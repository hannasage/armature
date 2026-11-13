import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The size script and the budget check. The measure runs esbuild on the real entries. The budget check runs on made-up rows.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

type Row = { key: string; source: string; minified: number; gzipped: number };
const lib = (await import(pathToFileURL(join(root, "scripts/size-lib.mjs")).href)) as {
  entriesOf: (pkg: { name: string; exports: Record<string, unknown> }) => { key: string; source: string }[];
  sourceFor: (value: unknown, key?: string) => string;
  measureEntry: (source: string, dir?: string) => Promise<{ minified: number; gzipped: number }>;
  resolveOut: (arg: string | undefined, dir?: string) => string;
  capFor: (gzipped: number) => number;
  measureAll: () => Promise<Row[]>;
  formatTable: (rows: Row[]) => string;
  checkBudget: (rows: Row[], budget: { caps?: Record<string, { cap: number }> }) => string[];
};

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; exports: Record<string, unknown> };
const budget = JSON.parse(readFileSync(join(root, "size-budget.json"), "utf8")) as {
  caps: Record<string, { cap: number; measuredGzipped: number; measuredIn?: string; measuredAfterReview?: number }>;
  proposedForNewEntries: Record<string, string>;
};

const row = (key: string, gzipped: number): Row => ({ key, source: "src/x.ts", minified: gzipped * 3, gzipped });

describe("size entries", () => {
  it("maps each export to its source file", () => {
    expect(lib.sourceFor({ import: "./dist/index.js" })).toBe("src/index.ts");
    expect(lib.sourceFor({ import: "./dist/glass/react/index.js" })).toBe("src/glass/react/index.ts");
    expect(lib.sourceFor("./dist/styles.css")).toBe("src/glass/styles.css");
  });

  it("lists one entry per export, with the package name", () => {
    const keys = lib.entriesOf(pkg).map((entry) => entry.key);
    expect(keys).toEqual(Object.keys(pkg.exports).map((key) => (key === "." ? pkg.name : `${pkg.name}/${key.slice(2)}`)));
  });
});

describe("size measure", () => {
  it("measures every entry, and gzip is smaller than minified", async () => {
    const rows = await lib.measureAll();
    expect(rows.map((r) => r.key)).toEqual(lib.entriesOf(pkg).map((e) => e.key));
    for (const r of rows) {
      expect(r.minified).toBeGreaterThan(0);
      expect(r.gzipped).toBeGreaterThan(0);
      expect(r.gzipped).toBeLessThan(r.minified);
    }
  });

  it("keeps the spring-only entry free of glass code, so it is the smallest of the entries that carry the DOM, React, or glass code", async () => {
    // Only the entries that carry DOM, React, or glass code are compared. /frame and /values are small entries of their own.
    const carriers = Object.keys(pkg.exports).filter((key) => /^\.\/(dom|react|glass)/.test(key)).map((key) => `${pkg.name}/${key.slice(2)}`);
    const rows = await lib.measureAll();
    const js = rows.filter((r) => r.key === pkg.name || carriers.includes(r.key));
    const engine = js.find((r) => r.key === pkg.name);
    expect(js.length).toBeGreaterThan(1);
    expect(engine).toBeDefined();
    for (const r of js) expect(engine!.gzipped).toBeLessThanOrEqual(r.gzipped);
  });

  it("writes a markdown row for each entry", () => {
    const table = lib.formatTable([row("a", 1500), row("b", 20)]);
    expect(table).toContain("| `a` | `src/x.ts` | 4,500 | 1,500 |");
    expect(table.split("\n")).toHaveLength(4);
  });
});

describe("size budget", () => {
  it("passes when every entry is within its cap", () => {
    expect(lib.checkBudget([row("a", 100), row("b", 200)], { caps: { a: { cap: 100 }, b: { cap: 250 } } })).toEqual([]);
  });

  it("fails when an entry is over its cap", () => {
    const problems = lib.checkBudget([row("a", 101)], { caps: { a: { cap: 100 } } });
    expect(problems).toEqual(["a is 101 bytes gzipped, which is 1 over its cap of 100"]);
  });

  it("fails when an entry has no cap", () => {
    expect(lib.checkBudget([row("a", 1), row("b", 1)], { caps: { a: { cap: 5 } } })).toEqual(["b has no cap in the budget"]);
  });

  it("fails when a cap is zero, negative, or not a number", () => {
    for (const cap of [0, -1, Number.NaN]) expect(lib.checkBudget([row("a", 1)], { caps: { a: { cap } } })).toHaveLength(1);
  });

  it("fails when the budget has no caps at all", () => {
    expect(lib.checkBudget([row("a", 1)], {})).toEqual(["a has no cap in the budget"]);
  });

  it("fails when a cap names an entry that does not exist", () => {
    expect(lib.checkBudget([], { caps: { gone: { cap: 5 } } })).toEqual(["the budget has a cap for gone, and the package has no such entry"]);
  });

  it("holds one cap above the measured size for every real entry", async () => {
    expect(lib.checkBudget(await lib.measureAll(), budget)).toEqual([]);
  });
});

describe("size entry safety", () => {
  it("names the export key when a target is not a string or has no import", () => {
    expect(() => lib.sourceFor(42, "./bad")).toThrow(/export "\.\/bad"/);
    expect(() => lib.sourceFor({ types: "./dist/x.d.ts" }, "./bad")).toThrow(/export "\.\/bad".*import/);
  });

  it("fails a wildcard key with a clear message", () => {
    expect(() => lib.entriesOf({ name: "p", exports: { "./*": { import: "./dist/*.js" } } })).toThrow(/wildcard/);
  });

  it("fails a target that leaves src", () => {
    expect(() => lib.sourceFor({ import: "./dist/../../etc/passwd.js" }, "./x")).toThrow(/inside src/);
    expect(() => lib.sourceFor({ import: "./other/index.js" }, "./x")).toThrow(/\.\/dist\//);
  });

  it("throws when the entry file is missing", async () => {
    await expect(lib.measureEntry("src/does-not-exist.ts")).rejects.toThrow(/does not exist/);
  });

  it("throws when the entry builds to nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "armature-size-"));
    try {
      cpSync(join(root, "tsconfig.json"), join(dir, "tsconfig.json"));
      writeFileSync(join(dir, "empty.ts"), "");
      await expect(lib.measureEntry("empty.ts", dir)).rejects.toThrow(/empty/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws when esbuild reports a warning", async () => {
    const dir = mkdtempSync(join(tmpdir(), "armature-size-"));
    try {
      writeFileSync(join(dir, "warn.ts"), "export const a = (x: unknown) => typeof x === 'null';\n");
      await expect(lib.measureEntry("warn.ts", dir)).rejects.toThrow(/warning/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("size --out", () => {
  it("fails with no value, or with a flag as the value", () => {
    expect(() => lib.resolveOut(undefined)).toThrow(/--out needs a file path/);
    expect(() => lib.resolveOut("--json")).toThrow(/--out needs a file path/);
  });

  it("fails for a path outside the repository", () => {
    expect(() => lib.resolveOut("/etc/size.md")).toThrow(/inside the repository/);
    expect(() => lib.resolveOut("../outside.md")).toThrow(/inside the repository/);
  });

  it("accepts a path inside the repository", () => {
    expect(lib.resolveOut("size-table.md")).toBe(join(root, "size-table.md"));
  });

  it("refuses a file type other than .md or .json", () => {
    expect(() => lib.resolveOut("size.mjs")).toThrow(/\.md or \.json/);
  });

  it("refuses a tracked file, by name and by git", () => {
    for (const name of ["package.json", "README.md", "size-budget.json", "docs/baseline.md"]) expect(() => lib.resolveOut(name)).toThrow(/overwrite/);
  });

  it("refuses a missing directory", () => {
    expect(() => lib.resolveOut("no-such-dir/x.md")).toThrow(/does not exist/);
  });

  it("fails closed when the directory is not a git repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "armature-out-plain-"));
    try {
      expect(() => lib.resolveOut("x.md", dir)).toThrow(/cannot tell whether x\.md is tracked/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a broken symlink as the output", () => {
    const repo = mkdtempSync(join(tmpdir(), "armature-out-repo-"));
    try {
      symlinkSync(join(repo, "missing.md"), join(repo, "dead.md"));
      expect(() => lib.resolveOut("dead.md", repo)).toThrow(/the --out path is a broken symlink/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("refuses a path through a symlink that leaves the repository", () => {
    const repo = mkdtempSync(join(tmpdir(), "armature-out-repo-"));
    const outside = mkdtempSync(join(tmpdir(), "armature-out-outside-"));
    try {
      symlinkSync(outside, join(repo, "link"));
      expect(() => lib.resolveOut("link/x.md", repo)).toThrow(/inside the repository/);
      writeFileSync(join(outside, "o.md"), "x");
      symlinkSync(join(outside, "o.md"), join(repo, "f.md"));
      expect(() => lib.resolveOut("f.md", repo)).toThrow(/inside the repository/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("size budget file", () => {
  it("follows the stated rule: measured plus 10 percent, rounded up to 10 bytes", () => {
    expect(lib.capFor(7655)).toBe(8430);
    for (const [name, entry] of Object.entries(budget.caps)) expect([name, entry.cap]).toEqual([name, lib.capFor(entry.measuredGzipped)]);
  });

  const baselineLines = readFileSync(join(root, "docs/baseline.md"), "utf8").split("\n");
  const label = (key: string) => (key === pkg.name ? `\`${key}\`` : `\`${key.slice(pkg.name.length)}\``);
  const fmt = (n: number) => n.toLocaleString("en-US");

  it("lists each cap as its own bullet in docs/baseline.md", () => {
    for (const [key, entry] of Object.entries(budget.caps)) expect(baselineLines).toContain(`- ${label(key)}: ${fmt(entry.cap)}.`);
  });

  /** The lines of the `## <title>` section of docs/baseline.md, up to the next `## ` heading. */
  const section = (title: string): string[] => {
    const start = baselineLines.indexOf(`## ${title}`);
    if (start < 0) return [];
    const end = baselineLines.findIndex((line, i) => i > start && line.startsWith("## "));
    return baselineLines.slice(start + 1, end < 0 ? undefined : end);
  };

  it("names, for each entry, the baseline section that holds its measured row", () => {
    for (const [key, entry] of Object.entries(budget.caps)) expect(entry.measuredIn, key).toBeTypeOf("string");
  });

  it("matches measuredGzipped to the gzipped column of the one table row of each entry in the section it names", () => {
    for (const [key, entry] of Object.entries(budget.caps)) {
      const rows = section(entry.measuredIn ?? "missing").filter((line) => line.startsWith(`| \`${key}\` |`));
      expect(rows, `${key} in ${entry.measuredIn}`).toHaveLength(1);
      const cells = rows[0].split("|").map((cell) => cell.trim());
      expect([key, cells[cells.length - 2]]).toEqual([key, fmt(entry.measuredGzipped)]);
    }
  });

  it("records the size after review for /curves and /linear, and it is the current size", async () => {
    const rows = await lib.measureAll();
    for (const short of ["curves", "linear"]) {
      const key = `${pkg.name}/${short}`;
      const entry = budget.caps[key];
      expect(entry.measuredAfterReview, key).toBe(rows.find((r) => r.key === key)!.gzipped);
      expect(entry.measuredAfterReview, key).toBeLessThanOrEqual(entry.cap);
      const line = baselineLines.find((l) => l.startsWith(`| \`/${short}\` |`) && l.includes(fmt(entry.measuredAfterReview!)));
      expect(line, key).toBeDefined();
    }
  });

  it("keeps a proposal out of the real entries", () => {
    const real = new Set(lib.entriesOf(pkg).map((entry) => entry.key));
    for (const name of Object.keys(budget.proposedForNewEntries)) expect(real.has(name)).toBe(false);
  });
});

describe("check scripts as programs", () => {
  const copy = () => {
    const dir = mkdtempSync(join(tmpdir(), "armature-check-"));
    cpSync(join(root, "scripts"), join(dir, "scripts"), { recursive: true });
    for (const file of ["package.json", "README.md", "size-budget.json"]) cpSync(join(root, file), join(dir, file));
    symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
    symlinkSync(join(root, "src"), join(dir, "src"));
    // The --out check asks git whether a file is tracked, so the copy is a real repository.
    spawnSync("git", ["init", "-q"], { cwd: dir });
    spawnSync("git", ["add", "package.json", "README.md", "size-budget.json", "scripts"], { cwd: dir });
    return dir;
  };
  const run = (dir: string, script: string) => spawnSync(process.execPath, [join(dir, "scripts", script)], { encoding: "utf8" });

  it("check-readme passes on a copy of the real files", () => {
    const dir = copy();
    try {
      const result = run(dir, "check-readme.mjs");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("README check passed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("check-readme exits 1 and names the problem on a broken README", () => {
    const dir = copy();
    try {
      writeFileSync(join(dir, "README.md"), readFileSync(join(dir, "README.md"), "utf8").replace("1.0.0-beta.1", "0.0.1"));
      const result = run(dir, "check-readme.mjs");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("README check failed");
      expect(result.stderr).toContain("names the version 0.0.1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("check-size passes on a copy of the real files", () => {
    const dir = copy();
    try {
      const result = run(dir, "check-size.mjs");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Size check passed");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("check-size exits 1 and names the entry when a cap is too low or missing", () => {
    const dir = copy();
    try {
      const file = join(dir, "size-budget.json");
      const broken = JSON.parse(readFileSync(file, "utf8")) as { caps: Record<string, { cap: number }> };
      broken.caps[pkg.name].cap = 1;
      delete broken.caps[`${pkg.name}/dom`];
      writeFileSync(file, JSON.stringify(broken));
      const result = run(dir, "check-size.mjs");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Size check failed");
      expect(result.stderr).toContain(`${pkg.name} is `);
      expect(result.stderr).toContain(`${pkg.name}/dom has no cap`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("size.mjs --json --out writes valid JSON with every entry", () => {
    const dir = copy();
    try {
      const result = spawnSync(process.execPath, [join(dir, "scripts", "size.mjs"), "--json", "--out", "table.json"], { encoding: "utf8" });
      expect(result.status).toBe(0);
      const written = JSON.parse(readFileSync(join(dir, "table.json"), "utf8")) as { esbuild: string; entries: { key: string }[] };
      expect(written.entries.map((e) => e.key)).toEqual(lib.entriesOf(pkg).map((e) => e.key));
      expect(written.esbuild).toMatch(/^\d+\.\d+\.\d+$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("size.mjs exits 1 on a bare --out", () => {
    const dir = copy();
    try {
      const result = spawnSync(process.execPath, [join(dir, "scripts", "size.mjs"), "--out"], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("--out needs a file path");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("size.mjs exits 1 on an --out outside the repository, before it measures anything", () => {
    const dir = copy();
    const outside = mkdtempSync(join(tmpdir(), "armature-out-outside-"));
    try {
      const result = spawnSync(process.execPath, [join(dir, "scripts", "size.mjs"), "--out", join(outside, "x.md")], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("inside the repository");
      expect(result.stdout).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("size.mjs fails closed when git is not on the PATH", () => {
    const dir = copy();
    try {
      const result = spawnSync(process.execPath, [join(dir, "scripts", "size.mjs"), "--out", "table.json"], { encoding: "utf8", env: { PATH: "" } });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("cannot tell whether table.json is tracked");
      expect(result.stdout).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
