import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The size script and the budget check. The measure runs esbuild on the real entries. The budget check runs on made-up rows.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

type Row = { key: string; source: string; minified: number; gzipped: number };
const lib = (await import(pathToFileURL(join(root, "scripts/size-lib.mjs")).href)) as {
  entriesOf: (pkg: { name: string; exports: Record<string, unknown> }) => { key: string; source: string }[];
  sourceFor: (value: unknown) => string;
  measureAll: () => Promise<Row[]>;
  formatTable: (rows: Row[]) => string;
  checkBudget: (rows: Row[], budget: { caps?: Record<string, { cap: number }> }) => string[];
};

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; exports: Record<string, unknown> };
const budget = JSON.parse(readFileSync(join(root, "size-budget.json"), "utf8")) as { caps: Record<string, { cap: number }> };

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
