import { describe, expect, it } from "vitest";
import { colorKind, transform3dKind, transform3dStyles, type Transform3D } from "../../src/values";
import { namedColors } from "../../src/values/color-names";

// Review round 1: no NaN is ever written, every method of a kind validates, and the edge cases of overshoot and of a full turn.

const t3 = transform3dKind;
const spin = (axis: [number, number, number], angle: number): Transform3D => t3.parse({ rotate: { axis, angle } });
const base = (): Transform3D => t3.parse({});
const broken: Array<[string, Transform3D]> = [
  ["translate NaN", { ...base(), translate: [NaN, 0, 0] }],
  ["translate Infinity", { ...base(), translate: [0, Infinity, 0] }],
  ["scale NaN", { ...base(), scale: [1, NaN, 1] }],
  ["perspective -1", { ...base(), perspective: -1 }],
  ["perspective NaN", { ...base(), perspective: NaN }],
  ["a zero axis with an angle", { ...base(), rotate: { axis: [0, 0, 0], angle: 30 } }],
  ["an angle NaN", { ...base(), rotate: { axis: [0, 0, 1], angle: NaN } }],
];

describe("the color kind never writes NaN", () => {
  it("throws a TypeError for parts that are short or not finite", () => {
    for (const parts of [[NaN, 0, 0, 1], [0.5, Infinity, 0, 1], [0.5, 0, 0], [], [0.5, 0, 0, NaN], [0.5, 0, 0, undefined as unknown as number]]) {
      expect(() => colorKind.fromArray(parts), JSON.stringify(parts)).toThrow(TypeError);
    }
  });

  it("throws a TypeError for a progress that is not finite", () => {
    for (const p of [NaN, Infinity, -Infinity]) expect(() => colorKind.interpolate("#000", "#fff", p), String(p)).toThrow(TypeError);
  });

  it("clamps the premultiplied parts with the alpha: an alpha over 1 does not brighten the color", () => {
    expect(colorKind.fromArray([0.6, 0, 0, 1.2])).toBe(colorKind.fromArray([0.5, 0, 0, 1]));
  });

  it("short-circuits only at exactly 0 and 1, so an easing overshoot extrapolates", () => {
    const a = colorKind.toArray("#336699");
    const b = colorKind.toArray("#cc3300");
    const over = colorKind.fromArray(a.map((n, i) => n + (b[i] - n) * 1.2));
    expect(colorKind.interpolate("#336699", "#cc3300", 1.2)).toBe(over);
    expect(over).not.toBe("#cc3300");
    expect(colorKind.interpolate("#336699", "#cc3300", 1)).toBe("#cc3300");
    expect(colorKind.interpolate("#336699", "#cc3300", -0.2)).toBe(colorKind.fromArray(a.map((n, i) => n + (b[i] - n) * -0.2)));
    expect(colorKind.interpolate("#000", "#fff", -0.2)).toBe("#000000");
  });

  it("freezes the table of color names", () => {
    expect(Object.isFrozen(namedColors())).toBe(true);
    expect(namedColors().constructor).toBeUndefined();
  });
});

describe("the 3D transform kind validates in every method", () => {
  it("throws a TypeError for components of the wrong length or not finite, and never turns NaN into the identity", () => {
    const ok = t3.toArray(base());
    for (const parts of [ok.slice(1), [...ok, 0], [], ok.map((n, i) => (i === 4 ? NaN : n)), ok.map((n, i) => (i === 0 ? Infinity : n)), ok.map((n, i) => (i === 10 ? NaN : n)), ok.map((n, i) => (i === 8 ? NaN : n))]) {
      expect(() => t3.fromArray(parts), JSON.stringify(parts)).toThrow(TypeError);
    }
    for (const p of [NaN, Infinity]) expect(() => t3.interpolate(base(), spin([0, 0, 1], 90), p), String(p)).toThrow(TypeError);
  });

  it.each(broken)("rejects %s in toArray, serialize, transform3dStyles, distance, and interpolate", (_name, value) => {
    expect(() => t3.toArray(value)).toThrow(TypeError);
    expect(() => t3.serialize(value)).toThrow(TypeError);
    expect(() => transform3dStyles(value)).toThrow(TypeError);
    expect(() => t3.distance(value, base())).toThrow(TypeError);
    expect(() => t3.distance(base(), value)).toThrow(TypeError);
    expect(() => t3.interpolate(value, base(), 0.5)).toThrow(TypeError);
    expect(() => t3.interpolate(base(), value, 0.5)).toThrow(TypeError);
  });

  it("normalizes an axis that is not unit length, in toArray", () => {
    const loose: Transform3D = { ...base(), rotate: { axis: [0, 0, 2], angle: 90 } };
    const parts = t3.toArray(loose);
    expect(parts.slice(3, 7)).toEqual(t3.toArray(spin([0, 0, 1], 90)).slice(3, 7));
    expect(Math.hypot(...parts.slice(3, 7))).toBeCloseTo(1, 12);
    expect(transform3dStyles(loose).element.rotate).toBe("0 0 1 90deg");
  });

  it("gives an angle of 0 for the identity rotation written with w = -1, and not 360", () => {
    expect(t3.fromArray([0, 0, 0, 0, 0, 0, -1, 1, 1, 1, 0]).rotate).toEqual({ axis: [0, 0, 1], angle: 0 });
  });

  it("measures a quaternion and its negative as the same rotation", () => {
    expect(t3.distance(spin([0, 0, 1], 90), spin([0, 0, -1], 270))).toBeCloseTo(0, 9);
    expect(t3.distance(spin([1, 2, 3], 40), spin([-1, -2, -3], 320))).toBeCloseTo(0, 9);
  });

  it("extrapolates a rotation outside 0 to 1 along the same arc", () => {
    const over = t3.interpolate(spin([0, 0, 1], 0), spin([0, 0, 1], 90), 1.5);
    expect(over.rotate.angle).toBeCloseTo(135, 6);
    expect(over.rotate.axis[2]).toBeCloseTo(1, 9);
    const under = t3.interpolate(spin([0, 0, 1], 0), spin([0, 0, 1], 90), -0.5);
    expect(under.rotate.angle).toBeCloseTo(45, 6);
    expect(under.rotate.axis[2]).toBeCloseTo(-1, 9);
  });

  it("treats a full turn as no turn under align, and serialize drops the perspective", () => {
    expect(t3.distance(spin([0, 0, 1], 0), spin([0, 0, 1], 360))).toBeCloseTo(0, 9);
    expect(t3.distance(spin([0, 0, 1], 0), spin([0, 0, 1], 720))).toBeCloseTo(0, 9);
    const mid = t3.interpolate(spin([0, 0, 1], 0), spin([0, 0, 1], 360), 0.5);
    expect(mid.rotate.angle).toBeCloseTo(0, 6);
    expect(t3.serialize(t3.parse({ perspective: 500 }))).not.toContain("perspective");
  });
});
