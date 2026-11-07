import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanEnv, cleanup, git, makeFakeBin, makeRepo, repoRoot, runNode, tempDir } from "./support";

afterEach(cleanup);

const lib = (name: string) => import(pathToFileURL(join(repoRoot, "tools/lib", name)).href);
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

/** A pushed tree with an embedded repository committed as a gitlink (mode 160000), with no .gitmodules and no .git/modules. */
function withGitlink(options: { filterMarker?: string } = {}) {
  const tree = pushed();
  const source = makeRepo("main");
  spawnSync("git", ["clone", "-q", source, "embedded"], { cwd: tree, encoding: "utf8", env: cleanEnv() });
  git(tree, "add", "embedded");
  git(tree, "-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-q", "-m", "add embedded");
  git(tree, "push", "-q");
  expect(git(tree, "ls-files", "-s")).toContain("160000");
  expect(existsSync(join(tree, ".gitmodules"))).toBe(false);
  expect(existsSync(join(tree, ".git", "modules"))).toBe(false);
  if (options.filterMarker !== undefined) {
    const filter = join(tempDir(), "filter.sh");
    writeFileSync(filter, `#!/bin/sh\ntouch '${options.filterMarker}'\ncat\n`);
    chmodSync(filter, 0o755);
    writeFileSync(join(tree, "embedded", ".gitattributes"), "file.txt filter=x\n");
    git(join(tree, "embedded"), "config", "filter.x.clean", filter);
    const later = new Date(Date.now() + 5000);
    utimesSync(join(tree, "embedded", "file.txt"), later, later);
  }
  return tree;
}

describe("1. tree-clean and gitlinks", () => {
  it("refuses a gitlink whose nested repository has a clean filter, and never runs the filter", () => {
    const marker = join(tempDir(), "gitlink-marker");
    const tree = withGitlink({ filterMarker: marker });
    const result = runNode(script, [tree]);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/gitlink/i);
    expect(existsSync(marker)).toBe(false);
  });

  it("refuses a gitlink whose nested repository has no change", () => {
    const tree = withGitlink();
    const result = runNode(script, [tree, "--json"]);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, refused: true });
  });

  it("refuses a tree whose common git folder has a modules folder, or a worktree folder has one", () => {
    const main = pushed();
    mkdirSync(join(main, ".git", "modules"));
    const wt = join(tempDir(), "wt");
    git(main, "worktree", "add", "-q", "-b", "wtbranch", wt);
    expect(runNode(script, [wt]).status).toBe(1);
    expect(runNode(script, [main]).status).toBe(1);
    const other = pushed();
    const wt2 = join(tempDir(), "wt2");
    git(other, "worktree", "add", "-q", "-b", "wt2branch", wt2);
    mkdirSync(join(other, ".git", "worktrees", "wt2", "modules"));
    expect(runNode(script, [wt2]).status).toBe(1);
  });

  it("refuses the config keys that can hide a changed gitlink", () => {
    for (const [key, value] of [["diff.ignoreSubmodules", "all"], ["submodule.x.ignore", "all"]]) {
      const tree = pushed();
      git(tree, "config", key, value);
      const result = runNode(script, [tree]);
      expect(result.status, key).toBe(1);
      expect(result.stdout, key).toContain(key.split(".")[0]);
    }
  }, 60000);

  it("passes a normal pushed tree and does not refuse this clone tree", () => {
    expect(runNode(script, [pushed()]).status).toBe(0);
    const body = JSON.parse(runNode(script, [repoRoot, "--json"]).stdout);
    expect(body.refused).not.toBe(true);
  });

  it("describes the real refusals in --help", () => {
    const help = runNode(script, ["--help"]).stdout;
    expect(help).toMatch(/submodule|gitlink/i);
    expect(help).not.toMatch(/a pager, a hook path/i);
  });
});

describe("2. redaction", () => {
  it("redacts a digit-only URL password that is followed by the host, but not a port followed by a slash", async () => {
    const { redact } = await lib("text.mjs");
    for (const text of ["https://admin:123456@host/x", "postgres://u:8080@db:5432/app"]) {
      const out = redact(text);
      expect(out, text).toContain("[redacted]");
      expect(out, text).not.toMatch(/123456|:8080@/);
    }
    for (const text of ["http://127.0.0.1:48123/@scope%2fpkg", "https://example.com:8080/a@b.com/x", "https://[::1]:3000/@x/y", "http://[2001:db8::1]:8080/a@b"]) expect(redact(text), text).toBe(text);
  });

  it("leaves ordinary prose alone, including the word pass", async () => {
    const { redact } = await lib("text.mjs");
    for (const text of ["pass: all gates green", "tests pass: 12 of 12", "the token ring and the secret sauce", "Result: all 5 gates passed", "a password manager"]) expect(redact(text), text).toBe(text);
  });

  it("redacts passwd, password, and passphrase with a number or a word", async () => {
    const { redact } = await lib("text.mjs");
    for (const text of ["passwd=1234", "password: 8675309", "passphrase=correct horse"]) expect(redact(text), text).toContain("[redacted]");
  });

  it("keeps JSON valid", async () => {
    const { redact } = await lib("text.mjs");
    const out = redact(JSON.stringify({ password: "123456", token: "5", note: "pass: all gates green", url: "postgres://u:8080@db:5432/app" }));
    expect(() => JSON.parse(out)).not.toThrow();
    expect(JSON.parse(out).note).toBe("pass: all gates green");
    expect(out).not.toMatch(/123456|:8080@/);
  });
});

describe("3. pr-open", () => {
  const FOOTER = "🤖 Generated with [Claude Code](https://claude.com/claude-code)";
  const GOOD = `> [!NOTE]\n> Adds it.\n\n${FOOTER}\n`;
  function setup() {
    const fake = makeFakeBin();
    const repo = makeRepo();
    const body = join(tempDir(), "body.md");
    writeFileSync(body, GOOD);
    const base = ["--title", "x", "--body-file", body, "--base", "main"];
    return { fake, base, run: (args: string[], extra: Record<string, string> = {}) => runNode(join(repoRoot, "tools/pr-open.mjs"), args, { cwd: repo, env: fake.env(extra) }) };
  }

  it("does not say a PR may exist after a clean failure before creation", () => {
    const { run, base } = setup();
    const text = run(base, { FAKE_GH_FAIL: "1" });
    expect(text.status).toBe(1);
    expect(text.stdout).not.toContain("a PR may exist");
    const json = JSON.parse(run([...base, "--json"], { FAKE_GH_FAIL: "1" }).stdout);
    expect(json.failingLine).not.toContain("a PR may exist");
  });

  it("says a PR may exist on a timeout, on no URL, and on a non-zero exit whose output holds a PR URL", () => {
    const { run, base } = setup();
    expect(run(base, { FAKE_GH_SLEEP_MS: "4000", RELEASE_TIMEOUT_MS: "400" }).stdout).toContain("a PR may exist");
    expect(run(base, { FAKE_GH_EMPTY: "1" }).stdout).toContain("a PR may exist");
    expect(run(base, { FAKE_GH_FAIL_URL: "1" }).stdout).toContain("a PR may exist");
  });

  it("treats only the integration message as a harmless identity failure", () => {
    const { run, base } = setup();
    expect(run(base, { FAKE_GH_API_FAIL: "1" }).status).toBe(0);
    expect(run(base, { FAKE_GH_API_FAIL: "HTTP 403: Forbidden" }).status).toBe(1);
  });

  it("says a PR may exist when gh output is too large, and does not say gh did not start", () => {
    const { run, base } = setup();
    const result = run(base, { FAKE_GH_BIGOUTPUT: "1", RELEASE_MAX_BUFFER: "1000" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("a PR may exist");
    expect(result.stdout).not.toMatch(/did not start|could not start/);
  });

  it("does not say a PR may exist when gh is missing", () => {
    const git = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    const dir = tempDir();
    symlinkSync(git, join(dir, "git"));
    const { base } = setup();
    const result = runNode(join(repoRoot, "tools/pr-open.mjs"), base, { cwd: makeRepo(), env: cleanEnv({ PATH: dir }) });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("a PR may exist");
  });
});

