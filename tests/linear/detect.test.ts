import { afterEach, describe, expect, it, vi } from "vitest";
import { easing } from "../../src/curves";
import { supportsLinear, toEasing } from "../../src/linear";
import { presets, solverSeries, evalStops, parseLinear } from "../helpers/solver-series";

// Feature detection of `linear()`, and the fallback to a fitted bezier when it is missing.

const yes = () => true;
const no = () => false;

afterEach(() => vi.unstubAllGlobals());

describe("supportsLinear", () => {
  it("asks the probe about a linear() timing function, and says what it answers", () => {
    const probe = vi.fn(() => true);
    expect(supportsLinear(probe)).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith("animation-timing-function", "linear(0, 0.5, 1)");
    expect(supportsLinear(no)).toBe(false);
  });

  it("is false when the probe throws", () => {
    expect(supportsLinear(() => {
      throw new Error("bad");
    })).toBe(false);
  });

  it("is true only for a true answer, not for any truthy value", () => {
    for (const answer of [1, "yes", {}, undefined, null, 0]) expect(supportsLinear((() => answer) as never)).toBe(false);
  });

  it("reads CSS.supports on the global object when no probe is given", () => {
    vi.stubGlobal("CSS", { supports: (property: string, value: string) => property === "animation-timing-function" && value.startsWith("linear(") });
    expect(supportsLinear()).toBe(true);
    vi.stubGlobal("CSS", { supports: () => false });
    expect(supportsLinear()).toBe(false);
  });

  it("is false with no CSS object, as on a server, and with a CSS object that has no supports", () => {
    expect(supportsLinear()).toBe(false);
    vi.stubGlobal("CSS", {});
    expect(supportsLinear()).toBe(false);
    vi.stubGlobal("CSS", { supports: "nope" });
    expect(supportsLinear()).toBe(false);
  });
});

describe("toEasing", () => {
  it("writes linear() when the browser supports it", () => {
    for (const [name, config] of presets) {
      const result = toEasing(config, { supports: yes });
      expect(result.kind, name).toBe("linear");
      expect(result.css.startsWith("linear("), name).toBe(true);
      expect(result.error, name).toBeLessThanOrEqual(0.005);
    }
  });

  it("falls back to a fitted cubic-bezier when it does not, and reports the fit error", () => {
    for (const [name, config] of presets) {
      const result = toEasing(config, { supports: no });
      expect(result.kind, name).toBe("cubic-bezier");
      expect(result.css.startsWith("cubic-bezier("), name).toBe(true);
      expect(result.error, name).toBeGreaterThan(0);
      expect(result.error, name).toBeLessThan(0.6);
    }
  });

  it("reports the same duration on both paths", () => {
    const config = presets[0][1];
    expect(toEasing(config, { supports: no }).duration).toBe(toEasing(config, { supports: yes }).duration);
  });

  it("falls back to a fit that is close for a spring that does not overshoot", () => {
    const critical = { stiffness: 170, damping: 2 * Math.sqrt(170) };
    expect(toEasing(critical, { supports: no }).error).toBeLessThan(0.05);
  });

  it("falls back when the probe throws", () => {
    const result = toEasing(presets[0][1], {
      supports: () => {
        throw new Error("bad");
      },
    });
    expect(result.kind).toBe("cubic-bezier");
  });

  it("uses the global CSS.supports when no probe is given", () => {
    vi.stubGlobal("CSS", { supports: yes });
    expect(toEasing(presets[0][1]).kind).toBe("linear");
    vi.stubGlobal("CSS", { supports: no });
    expect(toEasing(presets[0][1]).kind).toBe("cubic-bezier");
  });

  it("returns a bezier curve as its own cubic-bezier with no error, whatever the support says", () => {
    const curve = easing("projection");
    for (const supports of [yes, no]) {
      expect(toEasing(curve, { supports })).toEqual({ css: "cubic-bezier(0.22, 1, 0.36, 1)", duration: 1, kind: "cubic-bezier", error: 0, degraded: false, truncated: false });
    }
  });

  it("writes linear() for another curve when it is supported, and a fitted bezier when it is not", () => {
    const wave = (p: number) => p + 0.1 * Math.sin(p * Math.PI * 2) * (1 - p);
    expect(toEasing(wave, { supports: yes }).kind).toBe("linear");
    expect(toEasing(wave, { supports: no }).kind).toBe("cubic-bezier");
  });

  it("keeps the linear() output within the tolerance it is given", () => {
    const config = presets[1][1];
    const { values } = solverSeries(config);
    const stops = parseLinear(toEasing(config, { supports: yes, tolerance: 0.001 }).css);
    for (let i = 0; i < values.length; i += 1) expect(Math.abs(evalStops(stops, i / (values.length - 1)) - values[i])).toBeLessThanOrEqual(0.001);
  });
});

describe("toEasing flags", () => {
  const bouncy = { stiffness: 300, damping: 10 };
  const critical = { stiffness: 170, damping: 2 * Math.sqrt(170) };

  it("marks the fallback as degraded when the fitted bezier is further from the solver than the tolerance", () => {
    const result = toEasing(bouncy, { supports: no, tolerance: 0.005 });
    expect(result.error).toBeGreaterThan(0.005);
    expect(result.degraded).toBe(true);
  });

  it("does not mark the fallback as degraded when the fit is within the tolerance", () => {
    const result = toEasing(critical, { supports: no, tolerance: 0.05 });
    expect(result.error).toBeLessThanOrEqual(0.05);
    expect(result.degraded).toBe(false);
  });

  it("never marks the linear() path as degraded", () => {
    for (const [name, config] of presets) expect(toEasing(config, { supports: yes }).degraded, name).toBe(false);
  });

  it("throws a RangeError when the fallback error is above maxError", () => {
    expect(() => toEasing(bouncy, { supports: no, maxError: 0.01 })).toThrow(RangeError);
    expect(() => toEasing(bouncy, { supports: no, maxError: 0.01 })).toThrow(/maxError/);
  });

  it("returns the fallback when its error is within maxError", () => {
    const result = toEasing(bouncy, { supports: no, maxError: 1 });
    expect(result.kind).toBe("cubic-bezier");
    expect(result.error).toBeLessThanOrEqual(1);
  });

  it("checks maxError on the linear() path too", () => {
    expect(() => toEasing(bouncy, { supports: yes, tolerance: 0.0005, maxError: 0.0005 })).not.toThrow();
    expect(() => toEasing(bouncy, { supports: yes, tolerance: 0.0005, maxError: 0.00001 })).toThrow(RangeError);
  });

  it("throws a TypeError for a bezier that returns NaN, so degraded and maxError cannot pass on NaN", () => {
    const forged = Object.assign(() => Number.NaN, { css: "cubic-bezier(0.22, 1, 0.36, 1)", points: [0.22, 1, 0.36, 1] as const });
    expect(() => toEasing(forged, { supports: yes })).toThrow(TypeError);
    expect(() => toEasing(forged, { supports: yes, maxError: 1 })).toThrow(TypeError);
  });

  it("throws a RangeError for a maxError that is not a finite number of 0 or more", () => {
    for (const maxError of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => toEasing(bouncy, { supports: no, maxError })).toThrow(RangeError);
  });

  it("marks a spring that never rests as truncated, on both paths, and does not throw", () => {
    const undamped = { stiffness: 100, damping: 0 };
    for (const supports of [yes, no]) {
      expect(toEasing(undamped, { supports }).truncated).toBe(true);
    }
    expect(toEasing(critical, { supports: yes }).truncated).toBe(false);
  });

  it("measures a bezier against its own points and not against its css text", () => {
    const forged = Object.assign((p: number) => p * p, { css: "cubic-bezier(0.22, 1, 0.36, 1)", points: [0.22, 1, 0.36, 1] as const });
    const result = toEasing(forged, { supports: yes });
    expect(result.error).toBeGreaterThan(0.1);
    expect(result.degraded).toBe(true);
    expect(result.css).toBe("cubic-bezier(0.22, 1, 0.36, 1)");
  });

  it("does not sample a bezier: the curve is called only to measure it", () => {
    let calls = 0;
    const base = easing("ease");
    const counted = Object.assign((p: number) => { calls += 1; return base(p); }, { css: base.css, points: base.points });
    toEasing(counted, { supports: yes });
    expect(calls).toBeLessThanOrEqual(200);
  });
});
