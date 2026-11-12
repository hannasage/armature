import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// G3 grows /values. The new cap of an existing entry is a proposal for the maintainer, and the budget file says so.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const lib = (await import(pathToFileURL(join(root, "scripts/size-lib.mjs")).href)) as {
  measureAll: () => Promise<{ key: string; gzipped: number }[]>;
  measureEntry: (source: string) => Promise<{ gzipped: number }>;
  capFor: (gzipped: number) => number;
};
const budget = JSON.parse(readFileSync(join(root, "size-budget.json"), "utf8")) as {
  caps: Record<string, { cap: number; measuredGzipped: number; measuredIn: string; proposal?: string; capStatus?: string; pathAlone?: number }>;
};
const baseline = readFileSync(join(root, "docs/baseline.md"), "utf8");
const values = budget.caps["@hannasage/armature/values"];

describe("the /values size after G3", () => {
  it("is the size the cap was derived from, measured in the G3 section", async () => {
    const rows = await lib.measureAll();
    expect(rows.find((row) => row.key === "@hannasage/armature/values")!.gzipped).toBe(values.measuredGzipped);
    expect(values.cap).toBe(lib.capFor(values.measuredGzipped));
    expect(values.measuredIn).toBe("G3 build");
    expect(values.measuredGzipped).toBeLessThanOrEqual(values.cap);
  });

  it("keeps the amendment proposal beside the cap, and marks the new cap as a proposal for the maintainer", () => {
    expect(values.proposal).toContain("4.0 KB");
    expect(values.capStatus).toBe("proposed for the maintainer, not approved");
    expect(values.cap).toBeGreaterThan(1830);
  });

  it("records the size of the path kind alone, and it is the current size", async () => {
    expect(values.pathAlone).toBeTypeOf("number");
    expect((await lib.measureEntry("src/values/path.ts")).gzipped).toBe(values.pathAlone);
  });

  it("writes the proposal and the figures in docs/baseline.md", () => {
    expect(baseline).toContain("## G3 build");
    expect(baseline).toContain(`- \`/values\`: ${values.cap.toLocaleString("en-US")}.`);
    expect(baseline).toContain("proposal for the maintainer");
  });

  it("leaves the caps of the other entries as they were", () => {
    const keep: Record<string, number> = {
      "@hannasage/armature": 4000, "@hannasage/armature/dom": 12170, "@hannasage/armature/react": 12650, "@hannasage/armature/glass": 8430,
      "@hannasage/armature/glass/react": 13710, "@hannasage/armature/styles.css": 830, "@hannasage/armature/frame": 890,
      "@hannasage/armature/curves": 2500, "@hannasage/armature/linear": 3690,
    };
    for (const [key, cap] of Object.entries(keep)) expect(budget.caps[key].cap, key).toBe(cap);
  });
});
