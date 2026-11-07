import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, makeFakeBin, makeRepo, repoRoot, runNode, tempDir } from "./support";

afterEach(cleanup);

const script = join(repoRoot, "tools/pr-open.mjs");
const FOOTER = "🤖 Generated with [Claude Code](https://claude.com/claude-code)";
const GOOD = `> [!NOTE]\n> Adds the release script.\n\nTests use a fake registry.\n\n${FOOTER}\n`;

function setup(body = GOOD) {
  const fake = makeFakeBin();
  const repo = makeRepo();
  const dir = tempDir();
  const bodyFile = join(dir, "body.md");
  writeFileSync(bodyFile, body);
  const run = (args: string[], env: Record<string, string> = {}) => runNode(script, args, { cwd: repo, env: fake.env(env) });
  const base = ["--title", "Add release script", "--body-file", bodyFile, "--base", "release/1.0.0"];
  return { fake, repo, bodyFile, run, base };
}

describe("pr-open", () => {
  it("opens a draft pull request against the base branch and prints the URL", () => {
    const { fake, run, base } = setup();
    const result = run(base);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("https://github.com/example/repo/pull/1");
    expect(result.stdout).toContain("$ gh pr create --draft --base release/1.0.0");
    const calls = fake.lines("gh").filter((line) => line.startsWith("pr create"));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^pr create --draft --base release\/1\.0\.0 --title Add release script --body-file /);
  });

  it("never opens a pull request that is not a draft", () => {
    const { fake, run, base } = setup();
    expect(run([...base, "--ready"]).status).toBe(2);
    expect(run([...base, "--no-draft"]).status).toBe(2);
    expect(run([...base, "--draft=false"]).status).toBe(2);
    expect(fake.lines("gh")).toEqual([]);
  });

  it("checks the body before it calls gh, and does not call gh when the body is bad", () => {
    const { fake, run, base } = setup("No alert and it's wrong\n");
    const result = run(base);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/first line/);
    expect(fake.lines("gh")).toEqual([]);
  });

  it("refuses a body with a trailing-newline loophole", () => {
    const { fake, run, base } = setup(`${GOOD}\n\n`);
    expect(run(base).status).toBe(1);
    expect(fake.lines("gh")).toEqual([]);
  });

  it("exits 2 when a required argument is missing", () => {
    const { fake, run } = setup();
    expect(run(["--title", "x"]).status).toBe(2);
    expect(run([]).status).toBe(2);
    expect(fake.lines("gh")).toEqual([]);
  });

  it("exits 2 for an unknown flag", () => {
    const { run, base } = setup();
    expect(run([...base, "--bogus"]).status).toBe(2);
  });

  it("refuses a body file that does not exist and a folder that is not a work tree", () => {
    const { fake, run, base } = setup();
    expect(run(["--title", "x", "--body-file", "/nonexistent/body.md", "--base", "main"]).status).toBe(2);
    expect(run([...base, "--dir", tempDir()]).status).toBe(2);
    expect(run([...base, "--dir", "/nonexistent/dir"]).status).toBe(2);
    expect(fake.lines("gh")).toEqual([]);
  });

  it("refuses a title with a line break, a base that looks like a flag, and an empty title", () => {
    const { run, bodyFile } = setup();
    expect(run(["--title", "a\nb", "--body-file", bodyFile, "--base", "main"]).status).toBe(2);
    expect(run(["--title", "ok", "--body-file", bodyFile, "--base", "--force"]).status).toBe(2);
    expect(run(["--title", "ok", "--body-file", bodyFile, "--base", "-x"]).status).toBe(2);
    expect(run(["--title", " ", "--body-file", bodyFile, "--base", "main"]).status).toBe(2);
  });

  it("with --dry-run checks the body and prints the command, but does not call gh", () => {
    const { fake, run, base } = setup();
    const result = run([...base, "--dry-run"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("gh pr create --draft");
    expect(fake.lines("gh")).toEqual([]);
  });

  it("reports a gh failure with its first line and exit 1", () => {
    const { run, base } = setup();
    const result = run(base, { FAKE_GH_FAIL: "1" });
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("could not create the pull request");
  });

  it("prints one JSON object under --json", () => {
    const { run, base } = setup();
    const result = run([...base, "--json"]);
    const body = JSON.parse(result.stdout);
    expect(body).toMatchObject({ ok: true, status: "pass", exit: 0, url: "https://github.com/example/repo/pull/1", draft: true });
    expect(body.command).toContain("--draft");
    const other = setup("nope\n");
    const bad = JSON.parse(other.run([...other.base, "--json"]).stdout);
    expect(bad).toMatchObject({ ok: false, status: "invalid-body", exit: 1 });
    expect(bad.problems.length).toBeGreaterThan(0);
  });

  it("runs gh in the folder given by --dir", () => {
    const { fake, run, base, repo } = setup();
    expect(run([...base, "--dir", repo]).status).toBe(0);
    expect(fake.calls().find((entry) => entry.args[0] === "pr")?.cwd).toBe(repo);
  });

  it("does not change the body file", () => {
    const { run, base, bodyFile } = setup();
    run(base);
    expect(readFileSync(bodyFile, "utf8")).toBe(GOOD);
  });

  it("fails with exit 1 when gh succeeds but prints no pull request URL", () => {
    const { run, base } = setup();
    const empty = run(base, { FAKE_GH_EMPTY: "1" });
    expect(empty.status).toBe(1);
    expect(empty.stdout).not.toContain("https://");
    const odd = run(base, { FAKE_GH_OUTPUT: "all done" });
    expect(odd.status).toBe(1);
    const json = JSON.parse(run([...base, "--json"], { FAKE_GH_EMPTY: "1" }).stdout);
    expect(json).toMatchObject({ ok: false, exit: 1 });
  });

  it("passes the checked text to gh on standard input and does not read the path again", () => {
    const { fake, run, base } = setup();
    expect(run(base).status).toBe(0);
    const call = fake.calls().find((entry) => entry.tool === "gh" && entry.args[0] === "pr")!;
    expect(call.args.slice(-2)).toEqual(["--body-file", "-"]);
    expect(call.stdin).toBe(GOOD);
  });

  it("refuses a body file outside the repository and the temporary folder", () => {
    const { fake, run } = setup();
    const outside = join(repoRoot, "README.md");
    const result = run(["--title", "x", "--body-file", outside, "--base", "main"]);
    expect(result.status).toBe(2);
    expect(fake.lines("gh")).toEqual([]);
  });

  it("accepts a body file inside the repository", () => {
    const { run, repo } = setup();
    const inside = join(repo, "body.md");
    writeFileSync(inside, GOOD);
    expect(run(["--title", "x", "--body-file", inside, "--base", "main"]).status).toBe(0);
  });

  it("exits 1 and says git could not run when git is missing", () => {
    const { fake, repo } = setup();
    const empty = tempDir();
    const result = runNode(script, ["--title", "x", "--body-file", join(repo, "none.md"), "--base", "main"], { cwd: repo, env: fake.env({ PATH: empty }) });
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("git could not run");
  });

  it("can be imported without running", async () => {
    const lib = await import(pathToFileURL(script).href);
    expect(typeof lib.main).toBe("function");
  });
});
