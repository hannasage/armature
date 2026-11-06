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

  it("has a damping ratio of 0.572, so it is underdamped", () => {
    expect(Math.abs(dampingRatio(mechanical) - 0.572)).toBeLessThan(0.01);
    expect(dampingRatio(mechanical)).toBeLessThan(1);
  });

  it("overshoots by about 11.2 percent in the closed-form solution", () => {
    expect(analyticOvershoot(mechanical)).toBeGreaterThan(0.11);
    expect(analyticOvershoot(mechanical)).toBeLessThan(0.115);
  });

  it("overshoots by 8.5 to 9.5 percent in the solver", () => {
    // A fixed semi-implicit Euler slice of 1/120 s adds a little damping, so the solver measures below the closed form.
    expect(measured.overshoot).toBeGreaterThan(0.085);
    expect(measured.overshoot).toBeLessThan(0.095);
    expect(measured.overshoot).toBeLessThan(analyticOvershoot(mechanical));
  });

  it("settles into the 2 percent band in about 223 ms", () => {
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
  it("reports the time after which the curve stays inside the band to the end of the run", () => {
    // Only the last entry into the band counts, so a longer run gives the same answer.
    const measured = measureSpring(mechanical, 2);
    const longer = measureSpring(mechanical, 8);
    expect(longer.settleSeconds).toBe(measured.settleSeconds);
  });
  it("throws when the curve never settles inside the run", () => {
    expect(() => measureSpring({ stiffness: 100, damping: 0, mass: 1 })).toThrow("never settles");
    expect(() => measureSpring(mechanical, 0.05)).toThrow("never settles");
    expect(() => measureSpring({ stiffness: 100, damping: 400, mass: 1 }, 1)).toThrow("never settles");
  });
  it("throws when the curve never moves", () => {
    expect(() => measureSpring(mechanical, 0)).toThrow("never moves");
  });
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
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /** A figure that is not part of a longer number: "9.0 percent" does not match inside "19.0 percent" or "9.05 percent". */
  const figure = (label: string, value: string) => new RegExp(`${escape(label)}:? ${escape(value)}(?!\\d|\\.\\d)`);

  /** The text under a heading, up to the next heading of any level. */
  function section(title: string): string {
    const lines = doc.split("\n");
    const start = lines.findIndex((line) => /^#{1,6} /.test(line) && line.replace(/^#+ /, "").trim() === title);
    expect(start, `a heading "${title}"`).toBeGreaterThanOrEqual(0);
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^#{1,6} /.test(line));
    return (end === -1 ? rest : rest.slice(0, end)).join("\n");
  }

  it("records, under each spring's own heading, the numbers the solver measures", () => {
    for (const [title, config] of [["mechanical", mechanical], ["settle", settle]] as const) {
      const text = section(title);
      const measured = measureSpring(config);
      expect(text, `${title} measured settle`).toMatch(figure("Measured settle time", ms(measured.settleSeconds)));
      expect(text, `${title} measured overshoot`).toMatch(figure("Measured overshoot", percent(measured.overshoot)));
      expect(text, `${title} closed-form overshoot`).toMatch(figure("Closed-form overshoot", percent(analyticOvershoot(config))));
      expect(text, `${title} closed-form settle`).toMatch(figure("Closed-form settle time", ms(analyticSettle(config))));
      expect(text, `${title} ratio`).toMatch(figure("Damping ratio", dampingRatio(config).toFixed(3)));
    }
  });

  it("does not put one spring's numbers under the other spring", () => {
    const a = section("mechanical");
    const b = section("settle");
    expect(a).not.toMatch(figure("Measured settle time", ms(measureSpring(settle).settleSeconds)));
    expect(b).not.toMatch(figure("Measured settle time", ms(measureSpring(mechanical).settleSeconds)));
    expect(b).not.toMatch(figure("Measured overshoot", percent(measureSpring(mechanical).overshoot)));
  });

  it("names the constants of each spring under its own heading", () => {
    expect(section("mechanical")).toContain(`stiffness ${mechanical.stiffness}, damping ${mechanical.damping}, mass ${mechanical.mass}`);
    expect(section("settle")).toContain(`stiffness ${settle.stiffness}, damping 2 sqrt(${settle.stiffness}), mass ${settle.mass}`);
    expect(section("settle")).toContain(`The damping is ${settle.damping.toFixed(1)}.`);
  });

  it("gives the settle damping as the literal 48.99", () => {
    expect(Math.abs(settle.damping - 48.99)).toBeLessThan(0.01);
  });

  it("says that the component work happens in Milestone 3", () => {
    expect(doc).toContain("Milestone 3");
  });
});
