import { execSync } from "node:child_process";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, makeFakeBin, makeRepo, repoRoot, runNode, tempDir } from "./support";

afterEach(cleanup);

const script = join(repoRoot, "tools/gates.mjs");

function setup() {
  const fake = makeFakeBin();
  const repo = makeRepo();
  const run = (args: string[], env: Record<string, string> = {}) => runNode(script, args, { cwd: repo, env: fake.env(env) });
  return { fake, repo, run };
}

describe("gates", () => {
  it("runs the five gates in order and prints one line per gate", () => {
    const { fake, run } = setup();
    const result = run([]);
    expect(result.status).toBe(0);
    expect(fake.lines("npm")).toEqual(["run typecheck", "run lint", "run test", "run build", "run check:pack"]);
    const lines = result.stdout.trim().split("\n");
    expect(lines.filter((line) => line.startsWith("PASS"))).toHaveLength(5);
    expect(lines[0]).toBe("PASS npm run typecheck (exit 0)");
  });

  it("with --ci runs npm ci first", () => {
    const { fake, run } = setup();
    expect(run(["--ci"]).status).toBe(0);
    expect(fake.lines("npm")[0]).toBe("ci");
    expect(fake.lines("npm")).toHaveLength(6);
  });

  it("reports the real exit code and never prints a pass line over a nonzero code", () => {
    const { run } = setup();
    const result = run([], { FAKE_FAIL_RUN: "lint", FAKE_FAIL_CODE: "3", FAKE_FAIL_MESSAGE: "src/a.ts: error no-unused-vars\nsecond line" });
    expect(result.status).toBe(1);
    const lines = result.stdout.trim().split("\n");
    expect(lines.some((line) => /^PASS .*lint/.test(line))).toBe(false);
    expect(lines.find((line) => line.includes("lint"))).toMatch(/^FAIL npm run lint \(exit 3\)/);
    expect(result.stdout).toContain("src/a.ts: error no-unused-vars");
    expect(result.stdout).not.toContain("second line");
  });

  it("still runs the later gates after a failure, and shows each one", () => {
    const { fake, run } = setup();
    const result = run([], { FAKE_FAIL_RUN: "lint" });
    expect(fake.lines("npm")).toHaveLength(5);
    expect(result.stdout.split("\n").filter((line) => /^(PASS|FAIL)/.test(line))).toHaveLength(5);
  });

  it("with --bail stops at the first failure", () => {
    const { fake, run } = setup();
    expect(run(["--bail"], { FAKE_FAIL_RUN: "lint" }).status).toBe(1);
    expect(fake.lines("npm")).toEqual(["run typecheck", "run lint"]);
  });

  it("prints one JSON object with the exit code of each gate", () => {
    const { run } = setup();
    const result = run(["--json", "--ci"], { FAKE_FAIL_RUN: "test", FAKE_FAIL_CODE: "7" });
    const body = JSON.parse(result.stdout);
    expect(body.ok).toBe(false);
    expect(body.exit).toBe(1);
    expect(body.gates.map((gate: { name: string }) => gate.name)).toEqual(["ci", "typecheck", "lint", "test", "build", "check:pack"]);
    expect(body.gates.find((gate: { name: string }) => gate.name === "test")).toMatchObject({ exit: 7, ok: false });
    expect(body.gates.filter((gate: { ok: boolean }) => gate.ok)).toHaveLength(5);
  });

  it("treats a missing npm as a failure with no pass line", () => {
    const { repo } = setup();
    // A folder on PATH that holds only git, so the tool can check the work tree but cannot find npm.
    const only = tempDir();
    symlinkSync(execSync("command -v git", { shell: "/bin/sh", encoding: "utf8" }).trim(), join(only, "git"));
    const result = runNode(script, [], { cwd: repo, env: { ...process.env, PATH: only } });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("PASS");
  });

  it("exits 2 for an unknown flag", () => {
    expect(setup().run(["--bogus"]).status).toBe(2);
  });

  it("runs in the folder given by --cwd and refuses a folder that is not a work tree", () => {
    const { fake, run, repo } = setup();
    expect(run(["--cwd", repo]).status).toBe(0);
    expect(fake.calls()[0]?.cwd).toBe(repo);
    expect(run(["--cwd", tempDir()]).status).toBe(2);
    expect(run(["--cwd", "/nonexistent"]).status).toBe(2);
  });
});
