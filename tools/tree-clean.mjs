// Reports whether a clone tree is safe to remove. Safety class: read-only.
//
//   node tools/tree-clean.mjs <tree> [--json]
//
// It checks three things and prints one line for each:
//   clean   no changed or untracked file, no stash entry, and no ignored file except node_modules, dist, and .next.
//   pushed  every local branch is on a remote: none is ahead of its upstream, none tracks a local branch, and a branch with no
//           upstream has no commit that a remote lacks. It compares with the last fetch and does not fetch.
//   idle    no process has its working folder inside the tree. It reads `lsof -a -d cwd`.
// It exits 0 only when all three pass.
// This tool REMOVES NOTHING. It never deletes a file, a branch, or a worktree. Removal belongs to the factory-tree finish step
// of the workbench scripts. Run this tool first, and let that step do the removal.
// The tool lists the keys of the tree's own git config first, and refuses the tree when a key can make git run a program.
// Exit codes: 0 all three pass, 1 a check failed or git could not run, 2 wrong use.
import { spawnSync } from "node:child_process";
import process from "node:process";
import { parseArgs } from "node:util";
import { GIT_SAFE_CONFIG, gitEnv } from "./lib/env.mjs";
import { isMainModule } from "./lib/main.mjs";
import { resolveWorkTree } from "./lib/paths.mjs";
import { jsonLine, redact } from "./lib/text.mjs";

const USAGE = [
  "Usage: node tools/tree-clean.mjs <tree> [--json]",
  "Checks that a clone tree is clean, pushed, and idle. Exit 0 only when all three pass.",
  "This tool removes nothing. Removal belongs to the factory-tree finish step of the workbench scripts.",
  "Note: the tool refuses a tree whose own git config has a key that can make git run a program (a filter, a pager, a hook path, an alias, a credential helper).",
  "Exit codes: 0 all pass, 1 a check failed, 2 wrong use.",
].join("\n");

// The tree can be any path, so its config is not trusted: git runs with no fsmonitor, no hooks, and no external ssh, and with
// the short allowlisted environment (no token). GIT_OPTIONAL_LOCKS=0 keeps git status from rewriting the index.
const git = (tree, ...args) => spawnSync("git", [...GIT_SAFE_CONFIG, "-C", tree, ...args], { encoding: "utf8", env: gitEnv(process.env), maxBuffer: 256 * 1024 * 1024 });
const plural = (count, word) => `${count} ${count === 1 ? word : word === "process" ? "processes" : `${word}s`}`;

// A repository config that can make git run a program (a filter, a pager, a credential helper, a diff driver, an alias) or that
// pulls in more config. The tool does not chase flags to switch each one off. If the tree has any of these, it refuses the tree.
const RISKY_KEYS = [
  /^filter\./i,
  /^core\.(fsmonitor|hookspath|sshcommand|pager|editor|askpass|gitproxy)$/i,
  /^diff\..*\.(command|textconv)$/i,
  /^merge\..*\.driver$/i,
  /^include(if)?\./i,
  /^alias\./i,
  /^credential\./i,
  /^url\..*\.(insteadof|pushinsteadof)$/i,
  /^(uploadpack|receivepack)\./i,
];

/** The first key in the tree's own config that matches a risky pattern, null when none does, or an error text. */
function riskyConfig(tree) {
  const keys = [];
  for (const scope of ["--local", "--worktree"]) {
    const result = git(tree, "config", scope, "--list", "--name-only");
    if (result.status === 0) keys.push(...result.stdout.split("\n").filter((line) => line !== ""));
    else if (scope === "--local") return { error: `git config could not be read: ${result.stderr.trim().split("\n")[0]}` };
  }
  const key = keys.find((name) => RISKY_KEYS.some((pattern) => pattern.test(name)));
  return key === undefined ? null : { key };
}

// Build folders that git ignores and that may stay. The listing shows an ignored folder as one line.
const ALLOWED_IGNORED = new Set(["node_modules/", "dist/", ".next/"]);

function checkClean(tree) {
  // Every untracked file is shown, whatever the config says, and submodules are not skipped.
  const status = git(tree, "-c", "status.showUntrackedFiles=all", "status", "--porcelain", "--ignored=matching", "--untracked-files=all", "--ignore-submodules=none");
  if (status.status !== 0) return { ok: false, detail: `git status failed: ${status.stderr.trim().split("\n")[0]}` };
  const lines = status.stdout.split("\n").filter((line) => line !== "");
  // "!! path" is an ignored path. Only the build folders may be there. Anything else could be work that git does not track.
  const ignored = lines.filter((line) => line.startsWith("!! ")).map((line) => line.slice(3));
  const stray = ignored.filter((path) => !ALLOWED_IGNORED.has(path));
  const changed = lines.filter((line) => !line.startsWith("!! "));
  if (changed.length > 0) return { ok: false, detail: `${plural(changed.length, "changed or untracked path")}, first: ${changed[0]}` };
  if (stray.length > 0) return { ok: false, detail: `${plural(stray.length, "ignored path")} that is not node_modules, dist, or .next, first: ${stray[0]}` };
  // A file marked assume-unchanged (lowercase tag) or skip-worktree (S) hides its changes from git status.
  const flagged = git(tree, "ls-files", "-v");
  if (flagged.status !== 0) return { ok: false, detail: `git ls-files failed: ${flagged.stderr.trim().split("\n")[0]}` };
  const hidden = flagged.stdout.split("\n").filter((line) => /^[a-zS] /.test(line));
  if (hidden.length > 0) return { ok: false, detail: `${plural(hidden.length, "file")} marked assume-unchanged or skip-worktree, first: ${hidden[0].slice(2)}` };
  const stash = git(tree, "stash", "list");
  if (stash.status !== 0) return { ok: false, detail: `git stash list failed: ${stash.stderr.trim().split("\n")[0]}` };
  const entries = stash.stdout.split("\n").filter((line) => line !== "");
  if (entries.length > 0) return { ok: false, detail: `${plural(entries.length, "stash entry")}, first: ${entries[0]}` };
  return { ok: true, detail: "no changed, untracked, or stray ignored file, no hidden change, and no stash entry" };
}

/** Looks at every local branch, not only the one that is checked out, because removing the tree loses nothing else but a branch can hold unpushed work. */
function checkPushed(tree) {
  const head = git(tree, "symbolic-ref", "--short", "-q", "HEAD");
  if (head.status !== 0) return { ok: false, detail: "detached head: no branch to compare with a remote" };
  const format = "%(refname:short)%09%(upstream:short)%09%(upstream:track)%09%(upstream:remotename)";
  const listing = git(tree, "for-each-ref", `--format=${format}`, "refs/heads");
  if (listing.status !== 0) return { ok: false, detail: `git for-each-ref failed: ${listing.stderr.trim().split("\n")[0]}` };
  const problems = [];
  let count = 0;
  for (const line of listing.stdout.split("\n").filter((entry) => entry !== "")) {
    const [name, upstream, track, remote] = line.split("\t");
    count += 1;
    if (upstream !== "") {
      if (remote === ".") problems.push(`${name} tracks a local branch (${upstream}), which is not a remote`);
      else if (/gone/.test(track)) problems.push(`${name}: its upstream ${upstream} is gone`);
      else {
        const ahead = /ahead (\d+)/.exec(track);
        if (ahead) problems.push(`${name}: ${plural(Number(ahead[1]), "commit")} not on ${upstream}`);
      }
    } else {
      const lonely = git(tree, "rev-list", "--count", name, "--not", "--remotes");
      if (lonely.status !== 0) problems.push(`${name}: git rev-list failed`);
      else if (Number(lonely.stdout.trim()) > 0) problems.push(`${name}: ${plural(Number(lonely.stdout.trim()), "commit")} that no remote has`);
    }
  }
  if (count === 0) return { ok: false, detail: "no local branch found" };
  if (problems.length > 0) return { ok: false, detail: problems.join("; ") };
  return { ok: true, detail: `${plural(count, "local branch")} ${count === 1 ? "is" : "are"} on a remote, as of the last fetch (${head.stdout.trim()} is checked out)` };
}

/** The processes whose working folder is the tree or a folder below it. */
export function processesInside(tree, listing, ownPids) {
  const found = [];
  let current = null;
  for (const line of listing.split("\n")) {
    const tag = line[0];
    const rest = line.slice(1);
    if (tag === "p") current = { pid: Number(rest), command: "", path: "" };
    else if (current === null) continue;
    else if (tag === "c") current.command = rest;
    else if (tag === "n") {
      current.path = rest;
      const inside = rest === tree || rest.startsWith(`${tree}/`);
      if (inside && !ownPids.has(current.pid)) found.push({ ...current });
    }
  }
  return found;
}

function checkIdle(tree) {
  const result = spawnSync("lsof", ["-a", "-d", "cwd", "-Fpcn"], { cwd: "/", encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error !== undefined) return { ok: false, detail: `lsof could not run: ${result.error.message}` };
  // lsof exits 0 when it lists everything and 1 when it lists most but warns about some. Any other end is a failure.
  if (result.status !== 0 && result.status !== 1) return { ok: false, detail: `lsof ended with ${result.status === null ? `signal ${result.signal}` : `exit ${result.status}`}, so idle is not proven` };
  if (result.stdout === "") return { ok: false, detail: "lsof printed nothing, so idle is not proven" };
  const inside = processesInside(tree, result.stdout, new Set([process.pid, result.pid]));
  if (inside.length === 0) return { ok: true, detail: "no process has its working folder inside the tree" };
  const names = inside.map((entry) => `${entry.command} (pid ${entry.pid})`);
  return { ok: false, detail: `${plural(inside.length, "process")} inside: ${names.join(", ")}` };
}

function usageError(json, message, exit = 2) {
  if (json) console.log(jsonLine({ ok: false, status: exit === 2 ? "usage" : "fail", exit, message }));
  else console.error(redact(exit === 2 ? `${message}\n${USAGE}` : message));
  return exit;
}

export function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, strict: true, allowPositionals: true, options: { json: { type: "boolean" }, help: { type: "boolean" } } });
  } catch (error) {
    return usageError(argv.includes("--json"), error instanceof Error ? error.message : String(error));
  }
  const json = parsed.values.json === true;
  if (parsed.values.help) {
    console.log(USAGE);
    return 0;
  }
  if (parsed.positionals.length !== 1) return usageError(json, "Give exactly one tree path.");
  const tree = resolveWorkTree(parsed.positionals[0]);
  if (!tree.ok) return usageError(json, tree.error, tree.gitFailed ? 1 : 2);
  if (tree.path !== tree.top) return usageError(json, `${tree.path} is not the top of a work tree (the top is ${tree.top})`);

  const risky = riskyConfig(tree.top);
  if (risky !== null) {
    const detail = risky.error ?? `refused: the config key ${risky.key} can make git run a program, so no git command was run on this tree except reading its config`;
    const refused = [{ name: "config", ok: false, detail }];
    if (json) console.log(jsonLine({ ok: false, status: "fail", exit: 1, path: tree.top, removes: "nothing", refused: true, checks: refused }));
    else {
      console.log(`FAIL config - ${detail}`);
      console.log("Result: the tree is not safe to remove. This tool removed nothing.");
    }
    return 1;
  }

  const checks = [
    { name: "clean", ...checkClean(tree.top) },
    { name: "pushed", ...checkPushed(tree.top) },
    { name: "idle", ...checkIdle(tree.top) },
  ];
  const ok = checks.every((check) => check.ok);
  if (json) console.log(jsonLine({ ok, status: ok ? "pass" : "fail", exit: ok ? 0 : 1, path: tree.top, removes: "nothing", checks }));
  else {
    for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name} - ${check.detail}`);
    console.log(ok ? "Result: the tree is safe to remove. This tool removed nothing." : "Result: the tree is not safe to remove. This tool removed nothing.");
  }
  return ok ? 0 : 1;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
