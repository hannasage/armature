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
  caps: Record<string, { cap: number; measuredGzipped: number }>;
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

  it("keeps the spring-only entry free of glass code, so it is the smallest JavaScript entry", async () => {
    const js = (await lib.measureAll()).filter((r) => !r.key.endsWith(".css"));
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
});

describe("size budget file", () => {
  it("follows the stated rule: measured plus 10 percent, rounded up to 10 bytes", () => {
    expect(lib.capFor(7655)).toBe(8430);
    for (const [name, entry] of Object.entries(budget.caps)) expect([name, entry.cap]).toEqual([name, lib.capFor(entry.measuredGzipped)]);
  });

  it("lists the caps in docs/baseline.md", () => {
    const baseline = readFileSync(join(root, "docs/baseline.md"), "utf8");
    for (const entry of Object.values(budget.caps)) expect(baseline).toContain(entry.cap.toLocaleString("en-US"));
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
      writeFileSync(join(dir, "README.md"), readFileSync(join(dir, "README.md"), "utf8").replace("1.0.0-beta.0", "0.0.1"));
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
});
