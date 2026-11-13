import { describe, expect, it } from "vitest";
import { cssKeyframes, cssKeyframesFit, type CssTrack } from "../../src/css";
import { bezier } from "../../src/curves";
import { createTimeline, type TimelineEnvironment } from "../../src/timeline";
import type { Flavor } from "../../src/engine/flavor";
import { tempo } from "../helpers/timeline-flavor";

// `cssKeyframes` turns a timeline into `@keyframes` text. The values are the values the timeline gives, so these tests compare the text with a real
// timeline seeked to the same times. The function runs with no DOM and no environment.

const spring = { stiffness: 170, damping: 26 };
const fade: CssTrack = { property: "opacity", keys: [[0, 0], [1000, 1]] };

/** The text read back as `[percent, { property: text }]` pairs. */
function parse(css: string): Array<[number, Record<string, string>]> {
  return [...css.matchAll(/^\s+([\d.]+)% \{ ([^}]*) \}$/gm)].map((m) => [
    Number(m[1]),
    Object.fromEntries(m[2].split(";").map((d) => d.trim()).filter(Boolean).map((d) => d.split(": ") as [string, string])),
  ]);
}

/** What a real timeline holds at a time, for the same tracks and placing. */
function valuesAt(tracks: readonly CssTrack[], ms: number, extra: { place?: "together" | "sequence"; stagger?: number; flavor?: Flavor } = {}): number[] {
  const env: TimelineEnvironment = { requestFrame: () => 0, cancelFrame: () => undefined, now: () => 0, setStyle: () => undefined };
  const timeline = createTimeline(env, { tracks: tracks.map(({ property, ...rest }) => ({ ...rest, target: {}, value: property })), ...extra });
  timeline.seek(ms);
  const { values } = timeline.getState();
  timeline.destroy();
  return values;
}

describe("the text", () => {
  it("writes a straight fade as three stops", () => {
    expect(cssKeyframes("fade", { tracks: [fade], stepMs: 500 })).toBe(
      ["@keyframes fade {", "  0% { opacity: 0; }", "  50% { opacity: 0.5; }", "  100% { opacity: 1; }", "}", ""].join("\n"),
    );
  });

  it("writes the unit after the number, and one declaration per track in each stop", () => {
    const css = cssKeyframes("slide", {
      tracks: [{ property: "translate", unit: "px", keys: [[0, 0], [200, 100]] }, fade],
      stepMs: 100,
    });
    expect(css).toContain("  0% { translate: 0px; opacity: 0; }");
    expect(css).toContain("  10% { translate: 50px; opacity: 0.1; }");
    expect(css).toContain("  50% { translate: 100px; opacity: 0.5; }");
    expect(css.split("\n").filter((line) => line.endsWith("}")).length).toBe(1 + parse(css).length);
  });

  it("uses the format function of a track, in place of the number and the unit", () => {
    const css = cssKeyframes("hue", { tracks: [{ property: "rotate", keys: [[0, 0], [100, 90]], format: (v) => `${v}deg` }], stepMs: 100 });
    expect(css).toContain("  0% { rotate: 0deg; }");
    expect(css).toContain("  100% { rotate: 90deg; }");
  });

  it("pins the text of a spring step", () => {
    expect(cssKeyframes("pop", { tracks: [{ property: "scale", keys: [[0, 0.5], [400, 1, spring]] }], stepMs: 80 })).toMatchInlineSnapshot(`
      "@keyframes pop {
        0% { scale: 0.5; }
        11.1111% { scale: 0.6453; }
        22.2222% { scale: 0.8038; }
        33.3333% { scale: 0.9076; }
        44.4444% { scale: 0.9547; }
        55.5556% { scale: 0.9798; }
        66.6667% { scale: 0.9903; }
        77.7778% { scale: 0.9957; }
        88.8889% { scale: 0.998; }
        100% { scale: 1; }
      }
      "
    `);
  });

  it("is the same text on every call", () => {
    const options = { tracks: [{ property: "scale", keys: [[0, 0.5], [400, 1, spring]] }] satisfies CssTrack[] };
    expect(cssKeyframes("pop", options)).toBe(cssKeyframes("pop", options));
  });
});

describe("the values", () => {
  it("match a timeline at every written stop, for a curve step", () => {
    const tracks: CssTrack[] = [{ property: "opacity", keys: [[0, 0], [600, 1, bezier(0.22, 1, 0.36, 1)]] }];
    const css = cssKeyframes("e", { tracks, stepMs: 60 });
    const stops = parse(css);
    expect(stops.length).toBe(11);
    for (const [percent, declared] of stops) expect(Number(declared.opacity)).toBeCloseTo(valuesAt(tracks, (percent / 100) * 600)[0], 3);
  });

  it("match a timeline at every written stop, for a spring that overshoots, and show the overshoot", () => {
    const loose = { stiffness: 300, damping: 10 };
    const tracks: CssTrack[] = [{ property: "scale", keys: [[0, 0], [300, 1, loose]] }];
    const fit = cssKeyframesFit("s", { tracks, stepMs: 20 });
    const stops = parse(fit.css);
    expect(fit.duration).toBeGreaterThan(300);
    for (const [percent, declared] of stops) expect(Number(declared.scale)).toBeCloseTo(valuesAt(tracks, (percent / 100) * fit.duration)[0], 3);
    expect(Math.max(...stops.map(([, d]) => Number(d.scale)))).toBeGreaterThan(1);
    expect(Number(stops[stops.length - 1][1].scale)).toBe(1);
  });

  it("place tracks in sequence, with a stagger, as a timeline does", () => {
    const tracks: CssTrack[] = [
      { property: "opacity", keys: [[0, 0], [100, 1]] },
      { property: "scale", keys: [[0, 0], [100, 1]] },
    ];
    const fit = cssKeyframesFit("q", { tracks, place: "sequence", stagger: 50, stepMs: 25 });
    expect(fit.duration).toBe(250);
    expect(fit.count).toBe(11);
    for (const [percent, declared] of parse(fit.css)) {
      const [opacity, scale] = valuesAt(tracks, (percent / 100) * fit.duration, { place: "sequence", stagger: 50 });
      expect(Number(declared.opacity)).toBeCloseTo(opacity, 3);
      expect(Number(declared.scale)).toBeCloseTo(scale, 3);
    }
  });

  it("reads named curves, springs, and sequences from a flavor, and gives what a timeline with that flavor gives", () => {
    const tracks: CssTrack[] = [{ property: "opacity", sequence: "enter" }];
    const fit = cssKeyframesFit("seq", { tracks, flavor: tempo, stepMs: 50 });
    expect(fit.css.startsWith("@keyframes seq {")).toBe(true);
    expect(fit.duration).toBeGreaterThan(800);
    for (const [percent, declared] of parse(fit.css)) expect(Number(declared.opacity)).toBeCloseTo(valuesAt(tracks, (percent / 100) * fit.duration, { flavor: tempo })[0], 3);
  });

  it("returns the duration in milliseconds and the number of stops", () => {
    const fit = cssKeyframesFit("fade", { tracks: [fade], stepMs: 250 });
    expect(fit.duration).toBe(1000);
    expect(fit.count).toBe(5);
    expect(fit.css).toBe(cssKeyframes("fade", { tracks: [fade], stepMs: 250 }));
  });

  it("writes stops with no exponent text, even for a value that is tiny or huge", () => {
    const css = cssKeyframes("x", { tracks: [{ property: "opacity", keys: [[0, 1e-9], [100, 1e21]] }], stepMs: 50 });
    expect(css).not.toMatch(/\d[eE][+-]?\d|Infinity|NaN/);
    expect(css).toContain("  0% { opacity: 0; }");
    expect(css).toContain("  100% { opacity: 1000000000; }");
  });

  it("writes the stops in order, from 0 to 100 percent, with no stop twice", () => {
    const percents = parse(cssKeyframes("o", { tracks: [fade], stepMs: 7 })).map(([p]) => p);
    expect(percents[0]).toBe(0);
    expect(percents[percents.length - 1]).toBe(100);
    expect(percents).toEqual([...new Set(percents)].sort((a, b) => a - b));
  });
});

describe("format gets the rounded value", () => {
  const seen = (tracks: CssTrack[], stepMs: number) => {
    const values: number[] = [];
    cssKeyframes("r", { tracks: tracks.map((t) => ({ ...t, format: (v: number) => (values.push(v), `${v}px`) })), stepMs });
    return values;
  };

  it("never gives format exponent text, for a value that crosses zero in small steps", () => {
    const values = seen([{ property: "translate", keys: [[0, -0.3], [100, 0.6]] }], 1);
    expect(values.length).toBeGreaterThan(90);
    for (const v of values) expect(String(v), String(v)).not.toMatch(/e/i);
    for (const v of values) expect(v).toBe(Number(v.toFixed(4)));
  });

  it("gives format a clean 0, and not a float error such as 5.5e-17, where the value crosses zero on a stop", () => {
    const values = seen([{ property: "translate", keys: [[0, -0.3], [90, 0.6]] }], 1);
    expect(values.some((v) => v === 0 && !Object.is(v, -0))).toBe(true);
    for (const v of values) expect(String(v)).not.toMatch(/e/i);
  });

  it("never gives format exponent text, for a spring that settles near zero", () => {
    const css = cssKeyframes("z", { tracks: [{ property: "translate", keys: [[0, 1], [600, 0, { stiffness: 170, damping: 14 }]], format: (v) => `${v}px` }], stepMs: 4 });
    expect(css).not.toMatch(/\d[eE][+-]?\d/);
    const values = seen([{ property: "translate", keys: [[0, 1], [600, 0, { stiffness: 170, damping: 14 }]] }], 4);
    for (const v of values) expect(String(v)).not.toMatch(/e/i);
    expect(values[values.length - 1]).toBe(0);
  });

  it("writes the same text with format (v) => `${v}` as with no format", () => {
    const tracks: CssTrack[] = [{ property: "opacity", keys: [[0, -0.3], [100, 0.6]] }];
    expect(cssKeyframes("same", { tracks: [{ ...tracks[0], format: (v) => `${v}` }], stepMs: 7 })).toBe(cssKeyframes("same", { tracks, stepMs: 7 }));
  });
});

describe("the track is read once", () => {
  it("checks and writes the same property, unit, and format, even when a getter gives another on the next read", () => {
    let reads = 0;
    const track = {
      keys: [[0, 0], [100, 1]],
      get property() {
        reads += 1;
        return reads === 1 ? "opacity" : "opacity;}body{display:none";
      },
      get unit() {
        reads += 1;
        return reads < 100 ? "" : "px;}";
      },
    } as unknown as CssTrack;
    const css = cssKeyframes("once", { tracks: [track], stepMs: 50 });
    expect(css).not.toContain("body");
    expect(css).toContain("opacity: 0.5;");
    expect(reads).toBe(2);
  });
});

describe("the name is not a keyword", () => {
  it.each(["none", "initial", "inherit", "unset", "revert", "revert-layer", "default", "NONE", "Initial", "Revert-Layer", "DEFAULT"])("refuses %s", (name) => {
    expect(() => cssKeyframes(name, { tracks: [fade] })).toThrow(TypeError);
    expect(() => cssKeyframes(name, { tracks: [fade] })).toThrow(/keyword/);
  });

  it("accepts a name that holds a keyword", () => {
    for (const name of ["none-x", "initial1", "my-default", "revert-layers"]) expect(cssKeyframes(name, { tracks: [fade], stepMs: 500 })).toContain(`@keyframes ${name} {`);
  });
});

describe("capped", () => {
  it("is false for a spring that rests, and true for one that is cut at 10 seconds before the next key", () => {
    expect(cssKeyframesFit("c", { tracks: [{ property: "scale", keys: [[0, 0], [300, 1, spring]] }], stepMs: 50 }).capped).toBe(false);
    expect(cssKeyframesFit("c", { tracks: [fade], stepMs: 500 }).capped).toBe(false);
    const loose = { property: "scale", keys: [[0, 0], [20_000, 1, { stiffness: 10, damping: 0 }], [30_000, 0]] } satisfies CssTrack;
    const fit = cssKeyframesFit("c", { tracks: [loose], stepMs: 5000 });
    expect(fit.capped).toBe(true);
    expect(fit.duration).toBe(30_000);
  });
});

describe("the number of stops", () => {
  const long = (ms: number): CssTrack => ({ property: "opacity", keys: [[0, 0], [ms, 1]] });

  it("writes evenly spaced stops, at most stepMs apart, and count is the number of stops written", () => {
    const fit = cssKeyframesFit("n", { tracks: [long(1000)], stepMs: 300 });
    const percents = parse(fit.css).map(([p]) => p);
    expect(fit.count).toBe(percents.length);
    expect(fit.count).toBe(5);
    const gaps = percents.slice(1).map((p, i) => p - percents[i]);
    for (const gap of gaps) expect((gap / 100) * fit.duration).toBeLessThanOrEqual(300 + 1e-6);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1e-3);
  });

  it("writes 5,000 stops at the edge, and refuses 5,001 with a message that counts stops", () => {
    const ok = cssKeyframesFit("e", { tracks: [long(4999)], stepMs: 1 });
    expect(ok.count).toBe(5000);
    expect(parse(ok.css)).toHaveLength(5000);
    expect(() => cssKeyframes("e", { tracks: [long(5000)], stepMs: 1 })).toThrow(RangeError);
    expect(() => cssKeyframes("e", { tracks: [long(5000)], stepMs: 1 })).toThrow(/5001 stops/);
  });
});

describe("no transform", () => {
  it.each(["transform", "Transform", "-webkit-transform", "-moz-TRANSFORM", "-ms-transform"])("refuses the property %s", (property) => {
    expect(() => cssKeyframes("t", { tracks: [{ property, keys: [[0, 0], [100, 1]] }] })).toThrow(TypeError);
  });

  it("accepts the individual properties", () => {
    for (const property of ["translate", "scale", "rotate", "opacity", "--my-var"]) {
      expect(cssKeyframes("t", { tracks: [{ property, keys: [[0, 0], [100, 1]] }], stepMs: 50 })).toContain(`${property}:`);
    }
  });
});

describe("injection", () => {
  const tracks = [fade];

  it("escapes the name, so it stays one name", () => {
    const css = cssKeyframes("a}body{display:none}/*", { tracks, stepMs: 500 });
    expect(css.split("\n")[0]).toBe("@keyframes a\\}body\\{display\\:none\\}\\/\\* {");
    expect(css.replace(/\\./g, "").match(/\{/g)).toHaveLength(4);
  });

  it("never writes a literal less-than sign from a name", () => {
    expect(cssKeyframes("</style><script>", { tracks, stepMs: 500 })).not.toContain("<");
  });

  it("refuses an empty name and a name that is not text", () => {
    expect(() => cssKeyframes("", { tracks })).toThrow(TypeError);
    expect(() => cssKeyframes(5 as never, { tracks })).toThrow(TypeError);
  });

  it.each(["px;}body{display:none", "px}", "{", "px /*", "\\", "p x", "1px", "calc(1px)", "<"])("refuses the unit %j", (unit) => {
    expect(() => cssKeyframes("u", { tracks: [{ property: "translate", unit, keys: [[0, 0], [100, 1]] }] })).toThrow(TypeError);
  });

  it.each(["1px;}body{display:none", "1px}", "\"x\"", "url(x)", "1px /* x */", "(1px", "1px)", "a\\b", "</style>", "1e-7", "calc(1e5px + 1px)"])(
    "refuses a format result of %j",
    (text) => {
      expect(() => cssKeyframes("f", { tracks: [{ property: "translate", keys: [[0, 0], [100, 1]], format: () => text }], stepMs: 50 })).toThrow(TypeError);
    },
  );

  it("accepts a format result that is an ordinary value", () => {
    for (const text of ["rgb(0 0 0 / 0.5)", "calc(1px + 2%)", "#1e2", "10px 20px"]) {
      expect(() => cssKeyframes("f", { tracks: [{ property: "translate", keys: [[0, 0], [100, 1]], format: () => text }], stepMs: 50 })).not.toThrow();
    }
  });

  it("refuses a format that is not a function, or that returns no text", () => {
    expect(() => cssKeyframes("f", { tracks: [{ property: "opacity", keys: [[0, 0], [100, 1]], format: (() => 5) as never }], stepMs: 50 })).toThrow(TypeError);
  });

  it("refuses a property name that could carry CSS", () => {
    for (const property of ["opacity;}body{display:none", "opacity: 1", "a b", "", "opacity}"]) {
      expect(() => cssKeyframes("p", { tracks: [{ property, keys: [[0, 0], [100, 1]] }] }), property).toThrow(TypeError);
    }
  });
});

describe("a bad call", () => {
  it("throws a TypeError for no options or no tracks, and a RangeError for a timeline with no length", () => {
    expect(() => cssKeyframes("n", undefined as never)).toThrow(TypeError);
    expect(() => cssKeyframes("n", { tracks: [] })).toThrow(TypeError);
    expect(() => cssKeyframes("n", { tracks: "x" as never })).toThrow(TypeError);
    expect(() => cssKeyframes("n", { tracks: [{ property: "opacity", keys: [[0, 1], [0, 1]] }] })).toThrow(RangeError);
  });

  it("refuses a step that is not a finite number of at least one millisecond", () => {
    for (const stepMs of [0, 0.5, -10, NaN, Infinity, "5" as never]) expect(() => cssKeyframes("s", { tracks: [fade], stepMs }), String(stepMs)).toThrow(RangeError);
  });

  it("refuses a step that would need more than 5,000 stops, and names the option to raise", () => {
    expect(() => cssKeyframes("s", { tracks: [{ property: "opacity", keys: [[0, 0], [60_000, 1]] }], stepMs: 1 })).toThrow(RangeError);
    expect(() => cssKeyframes("s", { tracks: [{ property: "opacity", keys: [[0, 0], [60_000, 1]] }], stepMs: 1 })).toThrow(/stepMs/);
  });

  it("passes on what the timeline throws: a name with no flavor, an unknown sequence", () => {
    expect(() => cssKeyframes("s", { tracks: [{ property: "opacity", sequence: "nope" }] })).toThrow(TypeError);
    expect(() => cssKeyframes("s", { tracks: [{ property: "opacity", keys: [[0, 0], [100, 1, "ease"]] }] })).toThrow(TypeError);
  });
});
