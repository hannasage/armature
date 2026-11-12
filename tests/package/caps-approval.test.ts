import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The maintainer approved three caps on 2026-11-12. The budget file and the baseline page both record it.

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const budget = JSON.parse(readFileSync(join(root, "size-budget.json"), "utf8")) as { caps: Record<string, { cap: number; approval?: string }> };
const baseline = readFileSync(join(root, "docs/baseline.md"), "utf8");
const NOTE = "approved by the maintainer, 2026-11-12";

describe("approved caps", () => {
  it.each([
    ["@hannasage/armature/curves", 2500],
    ["@hannasage/armature/linear", 3300],
    ["@hannasage/armature/react", 12650],
  ])("records the approval of the %s cap of %i in size-budget.json", (key, cap) => {
    expect(budget.caps[key].cap).toBe(cap);
    expect(budget.caps[key].approval).toBe(NOTE);
  });

  it("records the approval in docs/baseline.md, and the public names beyond the spec", () => {
    expect(baseline).toContain(NOTE);
    expect(baseline).toContain("- `/react`: 12,650.");
    expect(baseline).toMatch(/`fitLinear` and `LinearFit`[^\n]*beyond the spec/);
  });
});
