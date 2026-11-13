import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cssFlavor } from "../../src/css";
import { defineFlavor, type Flavor } from "../../src/engine/flavor";
import { glassFlavor } from "../../src/glass";
import { acme } from "../helpers/other-flavor";

// `cssFlavor` writes the variables and the attributes of a flavor as a stylesheet: one `@property` rule for each variable a controller writes,
// and one rule that puts the surface at rest on the surface attribute. Every name goes through an escape, so a flavor cannot inject CSS.

const rest = { restDelta: 0.001, restSpeed: 0.01 };

const ACME = [
  '@property --acme-squeeze { syntax: "<number>"; inherits: false; initial-value: 1; }',
  '@property --acme-bend { syntax: "<number>"; inherits: false; initial-value: 0; }',
  '@property --acme-shine-x { syntax: "<percentage>"; inherits: false; initial-value: 20%; }',
  '@property --acme-shine-y { syntax: "<percentage>"; inherits: false; initial-value: 80%; }',
  '@property --acme-halo { syntax: "<number>"; inherits: false; initial-value: 0; }',
  '@property --acme-bar-x { syntax: "<length>"; inherits: true; initial-value: 0px; }',
  '@property --acme-bar-y { syntax: "<length>"; inherits: true; initial-value: 0px; }',
  '@property --acme-bar-w { syntax: "<length>"; inherits: true; initial-value: 0px; }',
  '@property --acme-bar-h { syntax: "<length>"; inherits: true; initial-value: 0px; }',
  '@property --acme-bar-sx { syntax: "<number>"; inherits: true; initial-value: 1; }',
  '@property --acme-bar-sy { syntax: "<number>"; inherits: true; initial-value: 1; }',
  ":where([data-acme]) {",
  "  --acme-squeeze: 1;",
  "  --acme-bend: 0;",
  "  --acme-shine-x: 20%;",
  "  --acme-shine-y: 80%;",
  "  --acme-halo: 0;",
  "}",
  "",
];

describe("the stylesheet", () => {
  it("writes the surface and lens variables of a flavor, under the names the flavor gives", () => {
    expect(cssFlavor(acme)).toBe(ACME.join("\n"));
  });

  it("writes the followers as numbers that inherit, in the order of the flavor", () => {
    const flavor: Flavor = { ...acme, surface: undefined, lens: undefined, followers: { thumb: { var: "thumb", springKey: "tap", rest }, glow: { var: "glow-size", springKey: "tap", rest } } };
    expect(cssFlavor(flavor)).toBe(
      [
        '@property --acme-thumb { syntax: "<number>"; inherits: true; initial-value: 0; }',
        '@property --acme-glow-size { syntax: "<number>"; inherits: true; initial-value: 0; }',
        "",
      ].join("\n"),
    );
  });

  it("uses the bare data attribute for an empty suffix, and the suffix for another", () => {
    const flavor: Flavor = { ...acme, lens: undefined, surface: { ...acme.surface, attributes: { surface: "press", group: "set", feel: "mood" } } };
    expect(cssFlavor(flavor)).toContain(":where([data-acme-press]) {");
    expect(cssFlavor(acme)).toContain(":where([data-acme]) {");
  });

  it("writes nothing for a flavor with no part that writes a variable", () => {
    expect(cssFlavor({ name: "bare", prefix: "bare", logLabel: "bare", springs: { s: { stiffness: 1, damping: 1 } } })).toBe("");
  });

  it("is the same text for a flavor made with defineFlavor, and on every call", () => {
    expect(cssFlavor(defineFlavor({ ...acme }))).toBe(cssFlavor(acme));
  });

  it("changes with the flavor: another prefix and other defaults give another sheet", () => {
    const other = cssFlavor({ ...acme, prefix: "zed", surface: { ...acme.surface, defaults: { ...acme.surface.defaults, specularRest: { x: 33.33333, y: 0 } } } });
    expect(other).toContain("--zed-squeeze");
    expect(other).toContain("initial-value: 33.3333%;");
    expect(other).not.toContain("acme");
  });

  it("writes no declaration of the property transform, and no vendor-prefixed one", () => {
    const flavor: Flavor = { ...acme, followers: { turn: { var: "transform-x", springKey: "tap", rest } } };
    const css = cssFlavor(flavor);
    expect(css).toContain("--acme-transform-x");
    expect(css).not.toMatch(/(^|[;{\s])(-[a-z]+-)?transform\s*:/i);
  });

  it("writes numbers with no exponent text, and cuts a huge one", () => {
    const flavor: Flavor = { ...acme, surface: { ...acme.surface, defaults: { ...acme.surface.defaults, specularRest: { x: 1e21, y: 1e-9 } } } };
    const css = cssFlavor(flavor);
    expect(css).toContain("initial-value: 1000000000%;");
    expect(css).toContain("initial-value: 0%;");
    expect(css).not.toMatch(/\d[eE][+-]?\d|NaN|Infinity/);
  });
});

describe("a flavor that does not hold together", () => {
  it("throws a TypeError for a flavor that validateFlavor refuses", () => {
    expect(() => cssFlavor({ ...acme, prefix: "Bad Prefix" })).toThrow(TypeError);
    expect(() => cssFlavor({ ...acme, prefix: "a}" })).toThrow(TypeError);
    expect(() => cssFlavor(null as never)).toThrow(TypeError);
    expect(() => cssFlavor(5 as never)).toThrow(TypeError);
  });

  it("throws a TypeError for a surface default that is not a finite number", () => {
    for (const x of [NaN, Infinity, "20" as never, undefined as never]) {
      const flavor: Flavor = { ...acme, surface: { ...acme.surface, defaults: { ...acme.surface.defaults, specularRest: { x, y: 0 } } } };
      expect(() => cssFlavor(flavor), String(x)).toThrow(TypeError);
    }
  });
});

/** The text with every escape, every string, and every comment taken out, so that only the structure is left. */
const structure = (css: string): string =>
  css
    .replace(/\\[0-9a-fA-F]{1,6} ?/g, "_")
    .replace(/\\[^\n]/g, "_")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/\/\*[\s\S]*?\*\//g, "");

describe("injection", () => {
  const evil = "press;}body{display:none}/*";
  const hostile: Flavor = {
    ...acme,
    surface: {
      ...acme.surface,
      vars: { press: evil, flex: "bend</style><script>", specX: "shine-x", specY: "shine-y", glow: "halo" },
      attributes: { surface: "x]{}*{color:red}[y", group: "set", feel: "mood" },
    },
    lens: { ...acme.lens, vars: { x: "bar-x\n}", y: "bar-y", w: "bar-w", h: "bar-h", sx: "bar-sx", sy: "bar-sy" }, readyAttribute: "bar" },
  };

  it("keeps a hostile variable name and attribute name as one name each", () => {
    const css = cssFlavor(hostile);
    expect(css).not.toContain("display:none");
    expect(css).not.toContain("color:red");
    expect(css).toContain("--acme-press\\;\\}body\\{display\\:none\\}\\/\\*");
    expect(css).toContain("[data-acme-x\\]\\{\\}\\*\\{color\\:red\\}\\[y]");
    expect(css).toContain("--acme-bar-x\\a \\}");
  });

  it("leaves the structure of the benign flavor: the same number of rules, and braces only where a rule has them", () => {
    const plain = structure(cssFlavor(acme));
    const css = structure(cssFlavor(hostile));
    expect(css.match(/\{/g)).toHaveLength(plain.match(/\{/g)!.length);
    expect(css.match(/\}/g)).toHaveLength(plain.match(/\}/g)!.length);
    expect(css.split("\n").length).toBe(plain.split("\n").length);
    expect(css.match(/;/g)).toHaveLength(plain.match(/;/g)!.length);
  });

  it("writes no literal less-than sign, whatever the flavor holds", () => {
    expect(cssFlavor(hostile)).toContain("--acme-bend\\3c \\/style\\>\\3c script\\>");
    expect(cssFlavor(hostile)).not.toContain("<script");
    expect(cssFlavor(hostile).replaceAll('"<number>"', "").replaceAll('"<percentage>"', "").replaceAll('"<length>"', "")).not.toContain("<");
  });

  it("refuses a follower variable that validateFlavor refuses", () => {
    const flavor: Flavor = { ...acme, followers: { x: { var: "a}b", springKey: "tap", rest } } };
    expect(() => cssFlavor(flavor)).toThrow(TypeError);
  });

  it("refuses a variable suffix that is not text", () => {
    const flavor: Flavor = { ...acme, surface: { ...acme.surface, vars: { ...acme.surface.vars, press: 5 as never } } };
    expect(() => cssFlavor(flavor)).toThrow(TypeError);
  });
});

// Whether a variable inherits depends on where its controller writes it and where the stylesheet reads it. A variable that is written on an element
// and read on the same element needs no inheritance. One that is written on a parent and read on a child must inherit, or the child sees the initial value.
describe("the inherit flag of each part", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const read = (file: string) => readFileSync(join(root, file), "utf8");
  const styles = read("src/glass/styles.css");
  const inherits = (css: string): Record<string, boolean> =>
    Object.fromEntries([...css.matchAll(/@property (--[\w-]+) \{[^}]*inherits: (true|false)/g)].map((m) => [m[1], m[2] === "true"]));
  const flags = inherits(cssFlavor(glassFlavor));
  /** The selectors of the rules of the stylesheet that read a variable. */
  const readers = (name: string): string[] =>
    [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[2].includes(`var(${name}`)).map((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim());

  it("writes the surface on the element it reads it on, so the surface variables do not inherit", () => {
    const surface = read("src/dom/surface.ts");
    // The writes of the five variables are on `element`, the element of the surface, and not on a parent.
    for (const [call, label] of [["press", "press"], ["flex", "flex"], ["specX", "spec-x"], ["specY", "spec-y"], ["glow", "glow"]]) {
      expect(surface, label).toContain(`setVar(element, varNames.${call},`);
    }
    expect(surface).toMatch(/const setVar = \(target: object, name: string, value: string\) => \{[\s\S]*?env\.setCSSVariable\(target, name, value\)/);
    for (const name of ["press", "flex", "spec-x", "spec-y", "glow"]) {
      expect(new Set(readers(`--lqg-${name}`)), name).toEqual(new Set([".lqg-surface"]));
      expect(flags[`--lqg-${name}`], name).toBe(false);
    }
  });

  it("writes the lens on the row (its container) and reads it on a child, so the lens variables inherit", () => {
    expect(read("src/dom/lens.ts")).toMatch(/env\.setCSSVariable\(options\.container, name, value\)/);
    expect(styles).toMatch(/\[data-lqg-lens="ready"\] \.lqg-lens/);
    for (const name of ["lens-x", "lens-y", "lens-w", "lens-h", "lens-sx", "lens-sy"]) {
      expect(new Set(readers(`--lqg-${name}`)), name).toEqual(new Set([".lqg-lens"]));
      expect(flags[`--lqg-${name}`], name).toBe(true);
    }
  });

  it("writes a follower on the target it is given, and docs/css.md says a stylesheet reads it in descendants, so a follower inherits by design", () => {
    expect(read("src/dom/follower.ts")).toContain("env.setCSSVariable(target, name, next)");
    expect(read("docs/css.md")).toMatch(/follower[^\n]*inherits[^\n]*children/i);
    const flavor: Flavor = { ...acme, followers: { thumb: { var: "thumb", springKey: "tap", rest } } };
    expect(inherits(cssFlavor(flavor))["--acme-thumb"]).toBe(true);
  });
});
