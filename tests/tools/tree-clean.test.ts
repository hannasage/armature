import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, git, makeRepo, repoRoot, runNode, tempDir } from "./support";

afterEach(cleanup);

const script = join(repoRoot, "tools/tree-clean.mjs");

/** A work repository with a bare origin, pushed, on a branch called task/x. */
function pushedTree() {
  const base = tempDir();
  const origin = join(base, "origin.git");
  git(base, "init", "-q", "--bare", "-b", "main", origin);
  const work = makeRepo("task/x");
  git(work, "remote", "add", "origin", origin);
  git(work, "push", "-q", "-u", "origin", "task/x");
  return work;
}

describe("tree-clean", () => {
  it("passes all three checks for a clean, pushed, idle tree", () => {
    const tree = pushedTree();
    const result = runNode(script, [tree]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PASS clean");
    expect(result.stdout).toContain("PASS pushed");
    expect(result.stdout).toContain("PASS idle");
  });

  it("fails clean for an untracked file and for a changed file", () => {
    const tree = pushedTree();
    writeFileSync(join(tree, "new.txt"), "x");
    const result = runNode(script, [tree]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL clean");
    expect(result.stdout).toContain("PASS pushed");
    writeFileSync(join(tree, "file.txt"), "changed\n");
    expect(runNode(script, [tree]).stdout).toContain("FAIL clean");
  });

  it("fails pushed when a commit is not on origin", () => {
    const tree = pushedTree();
    writeFileSync(join(tree, "more.txt"), "x");
    git(tree, "add", "-A");
    git(tree, "commit", "-q", "-m", "local");
    const result = runNode(script, [tree]);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/FAIL pushed.*1 commit/);
    expect(result.stdout).toContain("PASS clean");
  });

  it("fails pushed when the branch has no remote at all", () => {
    const tree = makeRepo("task/y");
    const result = runNode(script, [tree]);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/FAIL pushed/);
  });

  it("fails pushed on a detached head", () => {
    const tree = pushedTree();
    git(tree, "checkout", "-q", "--detach");
    expect(runNode(script, [tree]).stdout).toMatch(/FAIL pushed.*detached/);
  });

  it("fails idle while a process has its working folder inside the tree", async () => {
    const tree = pushedTree();
    const child = spawn("sleep", ["30"], { cwd: tree, stdio: "ignore" });
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const result = runNode(script, [tree]);
      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(/FAIL idle.*sleep/);
      expect(result.stdout).toContain(String(child.pid));
    } finally {
      child.kill();
    }
  });

  it("counts a process in a folder below the tree as inside it", async () => {
    const tree = pushedTree();
    const child = spawn("sleep", ["30"], { cwd: join(tree, ".git"), stdio: "ignore" });
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(runNode(script, [tree]).stdout).toMatch(/FAIL idle/);
    } finally {
      child.kill();
    }
  });

  it("removes nothing", () => {
    const tree = pushedTree();
    writeFileSync(join(tree, "new.txt"), "x");
    runNode(script, [tree]);
    expect(git(tree, "status", "--short")).toBe("?? new.txt");
  });

  it("prints one JSON object under --json", () => {
    const tree = pushedTree();
    const body = JSON.parse(runNode(script, [tree, "--json"]).stdout);
    expect(body).toMatchObject({ ok: true, exit: 0, path: tree });
    expect(body.checks.map((check: { name: string }) => check.name)).toEqual(["clean", "pushed", "idle"]);
    writeFileSync(join(tree, "new.txt"), "x");
    const dirty = JSON.parse(runNode(script, [tree, "--json"]).stdout);
    expect(dirty).toMatchObject({ ok: false, exit: 1 });
    expect(dirty.checks.find((check: { name: string }) => check.name === "clean")).toMatchObject({ ok: false });
  });

  it("exits 2 for a missing path, a path that is not a work tree, no path, and an unknown flag", () => {
    expect(runNode(script, ["/nonexistent/tree"]).status).toBe(2);
    expect(runNode(script, [tempDir()]).status).toBe(2);
    expect(runNode(script, []).status).toBe(2);
    expect(runNode(script, [pushedTree(), "--bogus"]).status).toBe(2);
  });

  it("exits 2 for a folder below the top of the tree", () => {
    const tree = pushedTree();
    expect(runNode(script, [join(tree, ".git")]).status).toBe(2);
  });

  it("says in --help that it removes nothing", () => {
    const result = runNode(script, ["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/removes nothing/i);
    expect(result.stdout).toContain("factory-tree");
  });
});
