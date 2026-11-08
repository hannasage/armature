import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, git, makeReleaseRepo, type ReleaseRepo } from "./support";

afterEach(cleanup);

const json = (text: string) => JSON.parse(text) as { ok: boolean; command: string; status: string; exit: number; message: string; steps: { command: string; exit: number | null }[]; [key: string]: unknown };
const BETA = JSON.stringify({ beta: "1.0.0-beta.0", next: "1.0.0-next.0", latest: "1.0.0-next.0" });
const FORBIDDEN = /^(login|adduser|whoami|deprecate|dist-tag|unpublish|token)\b|^publish(?!.*--dry-run)/;

/** No call to npm in the log may write to the registry or touch a login. */
function expectNoRegistryWrites(repo: ReleaseRepo) {
  for (const line of repo.fake.lines("npm")) expect(line, line).not.toMatch(FORBIDDEN);
}

function preflighted() {
  const repo = makeReleaseRepo();
  expect(repo.run(["preflight"]).status).toBe(0);
  return repo;
}

describe("usage", () => {
  it("exits 2 for an unknown subcommand and says how to use the script", () => {
    const repo = makeReleaseRepo();
    const result = repo.run(["launch"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("Usage");
  });

  it("exits 2 with one JSON object under --json", () => {
    const repo = makeReleaseRepo();
    const result = repo.run(["--json", "launch"]);
    expect(result.status).toBe(2);
    const body = json(result.stdout);
    expect(body.ok).toBe(false);
    expect(body.status).toBe("usage");
    expect(body.exit).toBe(2);
  });

  it("exits 2 when a flag does not belong to the subcommand", () => {
    const repo = makeReleaseRepo();
    expect(repo.run(["preflight", "--dry-run"]).status).toBe(2);
    expect(repo.run(["gates", "--bogus"]).status).toBe(2);
    expect(repo.run([]).status).toBe(2);
  });

  it("exits 0 for --help", () => {
    expect(makeReleaseRepo().run(["--help"]).status).toBe(0);
  });
});

describe("preflight", () => {
  it("passes on a clean release branch, prints each command first, and runs again as already done", () => {
    const repo = makeReleaseRepo();
    const first = repo.run(["preflight"]);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("$ git fetch origin");
    expect(first.stdout).toContain("$ git status --short");
    expect(first.stdout).toContain("$ git log -1 --oneline");
    const second = repo.run(["preflight"]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain("already done");
  });

  it("prints one JSON object with the steps under --json", () => {
    const repo = makeReleaseRepo();
    const result = repo.run(["preflight", "--json"]);
    const body = json(result.stdout);
    expect(body).toMatchObject({ ok: true, command: "preflight", status: "pass", exit: 0 });
    expect(body.steps.map((step) => step.command)).toContain("git fetch origin");
    expect(body.steps.every((step) => step.exit === 0)).toBe(true);
    expect(body.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
  });

  it("fails and prints the first failing line when the tree is dirty", () => {
    const repo = makeReleaseRepo();
    writeFileSync(join(repo.work, "stray.txt"), "x\n");
    const result = repo.run(["preflight"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("stray.txt");
    expect(result.stdout).not.toContain("already done");
  });

  it("fails on another branch", () => {
    const repo = makeReleaseRepo();
    git(repo.work, "checkout", "-q", "-b", "other");
    const result = repo.run(["preflight"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("release/1.0.0");
  });

  it("fails when the branch has a commit that is not on the remote", () => {
    const repo = makeReleaseRepo();
    writeFileSync(join(repo.work, "more.txt"), "x\n");
    git(repo.work, "add", "-A");
    git(repo.work, "commit", "-q", "-m", "local only");
    expect(repo.run(["preflight"]).status).toBe(1);
  });

  it("fails when package.json disagrees with release.config.json", () => {
    const repo = makeReleaseRepo();
    const file = join(repo.work, "package.json");
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    pkg.version = "9.9.9";
    writeFileSync(file, JSON.stringify(pkg));
    git(repo.work, "commit", "-q", "-am", "bump");
    git(repo.work, "push", "-q");
    const result = repo.run(["preflight"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("version");
  });
});

describe("gates", () => {
  it("runs ci then the five gates in order and runs again as already done", () => {
    const repo = makeReleaseRepo();
    const result = repo.run(["gates"]);
    expect(result.status).toBe(0);
    expect(repo.fake.lines("npm")).toEqual(["ci", "run typecheck", "run lint", "run test", "run build", "run check:pack"]);
    const again = repo.run(["gates"]);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("already done");
    expect(repo.fake.lines("npm")).toHaveLength(6);
  });

  it("stops at the first failure and prints only the first failing line", () => {
    const repo = makeReleaseRepo();
    const result = repo.run(["gates"], { FAKE_FAIL_RUN: "lint", FAKE_FAIL_MESSAGE: "src/a.ts: error one\nsrc/b.ts: error two" });
    expect(result.status).toBe(1);
    expect(repo.fake.lines("npm")).toEqual(["ci", "run typecheck", "run lint"]);
    expect(result.stdout).toContain("src/a.ts: error one");
    expect(result.stdout).not.toContain("error two");
  });

  it("reports the failure in JSON and never claims a pass", () => {
    const repo = makeReleaseRepo();
    const body = json(repo.run(["gates", "--json"], { FAKE_FAIL_RUN: "test" }).stdout);
    expect(body).toMatchObject({ ok: false, status: "fail", exit: 1 });
    expect(body.steps.at(-1)).toMatchObject({ command: "npm run test", exit: 1 });
  });

  it("does not print a token that appears in the output of a failing command", () => {
    const repo = makeReleaseRepo();
    const secret = "npm_abcdefghijklmnopqrstuvwxyz0123456789";
    const result = repo.run(["gates"], { FAKE_FAIL_RUN: "typecheck", FAKE_FAIL_MESSAGE: `error with ${secret}` });
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(result.stdout).toContain("[redacted]");
  });
});

describe("dry-run", () => {
  it("checks the package line, the file count, the size, and the tag, then runs again as already done", () => {
    const repo = makeReleaseRepo();
    const result = repo.run(["dry-run"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("$ npm publish --dry-run --tag beta --access public");
    expect(repo.run(["dry-run"]).stdout).toContain("already done");
    expectNoRegistryWrites(repo);
  });

  it("fails when the file count differs from the config", () => {
    const repo = makeReleaseRepo();
    const result = repo.run(["dry-run"], { FAKE_FILES: "130" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("total files: 130");
  });

  it("fails when the size is far above the baseline", () => {
    const repo = makeReleaseRepo();
    expect(repo.run(["dry-run"], { FAKE_SIZE: "900 kB" }).status).toBe(1);
  });
});

describe("publish (human only)", () => {
  it("refuses without a terminal, prints the commands, exits 2, and runs no npm write", () => {
    const repo = makeReleaseRepo();
    const result = repo.run(["publish"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("npm publish --tag beta --access public");
    expect(result.stdout).toContain("npm login");
    expectNoRegistryWrites(repo);
    expect(repo.fake.lines("npm").filter((line) => !line.startsWith("view"))).toEqual([]);
  });

  it("describes the refusal in JSON", () => {
    const repo = makeReleaseRepo();
    const result = repo.run(["publish", "--json"]);
    expect(result.status).toBe(2);
    const body = json(result.stdout);
    expect(body).toMatchObject({ ok: false, status: "refused", exit: 2 });
    expect(body.commands).toContain("npm publish --tag beta --access public");
  });

  it("prints already done when the registry holds the version, and still publishes nothing", () => {
    const repo = makeReleaseRepo();
    writeFileSync(join(repo.fake.fixtures, "dist-tags.json"), BETA);
    const result = repo.run(["publish"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("already done");
    expectNoRegistryWrites(repo);
  });

  it("with a terminal it only prints the commands and still runs nothing", async () => {
    const repo = makeReleaseRepo();
    const release = (await import(pathToFileURL(repo.script).href)) as {
      runRelease(argv: string[], context: { root: string; env: NodeJS.ProcessEnv; isTTY: boolean; out(line: string): void }): Promise<{ exit: number }>;
    };
    const lines: string[] = [];
    const outcome = await release.runRelease(["publish"], { root: repo.work, env: repo.env(), isTTY: true, out: (line) => lines.push(line) });
    expect(outcome.exit).toBe(0);
    expect(lines.join("\n")).toContain("npm publish --tag beta --access public");
    expectNoRegistryWrites(repo);
  });
});

describe("verify", () => {
  it("fails when the beta tag does not point at the version", () => {
    const repo = makeReleaseRepo();
    const result = repo.run(["verify"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("beta");
  });

  it("installs into a clean project, counts the public names, and runs again as already done", () => {
    const repo = preflighted();
    writeFileSync(join(repo.fake.fixtures, "dist-tags.json"), BETA);
    const result = repo.run(["verify"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("29");
    expect(repo.fake.lines("npm")).toEqual(
      expect.arrayContaining(["view @hannasage/armature dist-tags --json --registry https://registry.npmjs.org/", "init -y", "install --ignore-scripts --registry https://registry.npmjs.org/ @hannasage/armature@beta react"]),
    );
    expect(repo.run(["verify"]).stdout).toContain("already done");
    expectNoRegistryWrites(repo);
  });

  it("fails when the installed package exports a different number of names", () => {
    const repo = preflighted();
    writeFileSync(join(repo.fake.fixtures, "dist-tags.json"), BETA);
    const result = repo.run(["verify"], { FAKE_EXPORTS: "28" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("28");
  });
});

describe("tag", () => {
  function verified() {
    const repo = preflighted();
    writeFileSync(join(repo.fake.fixtures, "dist-tags.json"), BETA);
    expect(repo.run(["verify"]).status).toBe(0);
    return repo;
  }

  it("refuses before verify has passed and creates nothing", () => {
    const repo = preflighted();
    const result = repo.run(["tag"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("verify");
    expect(git(repo.work, "tag", "--list")).toBe("");
  });

  it("with --dry-run prints the git commands and runs none of them", () => {
    const repo = verified();
    const commit = git(repo.work, "rev-parse", "HEAD");
    const result = repo.run(["tag", "--dry-run"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`git tag -a v1.0.0-beta.0 ${commit} -m 1.0.0-beta.0`);
    expect(result.stdout).toContain("git push origin refs/tags/v1.0.0-beta.0");
    expect(git(repo.work, "tag", "--list")).toBe("");
    expect(git(repo.origin, "tag", "--list")).toBe("");
  });

  it("refuses when the working tree is dirty", () => {
    const repo = verified();
    writeFileSync(join(repo.work, "stray.txt"), "x\n");
    const result = repo.run(["tag"]);
    expect(result.status).toBe(1);
    expect(git(repo.work, "tag", "--list")).toBe("");
  });

  it("refuses when HEAD moved after preflight", () => {
    const repo = verified();
    writeFileSync(join(repo.work, "more.txt"), "x\n");
    git(repo.work, "add", "-A");
    git(repo.work, "commit", "-q", "-m", "after preflight");
    const result = repo.run(["tag"]);
    expect(result.status).toBe(1);
    expect(git(repo.work, "tag", "--list")).toBe("");
  });

  it("tags the preflight commit, pushes to the remote, and runs again as already done", () => {
    const repo = verified();
    const commit = git(repo.work, "rev-parse", "HEAD");
    const result = repo.run(["tag"]);
    expect(result.status).toBe(0);
    expect(git(repo.work, "rev-list", "-n", "1", "v1.0.0-beta.0")).toBe(commit);
    expect(git(repo.origin, "rev-list", "-n", "1", "v1.0.0-beta.0")).toBe(commit);
    const again = repo.run(["tag"]);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain("already done");
  });
});

describe("retire (human only)", () => {
  it("refuses without a terminal, prints the commands, and runs none", () => {
    const repo = makeReleaseRepo();
    const result = repo.run(["retire"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toContain("npm deprecate @hannasage/armature@1.0.0-next.0");
    expect(result.stdout).toContain("npm dist-tag rm @hannasage/armature next");
    expect(result.stdout).toContain("npm dist-tag add @hannasage/armature@1.0.0-beta.0 latest");
    expectNoRegistryWrites(repo);
  });

  it("prints already done when the tags and the deprecation are in place", () => {
    const repo = makeReleaseRepo();
    writeFileSync(join(repo.fake.fixtures, "dist-tags.json"), JSON.stringify({ beta: "1.0.0-beta.0", latest: "1.0.0-beta.0" }));
    writeFileSync(join(repo.fake.fixtures, "deprecated.txt"), "Renamed to the beta tag. Use 1.0.0-beta.0.\n");
    const result = repo.run(["retire"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("already done");
    expectNoRegistryWrites(repo);
  });
});

describe("claims", () => {
  it("passes when no file holds a stale claim, and skips the releasing page", () => {
    const repo = makeReleaseRepo();
    const result = repo.run(["claims", "--json"]);
    expect(result.status).toBe(0);
    expect(json(result.stdout)).toMatchObject({ ok: true, status: "pass" });
    expect(repo.run(["claims"]).stdout).toContain("$ grep -rnaF");
  });

  it("fails with the first matching line", () => {
    const repo = makeReleaseRepo();
    writeFileSync(join(repo.work, "README.md"), "Intro\nPre-release. Not published yet.\nNothing is published either.\n");
    const result = repo.run(["claims"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("README.md:2");
    expect(result.stdout).not.toContain("README.md:3");
  });
});

describe("status", () => {
  it("lists every phase and what is left, and exits 0", () => {
    const repo = makeReleaseRepo();
    const body = json(repo.run(["status", "--json"]).stdout);
    expect(body).toMatchObject({ ok: true, command: "status", exit: 0 });
    const phases = body.phases as { name: string; state: string }[];
    expect(phases.map((phase) => phase.name)).toEqual(["preflight", "gates", "dry-run", "publish", "verify", "tag", "retire", "claims"]);
    expect(phases.find((phase) => phase.name === "publish")?.state).toBe("todo");
    expect(body.left).toContain("publish");
  });

  it("shows the human-readable list", () => {
    const repo = makeReleaseRepo();
    const result = repo.run(["status"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("publish");
    expect(result.stdout).toContain("1.0.0-beta.0");
  });
});

describe("secrets", () => {
  it("never prints or stores a token that is in the environment", () => {
    const repo = makeReleaseRepo();
    const secret = "npm_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";
    const env = { NPM_TOKEN: secret, NODE_AUTH_TOKEN: secret, NPM_CONFIG_OTP: "otp-71-xx" };
    let output = "";
    for (const args of [["preflight"], ["publish"], ["status"], ["claims"], ["retire"]]) {
      const result = repo.run(args, env);
      output += result.stdout + result.stderr;
    }
    expect(output).not.toContain(secret);
    expect(output).not.toContain("otp-71-xx");
    const state = join(repo.work, ".git", "release-state.json");
    if (existsSync(state)) expect(readFileSync(state, "utf8")).not.toContain(secret);
  });
});
