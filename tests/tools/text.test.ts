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
      "https://alice:s3cretpw@registry.example.com/x",
      "//bob:hunter22@host/path",
      "key sk-ant-api03-abcdefghijklmnop",
      "id AKIAABCDEFGHIJKLMNOP end",
      '{"_authToken":"tok123value"}',
      '{"_password": "cGFzcw"}',
    ];
    for (const sample of samples) {
      const out = lib.redact(`x ${sample} y`);
      expect(out, sample).toContain("[redacted]");
      expect(out, sample).not.toMatch(/ghp_a|gho_a|github_pat_a|npm_b|abc123secret|abc\.def|hunter2|123456|654321|dXNlcjpwYXNz|cGFzcw==|s3cretpw|hunter22|sk-ant-api03|AKIAABCDEFGHIJKLMNOP|tok123value|cGFzcw"/);
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

describe("redact: more shapes", () => {
  const cases: [string, RegExp][] = [
    ['{"_authToken":"to\\"ken\\"tail123"}', /tail123|to\\"ken/],
    ["{'access_token': 'sq-secret-value'}", /sq-secret-value/],
    ["access_token=abc123xyz", /abc123xyz/],
    ["client_secret: topsecretvalue", /topsecretvalue/],
    ["authToken = spacedvalue1", /spacedvalue1/],
    ["password=hunter99", /hunter99/],
    ["https://user:pa/ss@host.example/x", /pa\/ss/],
    ["https://user:p@ss@host.example/x", /ss@host|p@ss/],
    ["https://ghp_notarealtokenbutlongenough000@github.com/a/b", /notarealtoken/],
    ["https://abcdefghijklmnopqrstuvwx@host.example/x", /abcdefghijklmnopqrstuvwx/],
    ['NPM_TOKEN="a b c"', /a b c/],
    ["NODE_AUTH_TOKEN: yamlvalue77", /yamlvalue77/],
    ["_authToken = x1y2z3", /x1y2z3/],
    ["Authorization: rawcredential99", /rawcredential99/],
    ["xoxb-1234567890-abcdefghij", /xoxb-1234/],
    ["glpat-abcdefghijklmnopqrst12", /glpat-abc/],
    ["ASIAABCDEFGHIJKLMNOP", /ASIAABCDEFGHIJKLMNOP/],
    ["AIzaSyA-abcdefghijklmnopqrstuvwxyz01234", /AIzaSyA/],
    ["sk-proj-abcdefghijklmnopqrstuvwxyz", /sk-proj-abc/],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepart", /eyJhbGci|signaturepart/],
    ["run -otp 987654", /987654/],
    ["run --one-time-password=246810", /246810/],
    ["run --one-time-password 135790", /135790/],
  ];
  for (const [input, leak] of cases) {
    it(`redacts ${input.slice(0, 40)}`, () => {
      const out = lib.redact(`x ${input} y`);
      expect(out).toContain("[redacted]");
      expect(out).not.toMatch(leak);
    });
  }

  it("redacts by key name inside redactDeep, even when the value looks plain", () => {
    const out = lib.redactDeep({ token: "plainvalue", nested: { password: "p", access_token: "a", client_secret: "s", ok: "fine" } }) as { token: string; nested: Record<string, string> };
    expect(out.token).toBe("[redacted]");
    expect(out.nested).toEqual({ password: "[redacted]", access_token: "[redacted]", client_secret: "[redacted]", ok: "fine" });
  });

  it("does not take long input quadratic time", () => {
    const inputs = [
      "a".repeat(100000),
      "key=".repeat(25000),
      "//a:".repeat(25000),
      "github_pat_".repeat(9000),
      "eyJ".repeat(33000),
      "token ".repeat(16000),
      `token${" ".repeat(100000)}x`,
      "Authorization:".repeat(7000),
      "NPM_TOKEN=\"".repeat(9000),
    ];
    const start = Date.now();
    for (const input of inputs) lib.redact(input);
    expect(Date.now() - start).toBeLessThan(3000);
  });
});
