import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cssFlavor } from "../../src/css";
import { criticalDamping, type SpringConfig } from "../../src/engine/spring";
import { tide } from "../../examples/tide/flavor";
import { blocksOf, checkPage, readDoc, root } from "../helpers/doc-pages";
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
  ...Object.entries(tide.springs).map(([name, config]) => ({ text: springSection(name, config), check: () => expect(dampingRatio(config)).toBeLessThanOrEqual(1) })),
  { text: "stays inside 2 percent of the target", check: () => expect(SETTLE_BAND).toBe(0.02) },
]);

describe("the guide to writing a flavor", () => {
  it("cuts every code block from the files of the Tide flavor", () => {
    const blocks = blocksOf(page, "ts");
    expect(blocks.length).toBeGreaterThanOrEqual(10);
    for (const block of blocks) expect(files.some((file) => file.includes(block)), block).toBe(true);
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

  it("says that the solver measures no overshoot for drift, which the formula calls underdamped", () => {
    expect(page).toContain("`drift` is underdamped by the formula, and the solver measures no overshoot for it.");
    expect(dampingRatio(tide.springs.drift)).toBeLessThan(1);
    expect(analyticOvershoot(tide.springs.drift)).toBeGreaterThan(0);
    expect(percent(measureSpring(tide.springs.drift).overshoot)).toBe("0.0 percent");
  });

  it("points to the contract review for the status of each part", () => {
    expect(page).toContain('`docs/contract-review.md`, section "Review after the third flavor"');
    expect(readDoc("contract-review.md")).toContain("## Review after the third flavor");
  });

  it("draws docs/figures/tide-springs.svg from the solver's own samples", async () => {
    const svg = figure(Object.entries(tide.springs).map(([name, config]) => ({ title: name, points: sampleSpring(config, 1) })));
    await expect(svg).toMatchFileSnapshot("../../docs/figures/tide-springs.svg");
  });
});
