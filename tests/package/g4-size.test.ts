import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// G4 adds the `/gesture` entry. Its cap is the measured size plus 10 percent, rounded up to the next 10 bytes. The maintainer approved the cap of 5,850
// on 2026-11-12. No other cap moves.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const lib = (await import(pathToFileURL(join(root, "scripts/size-lib.mjs")).href)) as {
  measureAll: () => Promise<{ key: string; gzipped: number }[]>;
  capFor: (gzipped: number) => number;
};
type Cap = { cap: number; measuredGzipped: number; measuredAfterReview?: number; measuredIn: string; proposal?: string; approval?: string };
const budget = JSON.parse(readFileSync(join(root, "size-budget.json"), "utf8")) as { caps: Record<string, Cap>; proposedForNewEntries: Record<string, string> };
const baseline = readFileSync(join(root, "docs/baseline.md"), "utf8");
const KEY = "@hannasage/armature/gesture";
const gesture = budget.caps[KEY];

describe("the /gesture size after G4", () => {
  it("has a cap, derived from the measure by the rule, and the entry is at or under it", async () => {
    expect(gesture).toBeDefined();
    expect(gesture.cap).toBe(lib.capFor(gesture.measuredGzipped));
    expect(gesture.measuredIn).toBe("G4 build");
    const rows = await lib.measureAll();
    expect(rows.find((row) => row.key === KEY)!.gzipped).toBe(gesture.measuredAfterReview ?? gesture.measuredGzipped);
    expect(gesture.measuredGzipped).toBeLessThanOrEqual(gesture.cap);
  });

  it("keeps the amendment proposal beside the cap, and records the approval of the cap of 5,850", () => {
    expect(gesture.proposal).toBe("3.0 KB");
    expect(gesture.cap).toBe(5850);
    expect(gesture.approval).toBe("approved by the maintainer, 2026-11-12");
  });

  it("records the approval of the spring-only entry at its size after G4, with its cap of 4,000 unchanged", () => {
    expect(budget.caps["@hannasage/armature"].cap).toBe(4000);
    expect(budget.caps["@hannasage/armature"].approval).toContain("3,854");
    expect(baseline).toContain("the maintainer approved the `.` entry at 3,854");
  });

  it("keeps the approved size of the tarball as the baseline, and records the current measure beside it", () => {
    expect(baseline).toMatch(/MEASURED_SIZE[^\n]*222,018[^\n]*approved by the maintainer/);
  });

  it("no longer lists /gesture among the entries that do not exist yet", () => {
    expect(Object.keys(budget.proposedForNewEntries)).not.toContain(KEY);
  });

  it("writes the figures in docs/baseline.md", () => {
    expect(baseline).toContain("## G4 build");
    expect(baseline).toContain(`- \`/gesture\`: ${gesture.cap.toLocaleString("en-US")}.`);
  });

  it("leaves the caps of the other entries as they were", () => {
    const keep: Record<string, number> = {
      "@hannasage/armature": 4000, "@hannasage/armature/dom": 12170, "@hannasage/armature/react": 12650, "@hannasage/armature/glass": 8430,
      "@hannasage/armature/glass/react": 13710, "@hannasage/armature/styles.css": 830, "@hannasage/armature/frame": 890,
      "@hannasage/armature/values": 6870, "@hannasage/armature/curves": 2500, "@hannasage/armature/linear": 3690,
    };
    for (const [key, cap] of Object.entries(keep)) expect(budget.caps[key].cap, key).toBe(cap);
  });

  it("keeps every other entry at or under its cap", async () => {
    for (const row of await lib.measureAll()) expect(row.gzipped, row.key).toBeLessThanOrEqual(budget.caps[row.key].cap);
  });
});
