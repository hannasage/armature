import { describe, expect, it } from "vitest";
import { cssVar, dataAttr, logTag, personalityOf, requireLens, requireReveal, requireSurface, springOf, type Flavor, type PersonalitySpec, type RevealFlavor } from "../src/engine/flavor";
import { clamp, lerp } from "../src/engine/math";

const bare: Flavor = { name: "bare", prefix: "zz", logLabel: "bare-lib", springs: { soft: { stiffness: 100, damping: 10 } } };

describe("cssVar and dataAttr", () => {
  it("join the prefix and the suffix", () => {
    expect(cssVar(bare, "press")).toBe("--zz-press");
    expect(cssVar({ prefix: "lqg" }, "lens-x")).toBe("--lqg-lens-x");
    expect(dataAttr(bare, "group")).toBe("data-zz-group");
    expect(dataAttr({ prefix: "lqg" }, "reveal-delay")).toBe("data-lqg-reveal-delay");
  });
  it("give the bare attribute for an empty suffix", () => {
    expect(dataAttr(bare, "")).toBe("data-zz");
    expect(dataAttr(bare)).toBe("data-zz");
  });
  it("keep hyphens and digits in the prefix", () => {
    expect(cssVar({ prefix: "acme-2" }, "glow")).toBe("--acme-2-glow");
  });
});

describe("logTag", () => {
  it("wraps the label in brackets", () => {
    expect(logTag(bare)).toBe("[bare-lib]");
    expect(logTag({ logLabel: "" })).toBe("[]");
  });
});

describe("the require helpers", () => {
  it("throw a clear error naming the flavor when a part is missing", () => {
    expect(() => requireSurface(bare)).toThrow('The flavor "bare" has no surface part.');
    expect(() => requireLens(bare)).toThrow('The flavor "bare" has no lens part.');
    expect(() => requireReveal(bare)).toThrow('The flavor "bare" has no reveal part.');
    expect(() => requireSurface(bare)).toThrow(TypeError);
  });
  it("return the part when it is there", () => {
    const surface = {} as NonNullable<Flavor["surface"]>;
    const lens = {} as NonNullable<Flavor["lens"]>;
    const reveal = {} as RevealFlavor;
    const full: Flavor = { ...bare, surface, lens, reveal };
    expect(requireSurface(full)).toBe(surface);
    expect(requireLens(full)).toBe(lens);
    expect(requireReveal(full)).toBe(reveal);
  });
});

describe("springOf", () => {
  it("returns a named spring", () => {
    expect(springOf(bare, "soft")).toEqual({ stiffness: 100, damping: 10 });
  });
  it("throws for a missing key, including keys that Object has", () => {
    expect(() => springOf(bare, "hard")).toThrow('The flavor "bare" has no spring named "hard".');
    expect(() => springOf(bare, "constructor")).toThrow(TypeError);
    expect(() => springOf(bare, "toString")).toThrow(TypeError);
  });
});

describe("personalityOf", () => {
  const spec = (name: string): PersonalitySpec => ({ start: () => ({ x: 0, y: 0, scale: 1, rotate: 0 }), spring: "speed", clips: name === "b", scaleRotate: false, hiddenTranslate: true });
  const reveal = { personalities: { a: spec("a"), b: spec("b") }, fallback: "a" } as unknown as RevealFlavor<"a" | "b">;
  it("returns the spec of a known name", () => {
    expect(personalityOf(reveal, "b")).toBe(reveal.personalities.b);
  });
  it("returns the fallback for an unknown name, and for names Object has", () => {
    expect(personalityOf(reveal, "zzz")).toBe(reveal.personalities.a);
    expect(personalityOf(reveal, "")).toBe(reveal.personalities.a);
    expect(personalityOf(reveal, "constructor")).toBe(reveal.personalities.a);
    expect(personalityOf(reveal, "__proto__")).toBe(reveal.personalities.a);
  });
});

describe("math", () => {
  it("clamp keeps a value between the bounds", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.25, 0, 1)).toBe(0.25);
  });
  it("lerp runs from the first value to the second", () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.25)).toBe(12.5);
    expect(lerp(0, 10, 2)).toBe(20);
  });
});
