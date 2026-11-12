import { describe, expect, it } from "vitest";
import { transform3dKind, transform3dStyles, type Transform3D } from "../../src/values";

// The 3D transform kind. A value is a translation, a rotation about an axis, a scale, and a perspective. The kind springs and tweens a
// quaternion, so a rotation takes the short way. It writes only the individual properties `translate`, `rotate`, and `scale`.
// The perspective belongs on the parent.

const kind = transform3dKind;
const identity: Transform3D = { translate: [0, 0, 0], rotate: { axis: [0, 0, 1], angle: 0 }, scale: [1, 1, 1], perspective: 0 };
const spin = (axis: [number, number, number], angle: number): Transform3D => kind.parse({ rotate: { axis, angle } });
/** The quaternion part of a value: the components 3 to 6 of toArray. */
const quaternion = (value: Transform3D) => kind.toArray(value).slice(3, 7);
/** The signed angle about z, in degrees, in (-180, 180]. */
const signedZ = (value: Transform3D): number => {
  const raw = value.rotate.angle * Math.sign(value.rotate.axis[2] || 1);
  return ((((raw + 180) % 360) + 360) % 360) - 180 || 180;
};

describe("the 3D transform kind: parse", () => {
  it("has a name", () => {
    expect(kind.name).toBe("transform3d");
  });

  it("fills every missing part with the identity", () => {
    expect(kind.parse({})).toEqual(identity);
    expect(kind.parse({ translate: [1, 2, 3] })).toEqual({ ...identity, translate: [1, 2, 3] });
    expect(kind.parse({ scale: 2 })).toEqual({ ...identity, scale: [2, 2, 2] });
    expect(kind.parse({ scale: [1, 2, 3] }).scale).toEqual([1, 2, 3]);
    expect(kind.parse({ perspective: 500 }).perspective).toBe(500);
  });

  it("normalizes the rotation axis, and copies its input", () => {
    const input = { translate: [1, 2, 3], rotate: { axis: [0, 3, 4], angle: 90 } };
    const value = kind.parse(input);
    expect(value.rotate.axis[0]).toBeCloseTo(0, 12);
    expect(value.rotate.axis[1]).toBeCloseTo(0.6, 12);
    expect(value.rotate.axis[2]).toBeCloseTo(0.8, 12);
    expect(value.rotate.angle).toBe(90);
    expect(value.translate).not.toBe(input.translate);
    expect(input.rotate.axis).toEqual([0, 3, 4]);
  });

  it("parses a value it made, to the same value", () => {
    const value = kind.parse({ translate: [1, -2, 3], rotate: { axis: [1, 1, 0], angle: 33 }, scale: [1, 2, -3], perspective: 800 });
    expect(kind.parse(value)).toEqual(value);
  });

  it("ignores the axis of a zero angle", () => {
    expect(kind.parse({ rotate: { axis: [0, 0, 0], angle: 0 } }).rotate).toEqual({ axis: [0, 0, 1], angle: 0 });
  });

  it("rejects a value it cannot write, with a TypeError", () => {
    const bad: unknown[] = [
      null, undefined, 5, "translate", [1, 2, 3],
      { translate: [1, 2] }, { translate: [1, 2, NaN] }, { translate: "1px" }, { translate: [1, 2, Infinity] },
      { scale: [1, 2] }, { scale: NaN }, { scale: [1, 2, "3"] },
      { rotate: { axis: [0, 0, 0], angle: 30 } }, { rotate: { axis: [0, 0, 1] } }, { rotate: { axis: [0, 0, 1], angle: NaN } },
      { rotate: { axis: [0, 1], angle: 3 } }, { rotate: 45 }, { rotate: null },
      { perspective: -1 }, { perspective: NaN }, { perspective: "500px" },
    ];
    for (const input of bad) expect(() => kind.parse(input), JSON.stringify(input)).toThrow(TypeError);
  });

  it("rejects the parts a 3D transform does not hold, such as a transform string, a matrix, or a skew", () => {
    for (const key of ["transform", "matrix", "skew", "origin"]) expect(() => kind.parse({ [key]: 1 }), key).toThrow(/translate, rotate, scale, and perspective/);
  });
});

describe("the 3D transform kind: serialize", () => {
  it("writes the three individual properties, and nothing else", () => {
    const value = kind.parse({ translate: [10, 20, 30], rotate: { axis: [0, 0, 1], angle: 45 }, scale: [1, 2, 3] });
    expect(kind.serialize(value)).toBe("translate: 10px 20px 30px; rotate: 0 0 1 45deg; scale: 1 2 3");
  });

  it("keeps at most 4 decimals", () => {
    expect(kind.serialize(kind.parse({ translate: [1 / 3, 0, 0] }))).toContain("translate: 0.3333px 0px 0px");
  });

  it("splits the styles: translate, rotate, and scale for the element, and the perspective for its parent", () => {
    const value = kind.parse({ translate: [1, 2, 3], rotate: { axis: [1, 0, 0], angle: 30 }, perspective: 500 });
    expect(transform3dStyles(value)).toEqual({
      element: { translate: "1px 2px 3px", rotate: "1 0 0 30deg", scale: "1 1 1" },
      parent: { perspective: "500px" },
    });
    expect(transform3dStyles(identity).parent).toEqual({ perspective: "none" });
  });

  it("writes no transform, no matrix, and no CSS function, for any value", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 400;
    for (let i = 0; i < 100; i += 1) {
      const value = kind.parse({ translate: [rand(), rand(), rand()], rotate: { axis: [rand(), rand(), rand()], angle: Math.abs(rand()) }, scale: [rand() / 100, 1, 2], perspective: Math.abs(rand()) });
      const styles = transform3dStyles(value);
      expect(Object.keys(styles)).toEqual(["element", "parent"]);
      expect(Object.keys(styles.element)).toEqual(["translate", "rotate", "scale"]);
      expect(Object.keys(styles.parent)).toEqual(["perspective"]);
      const text = `${kind.serialize(value)} ${JSON.stringify(styles)}`;
      expect(text).not.toMatch(/transform|matrix|translate3d|rotate3d|scale3d|perspective\(|rotateX|rotateY|rotateZ|skew/i);
      expect(Object.keys(styles.element).concat(Object.keys(styles.parent))).not.toContain("transform");
      expect(kind.serialize(value)).not.toContain("perspective");
    }
  });
});

describe("the 3D transform kind: components and round trips", () => {
  it("splits into 11 components: translation, a unit quaternion, scale, and the inverse perspective", () => {
    const parts = kind.toArray(kind.parse({ translate: [1, 2, 3], rotate: { axis: [0, 1, 0], angle: 90 }, scale: [4, 5, 6], perspective: 500 }));
    expect(parts).toHaveLength(11);
    expect(parts.slice(0, 3)).toEqual([1, 2, 3]);
    expect(parts[3]).toBeCloseTo(0, 12);
    expect(parts[4]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(parts[5]).toBeCloseTo(0, 12);
    expect(parts[6]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(parts.slice(7, 10)).toEqual([4, 5, 6]);
    expect(parts[10]).toBe(2);
    expect(kind.toArray(identity)[10]).toBe(0);
  });

  it("joins the components back to the value they came from, for angles from 0 to 360", () => {
    const values = [
      kind.parse({ translate: [5, -6, 7], scale: [2, 3, 4], perspective: 400 }),
      spin([1, 0, 0], 30), spin([0, 1, 0], 135), spin([0, 0, 1], 270), spin([1, 2, 3], 359), spin([-1, 1, 0], 180),
    ];
    for (const value of values) {
      const back = kind.fromArray(kind.toArray(value));
      expect(back.translate).toEqual(value.translate);
      expect(back.scale).toEqual(value.scale);
      expect(back.perspective).toBeCloseTo(value.perspective, 9);
      expect(back.rotate.angle).toBeCloseTo(value.rotate.angle, 9);
      value.rotate.axis.forEach((n, i) => expect(back.rotate.axis[i]).toBeCloseTo(n, 9));
    }
  });

  it("gives the identity for a rotation that is zero or has no length, and never NaN", () => {
    expect(kind.fromArray([0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0]).rotate).toEqual({ axis: [0, 0, 1], angle: 0 });
    expect(kind.fromArray([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0]).rotate.angle).toBe(0);
    const velocity = kind.fromArray(new Array(11).fill(0));
    expect(JSON.stringify(velocity)).not.toMatch(/null|NaN/);
    expect(kind.fromArray([0, 0, 0, 0.3, 0.4, 0, 0.5, 1, 1, 1, -3]).perspective).toBe(0);
  });

  it("keeps a perspective of none at 0, and does not turn a far perspective into none", () => {
    expect(kind.fromArray(kind.toArray(kind.parse({ perspective: 0 }))).perspective).toBe(0);
    expect(kind.fromArray(kind.toArray(kind.parse({ perspective: 100000 }))).perspective).toBeCloseTo(100000, 3);
  });
});

describe("the 3D transform kind: interpolate", () => {
  it("lands exactly on both ends", () => {
    const a = kind.parse({ translate: [1, 2, 3], scale: 2 });
    const b = kind.parse({ translate: [4, 5, 6], rotate: { axis: [0, 1, 0], angle: 90 }, scale: [3, 3, 3], perspective: 500 });
    expect(kind.interpolate(a, b, 0)).toEqual(a);
    const end = kind.interpolate(a, b, 1);
    expect(end.translate).toEqual(b.translate);
    expect(end.scale).toEqual(b.scale);
    expect(end.rotate.angle).toBeCloseTo(90, 9);
    expect(end.perspective).toBeCloseTo(500, 9);
  });

  it("blends translation and scale in a straight line", () => {
    const mid = kind.interpolate(kind.parse({ translate: [0, 10, -20], scale: [1, 2, 3] }), kind.parse({ translate: [10, 20, 0], scale: [3, 4, 5] }), 0.5);
    expect(mid.translate).toEqual([5, 15, -10]);
    expect(mid.scale).toEqual([2, 3, 4]);
  });

  it("turns at a steady rate about one axis", () => {
    const quarter = kind.interpolate(spin([0, 0, 1], 0), spin([0, 0, 1], 90), 0.25);
    expect(quarter.rotate.angle).toBeCloseTo(22.5, 9);
    expect(kind.interpolate(spin([1, 0, 0], 0), spin([0, 1, 0], 90), 0).rotate.angle).toBeCloseTo(0, 9);
  });

  it("takes the short way: 10 to 350 degrees passes through 0, not through 180", () => {
    const mid = kind.interpolate(spin([0, 0, 1], 10), spin([0, 0, 1], 350), 0.5);
    expect(Math.abs(signedZ(mid))).toBeLessThan(1e-6);
    const near = kind.interpolate(spin([0, 0, 1], 10), spin([0, 0, 1], 350), 0.25);
    expect(signedZ(near)).toBeCloseTo(5, 6);
  });

  it("takes the short way when the two quaternions sit on opposite sides of the sphere", () => {
    // 170 degrees about +z, then 170 degrees about -z (which is 190 about +z). The short way is 20 degrees through 180.
    const from = spin([0, 0, 1], 170);
    const to = spin([0, 0, -1], 170);
    expect(quaternion(from)[2] * quaternion(to)[2] + quaternion(from)[3] * quaternion(to)[3]).toBeLessThan(0);
    const mid = kind.interpolate(from, to, 0.5);
    expect(Math.abs(quaternion(mid)[3])).toBeLessThan(1e-9);
    expect(Math.abs(quaternion(mid)[2])).toBeCloseTo(1, 9);
    const early = kind.interpolate(from, to, 0.25);
    expect(Math.abs(signedZ(early))).toBeCloseTo(175, 6);
  });

  it("does not flip a gimbal: a turn of 90 degrees about y, then up to 180 about x, stays smooth", () => {
    const from = spin([0, 1, 0], 90);
    const to = spin([1, 0, 0], 180);
    let last = quaternion(from);
    for (let i = 1; i <= 50; i += 1) {
      const next = quaternion(kind.interpolate(from, to, i / 50));
      const dot = last.reduce((sum, n, j) => sum + n * next[j], 0);
      expect(Math.abs(dot), `step ${i}`).toBeGreaterThan(0.99);
      last = next;
    }
  });

  it("blends the perspective as its inverse, so none to 500 does not pass through a tiny distance", () => {
    expect(kind.interpolate(identity, kind.parse({ perspective: 500 }), 0.5).perspective).toBeCloseTo(1000, 6);
    expect(kind.interpolate(kind.parse({ perspective: 500 }), kind.parse({ perspective: 500 }), 0.3).perspective).toBeCloseTo(500, 9);
    expect(kind.interpolate(identity, identity, 0.5).perspective).toBe(0);
  });
});

describe("the 3D transform kind: align and distance", () => {
  it("flips the target quaternion when it sits on the far side of the current one, and leaves the rest", () => {
    const from = kind.toArray(spin([0, 0, 1], 170));
    const to = kind.toArray(spin([0, 0, -1], 170));
    const aligned = kind.align!(from, to);
    expect(aligned).not.toBe(to);
    expect(aligned.slice(3, 7)).toEqual(to.slice(3, 7).map((n) => -n));
    expect([...aligned.slice(0, 3), ...aligned.slice(7)]).toEqual([...to.slice(0, 3), ...to.slice(7)]);
    const near = kind.toArray(spin([0, 0, 1], 160));
    expect(kind.align!(from, near)).toEqual(near);
  });

  it("measures distance: zero for the same value, symmetric, and the same for two names of one rotation", () => {
    const a = kind.parse({ translate: [3, 0, 0] });
    expect(kind.distance(a, a)).toBe(0);
    expect(kind.distance(a, identity)).toBeCloseTo(3, 9);
    expect(kind.distance(a, identity)).toBe(kind.distance(identity, a));
    expect(kind.distance(spin([0, 0, 1], 170), spin([0, 0, -1], 170))).toBeLessThan(0.5);
    expect(kind.distance(spin([0, 0, 1], 0), spin([0, 0, 1], 360))).toBeCloseTo(0, 9);
  });
});
