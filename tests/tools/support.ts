// Helpers for the tests of the release script and the workflow tools.
// A test builds a temporary git repository and a temporary folder with a fake `npm` and a fake `gh`. The fakes go first on PATH.
// They log each call and never reach a real registry or a real remote. The only remote is a bare repository in the temporary folder.
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const temps: string[] = [];

/**
 * Runs a function with one environment variable set to a value (or removed, when the value is undefined), and then puts the
 * variable back as it was. A variable that was not set is deleted again. Assigning undefined to process.env would store the
 * text "undefined", which broke os.tmpdir() on a CI runner where TMPDIR is not set.
 */
export function withEnv<T>(name: string, value: string | undefined, fn: () => T): T {
  const had = Object.hasOwn(process.env, name);
  const saved = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  const restore = () => {
    if (had) process.env[name] = saved;
    else delete process.env[name];
  };
  let result: T;
  try {
    result = fn();
  } catch (error) {
    restore();
    throw error;
  }
  if (result instanceof Promise) return result.finally(restore) as T;
  restore();
  return result;
}

/** The environment of this process without tokens, npm settings, or fake-tool settings, so no test passes a secret through. */
export function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/token|secret|password|^npm_|^GH_|^GITHUB_|^FAKE_|^NODE_AUTH|^NPM_/i.test(key)) continue;
    env[key] = value;
  }
  return { ...env, ...extra };
}

/** Makes a temporary folder. `cleanup` removes every folder made so far. */
export function tempDir(prefix = "armature-tools-"): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  temps.push(dir);
  return dir;
}

export function cleanup(): void {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** Runs git and returns trimmed standard output. A failure throws, so a broken setup stops the test early. */
export function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: cleanEnv({ GIT_TERMINAL_PROMPT: "0" }) });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** A plain repository with one commit, a branch name, and no remote. */
export function makeRepo(branch = "main"): string {
  const dir = tempDir();
  git(dir, "init", "-q", "-b", branch);
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test");
  writeFileSync(join(dir, "file.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "first");
  return dir;
}

const FAKE_NPM = `#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The fake finds its log and its fixtures next to itself, so it works with a scrubbed environment.
const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "fixtures");
const read = (name) => { try { return readFileSync(join(dir, name), "utf8"); } catch { return null; } };
const knobs = JSON.parse(read("knobs.json") ?? "{}");
const knob = (name) => knobs[name] ?? process.env[name];
const args = process.argv.slice(2);
appendFileSync(join(here, "..", "calls.log"), JSON.stringify({ tool: "npm", args, cwd: process.cwd(), env: Object.keys(process.env).sort(), values: { HOME: process.env.HOME, cache: process.env.npm_config_cache, prefix: process.env.npm_config_prefix, hasPackageJson: existsSync(join(process.cwd(), "package.json")) } }) + "\\n");
const [command, ...rest] = args;
if (knob("FAKE_GRANDCHILD")) {
  const { spawn } = await import("node:child_process");
  const child = spawn("sleep", ["60"], { stdio: "ignore" });
  writeFileSync(join(dir, "grandchild.pid"), String(child.pid));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
}
if (knob("FAKE_SLEEP_MS")) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(knob("FAKE_SLEEP_MS")));

if (["login", "adduser", "whoami", "deprecate", "dist-tag", "unpublish", "token"].includes(command) || (command === "publish" && !rest.includes("--dry-run"))) {
  console.error("FAKE NPM: " + command + " is never allowed in a test");
  process.exit(99);
}
if (command === "run") {
  if (knob("FAKE_FAIL_RUN") === rest[0]) {
    console.error(knob("FAKE_FAIL_MESSAGE") ?? rest[0] + ": 1 error found");
    process.exit(Number(knob("FAKE_FAIL_CODE") ?? 1));
  }
  console.log(rest[0] + " ok");
  process.exit(0);
}
if (command === "ci") process.exit(knob("FAKE_FAIL_RUN") === "ci" ? 1 : 0);
if (command === "init") { writeFileSync("package.json", JSON.stringify({ name: "temp", version: "1.0.0" })); process.exit(0); }
if (command === "view") {
  const registryAt = rest.indexOf("--registry");
  const clean = registryAt >= 0 ? rest.filter((_, index) => index !== registryAt && index !== registryAt + 1) : rest;
  const fields = clean.slice(1).filter((field) => !field.startsWith("--"));
  if (fields[0] === "dist-tags") {
    const text = read("dist-tags.json");
    if (text === null) { console.error(knob("FAKE_VIEW_ERROR") ?? "npm error code E404"); process.exit(1); }
    console.log(text);
    process.exit(0);
  }
  if (fields[0] === "deprecated" && knob("FAKE_FAIL_DEPRECATED")) { console.error("npm error network down"); process.exit(1); }
  if (fields[0] === "deprecated") { const text = read("deprecated.txt"); console.log(text ?? ""); process.exit(0); }
  if (fields.includes("dist.integrity")) {
    if (knob("FAKE_BARE_INTEGRITY")) { console.log(JSON.stringify((read("integrity.txt") ?? "sha512-FAKEINTEGRITY").trim())); process.exit(0); }
    const body = { "dist.integrity": (read("integrity.txt") ?? "sha512-FAKEINTEGRITY").trim() };
    const head = read("gitHead.txt");
    if (head !== null) body.gitHead = head.trim();
    console.log(JSON.stringify(body));
    process.exit(0);
  }
  process.exit(0);
}
if (command === "install") {
  const regAt = rest.indexOf("--registry");
  const noReg = regAt >= 0 ? rest.filter((_, index) => index !== regAt && index !== regAt + 1) : rest;
  const spec = noReg.find((part) => !part.startsWith("-"));
  const at = spec.lastIndexOf("@");
  const name = at > 0 ? spec.slice(0, at) : spec;
  const tag = at > 0 ? spec.slice(at + 1) : "latest";
  const tags = JSON.parse(read("dist-tags.json") ?? "{}");
  const folder = join(process.cwd(), "node_modules", name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "package.json"), JSON.stringify({ name, version: tags[tag] ?? "0.0.0", type: "module", main: "index.js" }));
  writeFileSync("package-lock.json", JSON.stringify({ lockfileVersion: 3, packages: { ["node_modules/" + name]: { version: tags[tag] ?? "0.0.0", integrity: knob("FAKE_INSTALL_INTEGRITY") ?? (read("integrity.txt") ?? "sha512-FAKEINTEGRITY").trim() } } }));
  const count = Number(knob("FAKE_EXPORTS") ?? 29);
  writeFileSync(join(folder, "index.js"), Array.from({ length: count }, (_, index) => "export const name" + index + " = " + index + ";").join("\\n") + "\\n");
  process.exit(0);
}
if (command === "publish") {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const tagIndex = rest.indexOf("--tag");
  const tag = tagIndex >= 0 ? rest[tagIndex + 1] : "latest";
  const notices = [
    "package: " + manifest.name + "@" + manifest.version,
    "package size: " + (knob("FAKE_SIZE") ?? "137 kB"),
    "total files: " + (knob("FAKE_FILES") ?? 122),
    "Publishing to https://registry.npmjs.org/ with tag " + tag + " and public access (dry-run)",
  ];
  for (const line of notices) console.error("npm notice " + line);
  console.log("+ " + manifest.name + "@" + manifest.version);
  process.exit(0);
}
process.exit(0);
`;

const FAKE_GH = `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => { try { return readFileSync(join(here, "..", "fixtures", name), "utf8"); } catch { return null; } };
const knobs = JSON.parse(read("knobs.json") ?? "{}");
const args = process.argv.slice(2);
let stdin = null;
if (args.includes("-")) { try { stdin = readFileSync(0, "utf8"); } catch { stdin = ""; } }
appendFileSync(join(here, "..", "calls.log"), JSON.stringify({ tool: "gh", args, cwd: process.cwd(), stdin }) + "\\n");
if (knobs.FAKE_GH_SLEEP_MS && args[0] === "pr") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(knobs.FAKE_GH_SLEEP_MS));
if (args[0] === "api" && args[1] === "user") {
  if (knobs.FAKE_GH_API_FAIL) { console.error(knobs.FAKE_GH_API_FAIL === "1" ? "gh: HTTP 403 Resource not accessible by integration" : "gh: " + knobs.FAKE_GH_API_FAIL); process.exit(1); }
  console.log(knobs.FAKE_GH_API_OUTPUT ?? "example-user");
  process.exit(0);
}
if (knobs.FAKE_GH_FAIL) { console.error("gh: could not create the pull request"); process.exit(1); }
if (knobs.FAKE_GH_FAIL_URL) { console.log("https://github.com/example/repo/pull/7"); console.error("gh: something failed after creating"); process.exit(1); }
if (knobs.FAKE_GH_EMPTY) process.exit(0);
if (knobs.FAKE_GH_BIGOUTPUT) { console.log("x".repeat(200000)); console.log("https://github.com/example/repo/pull/8"); process.exit(0); }
console.log(knobs.FAKE_GH_OUTPUT ?? "https://github.com/example/repo/pull/1");
`;

export interface FakeBin {
  bin: string;
  fixtures: string;
  log: string;
  env(extra?: Record<string, string>): NodeJS.ProcessEnv;
  calls(): { tool: string; args: string[]; cwd: string; stdin?: string | null; env?: string[]; values?: { HOME?: string; cache?: string; prefix?: string; hasPackageJson?: boolean } }[];
  /** The calls to one tool, as space-joined text. */
  lines(tool: string): string[];
}

/** A folder with a fake `npm` and a fake `gh`, a folder of fixtures, and a call log. */
export function makeFakeBin(): FakeBin {
  const root = tempDir("armature-fakebin-");
  const bin = join(root, "bin");
  const fixtures = join(root, "fixtures");
  mkdirSync(bin);
  mkdirSync(fixtures);
  const log = join(root, "calls.log");
  writeFileSync(log, "");
  for (const [name, source] of [["npm", FAKE_NPM], ["gh", FAKE_GH]] as const) {
    const file = join(bin, name);
    // The file is a module, so it needs the .mjs behavior. A package.json next to it says "type": "module".
    writeFileSync(file, source);
    chmodSync(file, 0o755);
  }
  writeFileSync(join(bin, "package.json"), JSON.stringify({ type: "module" }));
  const calls = () =>
    readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as { tool: string; args: string[]; cwd: string; stdin?: string | null; env?: string[]; values?: { HOME?: string; cache?: string; prefix?: string; hasPackageJson?: boolean } });
  return {
    bin,
    fixtures,
    log,
    env(extra = {}) {
      // The fakes read their settings from a file next to them, because the release script scrubs the environment of some commands.
      const knobs = Object.fromEntries(Object.entries(extra).filter(([key]) => key.startsWith("FAKE_")));
      writeFileSync(join(fixtures, "knobs.json"), JSON.stringify(knobs));
      return cleanEnv({ PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_GLOBAL: "/dev/null", ...extra });
    },
    calls,
    lines: (tool) => calls().filter((call) => call.tool === tool).map((call) => call.args.join(" ")),
  };
}

export interface ReleaseRepo {
  work: string;
  origin: string;
  fake: FakeBin;
  script: string;
  run(args: string[], extraEnv?: Record<string, string>): SpawnSyncReturns<string>;
  env(extra?: Record<string, string>): NodeJS.ProcessEnv;
}

/** A work repository on the release branch with a local bare `origin`, plus the release script copied in. */
export function makeReleaseRepo(): ReleaseRepo {
  const fake = makeFakeBin();
  const base = tempDir("armature-release-");
  const origin = join(base, "origin.git");
  const work = join(base, "work");
  mkdirSync(origin);
  mkdirSync(work);
  git(origin, "init", "-q", "--bare", "-b", "release/1.0.0");
  git(work, "init", "-q", "-b", "release/1.0.0");
  git(work, "config", "user.email", "test@example.com");
  git(work, "config", "user.name", "Test");
  mkdirSync(join(work, "scripts"));
  mkdirSync(join(work, "docs"));
  const config = JSON.parse(readFileSync(join(repoRoot, "release.config.json"), "utf8")) as { package: string; version: string; npmTag: string };
  writeFileSync(
    join(work, "package.json"),
    JSON.stringify({ name: config.package, version: config.version, type: "module", publishConfig: { access: "public", tag: config.npmTag } }, null, 2),
  );
  copyFileSync(join(repoRoot, "release.config.json"), join(work, "release.config.json"));
  for (const file of ["release.mjs", "public-api.mjs", "pack-rules.mjs"]) copyFileSync(join(repoRoot, "scripts", file), join(work, "scripts", file));
  mkdirSync(join(work, "tools", "lib"), { recursive: true });
  for (const file of ["text.mjs", "env.mjs", "run-group.mjs"]) copyFileSync(join(repoRoot, "tools", "lib", file), join(work, "tools", "lib", file));
  writeFileSync(join(work, "README.md"), "# Package\n\nThe version is on the beta tag.\n");
  // The releasing page quotes the stale phrases on purpose, so the claim check must skip it.
  writeFileSync(join(work, "docs", "releasing.md"), "Search for `Not published yet` and `Nothing is published`.\n");
  git(work, "add", "-A");
  git(work, "commit", "-q", "-m", "first");
  git(work, "remote", "add", "origin", origin);
  git(work, "push", "-q", "-u", "origin", "release/1.0.0");
  const script = join(work, "scripts", "release.mjs");
  writeFileSync(join(fake.fixtures, "dist-tags.json"), JSON.stringify({ next: "1.0.0-next.0", latest: "1.0.0-next.0" }));
  // A real package has a gitHead that names the commit it was published from. The fake registry says the first commit.
  writeFileSync(join(fake.fixtures, "gitHead.txt"), `${git(work, "rev-parse", "HEAD")}\n`);
  const env = (extra: Record<string, string> = {}) => fake.env(extra);
  return {
    work,
    origin,
    fake,
    script,
    env,
    run: (args, extraEnv = {}) => spawnSync(process.execPath, [script, ...args], { cwd: work, env: env(extraEnv), encoding: "utf8" }),
  };
}

/** Runs a node script with the given arguments. */
export function runNode(script: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [script, ...args], { cwd: options.cwd ?? repoRoot, env: options.env ?? cleanEnv(), encoding: "utf8" });
}

/** A map of every file under a folder (path from the folder, to a hash of its bytes). Used to see what a command changed. */
export function snapshot(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (folder: string) => {
    for (const name of readdirSync(folder)) {
      const full = join(folder, name);
      const info = statSync(full);
      if (info.isDirectory()) walk(full);
      else files.set(full.slice(dir.length + 1), createHash("sha1").update(readFileSync(full)).digest("hex"));
    }
  };
  walk(dir);
  return files;
}

/** The paths that were added, changed, or removed between two snapshots. */
export function changedPaths(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return [...paths].filter((path) => before.get(path) !== after.get(path)).sort();
}

/**
 * Puts a `git` on PATH that records three environment values and then runs the real git.
 * The record is one line per call: GIT_TERMINAL_PROMPT, GIT_SSH_COMMAND, and NPM_TOKEN (or "none").
 */
export function addGitSpy(fake: FakeBin): string {
  const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  const log = join(fake.bin, "..", "git-env.log");
  writeFileSync(log, "");
  const file = join(fake.bin, "git");
  writeFileSync(file, `#!/bin/sh\nprintf '%s|%s|%s\\n' "$GIT_TERMINAL_PROMPT" "$GIT_SSH_COMMAND" "\${NPM_TOKEN:-none}" >> '${log}'\nexec '${real}' "$@"\n`);
  chmodSync(file, 0o755);
  return log;
}
