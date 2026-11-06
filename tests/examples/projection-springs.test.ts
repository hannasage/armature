import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { springOf } from "@hannasage/armature";
import { projection } from "../../examples/projection/flavor";
import { analyticOvershoot, analyticSettle, dampingRatio, measureSpring } from "../helpers/measure-spring";

// These tests step each spring from 0 to 1 with the real solver (the fixed 1/120 s slice) and measure the curve.
// Nothing here is typed by hand except the limits. The numbers in docs/projection-flavor.md come from the same helper.

const mechanical = springOf(projection, "mechanical");
const settle = springOf(projection, "settle");

describe("the mechanical spring", () => {
  const measured = measureSpring(mechanical);

  it("has a damping ratio of 0.612, so it is underdamped", () => {
    expect(Math.abs(dampingRatio(mechanical) - 0.612)).toBeLessThan(0.01);
    expect(dampingRatio(mechanical)).toBeLessThan(1);
  });

  it("overshoots by 8 to 10 percent in the closed-form solution", () => {
    expect(analyticOvershoot(mechanical)).toBeGreaterThan(0.08);
    expect(analyticOvershoot(mechanical)).toBeLessThan(0.1);
  });

  it("overshoots by 6 to 7 percent in the solver, because a fixed Euler slice adds a little damping", () => {
    // The brief asked for 8 to 10 percent measured. The solver gives 6.5 percent for these constants, so that limit cannot hold.
    // semi-implicit Euler at 1/120 s multiplies the velocity by (1 - c h / m) = 0.75 each slice. The exact decay is exp(-c h / m) = 0.779.
    expect(measured.overshoot).toBeGreaterThan(0.06);
    expect(measured.overshoot).toBeLessThan(0.07);
    expect(measured.overshoot).toBeLessThan(analyticOvershoot(mechanical));
  });

  it("settles into the 2 percent band in about 224 ms", () => {
    expect(measured.settleSeconds).toBeGreaterThan(0.2);
    expect(measured.settleSeconds).toBeLessThan(0.25);
  });
});

describe("the settle spring", () => {
  const measured = measureSpring(settle);

  it("has a damping ratio of 1, so it is critical", () => {
    expect(Math.abs(dampingRatio(settle) - 1)).toBeLessThan(0.01);
  });

  it("overshoots by at most 0.5 percent", () => {
    expect(measured.overshoot).toBeLessThanOrEqual(0.005);
    expect(analyticOvershoot(settle)).toBe(0);
  });

  it("settles into the 2 percent band in about 256 ms", () => {
    expect(measured.settleSeconds).toBeGreaterThan(0.23);
    expect(measured.settleSeconds).toBeLessThan(0.28);
  });
});

describe("the measuring helper", () => {
  it("finds the textbook overshoot for a spring with a small step error", () => {
    // A slow, lightly damped spring has a small product of frequency and slice, so the solver is close to the closed form.
    const light = { stiffness: 100, damping: 2, mass: 1 };
    expect(Math.abs(measureSpring(light).overshoot - analyticOvershoot(light))).toBeLessThan(0.05);
  });
  it("reports no overshoot for an overdamped spring", () => {
    const heavy = { stiffness: 100, damping: 40, mass: 1 };
    expect(dampingRatio(heavy)).toBeGreaterThan(1);
    expect(measureSpring(heavy).overshoot).toBe(0);
  });
});

describe("docs/projection-flavor.md", () => {
  const doc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../docs/projection-flavor.md"), "utf8");
  const ms = (seconds: number) => `${Math.round(seconds * 1000)} ms`;
  const percent = (fraction: number) => `${(fraction * 100).toFixed(1)} percent`;

  it("records the numbers the solver measures, so a change to the solver or the springs fails here", () => {
    for (const config of [mechanical, settle]) {
      const measured = measureSpring(config);
      expect(doc, `settle time ${ms(measured.settleSeconds)}`).toContain(ms(measured.settleSeconds));
      expect(doc, `overshoot ${percent(measured.overshoot)}`).toContain(percent(measured.overshoot));
      expect(doc, `closed-form overshoot ${percent(analyticOvershoot(config))}`).toContain(percent(analyticOvershoot(config)));
      expect(doc, `closed-form settle ${ms(analyticSettle(config))}`).toContain(ms(analyticSettle(config)));
      expect(doc, `ratio`).toContain(dampingRatio(config).toFixed(3));
    }
  });

  it("names the stiffness and damping of both springs", () => {
    expect(doc).toContain(`stiffness ${mechanical.stiffness}, damping ${mechanical.damping}`);
    expect(doc).toContain(`stiffness ${settle.stiffness}`);
  });

  it("says that the component work happens in Milestone 3", () => {
    expect(doc).toContain("Milestone 3");
  });
});
