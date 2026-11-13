import { describe, expect, it } from "vitest";
import { cssLinear } from "../../src/css";
import { bezier } from "../../src/curves";
import { toLinear } from "../../src/linear";

// `cssLinear` is the `/linear` exporter behind a string-only name. It holds no sampling of its own, so it must give what `toLinear` gives.

const spring = { stiffness: 170, damping: 26 };

describe("cssLinear", () => {
  it("gives the string of toLinear for a spring", () => {
    expect(cssLinear(spring)).toBe(toLinear(spring));
    expect(cssLinear(spring, { tolerance: 0.01 })).toBe(toLinear(spring, { tolerance: 0.01 }));
  });

  it("gives the string of toLinear for a curve", () => {
    const curve = bezier(0.22, 1, 0.36, 1);
    expect(cssLinear(curve, { duration: 0.4 })).toBe(toLinear(curve, { duration: 0.4 }));
  });

  it("pins the text of a critically damped spring", () => {
    expect(cssLinear({ stiffness: 100, damping: 20 }, { tolerance: 0.05 })).toMatchInlineSnapshot(`"linear(0, 0.6333 21.5517%, 0.8571 35.3448%, 0.9702 56.8966%, 1)"`);
  });

  it("pins the text of an ease-out bezier", () => {
    expect(cssLinear(bezier(0.22, 1, 0.36, 1), { tolerance: 0.05 })).toMatchInlineSnapshot(`"linear(0, 0.5674 15.5%, 0.8558 32.2%, 0.9754 55.4%, 1)"`);
  });

  it("starts with linear(, ends with ), and holds no exponent text and no NaN", () => {
    const text = cssLinear({ stiffness: 400, damping: 5 });
    expect(text).toMatch(/^linear\(.*\)$/);
    expect(text).not.toMatch(/\d[eE][+-]?\d|NaN|Infinity/);
  });

  it("throws what toLinear throws, and does not return a bad string", () => {
    expect(() => cssLinear({ stiffness: 0, damping: 1 })).toThrow(TypeError);
    expect(() => cssLinear({ stiffness: 100, damping: 0 })).toThrow(RangeError);
    expect(() => cssLinear(spring, { tolerance: 0 })).toThrow(RangeError);
  });
});
