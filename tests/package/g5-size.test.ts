import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// G5 adds the `/timeline` entry. Its cap is the measured size plus 10 percent, rounded up to the next 10 bytes. The maintainer approved the cap of
// 6,460 on 2026-11-12. No existing cap moves, and the spring-only entry stays under its cap of 4,000.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const lib = (await import(pathToFileURL(join(root, "scripts/size-lib.mjs")).href)) as {
  measureAll: () => Promise<{ key: string; gzipped: number }[]>;
  capFor: (gzipped: number) => number;
};
type Cap = { cap: number; measuredGzipped: number; measuredAfterReview?: number; measuredIn: string; proposal?: string; approval?: string };
const budget = JSON.parse(readFileSync(join(root, "size-budget.json"), "utf8")) as { caps: Record<string, Cap>; proposedForNewEntries: Record<string, string> };
const baseline = readFileSync(join(root, "docs/baseline.md"), "utf8");
const KEY = "@hannasage/armature/timeline";
const timeline = budget.caps[KEY];

describe("the /timeline size after G5", () => {
  it("has a cap, derived from the measure by the rule, and the entry is at or under it", async () => {
    expect(timeline).toBeDefined();
    expect(timeline.cap).toBe(lib.capFor(timeline.measuredGzipped));
    expect(timeline.measuredIn).toBe("G5 build");
    const rows = await lib.measureAll();
    expect(rows.find((row) => row.key === KEY)!.gzipped).toBe(timeline.measuredAfterReview ?? timeline.measuredGzipped);
    expect(timeline.measuredGzipped).toBeLessThanOrEqual(timeline.cap);
  });

  it("keeps the amendment proposal beside the cap, and records the approval of the cap of 6,460", () => {
    expect(timeline.proposal).toBe("4.0 KB");
    expect(timeline.cap).toBe(6460);
    expect(timeline.approval).toBe("approved by the maintainer, 2026-11-12");
  });

  it("no longer lists /timeline among the entries that do not exist yet", () => {
    expect(Object.keys(budget.proposedForNewEntries)).not.toContain(KEY);
  });

  it("writes the figures in docs/baseline.md, with the cap approved, and the tarball re-measured", () => {
    expect(baseline).toContain("## G5 build");
    const section = baseline.slice(baseline.indexOf("## G5 build"), baseline.indexOf("## G6 build") === -1 ? undefined : baseline.indexOf("## G6 build"));
    expect(section).toContain(`- \`/timeline\`: ${timeline.cap.toLocaleString("en-US")}`);
    expect(section).toContain("approved by the maintainer, 2026-11-12");
    expect(section).not.toMatch(/not approved/);
    expect(section).toMatch(/tarball[^\n]*\d{3},\d{3} bytes/i);
    expect(section).toContain("1.5");
  });

  it("records that the maintainer chose option A for the flavor check on 2026-11-12, and leaves no open decision", () => {
    const section = baseline.slice(baseline.indexOf("## G5 build"), baseline.indexOf("## G6 build") === -1 ? undefined : baseline.indexOf("## G6 build"));
    expect(section).toMatch(/maintainer chose option A on 2026-11-12/);
    expect(section).not.toMatch(/Decision for the maintainer|Variants for the maintainer/);
    const flavors = readFileSync(join(root, "docs/flavors.md"), "utf8");
    expect(flavors).toMatch(/maintainer chose this on 2026-11-12/);
    expect(flavors).not.toMatch(/as a decision for the maintainer/);
  });

  it("keeps the approved size of the tarball as the baseline", () => {
    expect(baseline).toMatch(/MEASURED_SIZE[^\n]*222,018[^\n]*approved by the maintainer/);
  });

  it("leaves the caps of the other entries as they were", () => {
    const keep: Record<string, number> = {
      "@hannasage/armature": 4000, "@hannasage/armature/dom": 12170, "@hannasage/armature/react": 12650, "@hannasage/armature/glass": 8430,
      "@hannasage/armature/glass/react": 13710, "@hannasage/armature/styles.css": 830, "@hannasage/armature/frame": 890,
      "@hannasage/armature/values": 6870, "@hannasage/armature/curves": 2500, "@hannasage/armature/linear": 3690, "@hannasage/armature/gesture": 5850,
    };
    for (const [key, cap] of Object.entries(keep)) expect(budget.caps[key].cap, key).toBe(cap);
  });

  it("keeps every other entry at or under its cap", async () => {
    for (const row of await lib.measureAll()) expect(row.gzipped, row.key).toBeLessThanOrEqual(budget.caps[row.key].cap);
  });
});
