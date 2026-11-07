import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./support";

const lib = (await import(pathToFileURL(join(repoRoot, "tools/lib/text.mjs")).href)) as {
  redact(text: string): string;
  failingLine(stdout: string, stderr: string): string;
  redactDeep<T>(value: T): T;
};

describe("redact", () => {
  it("covers every token shape", () => {
    const samples = [
      "ghp_abcdefghijklmnopqrstuvwxyz012345",
      "gho_abcdefghijklmnopqrstuvwxyz012345",
      "github_pat_abcdefghijklmnopqrstuvwxyz_0123",
      `npm_${"b".repeat(36)}`,
      "//registry.npmjs.org/:_authToken=abc123secret",
      "Authorization: Bearer abc.def-ghi",
      "NODE_AUTH_TOKEN=hunter2",
      "npm publish --otp 123456",
      "npm publish --otp=654321",
      "//r/:_auth=dXNlcjpwYXNz",
      "_password=cGFzcw==",
      "Authorization: Basic dXNlcjpwYXNz",
    ];
    for (const sample of samples) {
      const out = lib.redact(`x ${sample} y`);
      expect(out, sample).toContain("[redacted]");
      expect(out, sample).not.toMatch(/ghp_a|gho_a|github_pat_a|npm_b|abc123secret|abc\.def|hunter2|123456|654321|dXNlcjpwYXNz|cGFzcw==/);
    }
  });

  it("leaves ordinary text alone", () => {
    expect(lib.redact("src/a.ts: error 12:3 unused variable")).toBe("src/a.ts: error 12:3 unused variable");
  });
});

describe("failingLine", () => {
  it("redacts before it cuts, so a token at the cut is not left half shown", () => {
    const line = `error ${"x".repeat(285)} npm_${"a".repeat(40)}`;
    expect(lib.failingLine("", line)).not.toMatch(/npm_a/);
  });

  it("returns the first line that names an error", () => {
    expect(lib.failingLine("ok\nfirst error here\nsecond error", "")).toBe("first error here");
  });
});

describe("redactDeep", () => {
  it("redacts every string in an object, a list, and a nested value, and leaves the shape alone", () => {
    const input = { a: "x --otp 123456", b: ["_authToken=abc", { c: "Bearer q.r" }], n: 5, ok: true, nothing: null };
    const out = lib.redactDeep(input);
    expect(JSON.stringify(out)).not.toMatch(/123456|abc|q\.r/);
    expect(out.n).toBe(5);
    expect(out.ok).toBe(true);
    expect(out.nothing).toBeNull();
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });

  it("keeps the JSON valid when a field ends with a token", () => {
    const out = lib.redactDeep({ line: "see //r/:_authToken=abc", cmd: "npm publish --otp 123456" });
    expect(JSON.parse(JSON.stringify(out))).toEqual({ line: "see //r/:_authToken=[redacted]", cmd: "npm publish --otp [redacted]" });
  });
});
