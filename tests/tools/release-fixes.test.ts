import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, git, makeReleaseRepo, tempDir, type ReleaseRepo } from "./support";

afterEach(cleanup);

type Body = { ok: boolean; status: string; exit: number; message: string; failingLine?: string; warnings?: string[]; phases?: { name: string; state: string }[]; [key: string]: unknown };
const parse = (text: string) => JSON.parse(text) as Body;
const BETA = JSON.stringify({ beta: "1.0.0-beta.0", next: "1.0.0-next.0", latest: "1.0.0-next.0" });
const NAME = "v1.0.0-beta.0";
const statePath = (repo: ReleaseRepo) => join(repo.work, ".git", "release-state.json");
const readState = (repo: ReleaseRepo) => JSON.parse(readFileSync(statePath(repo), "utf8"));
const setDistTags = (repo: ReleaseRepo, text = BETA) => writeFileSync(join(repo.fake.fixtures, "dist-tags.json"), text);

function verified() {
  const repo = makeReleaseRepo();
  expect(repo.run(["preflight"]).status).toBe(0);
  setDistTags(repo);
  expect(repo.run(["verify"]).status).toBe(0);
  return repo;
}

async function inProcess(repo: ReleaseRepo, args: string[], isTTY: boolean) {
  const release = (await import(pathToFileURL(repo.script).href + `?t=${Math.random()}`)) as {
    runRelease(argv: string[], context: { root: string; env: NodeJS.ProcessEnv; isTTY: boolean; out(line: string): void }): Promise<{ exit: number }>;
  };
  const lines: string[] = [];
  const outcome = await release.runRelease(args, { root: repo.work, env: repo.env(), isTTY, out: (line) => lines.push(line) });
  return { exit: outcome.exit, text: lines.join("\n") };
}

describe("a git worktree", () => {
  it("runs preflight, gates, and dry-run when .git is a file, and keeps the state in the worktree git folder", () => {
    const repo = makeReleaseRepo();
    git(repo.work, "checkout", "-q", "-b", "dev");
    const tree = join(tempDir(), "wt");
    git(repo.work, "worktree", "add", "-q", tree, "release/1.0.0");
    expect(readFileSync(join(tree, ".git"), "utf8")).toMatch(/^gitdir: \//);
    const run = (args: string[]) => spawnSync(process.execPath, [join(tree, "scripts/release.mjs"), ...args], { cwd: tree, env: repo.env(), encoding: "utf8" });
    for (const sub of ["preflight", "gates", "dry-run"]) {
      const result = run([sub]);
      expect(result.status, `${sub}: ${result.stdout}${result.stderr}`).toBe(0);
    }
    expect(existsSync(join(repo.work, ".git", "worktrees", basename(tree), "release-state.json"))).toBe(true);
    expect(run(["gates"]).stdout).toContain("already done");
  });
});

describe("failures are results, not crashes", () => {
  it("fails with exit 1 and a JSON object when the state file cannot be written", () => {
    const repo = makeReleaseRepo();
    mkdirSync(statePath(repo));
    const result = repo.run(["preflight", "--json"]);
    expect(result.status).toBe(1);
    expect(parse(result.stdout)).toMatchObject({ ok: false, status: "fail", exit: 1 });
    expect(result.stderr).not.toContain("at ");
  });

  it("fails with exit 1 when a later step rejects, such as a missing public API list", () => {
    const repo = makeReleaseRepo();
    setDistTags(repo);
    rmSync(join(repo.work, "scripts", "public-api.mjs"));
    const result = repo.run(["verify", "--json"]);
    expect(result.status).toBe(1);
    expect(parse(result.stdout)).toMatchObject({ ok: false, exit: 1 });
  });

  it("fails with exit 1 when package.json is not JSON", () => {
    const repo = makeReleaseRepo();
    writeFileSync(join(repo.work, "package.json"), "{nope");
    const result = repo.run(["preflight", "--json"]);
    expect(result.status).toBe(1);
    expect(parse(result.stdout).ok).toBe(false);
  });
});

describe("the state file", () => {
  it("says so when it is corrupt, and starts again", () => {
    const repo = makeReleaseRepo();
    writeFileSync(statePath(repo), "{not json");
    const result = repo.run(["preflight"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("state file corrupt, reset");
    expect(parse(repo.run(["preflight", "--json"]).stdout).warnings ?? []).toEqual([]);
  });

  it("reports the reset in JSON", () => {
    const repo = makeReleaseRepo();
    writeFileSync(statePath(repo), "[1,2");
    expect(parse(repo.run(["preflight", "--json"]).stdout).warnings).toContain("state file corrupt, reset");
  });

  it("ignores a state file from another version", () => {
    const repo = makeReleaseRepo();
    const head = git(repo.work, "rev-parse", "HEAD");
    writeFileSync(statePath(repo), JSON.stringify({ version: "0.0.1", preflight: { commit: head } }));
    const result = repo.run(["preflight"]);
    expect(result.stdout).toContain("another version");
    expect(result.stdout).not.toContain("already done");
  });

  it("does not trust a forged gates record with the wrong lock hash", () => {
    const repo = makeReleaseRepo();
    const head = git(repo.work, "rev-parse", "HEAD");
    writeFileSync(statePath(repo), JSON.stringify({ version: "1.0.0-beta.0", gates: { commit: head, lock: "deadbeef" } }));
    const result = repo.run(["gates"]);
    expect(result.stdout).not.toContain("already done");
    expect(repo.fake.lines("npm")).toHaveLength(6);
  });

  it("does not trust a forged gates record with no lock hash", () => {
    const repo = makeReleaseRepo();
    const head = git(repo.work, "rev-parse", "HEAD");
    writeFileSync(statePath(repo), JSON.stringify({ version: "1.0.0-beta.0", gates: { commit: head } }));
    expect(repo.run(["gates"]).stdout).not.toContain("already done");
  });

  it("does not let a forged verify record unlock the tag", () => {
    const repo = makeReleaseRepo();
    expect(repo.run(["preflight"]).status).toBe(0);
    const head = git(repo.work, "rev-parse", "HEAD");
    const state = readState(repo);
    state.verify = { commit: head };
    writeFileSync(statePath(repo), JSON.stringify(state));
    setDistTags(repo);
    const result = repo.run(["tag"]);
    expect(result.status).toBe(1);
    expect(git(repo.work, "tag", "--list")).toBe("");
  });
});

describe("gates and dry-run records", () => {
  it("does not record a run that started with a dirty tree, even after the tree is cleaned", () => {
    const repo = makeReleaseRepo();
    writeFileSync(join(repo.work, "stray.txt"), "x\n");
    const first = repo.run(["gates"]);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("not recorded");
    expect(existsSync(statePath(repo)) ? readState(repo).gates : undefined).toBeUndefined();
    rmSync(join(repo.work, "stray.txt"));
    const second = repo.run(["gates"]);
    expect(second.stdout).not.toContain("already done");
    expect(repo.fake.lines("npm")).toHaveLength(12);
    expect(repo.run(["gates"]).stdout).toContain("already done");
  });

  it("does not record a dry run that started with a dirty tree", () => {
    const repo = makeReleaseRepo();
    writeFileSync(join(repo.work, "stray.txt"), "x\n");
    expect(repo.run(["dry-run"]).stdout).toContain("not recorded");
    rmSync(join(repo.work, "stray.txt"));
    expect(repo.run(["dry-run"]).stdout).not.toContain("already done");
  });

  it("stores the commit and the lock hash", () => {
    const repo = makeReleaseRepo();
    repo.run(["gates"]);
    const state = readState(repo);
    expect(state.gates.commit).toBe(git(repo.work, "rev-parse", "HEAD"));
    expect(typeof state.gates.lock).toBe("string");
  });

  it("runs again with --force", () => {
    const repo = makeReleaseRepo();
    repo.run(["gates"]);
    const forced = repo.run(["gates", "--force"]);
    expect(forced.stdout).not.toContain("already done");
    expect(repo.fake.lines("npm")).toHaveLength(12);
    expect(repo.run(["preflight"]).status).toBe(0);
    expect(repo.run(["preflight", "--force"]).stdout).not.toContain("already done");
  });
});

describe("verify", () => {
  it("reads the registry again before it says already done", () => {
    const repo = verified();
    setDistTags(repo, JSON.stringify({ beta: "1.0.0-beta.9" }));
    const result = repo.run(["verify"]);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("already done");
  });

  it("stores the integrity from the registry", () => {
    const repo = verified();
    expect(readState(repo).verify.integrity).toBe("sha512-FAKEINTEGRITY");
  });

  it("fails when the registry gitHead differs from the commit", () => {
    const repo = makeReleaseRepo();
    repo.run(["preflight"]);
    setDistTags(repo);
    writeFileSync(join(repo.fake.fixtures, "gitHead.txt"), "0123456789abcdef0123456789abcdef01234567\n");
    const result = repo.run(["verify"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("gitHead");
  });

  it("accepts a registry gitHead that equals the commit", () => {
    const repo = makeReleaseRepo();
    repo.run(["preflight"]);
    setDistTags(repo);
    writeFileSync(join(repo.fake.fixtures, "gitHead.txt"), `${git(repo.work, "rev-parse", "HEAD")}\n`);
    expect(repo.run(["verify"]).status).toBe(0);
  });

  it("installs with --ignore-scripts and a scrubbed environment", () => {
    const repo = makeReleaseRepo();
    setDistTags(repo);
    const secrets = { NPM_TOKEN: "npm_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", NODE_AUTH_TOKEN: "x", GH_TOKEN: "y", SOME_OTHER: "z" };
    expect(repo.run(["verify"], secrets).status).toBe(0);
    const install = repo.fake.calls().find((call) => call.tool === "npm" && call.args[0] === "install");
    expect(install?.args).toContain("--ignore-scripts");
    const keys = install?.env ?? [];
    expect(keys).toContain("PATH");
    expect(keys).toContain("HOME");
    expect(keys).toContain("NPM_CONFIG_USERCONFIG");
    for (const secret of ["NPM_TOKEN", "NODE_AUTH_TOKEN", "GH_TOKEN", "SOME_OTHER"]) expect(keys).not.toContain(secret);
  });
});

describe("tag", () => {
  it("refuses when the dist-tag moved after verify", () => {
    const repo = verified();
    setDistTags(repo, JSON.stringify({ beta: "1.0.0-beta.9" }));
    const result = repo.run(["tag"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("beta");
    expect(git(repo.work, "tag", "--list")).toBe("");
  });

  it("refuses when the registry integrity changed after verify", () => {
    const repo = verified();
    writeFileSync(join(repo.fake.fixtures, "integrity.txt"), "sha512-OTHER\n");
    const result = repo.run(["tag"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("integrity");
  });

  it("fails when a local tag of the same name points at another commit", () => {
    const repo = verified();
    const head = git(repo.work, "rev-parse", "HEAD");
    const other = git(repo.work, "commit-tree", `${head}^{tree}`, "-p", head, "-m", "other");
    git(repo.work, "tag", NAME, other);
    const result = repo.run(["tag"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("points at");
    expect(result.stdout).not.toContain("already done");
    expect(git(repo.origin, "tag", "--list")).toBe("");
  });

  it("fails when the remote has the tag and the local repository does not", () => {
    const repo = verified();
    git(repo.work, "tag", "-a", NAME, "-m", "x");
    git(repo.work, "push", "-q", "origin", `refs/tags/${NAME}`);
    git(repo.work, "tag", "-d", NAME);
    const result = repo.run(["tag"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("remote tag exists, fetch it");
  });

  it("fails when the remote tag points at another commit", () => {
    const repo = verified();
    const head = git(repo.work, "rev-parse", "HEAD");
    const other = git(repo.work, "commit-tree", `${head}^{tree}`, "-p", head, "-m", "other");
    git(repo.work, "push", "-q", "origin", `${other}:refs/tags/${NAME}`);
    git(repo.work, "tag", "-a", NAME, head, "-m", "mine");
    const result = repo.run(["tag"]);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("already done");
  });

  it("pushes only when the local tag is right and the remote has none", () => {
    const repo = verified();
    git(repo.work, "tag", "-a", NAME, "-m", "1.0.0-beta.0");
    const result = repo.run(["tag"]);
    expect(result.status).toBe(0);
    expect(git(repo.origin, "tag", "--list")).toBe(NAME);
  });

  it("checks verify and preflight before the already-done shortcut", () => {
    const repo = makeReleaseRepo();
    git(repo.work, "tag", "-a", NAME, "-m", "x");
    git(repo.work, "push", "-q", "origin", `refs/tags/${NAME}`);
    const result = repo.run(["tag"]);
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("already done");
  });
});

describe("retire", () => {
  it("is not done when the tags are right but the old version is not deprecated", () => {
    const repo = makeReleaseRepo();
    setDistTags(repo, JSON.stringify({ beta: "1.0.0-beta.0", latest: "1.0.0-beta.0" }));
    const result = repo.run(["retire"]);
    expect(result.status).toBe(2);
    expect(result.stdout).not.toContain("already done");
  });

  it("with a terminal, refuses with exit 1 until verify has passed", async () => {
    const repo = makeReleaseRepo();
    const result = await inProcess(repo, ["retire"], true);
    expect(result.exit).toBe(1);
    expect(result.text).toContain("verify");
  });

  it("with a terminal and a passed verify, prints the commands and exits 0", async () => {
    const repo = verified();
    const result = await inProcess(repo, ["retire"], true);
    expect(result.exit).toBe(0);
    expect(result.text).toContain("npm dist-tag rm @hannasage/armature next");
    for (const line of repo.fake.lines("npm")) expect(line).not.toMatch(/^(deprecate|dist-tag)/);
  });

  it("stays at exit 2 without a terminal even when verify has not passed", () => {
    expect(makeReleaseRepo().run(["retire"]).status).toBe(2);
  });
});

describe("claims", () => {
  it("fails when a configured path is missing", () => {
    const repo = makeReleaseRepo();
    rmSync(join(repo.work, "docs"), { recursive: true });
    const result = repo.run(["claims"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("docs");
  });

  it("puts -- before the paths, so a path cannot become an option", () => {
    const repo = makeReleaseRepo();
    expect(repo.run(["claims"]).stdout).toMatch(/\$ grep .* -- README\.md docs/);
  });
});

describe("status", () => {
  it("shows a finished phase as done", () => {
    const repo = makeReleaseRepo();
    repo.run(["preflight"]);
    const body = parse(repo.run(["status", "--json"]).stdout);
    const states = Object.fromEntries((body.phases ?? []).map((phase) => [phase.name, phase.state]));
    expect(states.preflight).toBe("done");
    expect(states.gates).toBe("todo");
    expect(states.claims).toBe("done");
    expect(body.left).not.toContain("preflight");
  });

  it("shows publish as done when the registry has the version", () => {
    const repo = makeReleaseRepo();
    setDistTags(repo);
    const body = parse(repo.run(["status", "--json"]).stdout);
    expect(body.phases?.find((phase) => phase.name === "publish")?.state).toBe("done");
  });
});

describe("config safety", () => {
  function withConfig(change: (config: Record<string, any>) => void) {
    const repo = makeReleaseRepo();
    const file = join(repo.work, "release.config.json");
    const config = JSON.parse(readFileSync(file, "utf8"));
    change(config);
    writeFileSync(file, JSON.stringify(config));
    return repo;
  }
  const invalid = (change: (config: Record<string, any>) => void) => {
    const repo = withConfig(change);
    const result = repo.run(["claims", "--json"]);
    expect(result.status).toBe(1);
    expect(parse(result.stdout).message).toMatch(/release\.config\.json/);
    expect(repo.fake.calls()).toEqual([]);
  };

  it("rejects a retire check that is not npm view", () => invalid((c) => (c.retire.checks[1] = ["npm", "publish", "{package}"])));
  it("rejects a retire command that is not the pinned form", () => invalid((c) => (c.retire.commands[0] = ["npm", "unpublish", "{package}@{oldVersion}"])));
  it("rejects a remote that looks like an option", () => invalid((c) => (c.remote = "--upload-pack=evil")));
  it("rejects a branch with two dots", () => invalid((c) => (c.releaseBranch = "release/../x")));
  it("rejects a package name with a space", () => invalid((c) => (c.package = "bad name")));
  it("rejects a tag name that is not a safe name", () => invalid((c) => (c.gitTag.name = "-v{version}")));
  it("rejects a claim path outside the repository", () => invalid((c) => (c.claims.paths = ["../outside"])));
  it("rejects an unknown key", () => invalid((c) => (c.surprise = true)));
  it("rejects a file count that is not a number", () => invalid((c) => (c.expectedFileCount = "122")));
});

describe("redaction", () => {
  it("redacts tokens in the JSON message and the failing line", () => {
    const repo = makeReleaseRepo();
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    const message = `error ${secret} github_pat_abcdefghijklmnopqrstuvwxyz_01234 Bearer abc.def NODE_AUTH_TOKEN=hunter2`;
    const result = repo.run(["gates", "--json"], { FAKE_FAIL_RUN: "typecheck", FAKE_FAIL_MESSAGE: message });
    for (const text of [result.stdout, result.stderr]) {
      expect(text).not.toContain(secret);
      expect(text).not.toContain("github_pat_abc");
      expect(text).not.toContain("hunter2");
      expect(text).not.toContain("abc.def");
    }
    expect(parse(result.stdout).message).toContain("[redacted]");
  });

  it("redacts a token that would be cut by the length limit", () => {
    const repo = makeReleaseRepo();
    const secret = `npm_${"a".repeat(40)}`;
    const message = `${"x".repeat(290)} ${secret}`;
    const result = repo.run(["gates"], { FAKE_FAIL_RUN: "lint", FAKE_FAIL_MESSAGE: `error ${message}` });
    expect(result.stdout).not.toMatch(/npm_a{4}/);
  });
});
