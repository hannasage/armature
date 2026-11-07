// The release steps of docs/releasing.md as one script. Run it with `npm run release -- <subcommand>`.
//
//   status     reads the version, the tags, and the registry, and lists what is left        read-only
//   preflight  phase 1: the checkout is the release branch, up to date, and clean            local-write
//   gates      phase 2: npm ci, then typecheck, lint, test, build, and check:pack            local-write
//   dry-run    phase 3: npm publish --dry-run, then checks the package, files, size, and tag local-write
//   publish    phase 4: prints the commands for a person. It never runs them                 human-only
//   verify     phase 5: reads the registry and installs the package into a clean project    local-write
//   tag        phase 6: tags the commit from preflight and pushes the tag                    remote-write
//   retire     phase 7: prints the commands that retire the old version. It never runs them  human-only
//   claims     phase 8: finds text that says the package is not published                   read-only
//
// Every value about the release comes from release.config.json. The rules for all subcommands:
//   - The exact command is printed before it runs (`$ command`).
//   - `--json` prints one JSON object. Exit 0 is a pass, 1 is a failed check, and 2 is a wrong use of the script.
//   - A finished step can run again. It prints "already done" and exits 0. Pass `--force` to run it again.
//   - A step that fails stops the run. The script prints the first failing line only.
//   - publish and retire refuse unless standard input is a terminal. They print the commands and exit 2.
//     Even with a terminal they only print: the script never runs npm publish, npm login, npm deprecate, or npm dist-tag.
//   - The script never reads, stores, or prints a token, a password, or a one-time code. Output is scrubbed of token shapes.
//   - Child commands get a short allowlist of variables, never the whole environment. npm runs with a throwaway HOME and cache.
//     Every command has a time limit (2 minutes for git and npm view, 15 minutes for the gates). `status` exits 1 with status
//     "unknown" when it can not read the registry or the remote.
//   - verify runs the import of the installed package under Node's permission model (read access to the throwaway project only).
//     If this Node lacks the model, verify stops with exit 1 unless the person passes --allow-unsandboxed. With that flag the import
//     runs as ordinary code with the access of the user, in a project with no secrets, and a warning says so.
//   - A command that may start grandchildren runs in its own process group. On a timeout the whole group is killed.
// Preflight, gates, dry-run, and verify are local-write: they write a small note, `release-state.json`, inside the .git folder
// (preflight also runs git fetch, and verify also uses a temporary folder and the npm cache). The note holds the commit hash, the
// version, a hash of package-lock.json, and the integrity string of the published tarball. `tag` reads it so that it tags
// exactly the commit that preflight saw and refuses until verify has passed. The note holds no secret and is not in the working tree.
// A refused precondition exits 1. Exit 2 means wrong use of the script, or a human-only step run without a terminal.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gitEnv, makeScratch, toolEnv, viewEnv, baseEnv } from "../tools/lib/env.mjs";
import { effectiveTimeout, runCommand } from "../tools/lib/run-group.mjs";
import { failingLine, redact, redactDeep, show } from "../tools/lib/text.mjs";
import { sizeLimit } from "./pack-rules.mjs";

export { failingLine, redact };

/** The safety class of each subcommand. tools/manifest.json repeats these, and a test keeps the two equal. */
export const SAFETY = {
  status: "read-only",
  preflight: "local-write",
  gates: "local-write",
  "dry-run": "local-write",
  publish: "human-only",
  verify: "local-write",
  tag: "remote-write",
  retire: "human-only",
  claims: "read-only",
};

const GATE_COMMANDS = [
  ["npm", "ci"],
  ["npm", "run", "typecheck"],
  ["npm", "run", "lint"],
  ["npm", "run", "test"],
  ["npm", "run", "build"],
  ["npm", "run", "check:pack"],
];

const USAGE = [
  "Usage: node scripts/release.mjs <subcommand> [--json] [--force] [--help]",
  "  status | preflight | gates | dry-run | publish | verify | tag | retire | claims",
  "  tag also takes --dry-run, which prints the git commands and runs none of them.",
  "  verify also takes --allow-unsandboxed: without the Node permission model verify stops, and this flag lets it import the package anyway.",
  "  publish and retire are human-only: they print the commands and never run them.",
  "Exit codes: 0 pass, 1 a check failed (or status could not read a source), 2 wrong use.",
  "verify imports the installed package under the Node permission model. Without the model it stops unless --allow-unsandboxed is given.",
];

// ---------- config ----------

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const KEYS = {
  top: ["package", "version", "npmTag", "access", "expectedFileCount", "releaseBranch", "remote", "publicApi", "gitTag", "retire", "claims"],
  publicApi: ["file", "subpath"],
  gitTag: ["name", "message"],
  retire: ["oldVersion", "deprecateMessage", "removeTag", "promoteTag", "commands", "checks"],
  claims: ["patterns", "paths", "skipFileNames"],
};

const hasControl = (value) => [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
const isText = (value, max = 200) => typeof value === "string" && value !== "" && value.length <= max && !hasControl(value);
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const extraKeys = (object, allowed) => Object.keys(object).filter((key) => !allowed.includes(key));

function insideRoot(root, path) {
  if (typeof path !== "string" || path === "" || path.includes("\0") || isAbsolute(path)) return false;
  const rel = relative(root, resolve(root, path));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function branchOk(name) {
  return typeof name === "string" && BRANCH.test(name) && !name.includes("..") && !name.includes("//") && !/[/.]$/.test(name) && !name.endsWith(".lock");
}

/** The retire commands and checks in the one form that is allowed. The config must match these exactly. */
function canonicalRetire(config) {
  const { package: pkg, version } = config;
  const { oldVersion, deprecateMessage, removeTag, promoteTag } = config.retire;
  return {
    commands: [
      ["npm", "deprecate", `${pkg}@${oldVersion}`, deprecateMessage],
      ["npm", "dist-tag", "rm", pkg, removeTag],
      ["npm", "dist-tag", "add", `${pkg}@${version}`, promoteTag],
    ],
    checks: [
      ["npm", "view", pkg, "dist-tags", "--json"],
      ["npm", "view", `${pkg}@${oldVersion}`, "deprecated"],
    ],
  };
}

/** Checks the whole config. It returns a message that names the first problem, or null when the config is allowed. */
export function validateConfig(config, root) {
  if (!isObject(config)) return "the file is not a JSON object";
  const extra = extraKeys(config, KEYS.top);
  if (extra.length > 0) return `unknown key ${extra[0]}`;
  if (typeof config.package !== "string" || !PACKAGE.test(config.package)) return "package is not a valid npm package name";
  if (typeof config.version !== "string" || !VERSION.test(config.version)) return "version is not a version number";
  if (typeof config.npmTag !== "string" || !/^[a-z][a-z0-9._-]*$/.test(config.npmTag)) return "npmTag is not a valid dist-tag";
  if (config.access !== "public" && config.access !== "restricted") return "access must be public or restricted";
  if (!Number.isInteger(config.expectedFileCount) || config.expectedFileCount <= 0) return "expectedFileCount must be a positive whole number";
  if (!branchOk(config.releaseBranch)) return "releaseBranch is not a safe branch name";
  if (typeof config.remote !== "string" || !NAME.test(config.remote)) return "remote is not a safe remote name";
  for (const section of ["publicApi", "gitTag", "retire", "claims"]) {
    if (!isObject(config[section])) return `${section} must be an object`;
    const more = extraKeys(config[section], KEYS[section]);
    if (more.length > 0) return `unknown key ${section}.${more[0]}`;
  }
  if (!insideRoot(root, config.publicApi.file)) return "publicApi.file must be a path inside the repository";
  if (!isText(config.publicApi.subpath, 40)) return "publicApi.subpath must be text";
  const tag = fill(String(config.gitTag.name), { version: config.version });
  if (!NAME.test(tag)) return "gitTag.name does not make a safe tag name";
  if (!isText(config.gitTag.message)) return "gitTag.message must be one line of text";
  const retire = config.retire;
  if (typeof retire.oldVersion !== "string" || !VERSION.test(retire.oldVersion)) return "retire.oldVersion is not a version number";
  if (!isText(retire.deprecateMessage)) return "retire.deprecateMessage must be one line of text";
  for (const key of ["removeTag", "promoteTag"]) if (typeof retire[key] !== "string" || !/^[a-z][a-z0-9._-]*$/.test(retire[key])) return `retire.${key} is not a valid dist-tag`;
  const canonical = canonicalRetire(config);
  const values = valuesOf(config);
  for (const key of ["commands", "checks"]) {
    if (!Array.isArray(retire[key]) || retire[key].some((command) => !Array.isArray(command) || command.some((part) => typeof part !== "string"))) return `retire.${key} must be a list of commands`;
    const filled = retire[key].map((command) => command.map((part) => fill(part, values)));
    if (JSON.stringify(filled) !== JSON.stringify(canonical[key])) return `retire.${key} must be exactly ${JSON.stringify(canonical[key].map((command) => command.slice(0, 2).join(" ")))} in the pinned form`;
  }
  const claims = config.claims;
  if (!Array.isArray(claims.patterns) || claims.patterns.length === 0 || !claims.patterns.every((pattern) => isText(pattern))) return "claims.patterns must be a list of text";
  if (!Array.isArray(claims.paths) || claims.paths.length === 0 || !claims.paths.every((path) => insideRoot(root, path))) return "claims.paths must be a list of paths inside the repository";
  if (!Array.isArray(claims.skipFileNames) || !claims.skipFileNames.every((name) => isText(name, 100) && !/[/\\]/.test(name))) return "claims.skipFileNames must be a list of file names";
  return null;
}

/** Reads and checks release.config.json. A problem throws an error that names the file. */
export function loadConfig(root) {
  let config;
  try {
    config = JSON.parse(readFileSync(join(root, "release.config.json"), "utf8"));
  } catch (error) {
    throw new Error(`release.config.json can not be read: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const problem = validateConfig(config, root);
  if (problem !== null) throw new Error(`release.config.json is invalid: ${problem}`);
  return config;
}

/** Replaces each `{name}` in the text with the value for that name. */
export function fill(text, values) {
  return text.replace(/\{([A-Za-z]+)\}/g, (whole, name) => (name in values ? String(values[name]) : whole));
}

function valuesOf(config) {
  return {
    package: config.package,
    version: config.version,
    npmTag: config.npmTag,
    oldVersion: config.retire?.oldVersion,
    deprecateMessage: config.retire?.deprecateMessage,
    removeTag: config.retire?.removeTag,
    promoteTag: config.retire?.promoteTag,
  };
}

export function retireCommands(config) {
  return config.retire.commands.map((command) => command.map((part) => fill(part, valuesOf(config))));
}

function retireChecks(config) {
  return config.retire.checks.map((command) => command.map((part) => fill(part, valuesOf(config))));
}

export function gitTagName(config) {
  return fill(config.gitTag.name, valuesOf(config));
}

function gitTagMessage(config) {
  return fill(config.gitTag.message, valuesOf(config));
}

// ---------- small helpers ----------

/** Converts a size such as "137 kB" to bytes. npm counts a kilobyte as 1000 bytes. */
export function toBytes(amount, unit) {
  const factor = { B: 1, kB: 1000, MB: 1000 * 1000, GB: 1000 * 1000 * 1000 }[unit];
  return factor === undefined ? Number.NaN : Number(amount) * factor;
}

/** Reads the facts out of the text of `npm publish --dry-run`. A missing fact is null. */
export function parseDryRun(text) {
  const clean = text.split("\n").map((line) => line.replace(/^npm notice\s?/, "")).join("\n");
  const pick = (pattern) => pattern.exec(clean)?.slice(1) ?? null;
  const pkg = pick(/^package:\s+(\S+)@(\S+)\s*$/m);
  const files = pick(/^total files:\s+(\d+)\s*$/m);
  const size = pick(/^package size:\s+([\d.]+)\s*(B|kB|MB|GB)\s*$/m);
  const tag = pick(/with tag (\S+) and /);
  const plus = pick(/^\+ (\S+)@(\S+)\s*$/m);
  return {
    name: pkg?.[0] ?? null,
    version: pkg?.[1] ?? null,
    files: files === null ? null : Number(files[0]),
    bytes: size === null ? null : toBytes(size[0], size[1]),
    tag: tag?.[0] ?? null,
    dryRun: /\(dry-run\)/.test(clean),
    plusName: plus?.[0] ?? null,
    plusVersion: plus?.[1] ?? null,
  };
}

// ---------- state ----------

const COMMIT = /^[0-9a-f]{40}$/;
const isCommit = (value) => typeof value === "string" && COMMIT.test(value);
const isShort = (value) => typeof value === "string" && value.length > 0 && value.length <= 200;

function gitDir(root) {
  const dot = join(root, ".git");
  if (statSync(dot).isDirectory()) return dot;
  // In a git worktree .git is a file that holds the absolute path of the real git folder.
  const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(dot, "utf8"));
  if (!match) throw new Error(`${dot} is a file, but it does not name a git folder`);
  return resolve(root, match[1].trim());
}

/** A hash of package-lock.json, so a record is only trusted for the same dependencies. */
function lockHash(root) {
  try {
    return createHash("sha256").update(readFileSync(join(root, "package-lock.json"))).digest("hex");
  } catch {
    return "none";
  }
}

function warn(ctx, message) {
  ctx.warnings.push(message);
  ctx.run.say(message);
}

/** Keeps only the fields of the right shape. A forged or damaged field is dropped, never trusted. */
function cleanState(raw, version) {
  const state = { version };
  const ok = (value, test) => value !== null && typeof value === "object" && test(value);
  if (ok(raw.preflight, (v) => isCommit(v.commit))) state.preflight = { commit: raw.preflight.commit };
  for (const key of ["gates", "dryRun"]) if (ok(raw[key], (v) => isCommit(v.commit) && isShort(v.lock))) state[key] = { commit: raw[key].commit, lock: raw[key].lock };
  if (ok(raw.verify, (v) => isCommit(v.commit) && isShort(v.integrity) && (v.gitHead === null || isShort(v.gitHead)))) {
    state.verify = { commit: raw.verify.commit, integrity: raw.verify.integrity, gitHead: raw.verify.gitHead };
  }
  return state;
}

function readState(ctx) {
  const fresh = { version: ctx.config.version };
  let text;
  try {
    text = readFileSync(join(gitDir(ctx.root), "release-state.json"), "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") warn(ctx, "state file corrupt, reset");
    return fresh;
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = null;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    warn(ctx, "state file corrupt, reset");
    return fresh;
  }
  if (raw.version !== ctx.config.version) {
    warn(ctx, "state file is for another version, reset");
    return fresh;
  }
  return cleanState(raw, ctx.config.version);
}

/** Writes the state. It returns an error message, or null when the write worked. */
function writeState(ctx, state) {
  try {
    writeFileSync(join(gitDir(ctx.root), "release-state.json"), `${JSON.stringify(state, null, 2)}\n`);
    return null;
  } catch (error) {
    return `could not write the state file in .git: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ---------- running commands ----------

const MINUTE = 60 * 1000;

function makeRun(root, env, out, json) {
  const steps = [];
  const say = (line) => {
    if (!json) out(redact(line));
  };
  // One throwaway folder for the whole run, made when a command first needs it and removed at the end.
  let scratch = null;
  const getScratch = () => (scratch ??= makeScratch());
  /** Removes the scratch folder. It returns a warning text when the removal failed, so the result is still reported. */
  const cleanup = () => {
    try {
      scratch?.remove();
      return null;
    } catch (error) {
      return `could not remove the scratch folder: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      scratch = null;
    }
  };
  // RELEASE_TIMEOUT_MS can only shorten a limit. A test uses it to see a timeout.
  const limit = (ms) => effectiveTimeout(env, ms);
  const envFor = (command) => {
    if (command[0] === "git") return gitEnv(env);
    if (command[0] === "npm" && command[1] === "view") return viewEnv(env, getScratch());
    if (command[0] === "npm") return toolEnv(env, getScratch());
    return baseEnv(env);
  };
  const timeoutFor = (command) => (command[0] === "npm" && command[1] !== "view" ? 15 * MINUTE : 2 * MINUTE);
  /** Prints the command, runs it, and records the exit code. `display` is what is printed and recorded, when it must differ. */
  const exec = (command, options = {}) => {
    const shown = options.display ?? command;
    say(`$ ${show(shown)}`);
    const timeout = limit(options.timeout ?? timeoutFor(command));
    // "node" runs the same Node that runs this script, but the command is printed as "node" so no absolute path shows.
    const bin = command[0] === "node" ? process.execPath : command[0];
    // A command that may start grandchildren runs in its own process group, so a timeout kills the whole group.
    const result = runCommand({ command: [bin, ...command.slice(1)], cwd: options.cwd ?? root, env: options.env ?? envFor(command), timeout });
    const status = result.timedOut ? 124 : result.error !== null ? 127 : (result.status ?? (result.signal ? 128 : 1));
    steps.push({ command: redact(show(shown)), exit: status });
    return {
      ok: status === 0,
      status,
      stdout: result.stdout,
      stderr: result.timedOut ? `timed out after ${timeout} ms` : result.error !== null ? result.error : result.stderr,
    };
  };
  return { steps, say, exec, scratch: getScratch, cleanup };
}

function finish(ctx, base) {
  // The scratch folder goes first, so a failed removal becomes a warning in the result and not a crash after it.
  const problem = ctx.run.cleanup();
  if (problem !== null) ctx.warnings.push(problem);
  const body = {
    ok: base.exit === 0,
    command: base.command,
    status: base.status,
    exit: base.exit,
    message: base.message,
    steps: ctx.run.steps,
    ...base.extra,
  };
  if (ctx.warnings.length > 0) body.warnings = ctx.warnings;
  // Each string field is redacted on its own before the JSON is written.
  const safe = redactDeep(body);
  if (ctx.json) ctx.out(JSON.stringify(safe));
  else if (base.message) ctx.out(safe.message);
  return { exit: base.exit, result: safe };
}

function ok(ctx, message, extra = {}) {
  return finish(ctx, { command: ctx.command, status: "pass", exit: 0, message, extra });
}

function fail(ctx, line) {
  return finish(ctx, { command: ctx.command, status: "fail", exit: 1, message: `FAILED ${ctx.command}: ${line}`, extra: { failingLine: line } });
}

function done(ctx, extra = {}, note = "") {
  return finish(ctx, { command: ctx.command, status: "already-done", exit: 0, message: `already done${note ? `: ${note}` : ""}`, extra });
}

// ---------- shared checks ----------

function head(run) {
  const result = run.exec(["git", "rev-parse", "HEAD"]);
  return result.ok && COMMIT.test(result.stdout.trim()) ? result.stdout.trim() : null;
}

function treeIsClean(run) {
  const result = run.exec(["git", "status", "--short"]);
  const first = result.stdout.split("\n").find((line) => line.trim() !== "");
  return { ok: result.ok && first === undefined, first: first ?? failingLine(result.stdout, result.stderr) };
}

function distTags(run, config) {
  const result = run.exec(["npm", "view", config.package, "dist-tags", "--json"]);
  if (!result.ok) return { ok: false, missing: /E404/.test(result.stderr), tags: {}, error: failingLine(result.stdout, result.stderr) };
  try {
    const tags = JSON.parse(result.stdout);
    if (tags === null || typeof tags !== "object" || Array.isArray(tags)) throw new Error("not an object");
    return { ok: true, missing: false, tags, error: "" };
  } catch {
    return { ok: false, missing: false, tags: {}, error: "npm view did not print JSON" };
  }
}

/** The integrity string and the git head that the registry holds for the version. */
function registryInfo(run, config) {
  const result = run.exec(["npm", "view", `${config.package}@${config.version}`, "dist.integrity", "gitHead", "--json"]);
  if (!result.ok) return { ok: false, error: failingLine(result.stdout, result.stderr) };
  try {
    const body = JSON.parse(result.stdout);
    const integrity = body["dist.integrity"];
    const gitHead = body.gitHead ?? null;
    if (!isShort(integrity)) return { ok: false, error: "the registry returned no integrity string" };
    if (gitHead !== null && !isShort(gitHead)) return { ok: false, error: "the registry returned a bad gitHead" };
    return { ok: true, integrity, gitHead };
  } catch {
    return { ok: false, error: "npm view did not print JSON" };
  }
}

/** True when the old version is retired, false when it is not, and null when the deprecation could not be read. */
function isRetired(run, config, view) {
  if (!view.ok) return false;
  const tags = view.tags;
  if (tags[config.npmTag] !== config.version || tags[config.retire.promoteTag] !== config.version || config.retire.removeTag in tags) return false;
  const deprecated = run.exec(retireChecks(config)[1]);
  if (!deprecated.ok) return null;
  return deprecated.stdout.trim() !== "";
}

/** The commit that the remote tag points at (the peeled one for an annotated tag), null when there is none, or an error. */
function remoteTag(run, config, ref) {
  const result = run.exec(["git", "ls-remote", config.remote, ref, `${ref}^{}`]);
  if (!result.ok) return { ok: false, error: failingLine(result.stdout, result.stderr) };
  let direct = null;
  let peeled = null;
  for (const line of result.stdout.split("\n")) {
    const [hash, name] = line.trim().split(/\s+/);
    if (name === ref) direct = hash;
    if (name === `${ref}^{}`) peeled = hash;
  }
  return { ok: true, hash: peeled ?? direct };
}

/** Checks the claim paths. It returns the list of paths to search, or a problem message. */
function claimPaths(root, config) {
  let realRoot;
  try {
    realRoot = realpathSync(root);
  } catch {
    return { problem: "the repository folder can not be resolved" };
  }
  for (const path of config.claims.paths) {
    if (!existsSync(join(root, path))) return { problem: `the configured path ${path} does not exist, so the claims check did not search it` };
    const real = realpathSync(join(root, path));
    if (real !== realRoot && !real.startsWith(realRoot + sep)) return { problem: `the configured path ${path} points outside the repository` };
  }
  return { paths: config.claims.paths };
}

function runClaims(run, root, config) {
  const found = claimPaths(root, config);
  if (found.problem !== undefined) return { ok: false, first: found.problem };
  const command = ["grep", "-rnIF"];
  for (const pattern of config.claims.patterns) command.push("-e", pattern);
  for (const name of config.claims.skipFileNames) command.push(`--exclude=${name}`);
  command.push("--", ...found.paths);
  const result = run.exec(command);
  if (result.status === 1) return { ok: true, first: "", paths: found.paths };
  if (result.status === 0) return { ok: false, first: result.stdout.split("\n").find((line) => line.trim() !== "") ?? "" };
  return { ok: false, first: failingLine(result.stdout, result.stderr) };
}

function configDisagreement(root, config) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  } catch (error) {
    return `package.json can not be read: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (pkg.name !== config.package) return `package.json name is ${pkg.name}, release.config.json says ${config.package}`;
  if (pkg.version !== config.version) return `package.json version is ${pkg.version}, release.config.json says ${config.version}`;
  if (pkg.publishConfig?.tag !== config.npmTag) return `package.json publishConfig.tag is ${pkg.publishConfig?.tag}, release.config.json says ${config.npmTag}`;
  return null;
}

/** The number of run-time names the root entry must export. It is read from the public API list, never copied. */
async function expectedApiCount(root, config) {
  const api = await import(pathToFileURL(join(root, config.publicApi.file)).href);
  return api.API[config.publicApi.subpath].values.length;
}

function humanCommands(command, config) {
  if (command === "publish") {
    return ["npm whoami", "npm login   # only if whoami fails or shows the wrong account", `npm publish --tag ${config.npmTag} --access ${config.access}`];
  }
  return [...retireCommands(config).map(show), ...retireChecks(config).map(show)];
}

/** Writes the record, or turns a write error into a failed result. It returns null when the write worked. */
function record(ctx, state) {
  const problem = writeState(ctx, state);
  return problem === null ? null : fail(ctx, problem);
}

// ---------- subcommands ----------

const STEPS = {
  preflight(ctx) {
    const { run, root, config, flags } = ctx;
    const problem = configDisagreement(root, config);
    if (problem !== null) return fail(ctx, problem);
    const fetched = run.exec(["git", "fetch", config.remote]);
    if (!fetched.ok) return fail(ctx, failingLine(fetched.stdout, fetched.stderr));
    const branch = run.exec(["git", "rev-parse", "--abbrev-ref", "HEAD"]);
    if (!branch.ok || branch.stdout.trim() !== config.releaseBranch) {
      return fail(ctx, `on branch ${branch.stdout.trim() || "unknown"}, not ${config.releaseBranch}. Run: git checkout ${config.releaseBranch}`);
    }
    const remoteRef = `${config.remote}/${config.releaseBranch}`;
    const behind = run.exec(["git", "rev-list", "--count", `HEAD..${remoteRef}`]);
    if (!behind.ok || behind.stdout.trim() !== "0") return fail(ctx, `the branch is behind ${remoteRef}. Run: git pull --ff-only`);
    const ahead = run.exec(["git", "rev-list", "--count", `${remoteRef}..HEAD`]);
    if (!ahead.ok || ahead.stdout.trim() !== "0") return fail(ctx, `the branch has commits that ${remoteRef} lacks. Push them first`);
    const clean = treeIsClean(run);
    if (!clean.ok) return fail(ctx, `the working tree is not clean: ${clean.first}`);
    const log = run.exec(["git", "log", "-1", "--oneline"]);
    const commit = head(run);
    if (!log.ok || commit === null) return fail(ctx, failingLine(log.stdout, log.stderr));
    run.say(`commit: ${log.stdout.trim()}`);
    const state = readState(ctx);
    const finished = state.preflight?.commit === commit && !flags.has("--force");
    state.preflight = { commit };
    const bad = record(ctx, state);
    if (bad !== null) return bad;
    return finished ? done(ctx, { commit }, `preflight passed at ${commit}`) : ok(ctx, `preflight passed at ${commit}`, { commit });
  },

  gates(ctx) {
    const { run, root, flags } = ctx;
    const commit = head(run);
    if (commit === null) return fail(ctx, "could not read HEAD");
    const lock = lockHash(root);
    const state = readState(ctx);
    const before = treeIsClean(run);
    if (before.ok && !flags.has("--force") && state.gates?.commit === commit && state.gates?.lock === lock) return done(ctx, { commit });
    for (const command of GATE_COMMANDS) {
      const result = run.exec(command);
      if (!result.ok) return fail(ctx, `${show(command)} exited ${result.status}: ${failingLine(result.stdout, result.stderr)}`);
    }
    if (!before.ok) return ok(ctx, "gates passed, but the working tree was not clean at the start, so the result is not recorded", { commit, recorded: false });
    const after = treeIsClean(run);
    if (!after.ok) return fail(ctx, `the gates changed the working tree: ${after.first}`);
    state.gates = { commit, lock };
    const bad = record(ctx, state);
    return bad ?? ok(ctx, "gates passed", { commit, recorded: true });
  },

  "dry-run"(ctx) {
    const { run, root, config, flags } = ctx;
    const commit = head(run);
    if (commit === null) return fail(ctx, "could not read HEAD");
    const lock = lockHash(root);
    const state = readState(ctx);
    const before = treeIsClean(run);
    if (before.ok && !flags.has("--force") && state.dryRun?.commit === commit && state.dryRun?.lock === lock) return done(ctx, { commit });
    const command = ["npm", "publish", "--dry-run", "--tag", config.npmTag, "--access", config.access];
    const result = run.exec(command);
    if (!result.ok) return fail(ctx, `${show(command)} exited ${result.status}: ${failingLine(result.stdout, result.stderr)}`);
    const facts = parseDryRun(`${result.stderr}\n${result.stdout}`);
    const expected = `${config.package}@${config.version}`;
    const problems = [];
    if (facts.name !== config.package || facts.version !== config.version) problems.push(`package line is ${facts.name}@${facts.version}, expected ${expected}`);
    if (facts.files !== config.expectedFileCount) problems.push(`total files: ${facts.files}, expected ${config.expectedFileCount}`);
    if (facts.bytes === null || !(facts.bytes > 0) || facts.bytes > sizeLimit()) problems.push(`package size is ${facts.bytes} bytes, above the limit of ${sizeLimit()} bytes in scripts/pack-rules.mjs`);
    if (facts.tag !== config.npmTag) problems.push(`publish tag is ${facts.tag}, expected ${config.npmTag}`);
    if (!facts.dryRun) problems.push("the output does not say dry-run");
    if (facts.plusName !== config.package || facts.plusVersion !== config.version) problems.push(`last line is + ${facts.plusName}@${facts.plusVersion}, expected + ${expected}`);
    if (problems.length > 0) return fail(ctx, problems[0]);
    const summary = `dry run passed: ${expected}, ${facts.files} files, ${facts.bytes} bytes, tag ${facts.tag}`;
    if (!before.ok) return ok(ctx, `${summary}. The working tree was not clean at the start, so the result is not recorded`, { commit, recorded: false });
    const after = treeIsClean(run);
    if (!after.ok) return fail(ctx, `the dry run changed the working tree: ${after.first}`);
    state.dryRun = { commit, lock };
    const bad = record(ctx, state);
    return bad ?? ok(ctx, summary, { commit, recorded: true });
  },

  publish(ctx) {
    const { run, config } = ctx;
    const view = distTags(run, config);
    if (view.ok && view.tags[config.npmTag] === config.version) return done(ctx, {}, `${config.package}@${config.version} is on the ${config.npmTag} tag`);
    return humanOnly(ctx);
  },

  retire(ctx) {
    const { run, config } = ctx;
    if (isRetired(run, config, distTags(run, config)) === true) return done(ctx, {}, `${config.retire.oldVersion} is retired`);
    // Without a terminal the answer is exit 2 whatever the state is. With a terminal, verify must have passed first.
    if (!ctx.isTTY) return humanOnly(ctx);
    if (readState(ctx).verify === undefined) return fail(ctx, "refused: verify has not passed. Run: npm run release -- verify");
    return humanOnly(ctx);
  },

  async verify(ctx) {
    const { run, root, config, flags } = ctx;
    const commit = head(run);
    if (commit === null) return fail(ctx, "could not read HEAD");
    const state = readState(ctx);
    // The registry is read again on every run, before any "already done".
    const view = distTags(run, config);
    if (!view.ok) return fail(ctx, `could not read the registry: ${view.error}`);
    if (view.tags[config.npmTag] !== config.version) return fail(ctx, `dist-tag ${config.npmTag} is ${view.tags[config.npmTag] ?? "missing"}, expected ${config.version}`);
    const info = registryInfo(run, config);
    if (!info.ok) return fail(ctx, `could not read the integrity of ${config.package}@${config.version}: ${info.error}`);
    if (info.gitHead !== null && info.gitHead !== commit) return fail(ctx, `the registry gitHead ${info.gitHead} differs from the commit ${commit}`);
    const known = state.verify;
    if (!flags.has("--force") && known?.commit === commit && known.integrity === info.integrity && known.gitHead === info.gitHead) return done(ctx, { commit });
    // The import runs under the Node permission model. Without it the published code would run as ordinary code, so verify stops,
    // unless the person says to go on. RELEASE_FORCE_NO_PERMISSION=1 pretends the model is missing, for a test. It can only stop more.
    const flag = ctx.env.RELEASE_FORCE_NO_PERMISSION === "1" ? undefined : ["--permission", "--experimental-permission"].find((name) => process.allowedNodeEnvironmentFlags.has(name));
    if (flag === undefined) {
      if (!flags.has("--allow-unsandboxed")) return fail(ctx, "the Node permission model is not available, so verify will not import the package without a sandbox. Pass --allow-unsandboxed to run it anyway");
      warn(ctx, "the Node permission model is not available, so the import ran without it (--allow-unsandboxed)");
    }
    // Everything below runs in a throwaway project inside the scratch folder, with a throwaway HOME, cache, and npm config.
    const scratch = run.scratch();
    const temp = join(scratch.dir, "project");
    mkdirSync(temp);
    const isolated = viewEnv(ctx.env, scratch);
    for (const command of [
      ["npm", "init", "-y"],
      ["npm", "install", "--ignore-scripts", `${config.package}@${config.npmTag}`, "react"],
    ]) {
      const result = run.exec(command, { cwd: temp, env: isolated, timeout: 5 * MINUTE });
      if (!result.ok) return fail(ctx, `${show(command)} exited ${result.status}: ${failingLine(result.stdout, result.stderr)}`);
    }
    let installed = "unknown";
    try {
      installed = JSON.parse(readFileSync(join(temp, "node_modules", config.package, "package.json"), "utf8")).version;
    } catch {
      // The version check below reports it.
    }
    if (installed !== config.version) return fail(ctx, `the installed version is ${installed}, expected ${config.version}`);
    // The package name is an argument, not part of the code. The import runs under the Node permission model when this Node has it:
    // it may read only the throwaway project, may not write, and may not start a process. If this Node lacks the model, the import
    // runs without it and a warning says so.
    const code = "const name = process.argv[1]; const e = await import(name); console.log(Object.keys(e).length)";
    if (/[,*]/.test(temp)) return fail(ctx, "the scratch folder path holds a comma or an asterisk, which the permission flag can not take");
    const guard = flag === undefined ? [] : [flag, `--allow-fs-read=${temp}`];
    const command = ["node", ...guard, "--input-type=module", "-e", code, config.package];
    const display = ["node", ...(flag === undefined ? [] : [flag, "--allow-fs-read=<project>"]), "--input-type=module", "-e", code, config.package];
    const counted = run.exec(command, { cwd: temp, env: isolated, display });
    if (!counted.ok) return fail(ctx, `the import failed: ${failingLine(counted.stdout, counted.stderr)}`);
    const expected = await expectedApiCount(root, config);
    const actual = Number(counted.stdout.trim());
    if (actual !== expected) return fail(ctx, `the package exports ${actual} names, the public API list has ${expected}`);
    state.verify = { commit, integrity: info.integrity, gitHead: info.gitHead };
    const bad = record(ctx, state);
    return bad ?? ok(ctx, `verify passed: ${config.npmTag} is ${config.version} and the package exports ${actual} names`, { commit, exports: actual });
  },

  tag(ctx) {
    const { run, flags } = ctx;
    const config = ctx.config;
    const name = gitTagName(config);
    const ref = `refs/tags/${name}`;
    const state = readState(ctx);
    // Every precondition is checked first. Only then may a tag that already exists count as done.
    if (state.verify === undefined) return fail(ctx, "refused: verify has not passed. Run: npm run release -- verify");
    const commit = state.preflight?.commit;
    if (!commit) return fail(ctx, "refused: preflight has not passed. Run: npm run release -- preflight");
    const current = head(run);
    if (current !== commit || state.verify.commit !== commit) return fail(ctx, `refused: HEAD is ${current}, but preflight and verify saw ${commit}. Run both again`);
    const view = distTags(run, config);
    if (!view.ok) return fail(ctx, `refused: could not read the registry: ${view.error}`);
    if (view.tags[config.npmTag] !== config.version) return fail(ctx, `refused: dist-tag ${config.npmTag} is ${view.tags[config.npmTag] ?? "missing"}, expected ${config.version}`);
    const info = registryInfo(run, config);
    if (!info.ok) return fail(ctx, `refused: could not read the integrity: ${info.error}`);
    if (info.integrity !== state.verify.integrity || info.gitHead !== state.verify.gitHead) return fail(ctx, "refused: the registry integrity or gitHead changed since verify. Run verify again");
    const local = run.exec(["git", "rev-list", "-n", "1", ref]);
    const hasLocal = local.ok;
    const localHash = local.stdout.trim();
    const remote = remoteTag(run, config, ref);
    if (!remote.ok) return fail(ctx, `could not read the remote tags: ${remote.error}`);
    if (hasLocal && localHash !== commit) return fail(ctx, `the local tag ${name} points at ${localHash}, not at ${commit}`);
    if (remote.hash && remote.hash !== commit) return fail(ctx, `the remote tag ${name} points at ${remote.hash}, not at ${commit}`);
    if (remote.hash && !hasLocal) return fail(ctx, `remote tag exists, fetch it: git fetch ${config.remote} ${ref}:${ref}`);
    if (hasLocal && remote.hash) return done(ctx, { tag: name, commit });
    const clean = treeIsClean(run);
    if (!clean.ok) return fail(ctx, `refused: the working tree is not clean: ${clean.first}`);
    const create = ["git", "tag", "-a", name, commit, "-m", gitTagMessage(config)];
    const push = ["git", "push", config.remote, ref];
    if (flags.has("--dry-run")) {
      if (!hasLocal) run.say(`would run: ${show(create)}`);
      run.say(`would run: ${show(push)}`);
      return ok(ctx, "dry run: no git command was run", { tag: name, commit, commands: [...(hasLocal ? [] : [show(create)]), show(push)] });
    }
    if (!hasLocal) {
      const created = run.exec(create);
      if (!created.ok) return fail(ctx, failingLine(created.stdout, created.stderr));
    }
    const pushed = run.exec(push);
    if (!pushed.ok) return fail(ctx, failingLine(pushed.stdout, pushed.stderr));
    return ok(ctx, `tagged ${name} at ${commit} and pushed it`, { tag: name, commit });
  },

  claims(ctx) {
    const { run, root, config } = ctx;
    const found = runClaims(run, root, config);
    if (!found.ok) return fail(ctx, found.first);
    return ok(ctx, `claims check passed: no stale claim in ${found.paths.join(", ")}`, { searched: found.paths });
  },

  status(ctx) {
    const { run, root, config } = ctx;
    const state = readState(ctx);
    const commit = head(run);
    const lock = lockHash(root);
    const phases = [];
    const add = (name, finished, note = "") => phases.push({ name, state: finished === null ? "unknown" : finished ? "done" : "todo", note });
    const known = commit !== null;
    const noHead = known ? "" : "could not read HEAD";
    add("preflight", known ? state.preflight?.commit === commit : null, noHead);
    add("gates", known ? state.gates?.commit === commit && state.gates?.lock === lock : null, noHead);
    add("dry-run", known ? state.dryRun?.commit === commit && state.dryRun?.lock === lock : null, noHead);
    const view = distTags(run, config);
    add("publish", view.ok ? view.tags[config.npmTag] === config.version : view.missing ? false : null, view.ok ? "" : view.missing ? "registry says not found" : view.error);
    add("verify", known ? state.verify?.commit === commit : null, noHead);
    const ref = `refs/tags/${gitTagName(config)}`;
    const hasLocal = run.exec(["git", "rev-parse", "-q", "--verify", ref]).ok;
    const remote = remoteTag(run, config, ref);
    const wanted = state.preflight?.commit;
    const localHash = hasLocal ? run.exec(["git", "rev-list", "-n", "1", ref]).stdout.trim() : null;
    if (!remote.ok) {
      // The remote error comes first, so it is never hidden behind another note.
      add("tag", null, `could not read the remote tags: ${remote.error}${wanted ? "" : ". Preflight has not recorded a commit"}`);
    } else {
      let tagNote = "";
      if (!wanted) tagNote = "preflight has not recorded a commit";
      else if (localHash === null && !remote.hash) tagNote = "";
      else if (localHash !== wanted) tagNote = `local tag ${localHash === null ? "is missing" : `points at ${localHash}`}, expected ${wanted}`;
      else if (remote.hash !== wanted) tagNote = `remote tag ${remote.hash ? `points at ${remote.hash}` : "is missing"}, expected ${wanted}`;
      add("tag", wanted !== undefined && localHash === wanted && remote.hash === wanted, tagNote);
    }
    add("retire", view.ok ? isRetired(run, config, view) : view.missing ? false : null, view.ok || view.missing ? "" : view.error);
    add("claims", runClaims(run, root, config).ok);
    const left = phases.filter((phase) => phase.state !== "done").map((phase) => phase.name);
    run.say(`${config.package}@${config.version} on the ${config.npmTag} tag`);
    for (const phase of phases) run.say(`  ${phase.state.padEnd(7)} ${phase.name}${phase.note ? ` (${phase.note})` : ""}`);
    run.say(left.length === 0 ? "Nothing is left to do." : `Left to do: ${left.join(", ")}`);
    const unknown = phases.filter((phase) => phase.state === "unknown").map((phase) => phase.name);
    if (unknown.length > 0) {
      const message = `Could not determine: ${unknown.join(", ")}`;
      return finish(ctx, { command: "status", status: "unknown", exit: 1, message, extra: { package: config.package, version: config.version, phases, left, unknown } });
    }
    return finish(ctx, { command: "status", status: "pass", exit: 0, message: "", extra: { package: config.package, version: config.version, phases, left } });
  },
};

/** publish and retire. The script only prints the commands, and only a person at a terminal sees a clean exit. */
function humanOnly(ctx) {
  const commands = humanCommands(ctx.command, ctx.config);
  if (!ctx.json) {
    ctx.out(`${ctx.command} is human-only. This script never runs these commands. Run them yourself, in a terminal:`);
    for (const line of commands) ctx.out(`  ${redact(line)}`);
  }
  if (!ctx.isTTY) {
    return finish(ctx, {
      command: ctx.command,
      status: "refused",
      exit: 2,
      message: ctx.json ? `${ctx.command} is human-only and standard input is not a terminal` : "refused: standard input is not a terminal",
      extra: { commands },
    });
  }
  return finish(ctx, { command: ctx.command, status: "pass", exit: 0, message: "", extra: { commands } });
}

// ---------- entry ----------

const KNOWN_FLAGS = new Set(["--json", "--force", "--dry-run", "--allow-unsandboxed", "--help"]);

/**
 * Runs one subcommand. `context` is `{ root, env, isTTY, out }`. It returns `{ exit, result }` and never exits the process,
 * so a test can call it. A thrown error or a rejected promise becomes a failed result with exit 1.
 * The command line below is a thin wrapper.
 */
export async function runRelease(argv, context) {
  const { root, env, isTTY, out } = context;
  const flags = new Set(argv.filter((arg) => arg.startsWith("-")));
  const words = argv.filter((arg) => !arg.startsWith("-"));
  const json = flags.has("--json");
  const run = makeRun(root, env, out, json);
  const command = words[0];
  const base = { run, out, json, root, env, flags, isTTY, command, warnings: [] };
  if (flags.has("--help")) {
    for (const line of USAGE) out(line);
    return { exit: 0, result: { ok: true } };
  }
  if (words.length !== 1 || !Object.hasOwn(SAFETY, command)) {
    return usageError(base, command === undefined ? "No subcommand given." : `Unknown subcommand: ${words.join(" ")}`);
  }
  const bad = [...flags].find((flag) => !KNOWN_FLAGS.has(flag) || (flag === "--dry-run" && command !== "tag") || (flag === "--allow-unsandboxed" && command !== "verify"));
  if (bad !== undefined) return usageError(base, `The flag ${bad} does not belong to ${command}.`);
  try {
    const config = loadConfig(root);
    return await STEPS[command]({ ...base, config });
  } catch (error) {
    return fail(base, `internal error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    run.cleanup();
  }
}

function usageError(ctx, message) {
  const body = redactDeep({ ok: false, command: ctx.command ?? null, status: "usage", exit: 2, message, steps: ctx.run.steps, usage: USAGE });
  if (ctx.json) ctx.out(JSON.stringify(body));
  else for (const line of [body.message, ...USAGE]) ctx.out(line);
  return { exit: 2, result: body };
}

const here = fileURLToPath(import.meta.url);
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(here)) {
  const { exit } = await runRelease(process.argv.slice(2), {
    root: dirname(dirname(here)),
    env: process.env,
    isTTY: process.stdin.isTTY === true,
    out: (line) => console.log(line),
  });
  process.exit(exit);
}
