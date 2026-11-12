import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// G3 grows /values. The maintainer approved the new cap of 6,870 on 2026-11-12, and the budget file and the baseline page say so.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const lib = (await import(pathToFileURL(join(root, "scripts/size-lib.mjs")).href)) as {
  measureAll: () => Promise<{ key: string; gzipped: number }[]>;
  measureEntry: (source: string) => Promise<{ gzipped: number }>;
  capFor: (gzipped: number) => number;
};
const budget = JSON.parse(readFileSync(join(root, "size-budget.json"), "utf8")) as {
  caps: Record<string, { cap: number; measuredGzipped: number; measuredAfterReview?: number; measuredIn: string; proposal?: string; approval?: string; capStatus?: string; pathAlone?: number }>;
};
const baseline = readFileSync(join(root, "docs/baseline.md"), "utf8");
const values = budget.caps["@hannasage/armature/values"];

describe("the /values size after G3", () => {
  it("has the cap derived from the G3 measure, and the size after review is the current size, under the cap", async () => {
    const rows = await lib.measureAll();
    expect(values.cap).toBe(lib.capFor(values.measuredGzipped));
    expect(rows.find((row) => row.key === "@hannasage/armature/values")!.gzipped).toBe(values.measuredAfterReview);
    expect(values.measuredAfterReview!).toBeLessThanOrEqual(values.cap);
    expect(values.measuredIn).toBe("G3 build");
    expect(values.measuredGzipped).toBeLessThanOrEqual(values.cap);
  });

  it("keeps the amendment proposal beside the cap, and records the approval of the cap", () => {
    expect(values.proposal).toContain("4.0 KB");
    expect(values.cap).toBe(6870);
    expect(values.approval).toBe("approved by the maintainer, 2026-11-12");
    expect(values.capStatus).toBeUndefined();
  });

  it("records the size of the path kind alone, and it is the current size", async () => {
    expect(values.pathAlone).toBeTypeOf("number");
    expect((await lib.measureEntry("src/values/path.ts")).gzipped).toBe(values.pathAlone);
  });

  it("writes the proposal and the figures in docs/baseline.md", () => {
    expect(baseline).toContain("## G3 build");
    expect(baseline).toContain(`- \`/values\`: ${values.cap.toLocaleString("en-US")}.`);
    expect(baseline).toContain("approved by the maintainer, 2026-11-12");
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
