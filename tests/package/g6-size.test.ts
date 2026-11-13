import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// G6 adds the `/layout` entry. Its cap is the measured size plus 10 percent, rounded up to the next 10 bytes. The tech lead approved the cap
// on 2026-11-13. No existing cap moves, and the spring-only entry stays under its cap of 4,000.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const lib = (await import(pathToFileURL(join(root, "scripts/size-lib.mjs")).href)) as {
  measureAll: () => Promise<{ key: string; gzipped: number }[]>;
  capFor: (gzipped: number) => number;
};
type Cap = { cap: number; measuredGzipped: number; measuredAfterReview?: number; measuredIn: string; proposal?: string; approval?: string };
const budget = JSON.parse(readFileSync(join(root, "size-budget.json"), "utf8")) as { caps: Record<string, Cap>; proposedForNewEntries: Record<string, string> };
const baseline = readFileSync(join(root, "docs/baseline.md"), "utf8");
const KEY = "@hannasage/armature/layout";
const layout = budget.caps[KEY];
const section = () => baseline.slice(baseline.indexOf("## G6 build"));

describe("the /layout size after G6", () => {
  it("has a cap, derived from the measure by the rule, and the entry is at or under it", async () => {
    expect(layout).toBeDefined();
    expect(layout.cap).toBe(lib.capFor(layout.measuredGzipped));
    expect(layout.measuredIn).toBe("G6 build");
    const rows = await lib.measureAll();
    expect(rows.find((row) => row.key === KEY)!.gzipped).toBe(layout.measuredAfterReview ?? layout.measuredGzipped);
    expect(layout.measuredGzipped).toBeLessThanOrEqual(layout.cap);
  });

  it("keeps the amendment proposal beside the cap, and records the approval of the tech lead", () => {
    expect(layout.proposal).toBe("4.0 KB");
    expect(layout.approval).toBe("approved by the tech lead, 2026-11-13");
  });

  it("no longer lists /layout among the entries that do not exist yet", () => {
    expect(Object.keys(budget.proposedForNewEntries)).not.toContain(KEY);
  });

  it("writes the figures in docs/baseline.md, with the cap approved by the tech lead, and the tarball re-measured", () => {
    expect(baseline).toContain("## G6 build");
    expect(section()).toContain(`- \`/layout\`: ${layout.cap.toLocaleString("en-US")}`);
    expect(section()).toContain("approved by the tech lead, 2026-11-13");
    expect(section()).not.toMatch(/not approved/);
    expect(section()).toContain((layout.measuredAfterReview ?? layout.measuredGzipped).toLocaleString("en-US"));
    expect(section()).toMatch(/tarball[^\n]*\d{3},\d{3} bytes/i);
    expect(section()).toContain("1.5");
  });

  it("records the scale distortion measurement and the choice in docs/baseline.md", () => {
    const text = section();
    expect(text).toContain("### Scale distortion");
    expect(text).toMatch(/Choice: counter-scale/);
    expect(text).toMatch(/layouts? per frame/i);
    for (const count of ["10", "100", "1,000"]) expect(text, count).toMatch(new RegExp(`\\| ${count} \\|`));
    expect(text).toMatch(/stretch/i);
  });

  it("keeps the approved size of the tarball as the baseline", () => {
    expect(baseline).toMatch(/MEASURED_SIZE[^\n]*222,018[^\n]*approved by the maintainer/);
  });

  it("leaves the caps of the other entries as they were", () => {
    const keep: Record<string, number> = {
      "@hannasage/armature": 4000, "@hannasage/armature/dom": 12170, "@hannasage/armature/react": 12650, "@hannasage/armature/glass": 8430,
      "@hannasage/armature/glass/react": 13710, "@hannasage/armature/styles.css": 830, "@hannasage/armature/frame": 890,
      "@hannasage/armature/values": 6870, "@hannasage/armature/curves": 2500, "@hannasage/armature/linear": 3690, "@hannasage/armature/gesture": 5850,
      "@hannasage/armature/timeline": 6460,
    };
    for (const [key, cap] of Object.entries(keep)) expect(budget.caps[key].cap, key).toBe(cap);
  });

  it("keeps every other entry at or under its cap, and the spring-only entry as G5 left it", async () => {
    const rows = await lib.measureAll();
    for (const row of rows) expect(row.gzipped, row.key).toBeLessThanOrEqual(budget.caps[row.key].cap);
    expect(rows.find((row) => row.key === "@hannasage/armature")!.gzipped).toBeLessThanOrEqual(3853);
  });

  it("records the public names, and the decision for the environment, in docs/baseline.md", () => {
    expect(section()).toContain("### Public names");
    expect(section()).toMatch(/measure/);
  });

  it("records the decision of the tech lead for the flavor check, in the source and in every doc, and leaves no open question", () => {
    const files = ["src/layout/flavor.ts", "docs/layout.md", "docs/flavors.md", "docs/baseline.md", "CHANGELOG.md"];
    for (const file of files) {
      const text = readFileSync(join(root, file), "utf8");
      expect(text, file).toMatch(/the tech lead decided option A for the layout part on 2026-11-13/i);
      expect(text, file).not.toMatch(/not yet confirmed|has not confirmed/);
    }
  });

  it("documents the limits of the controllers in docs/layout.md", () => {
    const text = readFileSync(join(root, "docs/layout.md"), "utf8");
    expect(text).toMatch(/own[^\n]*`translate` and `scale`/);
    expect(text).toMatch(/transformed ancestor/);
    expect(text).toMatch(/rotation/);
    expect(text).toMatch(/same frame/);
    expect(text).toMatch(/cancel/);
    expect(text).toMatch(/without firing `exit`|does not fire `exit`/);
    expect(text).not.toMatch(/did no layout during the move/);
  });
});
