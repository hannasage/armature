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
      expect(toEasing(curve, { supports })).toEqual({ css: "cubic-bezier(0.22, 1, 0.36, 1)", duration: 1, kind: "cubic-bezier", error: 0 });
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
