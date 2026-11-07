import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, git, makeFakeBin, makeReleaseRepo, makeRepo, repoRoot, runNode, tempDir } from "./support";

afterEach(cleanup);

type Body = { ok: boolean; status: string; exit: number; message: string; phases?: { name: string; state: string; note: string }[]; warnings?: string[]; [key: string]: unknown };
const parse = (text: string) => JSON.parse(text) as Body;
const phase = (body: Body, name: string) => body.phases?.find((entry) => entry.name === name) as { name: string; state: string; note: string };
const BETA = JSON.stringify({ beta: "1.0.0-beta.0", next: "1.0.0-next.0", latest: "1.0.0-next.0" });
const lib = (name: string) => import(pathToFileURL(join(repoRoot, "tools/lib", name)).href);

describe("1. tree-clean fails closed on a repository that can run programs", () => {
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

  it("refuses a tree with a clean filter, names the key, and never runs the filter", () => {
    const tree = pushed();
    const marker = join(tempDir(), "filter-marker");
    const filter = join(tempDir(), "filter.sh");
    writeFileSync(filter, `#!/bin/sh\ntouch '${marker}'\ncat\n`);
    chmodSync(filter, 0o755);
    git(tree, "config", "filter.x.clean", filter);
    writeFileSync(join(tree, ".gitattributes"), "file.txt filter=x\n");
    const later = new Date(Date.now() + 5000);
    utimesSync(join(tree, "file.txt"), later, later);
    const result = runNode(script, [tree]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("filter.x.clean");
    expect(result.stdout).toMatch(/refused/i);
    expect(existsSync(marker)).toBe(false);
  });

  it("refuses each risky config key, and reports the key", () => {
    for (const [key, value] of [["core.sshCommand", "ssh"], ["core.askpass", "x"], ["core.gitProxy", "x"], ["credential.helper", "store"], ["diff.x.textconv", "cat"], ["diff.external", "x"], ["core.attributesFile", "x"], ["gpg.x.program", "x"], ["merge.x.driver", "true"], ["include.path", "other"], ["uploadpack.packObjectsHook", "true"]]) {
      const tree = pushed();
      git(tree, "config", key, value);
      const result = runNode(script, [tree, "--json"]);
      expect(result.status, key).toBe(1);
      const body = JSON.parse(result.stdout);
      expect(body).toMatchObject({ ok: false, refused: true });
      expect(JSON.stringify(body.checks).toLowerCase()).toContain(key.split(".")[0].toLowerCase());
    }
  }, 120000);

  it("fails clean for an untracked file even when the config hides untracked files", () => {
    const tree = pushed();
    git(tree, "config", "status.showUntrackedFiles", "no");
    writeFileSync(join(tree, "new.txt"), "x");
    const result = runNode(script, [tree]);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/FAIL clean.*new\.txt/);
  });

  it("fails clean for a file marked assume-unchanged or skip-worktree", () => {
    for (const flag of ["--assume-unchanged", "--skip-worktree"]) {
      const tree = pushed();
      git(tree, "update-index", flag, "file.txt");
      writeFileSync(join(tree, "file.txt"), "changed\n");
      const result = runNode(script, [tree]);
      expect(result.status, flag).toBe(1);
      expect(result.stdout, flag).toMatch(/FAIL clean.*(assume-unchanged|skip-worktree)/);
    }
  });

  it("still passes a normal clean, pushed, idle tree", () => {
    const tree = pushed();
    const result = runNode(script, [tree]);
    expect(result.status, result.stdout).toBe(0);
  });
});

describe("2. the registry is read from a safe place", () => {
  it("runs every npm view in the scratch folder, not in the repository, so a project .npmrc is ignored", () => {
    const repo = makeReleaseRepo();
    writeFileSync(join(repo.work, ".npmrc"), "registry=http://attacker.example.invalid/\n");
    repo.run(["status"]);
    const views = repo.fake.calls().filter((call) => call.tool === "npm" && call.args[0] === "view");
    expect(views.length).toBeGreaterThan(0);
    for (const view of views) {
      expect(view.cwd.startsWith(repo.work)).toBe(false);
      expect(view.cwd).toContain("release-scratch-");
    }
  });

  it("does not take a 404 for 'not published' when access is restricted", () => {
    const repo = makeReleaseRepo();
    rmSyncSafe(join(repo.fake.fixtures, "dist-tags.json"));
    const file = join(repo.work, "release.config.json");
    const config = JSON.parse(readFileSync(file, "utf8"));
    config.access = "restricted";
    writeFileSync(file, JSON.stringify(config));
    const result = repo.run(["status", "--json"]);
    expect(result.status).toBe(1);
    expect(phase(parse(result.stdout), "publish").state).toBe("unknown");
  });

  it("does not take 'E404' that is not the npm error code line", () => {
    const repo = makeReleaseRepo();
    rmSyncSafe(join(repo.fake.fixtures, "dist-tags.json"));
    const result = repo.run(["status", "--json"], { FAKE_VIEW_ERROR: "npm error some E404 text in a message" });
    expect(result.status).toBe(1);
    expect(phase(parse(result.stdout), "publish").state).toBe("unknown");
  });

  it("never reports done or pass when the registry is not the public one, and warns", () => {
    const repo = makeReleaseRepo();
    writeFileSync(join(repo.fake.fixtures, "dist-tags.json"), BETA);
    const status = repo.run(["status", "--json"], { RELEASE_REGISTRY: "https://registry.example.test/" });
    expect(status.status).toBe(1);
    expect(parse(status.stdout).warnings?.join()).toContain("not the public registry");
    const publish = repo.run(["publish"], { RELEASE_REGISTRY: "https://registry.example.test/" });
    expect(publish.stdout).not.toContain("already done");
    const verify = repo.run(["verify"], { RELEASE_REGISTRY: "https://registry.example.test/" });
    expect(verify.status).toBe(1);
  });

  it("passes --registry to npm install and checks the installed integrity against the registry", () => {
    const repo = makeReleaseRepo();
    writeFileSync(join(repo.fake.fixtures, "dist-tags.json"), BETA);
    expect(repo.run(["verify"]).status).toBe(0);
    const install = repo.fake.calls().find((call) => call.tool === "npm" && call.args[0] === "install");
    expect(install?.args).toEqual(expect.arrayContaining(["--registry", "https://registry.npmjs.org/"]));
    const other = makeReleaseRepo();
    writeFileSync(join(other.fake.fixtures, "dist-tags.json"), BETA);
    const result = other.run(["verify"], { FAKE_INSTALL_INTEGRITY: "sha512-DIFFERENT" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("integrity");
  });
});

function rmSyncSafe(path: string) {
  rmSync(path, { force: true });
}

describe("3. redaction", () => {
  const cases: [string, RegExp][] = [
    ["AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCY", /wJalrXUtnFEMI/],
    ["MY_SERVICE_KEY: abcdef123", /abcdef123/],
    ["DB_PASSWORD=hunter2x", /hunter2x/],
    ["SOME_SECRET = valuehere9", /valuehere9/],
    ["x-api-key: key-value-12345", /key-value-12345/],
    ["Cookie: session=abc123; other=def456", /abc123|def456/],
    ["Set-Cookie: sid=zzz999; Path=/", /zzz999/],
    ["-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----", /MIIEow/],
    ["-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n(cut off", /MIIEvQ/],
    ["token sk-abcdefghijklmnopqrstuvwxyz1234", /sk-abcdefghijkl/],
    ["stripe sk_live_abcdefghij1234567890", /sk_live_abcdef/],
    ["stripe rk_live_abcdefghij1234567890", /rk_live_abcdef/],
    ["passwd=secretpass1", /secretpass1/],
    ["private_key=base64keymaterial", /base64keymaterial/],
    ['{"token":"unterminated value here', /unterminated value/],
  ];
  for (const [input, leak] of cases) {
    it(`redacts ${input.slice(0, 40).replace(/\n/g, " ")}`, async () => {
      const { redact } = await lib("text.mjs");
      const out = redact(`x ${input} y`);
      expect(out).toContain("[redacted]");
      expect(out).not.toMatch(leak);
    });
  }

  it("keeps a registry URL with a port readable", async () => {
    const { redact } = await lib("text.mjs");
    for (const url of ["https://registry.example.com:8443/path", "http://127.0.0.1:9/", "see https://registry.example.com:8443/a/b@c for more"]) expect(redact(url)).toBe(url);
  });

  it("leaves boolean and null values alone, but redacts a number after a secret name", async () => {
    const { redact } = await lib("text.mjs");
    for (const text of ["secret=true", "password=false", "token: null"]) expect(redact(text), text).toBe(text);
    for (const text of ["password=123456", "token: 5", "//reg/:_authToken=12345678", "api_key: 12"]) expect(redact(text), text).toContain("[redacted]");
  });

  it("keeps JSON valid when it redacts inside JSON text", async () => {
    const { redact } = await lib("text.mjs");
    const json = JSON.stringify({ a: 1, token: "abc\"def", nested: { password: "p w", list: ["x", { secret: "s" }] }, other: "fine" });
    const out = redact(json);
    expect(() => JSON.parse(out)).not.toThrow();
    expect(out).not.toMatch(/abc|\\"def|p w/);
    expect(JSON.parse(out).other).toBe("fine");
  });
});

describe("4. pr-open identity", () => {
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

  it("with --expect-identity passes when the login matches", () => {
    const { run, base } = setup();
    expect(run([...base, "--expect-identity", "example-user"]).status).toBe(0);
  });

  it("with --expect-identity fails closed when the login differs, and creates nothing", () => {
    const { fake, run, base } = setup();
    const result = run([...base, "--expect-identity", "someone-else"]);
    expect(result.status).toBe(1);
    expect(fake.lines("gh").some((line) => line.startsWith("pr create"))).toBe(false);
  });

  it("with --expect-identity fails closed when the identity can not be read, even with a 403", () => {
    const { fake, run, base } = setup();
    const result = run([...base, "--expect-identity", "example-user"], { FAKE_GH_API_FAIL: "1" });
    expect(result.status).toBe(1);
    expect(fake.lines("gh").some((line) => line.startsWith("pr create"))).toBe(false);
  });

  it("downgrades only the integration error to a warning, not a bare HTTP 403 such as a rate limit", () => {
    const { run, base } = setup();
    expect(run(base, { FAKE_GH_API_FAIL: "HTTP 403: API rate limit exceeded" }).status).toBe(1);
    expect(run(base, { FAKE_GH_API_FAIL: "HTTP 403: SAML enforcement" }).status).toBe(1);
  });

  it("downgrades a 403 to a warning, but fails on another identity error", () => {
    const { fake, run, base } = setup();
    expect(run(base, { FAKE_GH_API_FAIL: "1" }).status).toBe(0);
    const other = run(base, { FAKE_GH_API_FAIL: "network down" });
    expect(other.status).toBe(1);
    expect(other.stdout).toContain("FAILED gh identity");
    expect(other.stdout).not.toContain("FAILED gh pr create");
    expect(fake.lines("gh").filter((line) => line.startsWith("pr create")).length).toBe(1);
  });

  it("allows an underscore in a login", () => {
    const { run, base } = setup();
    expect(run(base, { FAKE_GH_API_OUTPUT: "some_user" }).status).toBe(0);
  });

  it("says a PR may exist when gh prints no URL, or exits non-zero after it printed one", () => {
    const { run, base } = setup();
    expect(run(base, { FAKE_GH_FAIL_URL: "1" }).stdout).toContain("a PR may exist: check before retrying");
    expect(run(base, { FAKE_GH_EMPTY: "1" }).stdout).toContain("a PR may exist: check before retrying");
  });

  it("includes the warnings in a failure JSON", () => {
    const { run, base } = setup();
    const body = JSON.parse(run([...base, "--json"], { FAKE_GH_API_FAIL: "1", FAKE_GH_FAIL: "1" }).stdout);
    expect(body.ok).toBe(false);
    expect(body.warnings.join()).toContain("identity");
  });

  it("shows the title as it is in the printed command", () => {
    const { run, base } = setup();
    const result = run(["--title", "Add the user_key option", ...base.slice(2)]);
    expect(result.stdout).toContain("'Add the user_key option'");
  });

  it("refuses a title that holds a secret", () => {
    const { fake, run, base } = setup();
    const result = run(["--title", `fix ${"npm_" + "a".repeat(30)}`, ...base.slice(2)]);
    expect(result.status).toBe(1);
    expect(fake.lines("gh")).toEqual([]);
  });
});

describe("5. pr-body", () => {
  const FOOTER = "🤖 Generated with [Claude Code](https://claude.com/claude-code)";
  const good = `> [!NOTE]\n> Adds the release script.\n\nThe script reads the config file.\n\n${FOOTER}\n`;

  it("decodes each percent run on its own, so a lone percent sign does not stop decoding", async () => {
    const { validateBody } = await lib("pr-body.mjs");
    expect(validateBody(good.replace("config file", "100% sure, see %2FUsers%2Fsomeone%2Fx")).join()).toMatch(/home path/);
    expect(validateBody(good.replace("config file", "%zz and %2Fhome%2Fsomeone")).join()).toMatch(/home path/);
  });

  it("checks &apos; as an apostrophe", async () => {
    const { validateBody } = await lib("pr-body.mjs");
    expect(validateBody(good.replace("reads", "don&apos;t read")).join()).toMatch(/contraction/);
    expect(validateBody(good.replace("reads", "don&#39;t read")).join()).toMatch(/contraction/);
  });

  it("finds a division slash, lowercase users, root, var/root, and more claude.ai links", async () => {
    const { validateBody } = await lib("pr-body.mjs");
    const forms = [
      "file at ∕Users∕someone",
      "file at /users/someone/x",
      "file at /root/x",
      "file at /var/root/x",
      "link https://claude.ai/share/abc",
      "link https://claude.ai/s/abc",
      "link https://claude.ai/project/abc",
    ];
    for (const text of forms) expect(validateBody(good.replace("config file", text)).join(), text).toMatch(/home path|session link/);
  });
});

describe("6. makeScratch cleans up after a failure", () => {
  it("leaves no scratch folder when a step after mkdtemp throws", async () => {
    const { makeScratch } = await lib("env.mjs");
    const folder = join(tempDir(), "tmp");
    mkdirSync(folder);
    const saved = process.env.TMPDIR;
    process.env.TMPDIR = folder;
    try {
      expect(() => makeScratch({ onCreated: () => { throw new Error("boom"); } })).toThrow("boom");
      expect(readdirSync(folder).filter((name: string) => name.startsWith("release-scratch-"))).toEqual([]);
    } finally {
      process.env.TMPDIR = saved;
    }
  });
});
