import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bezier, easing, easings, type EasingName } from "../../src/curves";
import { fitLinear, toEasing, toLinear } from "../../src/linear";
import { checkPage, readDoc, root } from "../helpers/doc-pages";
import { figure, sampleCurve } from "../helpers/doc-svg";

// The numbers of docs/curves.md, worked out from the evaluator, the exporter, and the fitting aid. The figure of the named easings is drawn
// from the evaluator's own samples, and docs/figures/easings.svg must be that drawing.

const spring = { stiffness: 170, damping: 26 };
const bouncy = { stiffness: 170, damping: 12 };
const four = (n: number) => n.toFixed(4);

/** The table of the page, built from the easings. */
const table = (): string =>
  (Object.keys(easings) as EasingName[])
    .map((name) => {
      const curve = easing(name);
      return `| \`${name}\` | \`${easings[name].join(", ")}\` | ${four(curve(0.25))} | ${four(curve(0.5))} |`;
    })
    .join("\n");

checkPage("curves.md", [
  { text: table(), check: () => expect(Object.keys(easings)).toHaveLength(6) },
  {
    text: "- For the spring `{ stiffness: 170, damping: 26 }`, the best bezier is off by 0.0177 at most.",
    check: () => expect(four(toEasing(spring, { supports: () => false }).error)).toBe("0.0177"),
  },
  {
    text: "For the bouncier spring `{ stiffness: 170, damping: 12 }`, it is off by 0.0723.",
    check: () => expect(four(toEasing(bouncy, { supports: () => false }).error)).toBe("0.0723"),
  },
  {
    text: "Both are above the default tolerance, so `toEasing` marks both results `degraded`.",
    check: () => {
      for (const source of [spring, bouncy]) expect(toEasing(source, { supports: () => false }).degraded).toBe(true);
    },
  },
  {
    text: "The default is 0.005. The smallest allowed is 0.0005, because the stops are written with 4 decimals.",
    check: () => {
      expect(fitLinear(spring).error).toBeLessThanOrEqual(0.005);
      expect(fitLinear(spring, { tolerance: 0.005 }).css).toBe(fitLinear(spring).css);
      expect(() => toLinear(spring, { tolerance: 0.0004 })).toThrow(RangeError);
      expect(() => toLinear(spring, { tolerance: 0.0005 })).not.toThrow();
      const decimals = [...toLinear(spring).matchAll(/\d+\.(\d+)/g)].map((match) => match[1].length);
      expect(Math.max(...decimals)).toBe(4);
    },
  },
  {
    text: "A spring that has not rested after 10 seconds throws a `RangeError`",
    check: () => {
      expect(() => toLinear({ stiffness: 100, damping: 0 })).toThrow(RangeError);
      expect(toEasing({ stiffness: 100, damping: 0 }).truncated).toBe(true);
      // A slow spring that rests just inside 10 seconds is still written.
      expect(() => toLinear({ stiffness: 1, damping: 2 })).not.toThrow();
    },
  },
  {
    text: "For the spring `{ stiffness: 170, damping: 26 }`:\n\n- At the default tolerance it needs 15 stops. It rests in 775 ms, and the largest error is 0.0045.",
    check: () => {
      const fit = fitLinear(spring);
      expect([fit.count, Math.round(fit.duration * 1000), four(fit.error)]).toEqual([15, 775, "0.0045"]);
    },
  },
  { text: "At a tolerance of 0.001 it needs 34 stops.", check: () => expect(fitLinear(spring, { tolerance: 0.001 }).count).toBe(34) },
  {
    text: 'toLinear({ stiffness: 170, damping: 26 }); // "linear(0, 0.0327 2.1505%, ... 1)"',
    check: () => {
      const css = toLinear(spring);
      expect(css.startsWith("linear(0, 0.0327 2.1505%, ")).toBe(true);
      expect(css.endsWith(", 1)")).toBe(true);
    },
  },
  { text: 'out.css; // "cubic-bezier(0, 0, 0.58, 1)"', check: () => expect(easing("ease-out").css).toBe("cubic-bezier(0, 0, 0.58, 1)") },
]);

describe("docs/figures/easings.svg", () => {
  it("is the drawing of the six named easings from their own samples, and the page links it", async () => {
    // The file must exist, so a run that could write a new snapshot cannot pass on a file it made itself.
    expect(existsSync(join(root, "docs/figures/easings.svg"))).toBe(true);
    expect(readDoc("curves.md")).toMatch(/!\[[^\]]+\]\(figures\/easings\.svg\)/);
    const svg = figure((Object.keys(easings) as EasingName[]).map((name) => ({ title: name, points: sampleCurve(bezier(...easings[name])) })));
    await expect(svg).toMatchFileSnapshot("../../docs/figures/easings.svg");
  });
});
