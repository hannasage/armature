import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cssFlavor } from "../../src/css";
import { criticalDamping, type SpringConfig } from "../../src/engine/spring";
import { tide } from "../../examples/tide/flavor";
import { blocksOf, checkPage, fenceLabels, isCutFrom, readDoc, root, sectionOf } from "../helpers/doc-pages";
import { figure, sampleSpring } from "../helpers/doc-svg";
import { analyticOvershoot, analyticSettle, dampingRatio, measureSpring, SETTLE_BAND } from "../helpers/measure-spring";

// docs/flavor-authoring.md builds the Tide flavor. Its code blocks are cut from the files of the flavor, so the guide shows the code that the
// tests run. Its numbers are measured with the real solver, as on docs/projection-flavor.md.

const page = readDoc("flavor-authoring.md");
const files = ["examples/tide/flavor.ts", "examples/tide/sheet.ts"].map((file) => readFileSync(join(root, file), "utf8"));
const ms = (seconds: number) => `${Math.round(seconds * 1000)} ms`;
const percent = (fraction: number) => `${(fraction * 100).toFixed(1)} percent`;

/** The section of the guide for one spring, written from the spring and the solver. */
function springSection(name: string, config: SpringConfig): string {
  const mass = config.mass ?? 1;
  const critical = Math.abs(config.damping - criticalDamping(config.stiffness, mass)) < 1e-9;
  const ratio = dampingRatio(config);
  const measured = measureSpring(config);
  const kind = critical ? "It is critically damped." : ratio < 1 ? "It is underdamped." : "It is overdamped.";
  return [
    `#### ${name}`,
    ``,
    critical
      ? `- Constants: stiffness ${config.stiffness}, damping 2 sqrt(${config.stiffness}), mass ${mass}. The damping is ${config.damping.toFixed(1)}.`
      : `- Constants: stiffness ${config.stiffness}, damping ${config.damping}, mass ${mass}.`,
    `- Natural frequency: ${Math.sqrt(config.stiffness / mass).toFixed(1)} radians per second.`,
    `- Damping ratio ${ratio.toFixed(3)}. ${kind}`,
    `- Measured overshoot: ${percent(measured.overshoot)}.`,
    `- Measured settle time: ${ms(measured.settleSeconds)}.`,
    `- Closed-form overshoot: ${percent(analyticOvershoot(config))}.`,
    `- Closed-form settle time: ${ms(analyticSettle(config))}.`,
  ].join("\n");
}

checkPage("flavor-authoring.md", [
  // Each section is written from the solver, so its numbers are the check. It must sit under the heading that says they are measured.
  ...Object.entries(tide.springs).map(([name, config]) => {
    const text = springSection(name, config);
    return { text, check: () => expect(sectionOf(page, "What the solver measures")).toContain(text) };
  }),
  { text: "stays inside 2 percent of the target", check: () => expect(SETTLE_BAND).toBe(0.02) },
  {
    text: "`ζ = c / (2 sqrt(k m))`",
    check: () => {
      const config = { stiffness: 260, damping: 20, mass: 2 };
      expect(dampingRatio(config)).toBeCloseTo(20 / (2 * Math.sqrt(260 * 2)), 12);
    },
  },
  { text: "returns `2 sqrt(k m)`", check: () => expect(criticalDamping(260, 2)).toBeCloseTo(2 * Math.sqrt(260 * 2), 12) },
]);

describe("the guide to writing a flavor", () => {
  it("labels every fenced block as ts, css, or text, so no block escapes the checks", () => {
    const labels = fenceLabels(page);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(["ts", "css", "text"], `a block labelled "${label}"`).toContain(label);
    // Every fence line of the page belongs to a block the pattern found, so no block hides from the checks.
    expect(page.match(/^ {0,3}(```|~~~)/gm)).toHaveLength(labels.length * 2);
  });

  it("cuts every ts block from the files of the Tide flavor, as whole consecutive lines", () => {
    const blocks = blocksOf(page, "ts");
    expect(blocks.length).toBeGreaterThanOrEqual(12);
    for (const block of blocks) expect(files.some((file) => isCutFrom(block, file)), block).toBe(true);
  });

  it("refuses a block that drops a line in the middle, or that starts inside a line", () => {
    const file = "a\nb\nc\n";
    expect(isCutFrom("a\nb\n", file)).toBe(true);
    expect(isCutFrom("a\nc\n", file)).toBe(false);
    expect(isCutFrom("b\nc", "xb\nc")).toBe(false);
  });

  it("shows the only text block as the equation of a spring", () => {
    expect(blocksOf(page, "text")).toEqual(["m x'' + c x' + k x = 0\n"]);
  });

  it("shows the whole flavor: each part of it is a block on the page", () => {
    const blocks = blocksOf(page, "ts").join("\n");
    for (const name of ["const swell", "const ebb", "const drift", "const ripple", "const followers", "const gesture", "const timeline", "const layout", "export const tide"]) {
      expect(blocks, name).toContain(name);
    }
  });

  it("shows the stylesheet that cssFlavor writes for the flavor", () => {
    expect(blocksOf(page, "css")).toEqual([cssFlavor(tide)]);
  });

  it("says that the solver measures less overshoot for drift than the formula, which calls it underdamped", () => {
    expect(page).toContain("`drift` is underdamped by the formula, and the solver measures a smaller overshoot for it than the formula gives.");
    expect(dampingRatio(tide.springs.drift)).toBeLessThan(1);
    expect(measureSpring(tide.springs.drift).overshoot).toBeLessThan(analyticOvershoot(tide.springs.drift));
  });

  it("points to the contract review for the status of each part", () => {
    expect(page).toContain('`docs/contract-review.md`, section "Review after the third flavor"');
    expect(readDoc("contract-review.md")).toContain("## Review after the third flavor");
  });

  it("draws docs/figures/tide-springs.svg from the solver's own samples, and links it", async () => {
    // The file must exist, so a run that could write a new snapshot cannot pass on a file it made itself.
    expect(existsSync(join(root, "docs/figures/tide-springs.svg"))).toBe(true);
    expect(page).toMatch(/!\[[^\]]+\]\(figures\/tide-springs\.svg\)/);
    const svg = figure(Object.entries(tide.springs).map(([name, config]) => ({ title: name, points: sampleSpring(config, 1) })));
    await expect(svg).toMatchFileSnapshot("../../docs/figures/tide-springs.svg");
  });
});
