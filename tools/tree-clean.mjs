// Reports whether a clone tree is safe to remove. Safety class: read-only.
//
//   node tools/tree-clean.mjs <tree> [--json]
//
// It checks three things and prints one line for each:
//   clean   `git status --porcelain` prints nothing. No changed and no untracked file.
//   pushed  the branch has no commit that its remote branch lacks. It compares with the last fetch and does not fetch.
//   idle    no process has its working folder inside the tree. It reads `lsof -a -d cwd`.
// It exits 0 only when all three pass.
// This tool REMOVES NOTHING. It never deletes a file, a branch, or a worktree. Removal belongs to the factory-tree finish step
// of the workbench scripts. Run this tool first, and let that step do the removal.
// Exit codes: 0 all three pass, 1 a check failed, 2 wrong use.
import { spawnSync } from "node:child_process";
import process from "node:process";
import { parseArgs } from "node:util";
import { resolveWorkTree } from "./lib/paths.mjs";

const USAGE = [
  "Usage: node tools/tree-clean.mjs <tree> [--json]",
  "Checks that a clone tree is clean, pushed, and idle. Exit 0 only when all three pass.",
  "This tool removes nothing. Removal belongs to the factory-tree finish step of the workbench scripts.",
  "Exit codes: 0 all pass, 1 a check failed, 2 wrong use.",
].join("\n");

const git = (tree, ...args) => spawnSync("git", ["-C", tree, ...args], { encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

function checkClean(tree) {
  const status = git(tree, "status", "--porcelain");
  if (status.status !== 0) return { ok: false, detail: `git status failed: ${status.stderr.trim().split("\n")[0]}` };
  const lines = status.stdout.split("\n").filter((line) => line !== "");
  return lines.length === 0 ? { ok: true, detail: "no changed and no untracked file" } : { ok: false, detail: `${plural(lines.length, "changed or untracked path")}, first: ${lines[0]}` };
}

function checkPushed(tree) {
  const branch = git(tree, "symbolic-ref", "--short", "-q", "HEAD");
  if (branch.status !== 0) return { ok: false, detail: "detached head: no branch to compare with a remote" };
  const name = branch.stdout.trim();
  let remote = git(tree, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}");
  let ref = remote.status === 0 ? remote.stdout.trim() : null;
  if (ref === null) {
    const fallback = `origin/${name}`;
    remote = git(tree, "rev-parse", "--verify", "-q", `refs/remotes/${fallback}`);
    ref = remote.status === 0 ? fallback : null;
  }
  if (ref === null) return { ok: false, detail: `the branch ${name} has no remote branch` };
  const ahead = git(tree, "rev-list", "--count", `${ref}..HEAD`);
  if (ahead.status !== 0) return { ok: false, detail: `git rev-list failed: ${ahead.stderr.trim().split("\n")[0]}` };
  const count = Number(ahead.stdout.trim());
  return count === 0 ? { ok: true, detail: `${name} matches ${ref} as of the last fetch` } : { ok: false, detail: `${plural(count, "commit")} not on ${ref}` };
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
  const result = spawnSync("lsof", ["-a", "-d", "cwd", "-Fpcn"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error !== undefined) return { ok: false, detail: `lsof could not run: ${result.error.message}` };
  if (result.stdout === "" && result.status !== 0) return { ok: false, detail: `lsof printed nothing and exited ${result.status}, so idle is not proven` };
  const inside = processesInside(tree, result.stdout, new Set([process.pid, process.ppid === undefined ? -1 : -2]));
  if (inside.length === 0) return { ok: true, detail: "no process has its working folder inside the tree" };
  const names = inside.map((entry) => `${entry.command} (pid ${entry.pid})`);
  return { ok: false, detail: `${plural(inside.length, "process")} inside: ${names.join(", ")}` };
}

function usageError(json, message) {
  if (json) console.log(JSON.stringify({ ok: false, status: "usage", exit: 2, message }));
  else console.error(`${message}\n${USAGE}`);
  return 2;
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
  if (!tree.ok) return usageError(json, tree.error);
  if (tree.path !== tree.top) return usageError(json, `${tree.path} is not the top of a work tree (the top is ${tree.top})`);

  const checks = [
    { name: "clean", ...checkClean(tree.top) },
    { name: "pushed", ...checkPushed(tree.top) },
    { name: "idle", ...checkIdle(tree.top) },
  ];
  const ok = checks.every((check) => check.ok);
  if (json) console.log(JSON.stringify({ ok, status: ok ? "pass" : "fail", exit: ok ? 0 : 1, path: tree.top, removes: "nothing", checks }));
  else {
    for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name} - ${check.detail}`);
    console.log(ok ? "Result: the tree is safe to remove. This tool removed nothing." : "Result: the tree is not safe to remove. This tool removed nothing.");
  }
  return ok ? 0 : 1;
}

process.exit(main(process.argv.slice(2)));
