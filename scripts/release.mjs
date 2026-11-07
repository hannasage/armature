// The release steps of docs/releasing.md as one script. Run it with `npm run release -- <subcommand>`.
//
//   status     reads the version, the tags, and the registry, and lists what is left        read-only
//   preflight  phase 1: the checkout is the release branch, up to date, and clean            read-only
//   gates      phase 2: npm ci, then typecheck, lint, test, build, and check:pack            local-write
//   dry-run    phase 3: npm publish --dry-run, then checks the package, files, size, and tag local-write
//   publish    phase 4: prints the commands for a person. It never runs them                 human-only
//   verify     phase 5: reads the registry and installs the package into a clean project    read-only
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
// Preflight, gates, dry-run, and verify write a small note, `release-state.json`, inside the .git folder. It holds the commit hash
// and the version, so that `tag` can tag exactly the commit that preflight saw and can refuse until verify has passed.
// It holds no secret and it is not part of the working tree.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sizeLimit } from "./pack-rules.mjs";

/** The safety class of each subcommand. tools/manifest.json repeats these, and a test keeps the two equal. */
export const SAFETY = {
  status: "read-only",
  preflight: "read-only",
  gates: "local-write",
  "dry-run": "local-write",
  publish: "human-only",
  verify: "read-only",
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
  "  publish and retire are human-only: they print the commands and never run them.",
  "Exit codes: 0 pass, 1 a check failed, 2 wrong use.",
];

// ---------- config ----------

export function loadConfig(root) {
  return JSON.parse(readFileSync(join(root, "release.config.json"), "utf8"));
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
    oldVersion: config.retire.oldVersion,
    deprecateMessage: config.retire.deprecateMessage,
    removeTag: config.retire.removeTag,
    promoteTag: config.retire.promoteTag,
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

/** Removes anything shaped like a token or a one-time-code flag from text that is about to be shown. */
export function redact(text) {
  return String(text)
    .replace(/npm_[A-Za-z0-9]{20,}/g, "[redacted]")
    .replace(/(--otp[= ])\S+/g, "$1[redacted]")
    .replace(/(_authToken=)\S+/g, "$1[redacted]");
}

/** The single line to show for a failed command: the first line that names an error, else the first line with text. */
export function failingLine(stdout, stderr) {
  const lines = `${stderr ?? ""}\n${stdout ?? ""}`.split("\n").map((line) => line.trim()).filter((line) => line !== "");
  const pick = lines.find((line) => /error|fail|not ok|✗|×/i.test(line)) ?? lines[0] ?? "no output";
  return redact(pick.length > 300 ? `${pick.slice(0, 300)}...` : pick);
}

function quote(part) {
  return /^[\w@%+=:,./-]+$/.test(part) ? part : `'${part.replaceAll("'", "'\\''")}'`;
}

function show(command) {
  return command.map(quote).join(" ");
}

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

function gitDir(root) {
  const dot = join(root, ".git");
  if (existsSync(dot) && statSync(dot).isDirectory()) return dot;
  const match = /^gitdir:\s*(.+)$/m.exec(readFileSync(dot, "utf8"));
  return match ? join(root, match[1].trim()) : dot;
}

function readState(root, config) {
  try {
    const state = JSON.parse(readFileSync(join(gitDir(root), "release-state.json"), "utf8"));
    return state.version === config.version ? state : { version: config.version };
  } catch {
    return { version: config.version };
  }
}

function writeState(root, state) {
  writeFileSync(join(gitDir(root), "release-state.json"), `${JSON.stringify(state, null, 2)}\n`);
}

// ---------- running commands ----------

function makeRun(root, env, out, json) {
  const steps = [];
  const say = (line) => {
    if (!json) out(redact(line));
  };
  /** Prints the command, runs it, and records the exit code. */
  const exec = (command, options = {}) => {
    say(`$ ${show(command)}`);
    const result = spawnSync(command[0], command.slice(1), {
      cwd: options.cwd ?? root,
      env,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
    const status = result.error !== undefined ? 127 : (result.status ?? (result.signal ? 128 : 1));
    steps.push({ command: show(command), exit: status });
    return {
      ok: status === 0,
      status,
      stdout: result.stdout ?? "",
      stderr: result.error !== undefined ? String(result.error.message) : (result.stderr ?? ""),
    };
  };
  return { steps, say, exec };
}

function finish(ctx, base) {
  const body = { ok: base.exit === 0, command: base.command, status: base.status, exit: base.exit, message: base.message, steps: ctx.run.steps, ...base.extra };
  if (ctx.json) ctx.out(JSON.stringify(body));
  else if (base.message) ctx.out(redact(base.message));
  return { exit: base.exit, result: body };
}

function ok(ctx, message, extra = {}, status = "pass") {
  return finish(ctx, { command: ctx.command, status, exit: 0, message, extra });
}

function fail(ctx, line) {
  const message = `FAILED ${ctx.command}: ${line}`;
  return finish(ctx, { command: ctx.command, status: "fail", exit: 1, message, extra: { failingLine: redact(line) } });
}

function done(ctx, extra = {}, note = "") {
  return ok(ctx, `already done${note ? `: ${note}` : ""}`, extra, "already-done");
}

// ---------- shared checks ----------

function head(run) {
  const result = run.exec(["git", "rev-parse", "HEAD"]);
  return result.ok ? result.stdout.trim() : null;
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
    return { ok: true, missing: false, tags: JSON.parse(result.stdout), error: "" };
  } catch {
    return { ok: false, missing: false, tags: {}, error: "npm view did not print JSON" };
  }
}

function isRetired(run, config, view) {
  if (!view.ok) return false;
  const tags = view.tags;
  if (tags[config.npmTag] !== config.version || tags[config.retire.promoteTag] !== config.version || config.retire.removeTag in tags) return false;
  const deprecated = run.exec(retireChecks(config)[1]);
  return deprecated.ok && deprecated.stdout.trim() !== "";
}

function remoteTagExists(run, config) {
  const result = run.exec(["git", "ls-remote", "--tags", config.remote, `refs/tags/${gitTagName(config)}`]);
  return result.ok && result.stdout.trim() !== "";
}

function claimsCommand(root, config) {
  const paths = config.claims.paths.filter((path) => existsSync(join(root, path)));
  if (paths.length === 0) return null;
  const command = ["grep", "-rnIF"];
  for (const pattern of config.claims.patterns) command.push("-e", pattern);
  for (const name of config.claims.skipFileNames ?? []) command.push(`--exclude=${name}`);
  return [...command, ...paths];
}

function runClaims(run, root, config) {
  const command = claimsCommand(root, config);
  if (command === null) return { ok: true, first: "" };
  const result = run.exec(command);
  if (result.status === 1) return { ok: true, first: "" };
  if (result.status === 0) return { ok: false, first: result.stdout.split("\n").find((line) => line.trim() !== "") ?? "" };
  return { ok: false, first: failingLine(result.stdout, result.stderr) };
}

function configDisagreement(root, config) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
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
    const state = readState(root, config);
    const finished = state.preflight?.commit === commit && !flags.has("--force");
    state.preflight = { commit };
    writeState(root, state);
    return finished ? done(ctx, { commit }, `preflight passed at ${commit}`) : ok(ctx, `preflight passed at ${commit}`, { commit });
  },

  gates(ctx) {
    const { run, root, config, flags } = ctx;
    const commit = head(run);
    const state = readState(root, config);
    if (commit !== null && state.gates?.commit === commit && !flags.has("--force") && treeIsClean(run).ok) return done(ctx, { commit });
    for (const command of GATE_COMMANDS) {
      const result = run.exec(command);
      if (!result.ok) return fail(ctx, `${show(command)} exited ${result.status}: ${failingLine(result.stdout, result.stderr)}`);
    }
    state.gates = { commit };
    writeState(root, state);
    return ok(ctx, "gates passed", { commit });
  },

  "dry-run"(ctx) {
    const { run, root, config, flags } = ctx;
    const commit = head(run);
    const state = readState(root, config);
    if (commit !== null && state.dryRun?.commit === commit && !flags.has("--force")) return done(ctx, { commit });
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
    state.dryRun = { commit };
    writeState(root, state);
    return ok(ctx, `dry run passed: ${expected}, ${facts.files} files, ${facts.bytes} bytes, tag ${facts.tag}`, { commit });
  },

  publish(ctx) {
    const { run, config } = ctx;
    const view = distTags(run, config);
    if (view.ok && view.tags[config.npmTag] === config.version) return done(ctx, {}, `${config.package}@${config.version} is on the ${config.npmTag} tag`);
    return humanOnly(ctx);
  },

  retire(ctx) {
    const { run, config } = ctx;
    if (isRetired(run, config, distTags(run, config))) return done(ctx, {}, `${config.retire.oldVersion} is retired`);
    return humanOnly(ctx);
  },

  async verify(ctx) {
    const { run, root, config, flags } = ctx;
    const commit = head(run);
    const state = readState(root, config);
    if (commit !== null && state.verify?.commit === commit && !flags.has("--force")) return done(ctx, { commit });
    const view = distTags(run, config);
    if (!view.ok) return fail(ctx, `could not read the registry: ${view.error}`);
    if (view.tags[config.npmTag] !== config.version) return fail(ctx, `dist-tag ${config.npmTag} is ${view.tags[config.npmTag] ?? "missing"}, expected ${config.version}`);
    const temp = mkdtempSync(join(tmpdir(), "release-verify-"));
    try {
      for (const command of [
        ["npm", "init", "-y"],
        ["npm", "install", `${config.package}@${config.npmTag}`, "react"],
      ]) {
        const result = run.exec(command, { cwd: temp });
        if (!result.ok) return fail(ctx, `${show(command)} exited ${result.status}: ${failingLine(result.stdout, result.stderr)}`);
      }
      let installed = "unknown";
      try {
        installed = JSON.parse(readFileSync(join(temp, "node_modules", config.package, "package.json"), "utf8")).version;
      } catch {
        // The version check below reports it.
      }
      if (installed !== config.version) return fail(ctx, `the installed version is ${installed}, expected ${config.version}`);
      const code = `import * as e from '${config.package}'; console.log(Object.keys(e).length)`;
      const counted = run.exec([process.execPath, "--input-type=module", "-e", code], { cwd: temp });
      if (!counted.ok) return fail(ctx, `the import failed: ${failingLine(counted.stdout, counted.stderr)}`);
      const expected = await expectedApiCount(root, config);
      const actual = Number(counted.stdout.trim());
      if (actual !== expected) return fail(ctx, `the package exports ${actual} names, the public API list has ${expected}`);
      state.verify = { commit };
      writeState(root, state);
      return ok(ctx, `verify passed: ${config.npmTag} is ${config.version} and the package exports ${actual} names`, { commit, exports: actual });
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  },

  tag(ctx) {
    const { run, root, config, flags } = ctx;
    const name = gitTagName(config);
    const hasLocal = run.exec(["git", "rev-parse", "-q", "--verify", `refs/tags/${name}`]);
    if (hasLocal.ok && remoteTagExists(run, config)) return done(ctx, { tag: name });
    const state = readState(root, config);
    if (state.verify?.commit === undefined) return fail(ctx, "refused: verify has not passed. Run: npm run release -- verify");
    const commit = state.preflight?.commit;
    if (!commit) return fail(ctx, "refused: preflight has not passed. Run: npm run release -- preflight");
    const current = head(run);
    if (current !== commit || state.verify.commit !== commit) return fail(ctx, `refused: HEAD is ${current}, but preflight and verify saw ${commit}. Run both again`);
    const clean = treeIsClean(run);
    if (!clean.ok) return fail(ctx, `refused: the working tree is not clean: ${clean.first}`);
    const create = ["git", "tag", "-a", name, commit, "-m", gitTagMessage(config)];
    const push = ["git", "push", config.remote, name];
    if (flags.has("--dry-run")) {
      ctx.run.say(`would run: ${show(create)}`);
      ctx.run.say(`would run: ${show(push)}`);
      return ok(ctx, "dry run: no git command was run", { tag: name, commit, commands: [show(create), show(push)] });
    }
    if (hasLocal.ok) {
      const at = run.exec(["git", "rev-list", "-n", "1", name]);
      if (!at.ok || at.stdout.trim() !== commit) return fail(ctx, `the local tag ${name} points at ${at.stdout.trim()}, not at ${commit}`);
    } else {
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
    return done(ctx, {}, "no file holds a stale claim");
  },

  status(ctx) {
    const { run, root, config } = ctx;
    const state = readState(root, config);
    const commit = head(run);
    const phases = [];
    const add = (name, finished, note = "") => phases.push({ name, state: finished === null ? "unknown" : finished ? "done" : "todo", note });
    add("preflight", state.preflight?.commit === commit);
    add("gates", state.gates?.commit === commit);
    add("dry-run", state.dryRun?.commit === commit);
    const view = distTags(run, config);
    add("publish", view.ok ? view.tags[config.npmTag] === config.version : view.missing ? false : null, view.ok ? "" : view.error);
    add("verify", state.verify?.commit === commit);
    const hasLocal = run.exec(["git", "rev-parse", "-q", "--verify", `refs/tags/${gitTagName(config)}`]).ok;
    add("tag", hasLocal && remoteTagExists(run, config));
    add("retire", view.ok ? isRetired(run, config, view) : null);
    add("claims", runClaims(run, root, config).ok);
    const left = phases.filter((phase) => phase.state !== "done").map((phase) => phase.name);
    run.say(`${config.package}@${config.version} on the ${config.npmTag} tag`);
    for (const phase of phases) run.say(`  ${phase.state.padEnd(7)} ${phase.name}${phase.note ? ` (${phase.note})` : ""}`);
    run.say(left.length === 0 ? "Nothing is left to do." : `Left to do: ${left.join(", ")}`);
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
      message: ctx.json ? `${ctx.command} is human-only and standard input is not a terminal` : `refused: standard input is not a terminal`,
      extra: { commands },
    });
  }
  return finish(ctx, { command: ctx.command, status: "pass", exit: 0, message: "", extra: { commands } });
}

// ---------- entry ----------

const KNOWN_FLAGS = new Set(["--json", "--force", "--dry-run", "--help"]);

/**
 * Runs one subcommand. `context` is `{ root, env, isTTY, out }`. It returns `{ exit, result }` and never exits the process,
 * so a test can call it. The command line below is a thin wrapper.
 */
export async function runRelease(argv, context) {
  const { root, env, isTTY, out } = context;
  const flags = new Set(argv.filter((arg) => arg.startsWith("-")));
  const words = argv.filter((arg) => !arg.startsWith("-"));
  const json = flags.has("--json");
  const run = makeRun(root, env, out, json);
  const command = words[0];
  const base = { run, out, json, root, flags, isTTY, command };
  if (flags.has("--help")) {
    for (const line of USAGE) out(line);
    return { exit: 0, result: { ok: true } };
  }
  if (words.length !== 1 || !(command in SAFETY)) {
    return usageError(base, command === undefined ? "No subcommand given." : `Unknown subcommand: ${words.join(" ")}`);
  }
  const bad = [...flags].find((flag) => !KNOWN_FLAGS.has(flag) || (flag === "--dry-run" && command !== "tag"));
  if (bad !== undefined) return usageError(base, `The flag ${bad} does not belong to ${command}.`);
  let config;
  try {
    config = loadConfig(root);
  } catch (error) {
    return usageError(base, `Cannot read release.config.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  return await STEPS[command]({ ...base, config });
}

function usageError(ctx, message) {
  const body = { ok: false, command: ctx.command ?? null, status: "usage", exit: 2, message, steps: ctx.run.steps, usage: USAGE };
  if (ctx.json) ctx.out(JSON.stringify(body));
  else for (const line of [message, ...USAGE]) ctx.out(line);
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
