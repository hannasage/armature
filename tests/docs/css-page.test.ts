import { describe, expect, it } from "vitest";
import { cssFlavor, cssKeyframesFit, cssLinear } from "../../src/css";
import { escapeIdent } from "../../src/css/escape";
import { glassFlavor } from "../../src/glass";
import { blocksOf, checkPage, readDoc, sectionOf } from "../helpers/doc-pages";

// The numbers of docs/css.md, worked out by calling the CSS output. The blocks that show output are compared with real output too.

const page = readDoc("css.md");
const fit = (stepMs?: number, end = 1000) => cssKeyframesFit("probe", { tracks: [{ property: "opacity", keys: [[0, 0], [end, 1]] }], ...(stepMs === undefined ? {} : { stepMs }) });
/** The example of the page: two tracks, a spring step, and a step of 100 ms. */
const example = () =>
  cssKeyframesFit("pop", {
    tracks: [
      { property: "scale", keys: [[0, 0.5], [300, 1, { stiffness: 170, damping: 26 }]] },
      { property: "opacity", keys: [[0, 0], [150, 1]] },
    ],
    stepMs: 100,
  });

checkPage("css.md", [
  {
    text: "The default is 1000/60",
    check: () => {
      // One second at the default step is 60 steps, so 61 stops.
      expect(fit().count).toBe(61);
      expect(fit(1000 / 60).css).toBe(fit().css);
    },
  },
  {
    text: "It is a finite number of 1 or more",
    check: () => {
      expect(() => fit(0.999)).toThrow();
      expect(fit(1, 10).count).toBe(11);
    },
  },
  {
    text: "At most 5,000 stops are written",
    check: () => {
      expect(fit(1, 4999).count).toBe(5000);
      expect(() => fit(1, 5000)).toThrow(/5001 stops/);
    },
  },
  {
    text: "cut at 10 seconds",
    check: () => {
      const result = cssKeyframesFit("ring", { tracks: [{ property: "opacity", keys: [[0, 0], [100, 1, { stiffness: 100, damping: 0 }]] }], stepMs: 100 });
      expect(result.capped).toBe(true);
      expect(Math.round(result.duration / 1000)).toBe(10);
    },
  },
  {
    text: "up to 12 characters",
    check: () => {
      const unit = (text: string) => () => cssKeyframesFit("u", { tracks: [{ property: "width", unit: text, keys: [[0, 0], [10, 1]] }] });
      expect(unit("a".repeat(12))).not.toThrow();
      expect(unit("a".repeat(13))).toThrow(TypeError);
    },
  },
  {
    text: "rounded to 4 places",
    check: () => {
      const seen: number[] = [];
      cssKeyframesFit("r", { tracks: [{ property: "opacity", keys: [[0, 0.123456789], [10, 0.123456789]], format: (value) => (seen.push(value), String(value)) }] });
      expect(new Set(seen)).toEqual(new Set([0.1235]));
    },
  },
  {
    text: "Every number is cut to 1,000,000,000 and written with at most 4 decimals",
    check: () => {
      const big = cssKeyframesFit("b", { tracks: [{ property: "opacity", keys: [[0, 5e9], [10, 0.123456789]] }], stepMs: 10 });
      expect(big.css).toContain("0% { opacity: 1000000000; }");
      expect(big.css).toContain("100% { opacity: 0.1235; }");
    },
  },
  {
    text: "// linear(0, 0.0327 2.1505%, 0.0934 4.3011%, ... 1)",
    check: () => {
      const css = cssLinear({ stiffness: 170, damping: 26 });
      expect(css.startsWith("linear(0, 0.0327 2.1505%, 0.0934 4.3011%, ")).toBe(true);
      expect(css.endsWith(", 1)")).toBe(true);
    },
  },
  {
    text: "animation: pop 709ms linear both",
    check: () => expect(Math.ceil(example().duration)).toBe(709),
  },
  {
    text: "12.5% { scale: 0.6655; opacity: 0.5903; }",
    check: () => {
      // The block on the page leaves out the middle stops. Every line it shows is a line of the real output.
      const shown = blocksOf(page, "css")[0].split("\n").filter((line) => line.trim() !== "" && line.trim() !== "...");
      const real = example().css.split("\n");
      for (const line of shown) expect(real, line).toContain(line);
    },
  },
  {
    text: "@property --lqg-press { syntax: \"<number>\"; inherits: false; initial-value: 1; }",
    check: () => {
      const shown = blocksOf(page, "css")[1].split("\n").filter((line) => line.trim() !== "" && !line.startsWith("..."));
      const real = cssFlavor(glassFlavor).split("\n");
      for (const line of shown) expect(real, line).toContain(line);
    },
  },
  {
    text: "so it never gets a number such as `5.5e-17`",
    check: () => {
      const seen: number[] = [];
      cssKeyframesFit("tiny", { tracks: [{ property: "opacity", keys: [[0, 5.5e-17], [10, 5.5e-17]], format: (value) => (seen.push(value), String(value)) }] });
      expect(new Set(seen)).toEqual(new Set([0]));
    },
  },
  { text: "They write it as `\\3c `", check: () => expect(escapeIdent("a<b")).toBe("a\\3c b") },
]);

describe("docs/baseline.md, section G8 build", () => {
  it("gives the measured duration of the example of docs/css.md", () => {
    expect(sectionOf(readDoc("baseline.md"), "G8 build")).toContain(`a timeline that measures ${example().duration.toFixed(2)} ms`);
  });
});
