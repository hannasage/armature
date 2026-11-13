import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, git, makeFakeBin, makeReleaseRepo, makeRepo, repoRoot, runNode, tempDir, type ReleaseRepo } from "./support";

afterEach(cleanup);

type Phase = { name: string; state: string; note: string };
type Body = { ok: boolean; status: string; exit: number; message: string; phases?: Phase[]; warnings?: string[]; [key: string]: unknown };
const parse = (text: string) => JSON.parse(text) as Body;
const BETA = JSON.stringify({ beta: "1.0.0-beta.1", next: "1.0.0-next.0", latest: "1.0.0-next.0" });
const phase = (body: Body, name: string) => body.phases?.find((entry) => entry.name === name) as Phase;
const setTags = (repo: ReleaseRepo, text = BETA) => writeFileSync(join(repo.fake.fixtures, "dist-tags.json"), text);

describe("status before the first publish", () => {
  it("treats a registry 404 as the normal state: publish and retire are todo, and the exit is 0", () => {
    const repo = makeReleaseRepo();
    rmSync(join(repo.fake.fixtures, "dist-tags.json"));
    const result = repo.run(["status", "--json"]);
    expect(result.status).toBe(0);
    const body = parse(result.stdout);
    expect(body).toMatchObject({ ok: true, status: "pass", exit: 0 });
    expect(phase(body, "publish")).toMatchObject({ state: "todo" });
    expect(phase(body, "publish").note).toContain("registry says not found");
    expect(phase(body, "retire").state).toBe("todo");
  });

  it("treats a failed registry read that is not a 404 as unknown, with exit 1", () => {
    const repo = makeReleaseRepo();
    const result = repo.run(["status", "--json"], { FAKE_SLEEP_MS: "4000", RELEASE_TIMEOUT_MS: "400" });
    expect(result.status).toBe(1);
    const body = parse(result.stdout);
    expect(body.status).toBe("unknown");
    expect(phase(body, "publish").state).toBe("unknown");
  });
});

describe("status when retire can not be checked", () => {
  it("marks retire unknown when the deprecation read fails", () => {
    const repo = makeReleaseRepo();
    setTags(repo, JSON.stringify({ beta: "1.0.0-beta.1", latest: "1.0.0-beta.1" }));
    const result = repo.run(["status", "--json"], { FAKE_FAIL_DEPRECATED: "1" });
    expect(result.status).toBe(1);
    const body = parse(result.stdout);
    expect(phase(body, "retire").state).toBe("unknown");
    expect(body.status).toBe("unknown");
  });

  it("does not call retire done when the read fails", () => {
    const repo = makeReleaseRepo();
    setTags(repo, JSON.stringify({ beta: "1.0.0-beta.1", latest: "1.0.0-beta.1" }));
    const result = repo.run(["retire"], { FAKE_FAIL_DEPRECATED: "1" });
    expect(result.stdout).not.toContain("already done");
  });
});

describe("status when HEAD can not be read", () => {
  it("marks preflight, gates, dry-run, and verify unknown, and exits 1", () => {
    const repo = makeReleaseRepo();
    git(repo.work, "checkout", "-q", "--orphan", "empty");
    const result = repo.run(["status", "--json"]);
    expect(result.status).toBe(1);
    const body = parse(result.stdout);
    for (const name of ["preflight", "gates", "dry-run", "verify"]) expect(phase(body, name).state, name).toBe("unknown");
    expect(body.status).toBe("unknown");
  });
});

describe("redaction of usage errors", () => {
  it("does not echo a token that is typed as a subcommand, in text or in JSON", () => {
    const repo = makeReleaseRepo();
    const token = `npm_${"a".repeat(30)}`;
    for (const args of [[token], [token, "--json"]]) {
      const result = repo.run(args);
      expect(result.status).toBe(2);
      expect(result.stdout + result.stderr).not.toContain(token);
    }
    expect(parse(repo.run([token, "--json"]).stdout).status).toBe("usage");
  });

  it("does not echo a one-time code that is typed as a flag", () => {
    const repo = makeReleaseRepo();
    for (const args of [["status", "--otp=123456"], ["status", "--otp=123456", "--json"]]) {
      const result = repo.run(args);
      expect(result.status).toBe(2);
      expect(result.stdout + result.stderr).not.toContain("123456");
    }
  });
});

describe("verify without the Node permission model", () => {
  it("fails closed with exit 1 and says how to go on", () => {
    const repo = makeReleaseRepo();
    setTags(repo);
    const result = repo.run(["verify"], { RELEASE_FORCE_NO_PERMISSION: "1" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("--allow-unsandboxed");
    expect(repo.fake.lines("npm").some((line) => line.startsWith("install"))).toBe(false);
  });

  it("runs without it when the person passes --allow-unsandboxed, and warns", () => {
    const repo = makeReleaseRepo();
    setTags(repo);
    const result = repo.run(["verify", "--allow-unsandboxed", "--json"], { RELEASE_FORCE_NO_PERMISSION: "1" });
    expect(result.status, result.stdout).toBe(0);
    const body = parse(result.stdout);
    expect(body.warnings?.join()).toContain("permission model");
    expect((body.steps as { command: string }[]).some((step) => /permission/.test(step.command))).toBe(false);
  });

  it("does not take --allow-unsandboxed for another subcommand", () => {
    expect(makeReleaseRepo().run(["status", "--allow-unsandboxed"]).status).toBe(2);
  });
});

describe("a temporary folder with a comma", () => {
  it("makes the scratch folder somewhere safe, so the permission path is plain", () => {
    const repo = makeReleaseRepo();
    setTags(repo);
    const odd = join(tempDir(), "a,b");
    mkdirSync(odd);
    const result = repo.run(["verify", "--json"], { TMPDIR: odd });
    expect(result.status, result.stdout).toBe(0);
    const install = repo.fake.calls().find((call) => call.tool === "npm" && call.args[0] === "install");
    expect(install?.cwd).not.toMatch(/[,*]/);
  });
});

describe("a timeout kills the whole process group", () => {
  function alive(pid: number) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  it("in the release script: exit code 124 is kept, and a grandchild dies", async () => {
    const repo = makeReleaseRepo();
    const result = repo.run(["gates", "--json"], { FAKE_GRANDCHILD: "1", RELEASE_TIMEOUT_MS: "800" });
    expect(result.status).toBe(1);
    const body = parse(result.stdout);
    expect(body.message).toContain("timed out");
    expect((body.steps as { exit: number }[]).at(-1)?.exit).toBe(124);
    const pid = Number(readFileSync(join(repo.fake.fixtures, "grandchild.pid"), "utf8"));
    for (let tries = 0; tries < 30 && alive(pid); tries += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(alive(pid)).toBe(false);
  });

  it("in tools/gates.mjs: the gate times out with the override and a grandchild dies", async () => {
    const fake = makeFakeBin();
    const repo = makeRepo();
    const result = runNode(join(repoRoot, "tools/gates.mjs"), ["--json"], { cwd: repo, env: fake.env({ FAKE_GRANDCHILD: "1", RELEASE_TIMEOUT_MS: "800" }) });
    expect(result.status).toBe(1);
    const body = JSON.parse(result.stdout);
    expect(body.gates[0]).toMatchObject({ ok: false, exit: 124 });
    expect(body.gates[0].firstFailingLine).toContain("timed out");
    const pid = Number(readFileSync(join(fake.fixtures, "grandchild.pid"), "utf8"));
    for (let tries = 0; tries < 30 && alive(pid); tries += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(alive(pid)).toBe(false);
  });
});

describe("pr-open gh handling", () => {
  const FOOTER = "🤖 Generated with [Claude Code](https://claude.com/claude-code)";
  const GOOD = `> [!NOTE]\n> Adds it.\n\n${FOOTER}\n`;
  function setup() {
    const fake = makeFakeBin();
    const repo = makeRepo();
    const body = join(tempDir(), "body.md");
    writeFileSync(body, GOOD);
    return { fake, repo, body, run: (args: string[], env: Record<string, string> = {}) => runNode(join(repoRoot, "tools/pr-open.mjs"), args, { cwd: repo, env: fake.env(env) }) };
  }

  it("times out a gh that hangs", () => {
    const { run, body } = setup();
    const result = run(["--title", "x", "--body-file", body, "--base", "main"], { FAKE_GH_SLEEP_MS: "9000", RELEASE_TIMEOUT_MS: "2500" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("timed out");
  });

  it("prints the gh identity before it creates the pull request", () => {
    const { fake, run, body } = setup();
    const result = run(["--title", "x", "--body-file", body, "--base", "main"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("gh identity: example-user");
    expect(result.stdout.indexOf("gh identity")).toBeLessThan(result.stdout.indexOf("$ gh pr create"));
    expect(fake.lines("gh")[0]).toBe("api user --jq .login");
  });

  it("says in --help that gh gets the full environment on purpose", () => {
    const { run } = setup();
    expect(run(["--help"]).stdout).toMatch(/full environment/);
  });

  it("does not print a token from the title in text mode", () => {
    const { run, body } = setup();
    const token = `npm_${"b".repeat(30)}`;
    const result = run(["--title", `fix ${token}`, "--body-file", body, "--base", "main", "--dry-run"]);
    expect(result.stdout + result.stderr).not.toContain(token);
  });
});
