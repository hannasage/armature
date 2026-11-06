import { describe, expect, it } from "vitest";
import { computeDisplacementMap, computeSpecularMap } from "../../src/glass/displacement";
import { applyFilterScale, createGlassFilter, updateGlassFilter, type GlassFilter, type GlassFilterEngine } from "../../src/glass/filter";

/** A small well-formedness check: balanced tags, quoted attributes, no stray angle brackets or ampersands. */
function assertWellFormed(markup: string) {
  const stack: string[] = [];
  const tag = /<(\/?)([A-Za-z][\w:-]*)((?:\s+[\w:-]+="[^"<&]*")*)\s*(\/?)>/g;
  let rest = markup;
  let match: RegExpExecArray | null;
  let consumed = 0;
  while ((match = tag.exec(markup))) {
    const between = markup.slice(consumed, match.index);
    expect(between.trim(), "text between tags").toBe("");
    consumed = match.index + match[0].length;
    const [, closing, name, , selfClosing] = match;
    if (closing) expect(stack.pop(), `closing ${name}`).toBe(name);
    else if (!selfClosing) stack.push(name);
  }
  rest = markup.slice(consumed);
  expect(rest.trim()).toBe("");
  expect(stack).toEqual([]);
}

const attr = (markup: string, element: string, name: string) => {
  const found = [...markup.matchAll(new RegExp(`<${element}\\b[^>]*?\\s${name}="([^"]*)"`, "g"))];
  return found.map((m) => m[1]);
};

const count = (markup: string, element: string) => (markup.match(new RegExp(`<${element}\\b`, "g")) ?? []).length;

const base = { width: 160, height: 56, radius: 28 };

describe("computeDisplacementMap", () => {
  const w = 100;
  const h = 60;
  const map = computeDisplacementMap({ width: w, height: h, radius: 30, bevel: 20, depth: 12, refractiveIndex: 1.5 });
  const px = (x: number, y: number) => Array.from(map.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));

  it("is a Uint8ClampedArray of RGBA, one pixel per cell", () => {
    expect(map).toBeInstanceOf(Uint8ClampedArray);
    expect(map.length).toBe(w * h * 4);
  });

  it("is exactly 128 (no shift) at the flat center, and opaque", () => {
    expect(px(50, 30)).toEqual([128, 128, 128, 255]);
    expect(px(48, 29)).toEqual([128, 128, 128, 255]);
  });

  it("is neutral outside the rounded corners", () => {
    expect(px(0, 0)).toEqual([128, 128, 128, 255]);
    expect(px(w - 1, h - 1)).toEqual([128, 128, 128, 255]);
  });

  it("keeps every alpha at 255 so the browser's premultiplying cannot bend the channels", () => {
    for (let i = 3; i < map.length; i += 4) expect(map[i]).toBe(255);
  });

  it("pulls the edge pixels toward the center: red above 128 on the left, below on the right, green the same way for top and bottom", () => {
    expect(px(1, 30)[0]).toBeGreaterThan(128);
    expect(px(w - 2, 30)[0]).toBeLessThan(128);
    expect(px(50, 1)[1]).toBeGreaterThan(128);
    expect(px(50, h - 2)[1]).toBeLessThan(128);
    // The pill's center row sits half a pixel off the middle, so the cross channel is within a few steps of 128.
    expect(Math.abs(px(1, 30)[1] - 128)).toBeLessThanOrEqual(3);
    expect(px(50, 1)[0]).toBe(128);
  });

  it("is mirror symmetric", () => {
    for (const [x, y] of [[1, 30], [3, 30], [6, 30], [10, 20]]) {
      const left = px(x, y);
      const right = px(w - 1 - x, y);
      expect(left[0] + right[0]).toBeGreaterThanOrEqual(255);
      expect(left[0] + right[0]).toBeLessThanOrEqual(257);
    }
  });

  it("shifts most at the very edge and fades to nothing at the end of the bevel", () => {
    const strength = (x: number) => Math.abs(px(x, 30)[0] - 128);
    expect(strength(0)).toBeGreaterThan(strength(5));
    expect(strength(5)).toBeGreaterThan(strength(10));
    expect(strength(10)).toBeGreaterThan(strength(18));
    expect(strength(25)).toBe(0);
  });

  it("stays inside 1 to 255 on the color channels", () => {
    for (let i = 0; i < map.length; i += 4) {
      expect(map[i]).toBeGreaterThanOrEqual(1);
      expect(map[i + 1]).toBeGreaterThanOrEqual(1);
    }
  });

  it("makes no shift at all when the glass has the same index as air", () => {
    const flat = computeDisplacementMap({ width: w, height: h, radius: 30, bevel: 20, depth: 12, refractiveIndex: 1 });
    expect(new Set(Array.from(flat.filter((_, i) => i % 4 < 2)))).toEqual(new Set([128]));
  });

  it("bends more with a higher index", () => {
    const low = computeDisplacementMap({ width: w, height: h, radius: 30, bevel: 20, depth: 12, refractiveIndex: 1.2 });
    const high = computeDisplacementMap({ width: w, height: h, radius: 30, bevel: 20, depth: 12, refractiveIndex: 1.8 });
    const at = (m: Uint8ClampedArray) => Math.abs(m[(30 * w + 8) * 4] - 128);
    expect(at(high)).toBeGreaterThan(at(low));
  });

  it("is deterministic", () => {
    const again = computeDisplacementMap({ width: w, height: h, radius: 30, bevel: 20, depth: 12, refractiveIndex: 1.5 });
    expect(Array.from(again)).toEqual(Array.from(map));
  });

  it("copes with a radius larger than the box and with tiny and odd sizes", () => {
    for (const [width, height, radius] of [[40, 20, 500], [1, 1, 0], [2, 40, 1], [64, 64, 0], [64, 64, 32]]) {
      const out = computeDisplacementMap({ width, height, radius, bevel: 10, depth: 6, refractiveIndex: 1.5 });
      expect(out.length).toBe(width * height * 4);
      expect(out.every((value) => Number.isFinite(value))).toBe(true);
    }
  });

  it("copes with NaN and negative options by falling back to safe values", () => {
    const out = computeDisplacementMap({ width: 30, height: 30, radius: Number.NaN, bevel: -4, depth: Number.NaN, refractiveIndex: Number.NaN });
    expect(out.length).toBe(30 * 30 * 4);
    expect(out.every((value) => value >= 0 && value <= 255)).toBe(true);
  });

  it("rejects a size that is not a positive whole number", () => {
    expect(() => computeDisplacementMap({ width: 0, height: 10, radius: 1, bevel: 4, depth: 4, refractiveIndex: 1.5 })).toThrow(/size/i);
    expect(() => computeDisplacementMap({ width: 10.5, height: 10, radius: 1, bevel: 4, depth: 4, refractiveIndex: 1.5 })).toThrow(/size/i);
  });
});

describe("computeSpecularMap", () => {
  const w = 100;
  const h = 60;
  const map = computeSpecularMap({ width: w, height: h, radius: 30, bevel: 20, depth: 12, angle: -135, strength: 1 });
  const alpha = (x: number, y: number) => map[(y * w + x) * 4 + 3];

  it("is clear at the center and lit on the rim", () => {
    expect(alpha(50, 30)).toBe(0);
    expect(Math.max(...Array.from({ length: w * h }, (_, i) => map[i * 4 + 3]))).toBeGreaterThan(100);
  });

  it("lights the side facing the light more than the opposite side", () => {
    // Light from the top left: the top and left rims shine more than the bottom and right rims.
    const dim = computeSpecularMap({ width: w, height: h, radius: 30, bevel: 20, depth: 12, angle: -135, strength: 0.5 });
    const a = (x: number, y: number) => dim[(y * w + x) * 4 + 3];
    expect(a(50, 3)).toBeGreaterThan(a(50, h - 4));
    expect(a(3, 30)).toBeGreaterThan(a(w - 4, 30));
    expect(a(50, h - 4)).toBeGreaterThan(0);
  });

  it("stays within 0 to 255 and keeps white color", () => {
    for (let i = 0; i < map.length; i += 4) {
      expect([map[i], map[i + 1], map[i + 2]]).toEqual([255, 255, 255]);
    }
  });

  it("scales with strength", () => {
    const soft = computeSpecularMap({ width: w, height: h, radius: 30, bevel: 20, depth: 12, angle: -135, strength: 0.4 });
    const total = (m: Uint8ClampedArray) => m.reduce((sum, value, i) => (i % 4 === 3 ? sum + value : sum), 0);
    expect(total(soft)).toBeLessThan(total(map));
    const off = computeSpecularMap({ width: w, height: h, radius: 30, bevel: 20, depth: 12, angle: -135, strength: 0 });
    expect(total(off)).toBe(0);
  });
});

describe("createGlassFilter", () => {
  it("builds well formed markup with a filter, a displacement map, and an image", () => {
    const glass = createGlassFilter(base);
    assertWellFormed(glass.markup);
    expect(glass.markup).toContain("<filter");
    expect(count(glass.markup, "feImage")).toBeGreaterThanOrEqual(1);
    expect(count(glass.markup, "feDisplacementMap")).toBe(1);
    expect(glass.markup).toContain(`id="${glass.id}"`);
    expect(glass.url).toBe(`url(#${glass.id})`);
  });

  it("hides the svg from people and from layout", () => {
    const { markup } = createGlassFilter(base);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('focusable="false"');
    expect(markup).toMatch(/width="0"/);
    expect(markup).toMatch(/height="0"/);
  });

  it("reads the map in sRGB, not linear RGB, so 128 stays 'no shift'", () => {
    expect(createGlassFilter(base).markup).toContain('color-interpolation-filters="sRGB"');
  });

  it("gives every call a unique id, with no randomness", () => {
    const ids = Array.from({ length: 60 }, () => createGlassFilter(base).id);
    expect(new Set(ids).size).toBe(60);
    for (const id of ids) expect(id).toMatch(/^lqg-[a-z]+-\d+$/);
  });

  it("uses a caller-supplied id so server and client markup can match", () => {
    const glass = createGlassFilter({ ...base, id: "lqg-nav" });
    expect(glass.id).toBe("lqg-nav");
    expect(glass.markup).toContain('id="lqg-nav"');
  });

  it("rejects an id that could break out of the attribute", () => {
    expect(() => createGlassFilter({ ...base, id: 'a"><script>' })).toThrow(/id/i);
  });

  it("carries a PNG data URI in the feImage", () => {
    const glass = createGlassFilter(base);
    expect(glass.displacementUri.startsWith("data:image/png;base64,")).toBe(true);
    expect(glass.markup).toContain(glass.displacementUri);
  });

  it("puts the scale on the displacement element and defaults it from the glass depth", () => {
    const glass = createGlassFilter(base);
    expect(glass.scale).toBeGreaterThan(0);
    expect(attr(glass.markup, "feDisplacementMap", "scale")).toEqual([String(glass.scale)]);
    const custom = createGlassFilter({ ...base, scale: 31 });
    expect(custom.scale).toBe(31);
    expect(attr(custom.markup, "feDisplacementMap", "scale")).toEqual(["31"]);
  });

  it("changes scale without rebuilding the maps", () => {
    let builds = 0;
    const engine: GlassFilterEngine = {
      computeDisplacementMap: (options) => { builds += 1; return computeDisplacementMap(options); },
      computeSpecularMap: (options) => { builds += 1; return computeSpecularMap(options); },
    };
    const glass = createGlassFilter({ ...base, scale: 30 }, engine);
    const buildsAfterCreate = builds;
    expect(buildsAfterCreate).toBeGreaterThan(0);
    const next = glass.withScale(12);
    expect(builds).toBe(buildsAfterCreate);
    expect(next.id).toBe(glass.id);
    expect(next.displacementUri).toBe(glass.displacementUri);
    expect(attr(next.markup, "feDisplacementMap", "scale")).toEqual(["12"]);
    expect(attr(glass.markup, "feDisplacementMap", "scale")).toEqual(["30"]);
    const viaUpdate = updateGlassFilter(glass, { scale: 5 }, engine);
    expect(builds).toBe(buildsAfterCreate);
    expect(viaUpdate.scale).toBe(5);
  });

  it("rebuilds the maps only when width, height, or radius change", () => {
    let builds = 0;
    const engine: GlassFilterEngine = {
      computeDisplacementMap: (options) => { builds += 1; return computeDisplacementMap(options); },
      computeSpecularMap: (options) => { builds += 1; return computeSpecularMap(options); },
    };
    const glass = createGlassFilter(base, engine);
    const start = builds;
    expect(updateGlassFilter(glass, { ...base }, engine)).toBe(glass);
    expect(builds).toBe(start);
    for (const patch of [{ width: base.width + 1 }, { height: base.height + 1 }, { radius: base.radius - 1 }]) {
      const before = builds;
      const next = updateGlassFilter(glass, patch, engine);
      expect(builds, JSON.stringify(patch)).toBeGreaterThan(before);
      expect(next.id).toBe(glass.id);
      expect(next.displacementUri).not.toBe(glass.displacementUri);
    }
  });

  it("clamps the scale so it can never be negative, NaN, or enormous", () => {
    const glass = createGlassFilter(base);
    expect(glass.withScale(-4).scale).toBe(0);
    expect(glass.withScale(Number.NaN).scale).toBe(glass.scale);
    expect(glass.withScale(Number.POSITIVE_INFINITY).scale).toBe(glass.scale);
    expect(glass.withScale(10_000).scale).toBeLessThanOrEqual(400);
  });

  it("adds three channel passes when dispersion is on, and not otherwise", () => {
    const plain = createGlassFilter(base);
    expect(count(plain.markup, "feDisplacementMap")).toBe(1);
    expect(count(plain.markup, "feColorMatrix")).toBe(0);
    const split = createGlassFilter({ ...base, scale: 40, dispersion: true });
    assertWellFormed(split.markup);
    expect(count(split.markup, "feDisplacementMap")).toBe(3);
    expect(count(split.markup, "feColorMatrix")).toBe(3);
    const scales = attr(split.markup, "feDisplacementMap", "scale").map(Number);
    expect(scales).toHaveLength(3);
    expect(scales[0]).toBeGreaterThan(scales[1]);
    expect(scales[1]).toBeGreaterThan(scales[2]);
    expect(scales[1]).toBe(40);
  });

  it("keeps the three passes in step when the scale changes", () => {
    const split = createGlassFilter({ ...base, scale: 40, dispersion: 0.1 });
    const half = split.withScale(20);
    const scales = attr(half.markup, "feDisplacementMap", "scale").map(Number);
    expect(scales[1]).toBe(20);
    expect(scales[0]).toBeCloseTo(22, 5);
    expect(scales[2]).toBeCloseTo(18, 5);
  });

  it("adds a specular layer by default and leaves it out on request", () => {
    const lit = createGlassFilter(base);
    expect(count(lit.markup, "feImage")).toBe(2);
    expect(lit.specularUri?.startsWith("data:image/png;base64,")).toBe(true);
    const dull = createGlassFilter({ ...base, specular: false });
    expect(count(dull.markup, "feImage")).toBe(1);
    expect(dull.specularUri).toBeNull();
    assertWellFormed(dull.markup);
  });

  it("scales a huge element's map down so the markup stays small", () => {
    const huge = createGlassFilter({ width: 1600, height: 900, radius: 40, specular: false });
    expect(huge.displacementUri.length).toBeLessThan(200_000);
    const image = [...huge.markup.matchAll(/<feImage[^>]*\swidth="(\d+)"[^>]*\sheight="(\d+)"/g)][0];
    expect(Number(image[1])).toBe(1600);
    expect(Number(image[2])).toBe(900);
  });

  it("fits the filter region to the element and stretches the map over it", () => {
    const glass = createGlassFilter(base);
    expect(glass.markup).toMatch(/preserveAspectRatio="none"/);
  });

  it("rejects a size that is not a positive whole number of pixels", () => {
    expect(() => createGlassFilter({ ...base, width: 0 })).toThrow(/size/i);
    expect(() => createGlassFilter({ ...base, height: Number.NaN })).toThrow(/size/i);
  });

  it("is deterministic for the same options and id", () => {
    const a = createGlassFilter({ ...base, id: "lqg-same" });
    const b = createGlassFilter({ ...base, id: "lqg-same" });
    expect(a.markup).toBe(b.markup);
  });
});

describe("applyFilterScale", () => {
  type FakeNode = { attrs: Record<string, string>; getAttribute(name: string): string | null; setAttribute(name: string, value: string): void };
  const node = (attrs: Record<string, string>): FakeNode => ({
    attrs,
    getAttribute: (name) => attrs[name] ?? null,
    setAttribute(name, value) { attrs[name] = value; },
  });

  it("sets scale on every displacement element of one filter, each at its own channel factor", () => {
    const glass: GlassFilter = createGlassFilter({ ...base, scale: 40, dispersion: 0.1 });
    const nodes = [node({ "data-lqg-scale-factor": "1.1" }), node({ "data-lqg-scale-factor": "1" }), node({ "data-lqg-scale-factor": "0.9" })];
    const root = {
      selectors: [] as string[],
      querySelectorAll(selector: string) { this.selectors.push(selector); return nodes; },
    };
    applyFilterScale(root, glass.id, 20);
    expect(root.selectors[0]).toContain(glass.id);
    expect(nodes.map((n) => Number(n.attrs.scale))).toEqual([22, 20, 18].map((v) => expect.closeTo(v, 5)));
  });

  it("ignores a scale that is not a finite number", () => {
    const target = node({ "data-lqg-scale-factor": "1", scale: "9" });
    applyFilterScale({ querySelectorAll: () => [target] }, "lqg-x", Number.NaN);
    expect(target.attrs.scale).toBe("9");
  });

  it("does nothing when the filter is not in the document", () => {
    expect(() => applyFilterScale({ querySelectorAll: () => [] }, "lqg-missing", 5)).not.toThrow();
  });
});
