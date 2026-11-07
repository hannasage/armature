import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanEnv, cleanup, git, makeFakeBin, makeReleaseRepo, makeRepo, repoRoot, runNode, tempDir, type ReleaseRepo } from "./support";

afterEach(cleanup);

type Phase = { name: string; state: string; note: string };
type Body = { ok: boolean; status: string; exit: number; message: string; phases?: Phase[]; warnings?: string[]; [key: string]: unknown };
const parse = (text: string) => JSON.parse(text) as Body;
const phase = (body: Body, name: string) => body.phases?.find((entry) => entry.name === name) as Phase;
const BETA = JSON.stringify({ beta: "1.0.0-beta.0", next: "1.0.0-next.0", latest: "1.0.0-next.0" });
const noTags = (repo: ReleaseRepo) => rmSync(join(repo.fake.fixtures, "dist-tags.json"));

const env = (await import(pathToFileURL(join(repoRoot, "tools/lib/env.mjs")).href)) as {
  makeScratch(): { dir: string; npmrc: string; globalrc: string; remove(): void };
  toolEnv(env: NodeJS.ProcessEnv, scratch: unknown): NodeJS.ProcessEnv;
  viewEnv(env: NodeJS.ProcessEnv, scratch: unknown): NodeJS.ProcessEnv;
};
const hasNpm = spawnSync("npm", ["--version"], { encoding: "utf8", env: cleanEnv() }).status === 0;

describe("A. the real npm under the scrubbed environments", () => {
  for (const kind of ["toolEnv", "viewEnv"] as const) {
    it.skipIf(!hasNpm)(`${kind}: npm runs and reads two different config files`, () => {
      const scratch = env.makeScratch();
      try {
        const childEnv = env[kind](cleanEnv(), scratch);
        expect(childEnv.NPM_CONFIG_USERCONFIG).not.toBe(childEnv.NPM_CONFIG_GLOBALCONFIG);
        const user = spawnSync("npm", ["config", "get", "userconfig"], { encoding: "utf8", env: childEnv });
        expect(user.status, user.stderr).toBe(0);
        expect(user.stdout.trim().startsWith(scratch.dir)).toBe(true);
        const global = spawnSync("npm", ["config", "get", "globalconfig"], { encoding: "utf8", env: childEnv });
        expect(global.status, global.stderr).toBe(0);
        expect(spawnSync("npm", ["--version"], { encoding: "utf8", env: childEnv }).status).toBe(0);
      } finally {
        scratch.remove();
      }
    });
  }

  it.skipIf(!hasNpm)("status with a non-public registry reports unknown with a JSON result and no crash", () => {
    const repo = makeReleaseRepo();
    const result = spawnSync(process.execPath, [repo.script, "status", "--json"], {
      cwd: repo.work,
      env: cleanEnv({ RELEASE_REGISTRY: "http://127.0.0.1:9/", RELEASE_TIMEOUT_MS: "30000" }),
      encoding: "utf8",
    });
    expect(result.status, result.stdout + result.stderr).toBe(1);
    const body = parse(result.stdout);
    expect(body.status).toBe("unknown");
    expect(phase(body, "publish").state).toBe("unknown");
    expect(result.stderr).not.toContain("    at ");
  }, 60000);
});

describe("B. when a registry 404 means not published", () => {
  it("is accepted only for a fresh state, the right name, and the public registry, and then warns", () => {
    const repo = makeReleaseRepo();
    noTags(repo);
    const result = repo.run(["status", "--json"]);
    expect(result.status).toBe(0);
    const body = parse(result.stdout);
    expect(phase(body, "publish").state).toBe("todo");
    expect(phase(body, "retire").state).toBe("todo");
    expect(body.warnings?.join()).toContain("registry says not found: normal before the first publish; otherwise check the package name");
    expect(repo.run(["status"]).stdout).toContain("registry says not found: normal before the first publish");
  });

  it("passes the public registry explicitly in every view", () => {
    const repo = makeReleaseRepo();
    repo.run(["status"]);
    const views = repo.fake.lines("npm").filter((line) => line.startsWith("view"));
    expect(views.length).toBeGreaterThan(0);
    for (const line of views) expect(line).toContain("--registry https://registry.npmjs.org/");
  });

  it("is unknown when a verify record says the package was published", () => {
    const repo = makeReleaseRepo();
    repo.run(["preflight"]);
    writeFileSync(join(repo.fake.fixtures, "dist-tags.json"), BETA);
    expect(repo.run(["verify"]).status).toBe(0);
    noTags(repo);
    const result = repo.run(["status", "--json"]);
    expect(result.status).toBe(1);
    const body = parse(result.stdout);
    expect(phase(body, "publish").state).toBe("unknown");
    expect(phase(body, "publish").note).toContain("record");
  });

  it("is unknown when package.json names another package", () => {
    const repo = makeReleaseRepo();
    noTags(repo);
    const file = join(repo.work, "package.json");
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    pkg.name = "@someone/else";
    writeFileSync(file, JSON.stringify(pkg));
    const result = repo.run(["status", "--json"]);
    expect(result.status).toBe(1);
    expect(phase(parse(result.stdout), "publish").state).toBe("unknown");
    expect(phase(parse(result.stdout), "publish").note).toContain("name");
  });

  it("is unknown for a registry other than the public one, with a visible warning and no registry read", () => {
    const repo = makeReleaseRepo();
    noTags(repo);
    const result = repo.run(["status", "--json"], { RELEASE_REGISTRY: "https://registry.example.test/" });
    expect(result.status).toBe(1);
    const body = parse(result.stdout);
    expect(phase(body, "publish").state).toBe("unknown");
    expect(body.warnings?.join()).toContain("not the public registry");
    expect(repo.fake.lines("npm").some((line) => line.startsWith("view"))).toBe(false);
  });
});

describe("I. status reads that fail are unknown", () => {
  it("marks the tag phase unknown when git can not look up the local tag", () => {
    const repo = makeReleaseRepo();
    const bin = join(repo.fake.bin, "git");
    const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    writeFileSync(bin, `#!/bin/sh\nif [ "$1" = "rev-parse" ] && [ "$2" = "-q" ]; then echo "fatal: broken" >&2; exit 128; fi\nexec '${real}' "$@"\n`);
    chmodSync(bin, 0o755);
    const result = repo.run(["status", "--json"]);
    expect(result.status).toBe(1);
    expect(phase(parse(result.stdout), "tag").state).toBe("unknown");
  });

  it("marks the claims phase unknown when grep itself fails", () => {
    const repo = makeReleaseRepo();
    rmSync(join(repo.work, "docs"), { recursive: true });
    const result = repo.run(["status", "--json"]);
    expect(result.status).toBe(1);
    expect(phase(parse(result.stdout), "claims").state).toBe("unknown");
  });
});

describe("D. pr-open identity and timeout", () => {
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

  it("warns and goes on when the identity can not be read", () => {
    const { run, base } = setup();
    const result = run(base, { FAKE_GH_API_FAIL: "1" });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/WARNING.*identity/);
    expect(result.stdout).toContain("https://github.com/example/repo/pull/1");
    const json = JSON.parse(run([...base, "--json"], { FAKE_GH_API_FAIL: "1" }).stdout);
    expect(json).toMatchObject({ ok: true, identity: null });
    expect(json.warnings.join()).toContain("identity");
  });

  it("refuses an identity that does not look like a login", () => {
    const { fake, run, base } = setup();
    const result = run(base, { FAKE_GH_API_OUTPUT: "<html>sign in</html>" });
    expect(result.status).toBe(1);
    expect(fake.lines("gh").some((line) => line.startsWith("pr create"))).toBe(false);
  });

  it("accepts a bot login", () => {
    const { run, base } = setup();
    expect(run(base, { FAKE_GH_API_OUTPUT: "coda-crew[bot]" }).status).toBe(0);
  });

  it("puts the identity in the JSON result", () => {
    const { run, base } = setup();
    expect(JSON.parse(run([...base, "--json"]).stdout).identity).toBe("example-user");
  });

  it("says a pull request may exist when gh pr create times out", () => {
    const { run, base } = setup();
    const result = run(base, { FAKE_GH_SLEEP_MS: "9000", RELEASE_TIMEOUT_MS: "2500" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("a PR may exist: check before retrying");
  });

  it("checks the title with the same rules as the body", () => {
    const { fake, run, base } = setup();
    for (const title of ["fix /Users/someone/x", "it's done", "see claude.ai/code/x"]) {
      const result = run(["--title", title, ...base.slice(2)]);
      expect(result.status, title).toBe(1);
    }
    expect(fake.lines("gh")).toEqual([]);
  });
});

describe("H. tree-clean runs git without the repository hooks", () => {
  it("does not run a core.fsmonitor command from the repository config", () => {
    const repo = makeRepo("task/x");
    const marker = join(tempDir(), "marker");
    const hook = join(tempDir(), "fsmonitor.sh");
    writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\nprintf '\\0'\n`);
    chmodSync(hook, 0o755);
    git(repo, "config", "core.fsmonitor", hook);
    const result = runNode(join(repoRoot, "tools/tree-clean.mjs"), [repo]);
    expect(result.stdout).toContain("core.fsmonitor");
    expect(existsSync(marker)).toBe(false);
    expect(result.status).toBe(1);
  });

  it("does not pass a token to git", () => {
    const repo = makeRepo("task/x");
    const spy = join(tempDir(), "bin");
    mkdirSync(spy);
    const log = join(spy, "log");
    const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    writeFileSync(join(spy, "git"), `#!/bin/sh\necho "\${NPM_TOKEN:-none}|\${GH_TOKEN:-none}" >> '${log}'\nexec '${real}' "$@"\n`);
    chmodSync(join(spy, "git"), 0o755);
    runNode(join(repoRoot, "tools/tree-clean.mjs"), [repo], { env: cleanEnv({ PATH: `${spy}:${process.env.PATH}`, NPM_TOKEN: "t1", GH_TOKEN: "t2" }) });
    const lines = readFileSync(log, "utf8").trim().split("\n");
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) expect(line).toBe("none|none");
  });
});
