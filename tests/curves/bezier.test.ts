import { describe, expect, it } from "vitest";
import { bezier } from "../../src/curves";

// The cubic-bezier evaluator. A known case is checked against the parametric form, which these tests write out by hand.

/** The point of the curve (0,0) (x1,y1) (x2,y2) (1,1) at parameter t. */
function point(x1: number, y1: number, x2: number, y2: number, t: number): [number, number] {
  const u = 1 - t;
  const at = (a: number, b: number) => 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
  return [at(x1, x2), at(y1, y2)];
}

const known: Array<[string, [number, number, number, number]]> = [
  ["ease", [0.25, 0.1, 0.25, 1]],
  ["ease-in", [0.42, 0, 1, 1]],
  ["ease-out", [0, 0, 0.58, 1]],
  ["ease-in-out", [0.42, 0, 0.58, 1]],
  ["projection", [0.22, 1, 0.36, 1]],
  ["overshoot", [0.34, 1.56, 0.64, 1]],
  ["anticipate", [0.36, -0.5, 0.64, 1.4]],
];

describe("bezier", () => {
  it("matches the parametric curve for known control points", () => {
    for (const [name, [x1, y1, x2, y2]] of known) {
      const ease = bezier(x1, y1, x2, y2);
      for (let i = 1; i < 20; i += 1) {
        const [x, y] = point(x1, y1, x2, y2, i / 20);
        expect(ease(x), `${name} at t=${i / 20}`).toBeCloseTo(y, 5);
      }
    }
  });

  it("is the identity for (0, 0, 1, 1)", () => {
    const ease = bezier(0, 0, 1, 1);
    for (const p of [0, 0.1, 0.25, 0.5, 0.9, 1]) expect(ease(p)).toBeCloseTo(p, 6);
  });

  it("gives 0.5 at the middle of a symmetric ease-in-out", () => {
    expect(bezier(0.42, 0, 0.58, 1)(0.5)).toBeCloseTo(0.5, 6);
  });

  it("gives the CSS ease curve a value of about 0.8024 at 0.5", () => {
    expect(bezier(0.25, 0.1, 0.25, 1)(0.5)).toBeCloseTo(0.8024, 3);
  });

  it("starts exactly on 0 and ends exactly on 1", () => {
    for (const [, [x1, y1, x2, y2]] of known) {
      const ease = bezier(x1, y1, x2, y2);
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
    }
  });

  it("clamps a progress outside 0..1 to the ends", () => {
    const ease = bezier(0.22, 1, 0.36, 1);
    expect(ease(-5)).toBe(0);
    expect(ease(7)).toBe(1);
    expect(ease(Number.POSITIVE_INFINITY)).toBe(1);
    expect(ease(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("returns NaN-free output for a NaN progress by treating it as the start", () => {
    expect(bezier(0.22, 1, 0.36, 1)(Number.NaN)).toBe(0);
  });

  it("rises monotonically when both y values are inside 0..1", () => {
    const ease = bezier(0.22, 1, 0.36, 1);
    let last = -1;
    for (let i = 0; i <= 1000; i += 1) {
      const value = ease(i / 1000);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
  });

  it("goes past 1 for a y above 1, and below 0 for a y below 0", () => {
    const over = bezier(0.34, 1.56, 0.64, 1);
    expect(Math.max(...Array.from({ length: 101 }, (_, i) => over(i / 100)))).toBeGreaterThan(1.05);
    const back = bezier(0.36, -0.5, 0.64, 1.4);
    expect(Math.min(...Array.from({ length: 101 }, (_, i) => back(i / 100)))).toBeLessThan(-0.05);
  });

  it("solves a steep curve whose x slope is near zero at the ends", () => {
    const ease = bezier(0, 1, 1, 0);
    expect(ease(0.5)).toBeCloseTo(0.5, 5);
    expect(Number.isFinite(ease(0.001))).toBe(true);
    expect(Number.isFinite(ease(0.999))).toBe(true);
  });

  it("writes its CSS string", () => {
    expect(bezier(0.22, 1, 0.36, 1).css).toBe("cubic-bezier(0.22, 1, 0.36, 1)");
    expect(bezier(0, 0, 1, 1).css).toBe("cubic-bezier(0, 0, 1, 1)");
    expect(bezier(0.34, 1.56, 0.64, -0.2).css).toBe("cubic-bezier(0.34, 1.56, 0.64, -0.2)");
  });

  it("keeps its control points", () => {
    expect(bezier(0.1, 0.2, 0.3, 0.4).points).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it("throws a TypeError for an x outside 0..1, because CSS rejects it", () => {
    expect(() => bezier(-0.1, 0, 0.5, 1)).toThrow(TypeError);
    expect(() => bezier(0.1, 0, 1.5, 1)).toThrow(TypeError);
  });

  it("throws a TypeError for a value that is not a finite number", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "0.2" as unknown as number, undefined as unknown as number, null as unknown as number]) {
      expect(() => bezier(bad, 0, 0.5, 1)).toThrow(TypeError);
      expect(() => bezier(0.2, bad, 0.5, 1)).toThrow(TypeError);
      expect(() => bezier(0.2, 0, bad, 1)).toThrow(TypeError);
      expect(() => bezier(0.2, 0, 0.5, bad)).toThrow(TypeError);
    }
  });

  it("accepts x values of exactly 0 and exactly 1", () => {
    expect(() => bezier(0, 0, 1, 1)).not.toThrow();
  });
});
