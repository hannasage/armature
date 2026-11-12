import { describe, expect, it } from "vitest";
import { easing } from "../../src/curves";
import { FIXED_STEP } from "../../src/engine/spring";
import { fitLinear, toLinear } from "../../src/linear";
import { linearFrom, sampleSource } from "../../src/linear/linear";
import { evalStops, parseLinear, presets, solverSeries } from "../helpers/solver-series";

// The `linear()` exporter. Each test reads the output with a parser of its own, then compares it to the solver's own series.

/** The largest gap between the stops and the solver, at every solver step and at the middle of each step. */
function gapToSolver(css: string, values: number[]): number {
  const stops = parseLinear(css);
  const last = values.length - 1;
  let worst = 0;
  for (let i = 0; i <= last; i += 1) worst = Math.max(worst, Math.abs(evalStops(stops, i / last) - values[i]));
  return worst;
}

describe("toLinear on every preset", () => {
  for (const tolerance of [0.02, 0.005, 0.001]) {
    it(`stays within a tolerance of ${tolerance} of the solver on every preset, glass and Projection`, () => {
      expect(presets.length).toBeGreaterThanOrEqual(12);
      for (const [name, config] of presets) {
        const { values } = solverSeries(config);
        const gap = gapToSolver(toLinear(config, { tolerance }), values);
        expect(gap, `${name} at ${tolerance}`).toBeLessThanOrEqual(tolerance);
      }
    });
  }

  it.each(presets)("stays within 0.005 of the solver for the preset %s", (_name, config) => {
    const { values } = solverSeries(config);
    expect(gapToSolver(toLinear(config, { tolerance: 0.005 }), values)).toBeLessThanOrEqual(0.005);
  });

  it.each(presets)("stays within the smallest tolerance, 0.0005, for the preset %s", (_name, config) => {
    const { values } = solverSeries(config);
    const fit = fitLinear(config, { tolerance: 0.0005 });
    expect(fit.error).toBeLessThanOrEqual(0.0005);
    expect(gapToSolver(fit.css, values)).toBeLessThanOrEqual(0.0005);
  });

  it("does not truncate any preset", () => {
    for (const [name, config] of presets) expect(fitLinear(config).truncated, name).toBe(false);
  });

  it("uses 0.005 when no tolerance is given", () => {
    for (const [name, config] of presets) {
      expect(toLinear(config), name).toBe(toLinear(config, { tolerance: 0.005 }));
    }
  });

  it("starts at 0 and ends at 1 for a spring that rests", () => {
    for (const [name, config] of presets) {
      const stops = parseLinear(toLinear(config));
      expect(stops[0], name).toEqual([0, 0]);
      expect(stops.at(-1), name).toEqual([1, 1]);
    }
  });

  it("writes stop times that never go back", () => {
    for (const [name, config] of presets) {
      const stops = parseLinear(toLinear(config, { tolerance: 0.001 }));
      for (let i = 1; i < stops.length; i += 1) expect(stops[i][0], name).toBeGreaterThanOrEqual(stops[i - 1][0]);
    }
  });
});

describe("fitLinear", () => {
  it("reports the error, and that error is the true gap and is within the tolerance", () => {
    for (const [name, config] of presets) {
      const fit = fitLinear(config, { tolerance: 0.005 });
      const { values } = solverSeries(config);
      expect(fit.error, name).toBeLessThanOrEqual(0.005);
      expect(fit.error, name).toBeCloseTo(gapToSolver(fit.css, values), 4);
    }
  });

  it("reports the duration of the spring from the solver's own steps", () => {
    for (const [name, config] of presets) {
      const { step, values } = solverSeries(config);
      expect(fitLinear(config).duration, name).toBeCloseTo((values.length - 1) * step, 10);
      expect(fitLinear(config).duration, name).toBeGreaterThan(FIXED_STEP);
    }
  });

  it("reports the number of stops, and the string holds that many", () => {
    const fit = fitLinear(presets[0][1]);
    expect(fit.count).toBe(parseLinear(fit.css).length);
  });

  it("uses fewer stops for a smoother curve", () => {
    const calm = { stiffness: 170, damping: 2 * Math.sqrt(170) };
    const bouncy = { stiffness: 170, damping: 6 };
    expect(fitLinear(calm).count).toBeLessThan(fitLinear(bouncy).count);
  });

  it("uses fewer stops for a larger tolerance", () => {
    const config = presets[0][1];
    expect(fitLinear(config, { tolerance: 0.02 }).count).toBeLessThan(fitLinear(config, { tolerance: 0.001 }).count);
  });

  it("uses far fewer stops than the solver has steps", () => {
    for (const [name, config] of presets) {
      const { values } = solverSeries(config);
      expect(fitLinear(config).count, name).toBeLessThan(values.length / 2);
    }
  });

  it("is the same on every call", () => {
    expect(fitLinear(presets[3][1])).toEqual(fitLinear(presets[3][1]));
  });

  it("uses overshoot values above 1 for an underdamped spring", () => {
    const stops = parseLinear(toLinear({ stiffness: 300, damping: 10 }));
    expect(Math.max(...stops.map((stop) => stop[1]))).toBeGreaterThan(1.1);
  });
});

describe("toLinear on a curve", () => {
  it("fits a bezier curve within the tolerance, sampled in its own steps", () => {
    const curve = easing("projection");
    const css = toLinear(curve, { tolerance: 0.002 });
    const stops = parseLinear(css);
    for (let i = 0; i <= 1000; i += 1) expect(Math.abs(evalStops(stops, i / 1000) - curve(i / 1000))).toBeLessThanOrEqual(0.002 + 1e-4);
  });

  it("reports a duration of 1 second for a curve, or the duration it is given", () => {
    expect(fitLinear(easing("ease")).duration).toBe(1);
    expect(fitLinear(easing("ease"), { duration: 0.35 }).duration).toBe(0.35);
  });

  it("writes a straight line as two stops", () => {
    expect(toLinear(easing("linear"))).toBe("linear(0, 1)");
  });

  it("accepts any function from progress to value", () => {
    const css = toLinear((p: number) => p * p, { tolerance: 0.005 });
    const stops = parseLinear(css);
    for (let i = 0; i <= 100; i += 1) expect(Math.abs(evalStops(stops, i / 100) - (i / 100) ** 2)).toBeLessThanOrEqual(0.0051);
  });
});

describe("bad input", () => {
  it("throws a RangeError for a tolerance that is not positive, not finite, or below what the output can hold", () => {
    const config = presets[0][1];
    for (const tolerance of [0, -0.1, Number.NaN, Number.POSITIVE_INFINITY, 0.00001]) {
      expect(() => toLinear(config, { tolerance }), String(tolerance)).toThrow(RangeError);
    }
  });

  it("throws a TypeError for a source that is neither a spring config nor a curve", () => {
    for (const bad of [null, undefined, 5, "spring", {}, { stiffness: "x" }]) {
      expect(() => toLinear(bad as never)).toThrow(TypeError);
    }
  });

  it("throws a TypeError when a curve returns a value that is not finite", () => {
    expect(() => toLinear(() => Number.NaN)).toThrow(TypeError);
  });

  it("throws a TypeError for a duration that is not positive", () => {
    for (const duration of [0, -1, Number.NaN]) expect(() => toLinear(easing("ease"), { duration })).toThrow(TypeError);
  });

  it("marks a spring that never rests as truncated, and keeps its stops finite", () => {
    const fit = fitLinear({ stiffness: 100, damping: 0 });
    expect(fit.truncated).toBe(true);
    const stops = parseLinear(fit.css);
    expect(stops.length).toBeGreaterThan(2);
    for (const [at, value] of stops) {
      expect(Number.isFinite(at)).toBe(true);
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("throws a RangeError that names the cap when toLinear would cut a spring short", () => {
    expect(() => toLinear({ stiffness: 100, damping: 0 })).toThrow(RangeError);
    expect(() => toLinear({ stiffness: 100, damping: 0 })).toThrow(/10 seconds or 20,000 steps/);
  });

  it("throws a TypeError for a spring with a stiffness, damping, or mass that is not usable", () => {
    const bad = [
      { stiffness: Number.NaN, damping: 10 }, { stiffness: 0, damping: 10 }, { stiffness: -5, damping: 10 }, { stiffness: Number.POSITIVE_INFINITY, damping: 10 },
      { stiffness: 100, damping: Number.NaN }, { stiffness: 100, damping: -1 }, { stiffness: 100, damping: Number.POSITIVE_INFINITY },
      { stiffness: 100, damping: 10, mass: 0 }, { stiffness: 100, damping: 10, mass: -1 }, { stiffness: 100, damping: 10, mass: Number.NaN },
    ];
    for (const config of bad) {
      expect(() => toLinear(config), JSON.stringify(config)).toThrow(TypeError);
      expect(() => fitLinear(config), JSON.stringify(config)).toThrow(TypeError);
    }
  });

  it("throws a TypeError for a restSpeed or restDelta that is not finite and above 0", () => {
    for (const field of ["restSpeed", "restDelta"]) {
      for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "1"]) {
        const config = { stiffness: 100, damping: 10, [field]: bad };
        expect(() => toLinear(config as never), `${field} ${String(bad)}`).toThrow(TypeError);
      }
    }
  });

  it("accepts a restSpeed and a restDelta above 0", () => {
    expect(fitLinear({ stiffness: 100, damping: 10, restSpeed: 0.001, restDelta: 0.001 }).truncated).toBe(false);
  });

  it("names the tolerance in the error for a tolerance that is too small", () => {
    expect(() => toLinear(presets[0][1], { tolerance: 0.0001 })).toThrow(/0\.0001/);
    expect(() => linearFrom({ ys: [0, 0.123456789, 1], duration: 1, truncated: false }, 1e-9)).toThrow(/1e-9/);
  });

  it("says a duration must be finite and above 0", () => {
    expect(() => toLinear(easing("ease"), { duration: 0 })).toThrow(/finite and above 0/);
  });

  it("accepts a spring with no damping, and a mass", () => {
    expect(fitLinear({ stiffness: 100, damping: 0 }).count).toBeGreaterThan(2);
    expect(fitLinear({ stiffness: 100, damping: 10, mass: 2 }).truncated).toBe(false);
  });
});

describe("samples and stops are checked before CSS is written", () => {
  it("samples a spring into at least two finite values and a finite positive duration", () => {
    const samples = sampleSource({ stiffness: 170, damping: 26 });
    expect(samples.ys.length).toBeGreaterThanOrEqual(2);
    expect(samples.ys.every(Number.isFinite)).toBe(true);
    expect(samples.duration).toBeGreaterThan(0);
    expect(samples.truncated).toBe(false);
  });

  it("throws a TypeError from linearFrom for a value that is not finite, too few values, or a bad duration", () => {
    expect(() => linearFrom({ ys: [0, Number.NaN, 1], duration: 1, truncated: false }, 0.005)).toThrow(TypeError);
    expect(() => linearFrom({ ys: [0, Number.POSITIVE_INFINITY], duration: 1, truncated: false }, 0.005)).toThrow(TypeError);
    expect(() => linearFrom({ ys: [1], duration: 1, truncated: false }, 0.005)).toThrow(TypeError);
    expect(() => linearFrom({ ys: [], duration: 1, truncated: false }, 0.005)).toThrow(TypeError);
    for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => linearFrom({ ys: [0, 1], duration, truncated: false }, 0.005)).toThrow(TypeError);
    }
  });

  it("never writes NaN or Infinity into the CSS for any preset", () => {
    for (const [name, config] of presets) expect(toLinear(config), name).not.toMatch(/NaN|Infinity/);
  });
});
