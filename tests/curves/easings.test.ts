import { describe, expect, it } from "vitest";
import { bezier, easing, easings } from "../../src/curves";

describe("named easings", () => {
  it("holds the Projection UI curve as data", () => {
    expect(easings.projection).toEqual([0.22, 1, 0.36, 1]);
    expect(easing("projection").css).toBe("cubic-bezier(0.22, 1, 0.36, 1)");
  });

  it("holds the CSS keywords as their standard control points", () => {
    expect(easings.linear).toEqual([0, 0, 1, 1]);
    expect(easings.ease).toEqual([0.25, 0.1, 0.25, 1]);
    expect(easings["ease-in"]).toEqual([0.42, 0, 1, 1]);
    expect(easings["ease-out"]).toEqual([0, 0, 0.58, 1]);
    expect(easings["ease-in-out"]).toEqual([0.42, 0, 0.58, 1]);
  });

  it("is frozen, so a caller cannot change a curve for everyone", () => {
    expect(Object.isFrozen(easings)).toBe(true);
    expect(Object.isFrozen(easings.projection)).toBe(true);
  });

  it("builds an easing by name that matches the same bezier", () => {
    for (const name of Object.keys(easings) as Array<keyof typeof easings>) {
      const [x1, y1, x2, y2] = easings[name];
      const made = easing(name);
      const direct = bezier(x1, y1, x2, y2);
      for (const p of [0, 0.2, 0.5, 0.8, 1]) expect(made(p)).toBe(direct(p));
    }
  });

  it("throws a TypeError that lists the names for an unknown name", () => {
    expect(() => easing("bounce" as never)).toThrow(TypeError);
    expect(() => easing("bounce" as never)).toThrow(/projection/);
  });

  it("does not read a name from the prototype chain", () => {
    expect(() => easing("constructor" as never)).toThrow(TypeError);
    expect(() => easing("__proto__" as never)).toThrow(TypeError);
  });
});
