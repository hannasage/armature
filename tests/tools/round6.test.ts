import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanEnv, cleanup, git, makeFakeBin, makeReleaseRepo, makeRepo, repoRoot, runNode, tempDir } from "./support";

afterEach(cleanup);

const lib = (name: string) => import(pathToFileURL(join(repoRoot, "tools/lib", name)).href);
const BETA = JSON.stringify({ beta: "1.0.0-beta.0", next: "1.0.0-next.0", latest: "1.0.0-next.0" });
const script = join(repoRoot, "tools/tree-clean.mjs");

function pushed() {
  const base = tempDir();
  const origin = join(base, "origin.git");
  git(base, "init", "-q", "--bare", "-b", "main", origin);
  const work = makeRepo("task/x");
  git(work, "remote", "add", "origin", origin);
  git(work, "push", "-q", "-u", "origin", "task/x");
  return work;
}

describe("1. tree-clean refuses a tree with submodules", () => {
  it("refuses, exits 1, and never runs a filter that is set in the module config", () => {
    const marker = join(tempDir(), "module-marker");
    const filter = join(tempDir(), "filter.sh");
    writeFileSync(filter, `#!/bin/sh\ntouch '${marker}'\ncat\n`);
    chmodSync(filter, 0o755);
    const sub = makeRepo("main");
    const tree = pushed();
    spawnSync("git", ["-c", "protocol.file.allow=always", "submodule", "add", sub, "sub"], { cwd: tree, encoding: "utf8", env: cleanEnv() });
    git(tree, "-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-q", "-m", "add module");
    git(tree, "push", "-q");
    writeFileSync(join(tree, "sub", ".gitattributes"), "file.txt filter=x\n");
    const modules = join(tree, ".git", "modules", "sub", "config");
    expect(existsSync(modules)).toBe(true);
    git(join(tree, "sub"), "config", "filter.x.clean", filter);
    const later = new Date(Date.now() + 5000);
    utimesSync(join(tree, "sub", "file.txt"), later, later);
    const result = runNode(script, [tree]);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/submodule/i);
    expect(existsSync(marker)).toBe(false);
  });

  it("refuses a tree that has only a .gitmodules file", () => {
    const tree = pushed();
    writeFileSync(join(tree, ".gitmodules"), '[submodule "x"]\n\tpath = x\n\turl = ./x\n');
    expect(runNode(script, [tree]).status).toBe(1);
  });
});

describe("2. tree-clean deny-list", () => {
  it("passes a tree with a local core.hooksPath, an alias, an editor, a pager, and an insteadOf", () => {
    const tree = pushed();
    git(tree, "config", "core.hooksPath", ".githooks");
    git(tree, "config", "alias.st", "status");
    git(tree, "config", "core.editor", "vi");
    git(tree, "config", "core.pager", "less");
    git(tree, "config", "url.https://example.com/.insteadOf", "ex:");
    const result = runNode(script, [tree]);
    expect(result.status, result.stdout).toBe(0);
  });

  it("says what the refused key can do", () => {
    const tree = pushed();
    git(tree, "config", "core.fsmonitor", "/bin/true");
    const result = runNode(script, [tree]);
    expect(result.stdout).toMatch(/core\.fsmonitor.*can run a program/);
  });
});

describe("3. redaction", () => {
  it("redacts a URL password that holds a slash, but not a port", async () => {
    const { redact } = await lib("text.mjs");
    expect(redact("https://bob:s3cr/et@host.com/r.git")).not.toContain("s3cr/et");
    expect(redact("https://bob:s3cr/et@host.com/r.git")).toContain("[redacted]");
    for (const text of ["http://127.0.0.1:48123/@scope%2fpkg", "https://example.com:8080 for owner@example.com", "https://example.com:8080/a@b.com/x"]) expect(redact(text), text).toBe(text);
  });

  const cases: [string, RegExp][] = [
    ["api-key: hyphenated-value-1", /hyphenated-value-1/],
    ["AccountKey=azureaccountkeyvalue==", /azureaccountkeyvalue/],
    ["run --token abc123tokenvalue now", /abc123tokenvalue/],
    ["run --password=pw-value-99", /pw-value-99/],
    ["whsec_abcdefghijklmnopqrstuvwxyz1234", /whsec_abcdef/],
    ["ya29.a0AfH6SMBabcdefghijklmnopqrstuvwxyz", /ya29\.a0/],
    ["AGE-SECRET-KEY-1ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", /AGE-SECRET-KEY-1ABC/],
    ["https://hooks.slack.com/services/T01234567/B01234567/abcdefghijklmnop", /T01234567|abcdefghij/],
    ["pass: sw0rdfish", /sw0rdfish/],
    ["Authorization: ApiKey abc123 extra-part", /abc123|extra-part/],
    ["Authorization: Custom scheme value here", /scheme value here/],
  ];
  for (const [input, leak] of cases) {
    it(`redacts ${input.slice(0, 40)}`, async () => {
      const { redact } = await lib("text.mjs");
      const out = redact(`x ${input} y`);
      expect(out).toContain("[redacted]");
      expect(out).not.toMatch(leak);
    });
  }

  it("keeps JSON valid after the new patterns", async () => {
    const { redact } = await lib("text.mjs");
    const json = JSON.stringify({ "api-key": "k1", pass: "p1", AccountKey: "a1", url: "https://bob:s3cr/et@host.com/r.git", hook: "https://hooks.slack.com/services/T01234567/B01234567/abcdefghijklmnop", fine: "ok" });
    const out = redact(json);
    expect(() => JSON.parse(out)).not.toThrow();
    expect(JSON.parse(out).fine).toBe("ok");
    expect(out).not.toMatch(/k1|p1|a1|s3cr|T01234567/);
  });

  it("stays fast on long input of the new shapes", async () => {
    const { redact } = await lib("text.mjs");
    const start = Date.now();
    for (const input of ["//a:".repeat(25000), "api-key ".repeat(12000), "whsec_".repeat(16000), "--token ".repeat(12000), "hooks.slack.com/services/".repeat(4000), "Authorization: ".repeat(7000), "AGE-SECRET-KEY-".repeat(6000)]) redact(input);
    expect(Date.now() - start).toBeLessThan(3000);
  });
});

describe("4. pr-open", () => {
  const FOOTER = "🤖 Generated with [Claude Code](https://claude.com/claude-code)";
  const GOOD = `> [!NOTE]\n> Adds it.\n\n${FOOTER}\n`;
  function setup() {
    const fake = makeFakeBin();
    const repo = makeRepo();
    const body = join(tempDir(), "body.md");
    writeFileSync(body, GOOD);
    const base = ["--title", "x", "--body-file", body, "--base", "main"];
    return { fake, base, body, run: (args: string[], extra: Record<string, string> = {}) => runNode(join(repoRoot, "tools/pr-open.mjs"), args, { cwd: repo, env: fake.env(extra) }) };
  }

  it("redacts the printed command in text mode", () => {
    const { run, base } = setup();
    const token = `npm_${"c".repeat(30)}`;
    const result = run([...base.slice(0, 4), "--base", token, "--dry-run"]);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(token);
    expect(result.stdout).toContain("[redacted]");
  });

  it("refuses a base that is not a safe ref name", () => {
    const { fake, run, base } = setup();
    for (const ref of ["a..b", "a//b", "a/", "x.lock", "a@{b", "-x", "a b"]) {
      expect(run(["--title", "x", "--body-file", base[3], "--base", ref]).status, ref).toBe(2);
    }
    expect(fake.lines("gh")).toEqual([]);
  });

  it("leaves the command out of the JSON when the identity step failed", () => {
    const { run, base } = setup();
    const body = JSON.parse(run([...base, "--json"], { FAKE_GH_API_FAIL: "network down" }).stdout);
    expect(body.ok).toBe(false);
    expect("command" in body).toBe(false);
    expect(body.failingLine).not.toContain("a PR may exist");
  });

  it("downgrades only an HTTP 403 or a not-accessible-by-integration error", () => {
    const { run, base } = setup();
    expect(run(base, { FAKE_GH_API_FAIL: "1" }).status).toBe(0);
    expect(run(base, { FAKE_GH_API_FAIL: "request id 4031 failed" }).status).toBe(1);
  });

  it("says a PR may exist only after gh started and failed, timed out, or printed no URL", () => {
    const { fake, run, base } = setup();
    expect(run(base, { FAKE_GH_FAIL: "1" }).stdout).toContain("a PR may exist");
    expect(run(base, { FAKE_GH_EMPTY: "1" }).stdout).toContain("a PR may exist");
    expect(run(base, { FAKE_GH_SLEEP_MS: "4000", RELEASE_TIMEOUT_MS: "400" }).stdout).toContain("a PR may exist");
    expect(fake.lines("gh").length).toBeGreaterThan(3);
    const identity = run(base, { FAKE_GH_API_FAIL: "network down" });
    expect(identity.stdout).not.toContain("a PR may exist");
    const nogh = runNode(join(repoRoot, "tools/pr-open.mjs"), base, { cwd: makeRepo(), env: cleanEnv({ PATH: dirOfGit() }) });
    expect(nogh.stdout).not.toContain("a PR may exist");
  });

  it("documents the App token limit and the hostile --dir risk in --help", () => {
    const { run } = setup();
    const help = run(["--help"]).stdout;
    expect(help).toMatch(/--expect-identity.*App token/s);
    expect(help).toMatch(/hostile --dir|hooks of a/i);
  });
});

function dirOfGit(): string {
  const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  const dir = tempDir();
  symlinkSync(real, join(dir, "git"));
  return dir;
}

describe("5. registryInfo with a bare string", () => {
  it("takes a bare string from npm view as the integrity, with no gitHead", () => {
    const repo = makeReleaseRepo();
    writeFileSync(join(repo.fake.fixtures, "dist-tags.json"), BETA);
    const result = repo.run(["verify", "--json"], { FAKE_BARE_INTEGRITY: "1" });
    expect(result.status, result.stdout).toBe(0);
    const state = JSON.parse(readFileSync(join(repo.work, ".git", "release-state.json"), "utf8"));
    expect(state.verify.integrity).toBe("sha512-FAKEINTEGRITY");
    expect(state.verify.gitHead).toBeNull();
  });
});

describe("6. makeScratch rethrows the original error", () => {
  it("keeps the first error even when the cleanup also fails", async () => {
    const { makeScratch } = await lib("env.mjs");
    const folder = join(tempDir(), "tmp");
    mkdirSync(folder);
    const saved = process.env.TMPDIR;
    process.env.TMPDIR = folder;
    try {
      expect(() =>
        makeScratch({
          onCreated: (dir: string) => {
            // Make the folder impossible to remove: replace the scratch folder's parent permissions after creation.
            chmodSync(folder, 0o500);
            throw new Error(`original ${dir.length > 0}`);
          },
        }),
      ).toThrow("original true");
    } finally {
      chmodSync(folder, 0o700);
      process.env.TMPDIR = saved;
    }
  });
});

describe("7. paths", () => {
  it("maps a git failure after a good path to exit 1, and not to exit 2", () => {
    const fake = makeFakeBin();
    const repo = makeRepo();
    writeFileSync(join(repo, ".git", "config"), "[core\n  broken");
    const result = runNode(join(repoRoot, "tools/gates.mjs"), ["--cwd", repo], { cwd: repo, env: fake.env() });
    expect(result.status).toBe(1);
  });

  it("still maps a folder that is not a work tree to exit 2", () => {
    const fake = makeFakeBin();
    expect(runNode(join(repoRoot, "tools/gates.mjs"), ["--cwd", tempDir()], { env: fake.env() }).status).toBe(2);
  });

  it("writes 'branches' in the plural", () => {
    const tree = pushed();
    git(tree, "branch", "copy1");
    git(tree, "branch", "copy2");
    expect(runNode(script, [tree]).stdout).toMatch(/3 local branches are on a remote/);
  });
});

describe("8. npm view stops at the scratch folder", () => {
  it("writes a package.json and sets the prefix, so a project .npmrc above TMPDIR is not read", () => {
    const repo = makeReleaseRepo();
    const project = tempDir();
    writeFileSync(join(project, ".npmrc"), "registry=http://attacker.example.invalid/\n");
    writeFileSync(join(project, "package.json"), "{}");
    const odd = join(project, "tmp");
    mkdirSync(odd);
    repo.run(["status"], { TMPDIR: odd });
    const views = repo.fake.calls().filter((call) => call.tool === "npm" && call.args[0] === "view");
    expect(views.length).toBeGreaterThan(0);
    for (const view of views) {
      expect(view.values?.hasPackageJson).toBe(true);
      expect(view.values?.prefix).toBe(view.cwd);
    }
  });

  const hasNpm = spawnSync("npm", ["--version"], { encoding: "utf8", env: cleanEnv() }).status === 0;
  it.skipIf(!hasNpm)("the real npm in the scratch folder reads the default registry, not the project one above", async () => {
    const { makeScratch, viewEnv } = await lib("env.mjs");
    const project = tempDir();
    writeFileSync(join(project, ".npmrc"), "registry=http://attacker.example.invalid/\n");
    writeFileSync(join(project, "package.json"), "{}");
    const odd = join(project, "tmp");
    mkdirSync(odd);
    const saved = process.env.TMPDIR;
    process.env.TMPDIR = odd;
    const scratch = makeScratch();
    try {
      const result = spawnSync("npm", ["config", "get", "registry"], { cwd: scratch.dir, env: viewEnv(cleanEnv(), scratch), encoding: "utf8" });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe("https://registry.npmjs.org/");
    } finally {
      scratch.remove();
      process.env.TMPDIR = saved;
    }
  });
});
