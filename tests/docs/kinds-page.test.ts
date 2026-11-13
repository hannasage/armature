import { expect } from "vitest";
import { createSpring } from "../../src/engine/spring";
import { colorKind, pathKind, transform3dKind, transform3dStyles, type Transform3D } from "../../src/values";
import { namedColors } from "../../src/values/color-names";
import { checkPage, readDoc } from "../helpers/doc-pages";

// The numbers of docs/kinds.md, worked out from the kinds themselves.

const DEGREES = 180 / Math.PI;
const t3 = (value: Partial<Transform3D> | Record<string, unknown>) => transform3dKind.parse(value as Transform3D);
/** The rotation angle, in degrees, of a value of the 3D transform kind. */
const angleOf = (value: Transform3D) => {
  const q = transform3dKind.toArray(value).slice(3, 7);
  return 2 * Math.atan2(Math.hypot(q[0], q[1], q[2]), Math.abs(q[3])) * DEGREES;
};
/** The smaller change of a perspective distance d for one rest step of the inverse, 1000 / d. */
const perspectiveStep = (d: number) => {
  const step = transform3dKind.restDelta!;
  return Math.min(Math.abs(1000 / (1000 / d + step) - d), Math.abs(1000 / (1000 / d - step) - d));
};

checkPage("kinds.md", [
  {
    text: "both default to 0.01",
    check: () => {
      const config = createSpring({ stiffness: 100, damping: 10 }).config;
      expect([config.restDelta, config.restSpeed]).toEqual([0.01, 0.01]);
    },
  },
  { text: "The color kind uses 0.0002", check: () => expect(colorKind.restDelta).toBe(0.0002) },
  { text: "the 3D transform kind uses 0.0005", check: () => expect(transform3dKind.restDelta).toBe(0.0005) },
  {
    text: "about 0.06 degrees of rotation, and under 1 px of perspective at 1000 px",
    check: () => {
      // One rest step on a quaternion component turns the rotation by about 2 asin(step).
      const turn = angleOf(transform3dKind.fromArray([0, 0, 0, 0, 0, transform3dKind.restDelta!, 1, 1, 1, 1, 0]));
      expect(Math.round(turn * 100) / 100).toBe(0.06);
      expect(perspectiveStep(1000)).toBeLessThan(1);
    },
  },
  {
    text: "the path kind and the others use 0.01",
    check: () => {
      // The path kind sets no rest distance of its own, so the default of the engine applies.
      expect(pathKind("M 0 0 L 1 1").restDelta).toBeUndefined();
      expect(createSpring({ stiffness: 100, damping: 10 }).config.restDelta).toBe(0.01);
    },
  },
  { text: "the default of the engine, 0.01", check: () => expect(createSpring({ stiffness: 100, damping: 10 }).config.restDelta).toBe(0.01) },
  { text: "for all 11 components", check: () => expect(transform3dKind.toArray(t3({}))).toHaveLength(11) },
  {
    text: "the perspective is moved as 1000 divided by the distance, so at 1000 px a step of 0.0005 is about 0.5 px, and at 5000 px it is about 12 px",
    check: () => {
      expect(transform3dKind.toArray(t3({ perspective: 1000 }))[10]).toBe(1);
      expect(transform3dKind.restDelta).toBe(0.0005);
      expect(Math.round(perspectiveStep(1000) * 10) / 10).toBe(0.5);
      expect(Math.round(perspectiveStep(5000))).toBe(12);
    },
  },
  {
    text: "The path kind rests at 0.01 of a coordinate unit. On a unit viewBox that is 1% of the box",
    check: () => {
      expect(pathKind("M 0 0 L 1 1").restDelta).toBeUndefined();
      expect(createSpring({ stiffness: 100, damping: 10 }).config.restDelta * 100).toBe(1);
    },
  },
  { text: "the 148 CSS color names", check: () => expect(Object.keys(namedColors())).toHaveLength(148) },
  {
    text: "so hsl(350) to hsl(10) goes through red and not through cyan",
    check: () => {
      const middle = colorKind.interpolate(colorKind.parse("hsl(350 80% 50%)"), colorKind.parse("hsl(10 80% 50%)"), 0.5);
      const [r, g, b] = [1, 3, 5].map((at) => parseInt(middle.slice(at, at + 2), 16));
      expect(r).toBeGreaterThan(g + 100);
      expect(r).toBeGreaterThan(b + 100);
    },
  },
  {
    text: "round to 6 decimals",
    check: () => {
      const kind = pathKind("M 0 0 L 1 1");
      expect(kind.serialize(kind.parse("M 0.123456789 0 L 1 1"))).toBe("M 0.123457 0 L 1 1");
      expect(kind.toArray(kind.parse("M 0.123456789 0 L 1 1"))[0]).toBe(0.123456789);
    },
  },
  {
    text: "So a turn from 10 degrees to 350 degrees goes 20 degrees backward, and not 340 degrees forward.",
    check: () => {
      const from = t3({ rotate: { axis: [0, 0, 1], angle: 10 } });
      const to = t3({ rotate: { axis: [0, 0, 1], angle: 350 } });
      // Halfway along the short way is 0 degrees. The long way would pass 180.
      expect(angleOf(transform3dKind.interpolate(from, to, 0.5))).toBeCloseTo(0, 6);
      expect(angleOf(from) + angleOf(to)).toBeCloseTo(20, 6);
    },
  },
  {
    text: "a turn of more than 180 degrees is written as the short turn the other way",
    check: () => expect(angleOf(t3({ rotate: { axis: [0, 0, 1], angle: 270 } }))).toBeCloseTo(90, 6),
  },
  {
    text: "A full turn (0 to 360 or 720 degrees) is the same rotation, so it does not move.",
    check: () => {
      const still = transform3dKind.toArray(t3({}));
      for (const angle of [360, 720]) {
        const turned = transform3dKind.align!(still, transform3dKind.toArray(t3({ rotate: { axis: [0, 0, 1], angle } })));
        turned.forEach((n, i) => expect(n, `${angle} part ${i}`).toBeCloseTo(still[i], 9));
      }
    },
  },
  {
    text: "The perspective blends as its inverse (1000 divided by the distance). A change from none to 500px",
    check: () => {
      expect(transform3dKind.toArray(t3({ perspective: 500 }))[10]).toBe(2);
      expect(transform3dKind.toArray(t3({}))[10]).toBe(0);
      const middle = transform3dKind.interpolate(t3({}), t3({ perspective: 500 }), 0.5);
      expect(middle.perspective).toBe(1000);
    },
  },
  { text: "color: 4 numbers", check: () => expect(colorKind.toArray(colorKind.parse("red"))).toHaveLength(4) },
  {
    text: "3D transform: 11 numbers. Translation (3), a quaternion (4), scale (3), and the inverse perspective (1).",
    check: () => {
      const parts = transform3dKind.toArray(t3({ translate: [1, 2, 3], rotate: { axis: [0, 0, 1], angle: 90 }, scale: [4, 5, 6], perspective: 500 }));
      expect(parts).toHaveLength(11);
      expect(parts.slice(0, 3)).toEqual([1, 2, 3]);
      expect(Math.hypot(...parts.slice(3, 7))).toBeCloseTo(1, 9);
      expect(parts.slice(7, 10)).toEqual([4, 5, 6]);
      expect(parts[10]).toBe(2);
    },
  },
  {
    text: "`pathKind(template, { restDelta: 0.0001 })`",
    check: () => expect(pathKind("M 0 0 L 1 1", { restDelta: 0.0001 }).restDelta).toBe(0.0001),
  },
  {
    text: '`parse("rgb(51 102 153)")` is `"#336699"`',
    check: () => expect(colorKind.parse("rgb(51 102 153)")).toBe("#336699"),
  },
  {
    text: "implicit repeats (`M 0 0 10 10`), compact numbers (`M0-1.5.5.5`)",
    check: () => {
      const repeats = pathKind("M 0 0 L 10 10");
      expect(repeats.serialize(repeats.parse("M 0 0 10 10"))).toBe("M 0 0 L 10 10");
      const compact = pathKind("M 0 -1.5 L 0.5 0.5");
      expect(compact.serialize(compact.parse("M0-1.5.5.5"))).toBe("M 0 -1.5 L 0.5 0.5");
    },
  },
  {
    text: "as `perspective: 800px` or `none`",
    check: () => {
      expect(transform3dStyles(t3({ perspective: 800 })).parent.perspective).toBe("800px");
      expect(transform3dStyles(t3({})).parent.perspective).toBe("none");
    },
  },
  {
    text: "translate: 10px 20px 30px; rotate: 0 0 1 45deg; scale: 1 1 1",
    check: () => {
      // The block on the page that shows what the kind writes.
      expect(readDoc("kinds.md")).toContain("```\ntranslate: 10px 20px 30px; rotate: 0 0 1 45deg; scale: 1 1 1\n```");
      expect(transform3dKind.serialize(t3({ translate: [10, 20, 30], rotate: { axis: [0, 0, 1], angle: 45 } }))).toBe("translate: 10px 20px 30px; rotate: 0 0 1 45deg; scale: 1 1 1");
    },
  },
]);
