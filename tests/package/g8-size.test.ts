import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

// G8 is the 1.0 gate of amendment 1. The final size table goes in docs/baseline.md, section "G8 build": every entry, its measure, and its cap,
// and the own-code caps beside them. G8 adds documentation, a third flavor in `examples/`, and tests. None of it is published, so no cap moves,
// and the `files` field of package.json keeps them out of the tarball.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const lib = (await import(pathToFileURL(join(root, "scripts/size-lib.mjs")).href)) as {
  measureAll: () => Promise<{ key: string; gzipped: number }[]>;
  measureOwn: (source: string) => Promise<{ gzipped: number }>;
};
const rules = (await import(pathToFileURL(join(root, "scripts/pack-rules.mjs")).href)) as {
  MEASURED_SIZE: number;
  SIZE_FACTOR: number;
  sizeLimit: () => number;
  disallowedFiles: (paths: string[]) => string[];
};
type Budget = { caps: Record<string, { cap: number }>; ownCaps: Record<string, { cap: number }> };
const budget = JSON.parse(readFileSync(join(root, "size-budget.json"), "utf8")) as Budget;
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; files: string[] };
const baseline = readFileSync(join(root, "docs/baseline.md"), "utf8");
const fmt = (n: number) => n.toLocaleString("en-US");
const section = () => {
  const start = baseline.indexOf("## G8 build");
  expect(start, "a G8 build section").toBeGreaterThanOrEqual(0);
  const next = baseline.indexOf("\n## ", start + 1);
  return baseline.slice(start, next === -1 ? undefined : next);
};

/** The caps after G7, which G8 must not move. */
const G7_CAPS: Record<string, number> = {
  "@hannasage/armature": 4000, "@hannasage/armature/frame": 890, "@hannasage/armature/gesture": 5850, "@hannasage/armature/timeline": 6460,
  "@hannasage/armature/layout": 6420, "@hannasage/armature/values": 6870, "@hannasage/armature/curves": 2500, "@hannasage/armature/linear": 3690,
  "@hannasage/armature/dom": 12170, "@hannasage/armature/react": 12650, "@hannasage/armature/glass": 8430, "@hannasage/armature/glass/react": 13710,
  "@hannasage/armature/css": 10520, "@hannasage/armature/vue": 12050, "@hannasage/armature/svelte": 11980, "@hannasage/armature/styles.css": 830,
};

describe("the size table after G8", () => {
  it("moves no cap", () => {
    expect(Object.fromEntries(Object.entries(budget.caps).map(([key, entry]) => [key, entry.cap]))).toEqual(G7_CAPS);
    expect(Object.fromEntries(Object.entries(budget.ownCaps).map(([key, entry]) => [key, entry.cap]))).toEqual({
      "@hannasage/armature/vue": 1000, "@hannasage/armature/svelte": 1000, "@hannasage/armature/css": 2510,
    });
  });

  it("writes one row for every entry in docs/baseline.md, with the size measured now and its cap, and each is inside its cap", async () => {
    const rows = await lib.measureAll();
    expect(rows.map((row) => row.key).sort()).toEqual(Object.keys(budget.caps).sort());
    for (const row of rows) {
      const cap = budget.caps[row.key].cap;
      expect(row.gzipped, row.key).toBeLessThanOrEqual(cap);
      expect(section(), row.key).toContain(`| \`${row.key}\` | ${fmt(row.gzipped)} | ${fmt(cap)} | ${fmt(cap - row.gzipped)} |`);
    }
  });

  it("writes the own-code caps with the size measured now", async () => {
    for (const [key, entry] of Object.entries(budget.ownCaps)) {
      const own = await lib.measureOwn(`src/${key.slice(pkg.name.length + 1)}/index.ts`);
      expect(own.gzipped, key).toBeLessThanOrEqual(entry.cap);
      expect(section(), key).toContain(`| \`${key}\` | ${fmt(own.gzipped)} | ${fmt(entry.cap)} |`);
    }
  });

  it("records the tarball under the limit of 1.5 times the approved MEASURED_SIZE, which did not change", () => {
    expect(rules.MEASURED_SIZE).toBe(222018);
    expect(rules.SIZE_FACTOR).toBe(1.5);
    const match = /The tarball is ([\d,]+) bytes in ([\d,]+) files, under the limit of ([\d,]+)/.exec(section());
    expect(match, "a tarball line").not.toBeNull();
    const [bytes, , limit] = match!.slice(1).map((text) => Number(text.replaceAll(",", "")));
    expect(limit).toBe(rules.sizeLimit());
    expect(bytes).toBeLessThanOrEqual(limit);
  });

  it("keeps the docs, the examples, and the tests out of the tarball", () => {
    expect(pkg.files).toEqual(["dist", "README.md", "LICENSE"]);
    const added = ["docs/curves.md", "docs/flavor-authoring.md", "docs/figures/easings.svg", "examples/tide/flavor.ts", "examples/tide/sheet.ts", "tests/examples/tide.test.ts"];
    expect(rules.disallowedFiles(added)).toEqual(added);
  });
});
