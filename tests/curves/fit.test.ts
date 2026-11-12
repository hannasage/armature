import { describe, expect, it } from "vitest";
import { bezier, easing, fitBezier } from "../../src/curves";
import { presets, solverSeries } from "../helpers/solver-series";

// The bezier fitting aid: fit a bezier to a sampled curve, and report the error.

const sample = (curve: (p: number) => number, n: number) => Array.from({ length: n }, (_, i) => curve(i / (n - 1)));

/** The largest gap between a bezier and the samples, measured here with the public evaluator. */
function maxGap(points: readonly number[], samples: readonly number[]): number {
  const ease = bezier(points[0], points[1], points[2], points[3]);
  return Math.max(...samples.map((y, i) => Math.abs(ease(i / (samples.length - 1)) - y)));
}

describe("fitBezier", () => {
  it("finds the control points of a sampled bezier, with a tiny error", () => {
    const fit = fitBezier(sample(easing("projection"), 120));
    expect(fit.error).toBeLessThan(0.002);
    expect(fit.points[0]).toBeCloseTo(0.22, 1);
    expect(fit.points[1]).toBeCloseTo(1, 1);
    expect(fit.points[2]).toBeCloseTo(0.36, 1);
    expect(fit.points[3]).toBeCloseTo(1, 1);
  });

  it("finds an ease-in-out and an ease-in with a tiny error", () => {
    for (const name of ["ease-in-out", "ease-in", "ease-out", "ease"] as const) {
      expect(fitBezier(sample(easing(name), 100)).error, name).toBeLessThan(0.003);
    }
  });

  it("reports an error equal to the largest gap between the fit and the samples", () => {
    const samples = sample((p) => Math.sin((p * Math.PI) / 2) ** 3, 80);
    const fit = fitBezier(samples);
    expect(fit.error).toBeGreaterThan(0);
    expect(fit.error).toBeCloseTo(maxGap(fit.points, samples), 6);
  });

  it("reports a large error for a curve a bezier cannot match", () => {
    const wiggle = sample((p) => p + 0.2 * Math.sin(p * Math.PI * 6) * (1 - p), 200);
    expect(fitBezier(wiggle).error).toBeGreaterThan(0.05);
  });

  it("reports an error for a solver curve of every preset, and that error is the true gap", () => {
    for (const [name, config] of presets) {
      const { values } = solverSeries(config);
      const fit = fitBezier(values);
      expect(fit.error, name).toBeGreaterThanOrEqual(0);
      expect(fit.error, name).toBeLessThan(0.6);
      expect(fit.error, name).toBeCloseTo(maxGap(fit.points, values), 6);
    }
  });

  it("writes a CSS string that matches the points", () => {
    const fit = fitBezier(sample(easing("ease-out"), 60));
    const [x1, y1, x2, y2] = fit.points;
    expect(fit.css).toBe(bezier(x1, y1, x2, y2).css);
    expect(fit.css.startsWith("cubic-bezier(")).toBe(true);
  });

  it("keeps x1 and x2 inside 0..1, so the CSS is valid", () => {
    for (const [, config] of presets) {
      const fit = fitBezier(solverSeries(config).values);
      expect(fit.points[0]).toBeGreaterThanOrEqual(0);
      expect(fit.points[0]).toBeLessThanOrEqual(1);
      expect(fit.points[2]).toBeGreaterThanOrEqual(0);
      expect(fit.points[2]).toBeLessThanOrEqual(1);
      expect(() => bezier(...(fit.points as [number, number, number, number]))).not.toThrow();
    }
  });

  it("gives the same answer on the same samples", () => {
    const samples = sample(easing("ease"), 50);
    expect(fitBezier(samples)).toEqual(fitBezier(samples));
  });

  it("fits a straight line as the linear curve", () => {
    const fit = fitBezier(sample((p) => p, 50));
    expect(fit.error).toBeLessThan(0.002);
  });

  it("throws a TypeError for fewer than two samples, or a sample that is not finite", () => {
    expect(() => fitBezier([])).toThrow(TypeError);
    expect(() => fitBezier([1])).toThrow(TypeError);
    expect(() => fitBezier([0, Number.NaN, 1])).toThrow(TypeError);
    expect(() => fitBezier(null as unknown as number[])).toThrow(TypeError);
  });
});
