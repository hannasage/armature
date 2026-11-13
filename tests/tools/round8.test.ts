import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, git, makeReleaseRepo, makeRepo, repoRoot, runNode, tempDir, type ReleaseRepo } from "./support";

afterEach(cleanup);

type Phase = { name: string; state: string; note: string };
type Body = { ok: boolean; status: string; exit: number; message: string; phases?: Phase[]; warnings?: string[]; left?: string[]; [key: string]: unknown };
const parse = (text: string) => JSON.parse(text) as Body;
const phase = (body: Body, name: string) => body.phases?.find((entry) => entry.name === name) as Phase;
const BETA = JSON.stringify({ beta: "1.0.0-beta.1", next: "1.0.0-next.0", latest: "1.0.0-next.0" });
const lib = (name: string) => import(pathToFileURL(join(repoRoot, "tools/lib", name)).href);
const statePath = (repo: ReleaseRepo) => join(repo.work, ".git", "release-state.json");
const setTags = (repo: ReleaseRepo) => writeFileSync(join(repo.fake.fixtures, "dist-tags.json"), BETA);

describe("1. a secret in the body", () => {
  const FOOTER = "🤖 Generated with [Claude Code](https://claude.com/claude-code)";
  it("refuses a body that holds something shaped like a secret", async () => {
    const { validateBody } = await lib("pr-body.mjs");
    const good = `> [!NOTE]\n> Adds it.\n\nThe key is ${"npm_" + "d".repeat(30)}.\n\n${FOOTER}\n`;
    expect(validateBody(good).join()).toMatch(/secret/);
    expect(validateBody(`> [!NOTE]\n> Adds it.\n\nPlain text.\n\n${FOOTER}\n`)).toEqual([]);
  });
});

describe("2. a registry without a gitHead", () => {
  it("fails verify unless the person passes --allow-no-githead, and then warns and records it", () => {
    const repo = makeReleaseRepo();
    setTags(repo);
    rmSync(join(repo.fake.fixtures, "gitHead.txt"));
    const refused = repo.run(["verify"]);
    expect(refused.status).toBe(1);
    expect(refused.stdout).toContain("--allow-no-githead");
    const allowed = repo.run(["verify", "--allow-no-githead", "--json"]);
    expect(allowed.status, allowed.stdout).toBe(0);
    const body = parse(allowed.stdout);
    expect(body.warnings?.join()).toMatch(/no gitHead/);
    const state = JSON.parse(readFileSync(statePath(repo), "utf8"));
    expect(state.verify.gitHead).toBeNull();
    expect(state.verify.noGitHead).toBe(true);
    expect(repo.run(["verify", "--allow-no-githead"]).stdout).toMatch(/no gitHead|already done/);
  });

  it("does not take --allow-no-githead for another subcommand", () => {
    expect(makeReleaseRepo().run(["status", "--allow-no-githead"]).status).toBe(2);
  });
});

describe("3. tag checks the registry itself", () => {
  function preflighted() {
    const repo = makeReleaseRepo();
    expect(repo.run(["preflight"]).status).toBe(0);
    setTags(repo);
    return repo;
  }

  it("refuses when the registry gitHead is not the preflight commit, even if a forged note agrees with the registry", () => {
    const repo = preflighted();
    const head = git(repo.work, "rev-parse", "HEAD");
    const other = "a".repeat(40);
    writeFileSync(join(repo.fake.fixtures, "gitHead.txt"), `${other}\n`);
    const state = JSON.parse(readFileSync(statePath(repo), "utf8"));
    state.verify = { commit: head, integrity: "sha512-FAKEINTEGRITY", gitHead: other };
    writeFileSync(statePath(repo), JSON.stringify(state));
    const result = repo.run(["tag", "--dry-run"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("gitHead");
    expect(git(repo.work, "tag", "--list")).toBe("");
  });

  it("refuses a registry without a gitHead unless --allow-no-githead is given again", () => {
    const repo = preflighted();
    rmSync(join(repo.fake.fixtures, "gitHead.txt"));
    expect(repo.run(["verify", "--allow-no-githead"]).status).toBe(0);
    expect(repo.run(["tag", "--dry-run"]).status).toBe(1);
    expect(repo.run(["tag", "--dry-run", "--allow-no-githead"]).status).toBe(0);
  });

  it("still tags when the registry gitHead is the preflight commit", () => {
    const repo = preflighted();
    expect(repo.run(["verify"]).status).toBe(0);
    expect(repo.run(["tag", "--dry-run"]).status).toBe(0);
  });
});

describe("4. a hidden change does not pass as clean", () => {
  it("fails preflight when an edited file is marked assume-unchanged or skip-worktree", () => {
    for (const flag of ["--assume-unchanged", "--skip-worktree"]) {
      const repo = makeReleaseRepo();
      git(repo.work, "update-index", flag, "README.md");
      writeFileSync(join(repo.work, "README.md"), "edited\n");
      const result = repo.run(["preflight"]);
      expect(result.status, flag).toBe(1);
      expect(result.stdout, flag).toMatch(/assume-unchanged|skip-worktree/);
    }
  });

  it("does not record gates or a dry run for a tree with a hidden change", () => {
    const repo = makeReleaseRepo();
    git(repo.work, "update-index", "--assume-unchanged", "README.md");
    writeFileSync(join(repo.work, "README.md"), "edited\n");
    expect(repo.run(["gates"]).stdout).toContain("not recorded");
    expect(repo.run(["dry-run"]).stdout).toContain("not recorded");
    expect(existsSync(statePath(repo))).toBe(false);
  });

  it("sees an untracked file inside a new folder", () => {
    const repo = makeReleaseRepo();
    mkdirSync(join(repo.work, "newdir"));
    writeFileSync(join(repo.work, "newdir", "a.txt"), "x");
    expect(repo.run(["preflight"]).stdout).toContain("newdir/a.txt");
  });
});

describe("5. status shows a stale note", () => {
  it("shows stale when the tree is dirty, and when HEAD moved", () => {
    const repo = makeReleaseRepo();
    repo.run(["preflight"]);
    expect(phase(parse(repo.run(["status", "--json"]).stdout), "preflight").state).toBe("done");
    writeFileSync(join(repo.work, "stray.txt"), "x");
    const dirty = parse(repo.run(["status", "--json"]).stdout);
    expect(phase(dirty, "preflight").state).toBe("stale");
    expect(phase(dirty, "preflight").note).toMatch(/not clean/);
    expect(dirty.left).toContain("preflight");
    rmSync(join(repo.work, "stray.txt"));
    writeFileSync(join(repo.work, "more.txt"), "x");
    git(repo.work, "add", "-A");
    git(repo.work, "commit", "-q", "-m", "more");
    git(repo.work, "push", "-q");
    const moved = parse(repo.run(["status", "--json"]).stdout);
    expect(phase(moved, "preflight").state).toBe("stale");
    expect(phase(moved, "preflight").note).toMatch(/another commit/);
  });
});

describe("6. claims", () => {
  it("finds a stale claim in a file that holds a NUL byte", () => {
    const repo = makeReleaseRepo();
    writeFileSync(join(repo.work, "docs", "x.bin"), Buffer.from("start\0 Not published yet \0end"));
    const result = repo.run(["claims"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("x.bin");
  });

  it("warns about a symlinked file in the searched paths, and fails when it points outside the repository", () => {
    const repo = makeReleaseRepo();
    writeFileSync(join(repo.work, "real.txt"), "fine\n");
    symlinkSync(join(repo.work, "real.txt"), join(repo.work, "docs", "inside.txt"));
    const warned = repo.run(["claims", "--json"]);
    expect(warned.status).toBe(0);
    expect(parse(warned.stdout).warnings?.join()).toContain("inside.txt");
    const outside = join(tempDir(), "outside.txt");
    writeFileSync(outside, "x\n");
    symlinkSync(outside, join(repo.work, "docs", "outside.txt"));
    const failed = repo.run(["claims"]);
    expect(failed.status).toBe(1);
    expect(failed.stdout).toContain("outside");
  });
});

describe("7. tree-clean text output", () => {
  it("prints the note about processes of other users", () => {
    const base = tempDir();
    const origin = join(base, "origin.git");
    git(base, "init", "-q", "--bare", "-b", "main", origin);
    const work = makeRepo("task/x");
    git(work, "remote", "add", "origin", origin);
    git(work, "push", "-q", "-u", "origin", "task/x");
    const result = runNode(join(repoRoot, "tools/tree-clean.mjs"), [work]);
    expect(result.stdout).toMatch(/other users/);
  });
});

describe("8. usesGroup", () => {
  it("treats the Node binary like node", async () => {
    const { usesGroup } = await lib("run-group.mjs");
    expect(usesGroup(["node", "-e", "1"])).toBe(true);
    expect(usesGroup([process.execPath, "-e", "1"])).toBe(true);
    expect(usesGroup(["git", "rev-parse"])).toBe(false);
  });

  it("kills the grandchild of a command that runs the Node binary", async () => {
    const { runCommand } = await lib("run-group.mjs");
    const pidFile = join(tempDir(), "pid");
    const code = `const {spawn}=require("node:child_process");const c=spawn("sleep",["60"],{stdio:"ignore"});require("node:fs").writeFileSync(${JSON.stringify(pidFile)},String(c.pid));setTimeout(()=>{},60000)`;
    const result = runCommand({ command: [process.execPath, "-e", code], cwd: tempDir(), env: { PATH: process.env.PATH }, timeout: 800 });
    expect(result.timedOut).toBe(true);
    const pid = Number(readFileSync(pidFile, "utf8"));
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let tries = 0; tries < 30 && alive(); tries += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(alive()).toBe(false);
  });
});

describe("9. more redaction", () => {
  const cases: [string, RegExp][] = [
    ["otp: 482913", /482913/],
    ["NPM_CONFIG_OTP=482913", /482913/],
    ["npm_config__auth=dXNlcjpwYXNz", /dXNlcjpwYXNz/],
    ["pwd=hunter22", /hunter22/],
    // Built from parts so that a secret scanner does not flag these fake values.
    [`${"py"}${"pi-"}AgEIcHlwaS5vcmcCJGFiY2RlZmdoaWprbG1ub3A`, /AgEIcHlwaS5vcmc/],
    [`${"S"}${"G."}abcdefghijklmnopqrstuv.abcdefghijklmnopqrstuvwxyz0123`, /abcdefghijklmnopqrstuvwxyz0123/],
    [`${"shp"}${"at_"}0123456789abcdef0123456789abcdef`, /0123456789abcdef0123/],
    [`${"dop"}${"_v1_"}0123456789abcdef0123456789abcdef0123`, /0123456789abcdef0123/],
  ];
  for (const [input, leak] of cases) {
    it(`redacts ${input.slice(0, 30)}`, async () => {
      const { redact } = await lib("text.mjs");
      const out = redact(`x ${input} y`);
      expect(out).toContain("[redacted]");
      expect(out).not.toMatch(leak);
    });
  }
});

describe("10. one source for the gates", () => {
  it("lists the gates once, in release.config.json, and both tools use that list", async () => {
    const config = JSON.parse(readFileSync(join(repoRoot, "release.config.json"), "utf8"));
    expect(config.gates).toEqual(["typecheck", "lint", "test", "build", "check:pack"]);
    const repo = makeReleaseRepo();
    const custom = JSON.parse(readFileSync(join(repo.work, "release.config.json"), "utf8"));
    custom.gates = ["typecheck", "lint"];
    writeFileSync(join(repo.work, "release.config.json"), JSON.stringify(custom));
    git(repo.work, "commit", "-q", "-am", "gates");
    git(repo.work, "push", "-q");
    repo.run(["gates"]);
    expect(repo.fake.lines("npm")).toEqual(["ci", "run typecheck", "run lint"]);
  });

  it("states the status output shape with unknown, in the manifest", () => {
    const manifest = JSON.parse(readFileSync(join(repoRoot, "tools/manifest.json"), "utf8")) as { tools: { name: string; output: string }[] };
    const status = manifest.tools.find((tool) => tool.name === "release status");
    expect(status?.output).toContain("unknown");
    expect(status?.output).toMatch(/unknown: \[/);
  });

  it("makes tools/gates.mjs read the same list", () => {
    const source = readFileSync(join(repoRoot, "tools/gates.mjs"), "utf8");
    expect(source).toContain("release.config.json");
    expect(source).not.toMatch(/\["typecheck", "lint", "test", "build", "check:pack"\]/);
  });
});
