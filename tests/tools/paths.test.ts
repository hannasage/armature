import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, makeRepo, repoRoot, tempDir } from "./support";

afterEach(cleanup);

type Result = { ok: true; path: string; top: string } | { ok: false; error: string; gitFailed?: boolean };
type FileResult = { ok: true; path: string } | { ok: false; error: string };
const lib = (await import(pathToFileURL(join(repoRoot, "tools/lib/paths.mjs")).href)) as {
  resolveWorkTree(input: unknown): Result;
  resolveFile(input: unknown, maxBytes?: number): FileResult;
};

describe("resolveWorkTree", () => {
  it("accepts the top of a git work tree and returns the resolved path", () => {
    const repo = makeRepo();
    expect(lib.resolveWorkTree(repo)).toEqual({ ok: true, path: repo, top: repo });
  });

  it("accepts a folder inside a work tree and reports the top", () => {
    const repo = makeRepo();
    mkdirSync(join(repo, "sub"));
    const result = lib.resolveWorkTree(join(repo, "sub"));
    expect(result).toEqual({ ok: true, path: join(repo, "sub"), top: repo });
  });

  it("refuses a path that does not exist", () => {
    const result = lib.resolveWorkTree(join(tempDir(), "missing"));
    expect(result.ok).toBe(false);
  });

  it("refuses a folder that is not a git work tree", () => {
    const result = lib.resolveWorkTree(tempDir());
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toContain("git work tree");
  });

  it("refuses a file", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "a.txt"), "x");
    expect(lib.resolveWorkTree(join(dir, "a.txt")).ok).toBe(false);
  });

  it("refuses an empty value, a value that is not text, and a path with a null byte", () => {
    expect(lib.resolveWorkTree("").ok).toBe(false);
    expect(lib.resolveWorkTree(undefined).ok).toBe(false);
    expect(lib.resolveWorkTree(42).ok).toBe(false);
    expect(lib.resolveWorkTree("/tmp/a\0b").ok).toBe(false);
  });

  it("resolves a dot-dot path before it checks it", () => {
    const repo = makeRepo();
    mkdirSync(join(repo, "sub"));
    const result = lib.resolveWorkTree(join(repo, "sub", ".."));
    expect(result).toMatchObject({ ok: true, path: repo });
  });

  it("follows a symbolic link to the real folder", () => {
    const repo = makeRepo();
    const holder = tempDir();
    symlinkSync(repo, join(holder, "link"));
    expect(lib.resolveWorkTree(join(holder, "link"))).toMatchObject({ ok: true, path: repo });
  });
});

describe("resolveFile", () => {
  it("accepts a regular file", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "body.md"), "hello");
    expect(lib.resolveFile(join(dir, "body.md"))).toEqual({ ok: true, path: join(dir, "body.md") });
  });

  it("refuses a missing file, a folder, an empty value, and a file above the size limit", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "big.md"), "x".repeat(100));
    expect(lib.resolveFile(join(dir, "none.md")).ok).toBe(false);
    expect(lib.resolveFile(dir).ok).toBe(false);
    expect(lib.resolveFile("").ok).toBe(false);
    expect(lib.resolveFile(join(dir, "big.md"), 50).ok).toBe(false);
  });

  it("reports that git could not run, and does not call that a bad path", () => {
    const repo = makeRepo();
    const saved = process.env.PATH;
    process.env.PATH = tempDir();
    try {
      expect(lib.resolveWorkTree(repo)).toMatchObject({ ok: false, gitFailed: true, error: expect.stringContaining("git could not run") });
    } finally {
      process.env.PATH = saved;
    }
  });
});
