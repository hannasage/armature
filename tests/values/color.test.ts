import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { colorKind } from "../../src/values";
import { namedColors } from "../../src/values/color-names";

// The color kind. A color value is a CSS color string. The kind blends in OKLab, a perceptual space, and writes `#rrggbb` or `#rrggbbaa`.

// The reference route of the CSS Color 4 sample code: sRGB to linear light, to XYZ (D65), to LMS, a cube root, then to OKLab.
const XYZ = [[506752 / 1228815, 87881 / 245763, 12673 / 70218], [87098 / 409605, 175762 / 245763, 12673 / 175545], [7918 / 409605, 87881 / 737289, 1001167 / 1053270]];
const TO_LMS = [[0.819022437996703, 0.3619062600528904, -0.1288737815209879], [0.0329836539323885, 0.9292868615863434, 0.0361446663506424], [0.0481771893596242, 0.2642395317527308, 0.6335478284694309]];
const TO_LAB = [[0.210454268309314, 0.7936177747023054, -0.0040720430116193], [1.9779985324311684, -2.42859224204858, 0.450593709617411], [0.0259040424655478, 0.7827717124575296, -0.8086757549230774]];
const mul = (m: number[][], v: number[]) => m.map((row) => row.reduce((sum, n, i) => sum + n * v[i], 0));
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const oklab = (r: number, g: number, b: number) => mul(TO_LAB, mul(TO_LMS, mul(XYZ, [r, g, b].map((c) => linear(c / 255)))).map(Math.cbrt));

const channels = (css: string): number[] => {
  const hex = colorKind.parse(css).slice(1);
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
};
/** The hue of an sRGB color, in degrees, from the HSL formula. */
const hueOf = (css: string): number => {
  const [r, g, b] = channels(css).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};
const gap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

describe("the color kind: parse", () => {
  it("has a name", () => {
    expect(colorKind.name).toBe("color");
  });

  it("reads hex in 3, 4, 6, and 8 digits, in any case", () => {
    expect(colorKind.parse("#369")).toBe("#336699");
    expect(colorKind.parse("#3698")).toBe("#33669988");
    expect(colorKind.parse("#336699")).toBe("#336699");
    expect(colorKind.parse("#336699CC")).toBe("#336699cc");
    expect(colorKind.parse("  #ABCDEF  ")).toBe("#abcdef");
    expect(colorKind.parse("#336699ff")).toBe("#336699");
  });

  it("reads rgb() and rgba(), with commas or spaces, numbers or percents, and an alpha", () => {
    expect(colorKind.parse("rgb(51, 102, 153)")).toBe("#336699");
    expect(colorKind.parse("rgb(51 102 153)")).toBe("#336699");
    expect(colorKind.parse("RGB(51 102 153)")).toBe("#336699");
    expect(colorKind.parse("rgba(51, 102, 153, 0.5)")).toBe("#33669980");
    expect(colorKind.parse("rgb(51 102 153 / 50%)")).toBe("#33669980");
    expect(colorKind.parse("rgb(100% 0% 0%)")).toBe("#ff0000");
    expect(colorKind.parse("rgb(20% 40% 60%)")).toBe("#336699");
    expect(colorKind.parse("rgb(50.6 0 0)")).toBe("#330000");
    expect(colorKind.parse("rgb(300 -5 0)")).toBe("#ff0000");
  });

  it("reads hsl() and hsla(), with units, wrapping hues, and an alpha", () => {
    expect(colorKind.parse("hsl(0 100% 50%)")).toBe("#ff0000");
    expect(colorKind.parse("hsl(120, 100%, 25%)")).toBe("#008000");
    expect(colorKind.parse("hsl(240deg 100% 50%)")).toBe("#0000ff");
    expect(colorKind.parse("hsl(-120 100% 50%)")).toBe("#0000ff");
    expect(colorKind.parse("hsl(480 100% 50%)")).toBe("#00ff00");
    expect(colorKind.parse("hsla(0, 100%, 50%, 0.5)")).toBe("#ff000080");
    expect(colorKind.parse("hsl(0 0% 100% / 0)")).toBe("#ffffff00");
    expect(colorKind.parse("hsl(210 50% 40%)")).toBe("#336699");
  });

  it("reads a color name, in any case, and transparent", () => {
    expect(colorKind.parse("red")).toBe("#ff0000");
    expect(colorKind.parse(" RebeccaPurple ")).toBe("#663399");
    expect(colorKind.parse("aliceblue")).toBe("#f0f8ff");
    expect(colorKind.parse("grey")).toBe("#808080");
    expect(colorKind.parse("gray")).toBe("#808080");
    expect(colorKind.parse("transparent")).toBe("#00000000");
  });

  it("knows the 148 CSS color names, with the values of the specification", () => {
    const names = namedColors();
    expect(Object.keys(names)).toHaveLength(148);
    // The CSS minifier of esbuild turns a name into hex when hex is shorter. Those names are checked against it. The rest name a short word.
    let checked = 0;
    for (const [name, value] of Object.entries(names)) {
      const out = transformSync(`a{color:${name}}`, { loader: "css", minify: true }).code.match(/color:([^}]+)\}/)![1];
      if (out.startsWith("#")) {
        const hex = out.length === 4 ? `#${[...out.slice(1)].map((c) => c + c).join("")}` : out;
        expect(`#${value.toString(16).padStart(6, "0")}`, name).toBe(hex);
        checked += 1;
      }
      expect(colorKind.parse(name), name).toBe(`#${value.toString(16).padStart(6, "0")}`);
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("rejects anything that is not a CSS color, with a TypeError that says what it needs", () => {
    for (const bad of ["", "   ", "banana", "#12", "#12345", "#gggggg", "#ff0000 x", "rgb(1 2)", "rgb(a b c)", "rgb(1 2 3 4 5)", "hsl()", "hsl(1 2)", "rgb(1,2,3", "red blue", "hsl(x 1% 1%)", "rgb(1 2 3 / )"]) {
      expect(() => colorKind.parse(bad), JSON.stringify(bad)).toThrow(TypeError);
    }
    for (const bad of [5, null, undefined, {}, [1, 2, 3], true, NaN]) expect(() => colorKind.parse(bad), String(bad)).toThrow(TypeError);
    expect(() => colorKind.parse("banana")).toThrow(/color/);
  });
});

describe("the color kind: serialize and round trips", () => {
  it("writes a parsed color as a CSS color, and parsing that text gives the same value", () => {
    for (const input of ["#369", "rgb(1 2 3)", "hsl(200 30% 60%)", "red", "rgba(0 0 0 / 0.25)", "#ABCDEF80", "transparent"]) {
      const value = colorKind.parse(input);
      expect(colorKind.serialize(value), input).toBe(value);
      expect(colorKind.parse(colorKind.serialize(value)), input).toBe(value);
    }
  });

  it("writes hex when opaque, and hex with an alpha pair when not", () => {
    expect(colorKind.serialize("rgb(0 0 0)")).toBe("#000000");
    expect(colorKind.serialize("rgb(0 0 0 / 0.5)")).toBe("#00000080");
  });

  it("gives back every 8-bit color through OKLab, with no drift", () => {
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) % 256;
    for (let i = 0; i < 256; i += 1) expect(channels(colorKind.fromArray(colorKind.toArray(`rgb(${i} ${i} ${i})`)))).toEqual([i, i, i]);
    for (let i = 0; i < 500; i += 1) {
      const rgb = [next(), next(), next()];
      expect(channels(colorKind.fromArray(colorKind.toArray(`rgb(${rgb.join(" ")})`))), rgb.join()).toEqual(rgb);
    }
  });

  it("splits into four components, and they follow the reference route to OKLab", () => {
    expect(colorKind.toArray("#ffffff")).toHaveLength(4);
    for (const [r, g, b] of [[255, 0, 0], [0, 128, 0], [51, 102, 153], [255, 255, 255], [0, 0, 0]]) {
      const parts = colorKind.toArray(`rgb(${r} ${g} ${b})`);
      const reference = oklab(r, g, b);
      for (let i = 0; i < 3; i += 1) expect(parts[i], `${r} ${g} ${b} component ${i}`).toBeCloseTo(reference[i], 6);
      expect(parts[3]).toBe(1);
    }
  });

  it("keeps the color premultiplied by alpha, so a fade from transparent has no dark halo", () => {
    const half = colorKind.toArray("rgb(255 0 0 / 0.5)");
    const full = colorKind.toArray("rgb(255 0 0)");
    for (let i = 0; i < 3; i += 1) expect(half[i]).toBeCloseTo(full[i] * 0.5, 9);
    expect(half[3]).toBeCloseTo(0.5, 9);
    expect(colorKind.interpolate("transparent", "#ff0000", 0.5)).toBe("#ff000080");
  });

  it("clamps what the components cannot show: a color out of gamut, an alpha out of range, a zero alpha", () => {
    expect(colorKind.fromArray([0.5, 0, 0, 1])).toBe("#636363");
    expect(colorKind.fromArray([2, 0, 0, 1])).toBe("#ffffff");
    expect(colorKind.fromArray([-1, 0, 0, 1])).toBe("#000000");
    expect(colorKind.fromArray([0.5, 0.2, 0.1, 3])).toMatch(/^#[0-9a-f]{6}$/);
    expect(colorKind.fromArray([0.5, 0.2, 0.1, -1])).toBe("#00000000");
    expect(colorKind.fromArray([0, 0, 0, 0])).toBe("#00000000");
  });
});

describe("the color kind: interpolate and distance", () => {
  it("lands exactly on both ends", () => {
    expect(colorKind.interpolate("#336699", "hsl(10 80% 50%)", 0)).toBe("#336699");
    expect(colorKind.interpolate("#336699", "hsl(10 80% 50%)", 1)).toBe(colorKind.parse("hsl(10 80% 50%)"));
  });

  it("blends in OKLab and not in sRGB: black to white passes through #636363, not #808080", () => {
    expect(colorKind.interpolate("#000", "#fff", 0.5)).toBe("#636363");
  });

  it("wraps the hue the short way: 350 to 10 degrees passes through red, and not through cyan", () => {
    for (const [from, to] of [[350, 10], [10, 350]]) {
      const mid = colorKind.interpolate(`hsl(${from} 100% 50%)`, `hsl(${to} 100% 50%)`, 0.5);
      expect(gap(hueOf(mid), 0), `${from} to ${to}: ${mid}`).toBeLessThan(8);
    }
    // At a quarter of the way the hue is still on the near side of the wrap.
    const quarter = colorKind.interpolate("hsl(350 100% 50%)", "hsl(10 100% 50%)", 0.25);
    expect(gap(hueOf(quarter), 355)).toBeLessThan(8);
  });

  it("takes the short way for a wider gap too: red to blue runs through magenta, not green", () => {
    const mid = colorKind.interpolate("hsl(0 100% 50%)", "hsl(240 100% 50%)", 0.5);
    const hue = hueOf(mid);
    expect(hue).toBeGreaterThan(260);
    expect(hue).toBeLessThan(350);
  });

  it("blends a grey with a color with no hue jump", () => {
    const mid = colorKind.interpolate("hsl(0 0% 50%)", "hsl(0 100% 50%)", 0.5);
    expect(mid).toMatch(/^#[0-9a-f]{6}$/);
    expect(gap(hueOf(mid), 0)).toBeLessThan(8);
  });

  it("measures distance: zero for the same color, symmetric, and 1 from black to white", () => {
    expect(colorKind.distance("#336699", "rgb(51 102 153)")).toBe(0);
    expect(colorKind.distance("#000", "#fff")).toBeCloseTo(1, 6);
    expect(colorKind.distance("#336699", "#cc3300")).toBe(colorKind.distance("#cc3300", "#336699"));
    expect(colorKind.distance("#336699", "#346699")).toBeLessThan(0.01);
    expect(colorKind.distance("#336699", "#cc3300")).toBeGreaterThan(0.1);
  });
});
