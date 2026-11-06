import { describe, expect, it } from "vitest";
import { validateFlavor, cssVar, dataAttr, logTag, personalityOf, requireLens, requireReveal, requireSurface, springOf, type Flavor, type PersonalitySpec, type RevealFlavor } from "../src/engine/flavor";
import { clamp, lerp } from "../src/engine/math";
import { glassFlavor } from "../src/glass/flavor";
import { acme } from "./helpers/other-flavor";

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
    const full: Flavor = { ...bare, surface: acme.surface, lens: acme.lens, reveal: acme.reveal, springs: acme.springs };
    expect(requireSurface(full)).toBe(acme.surface);
    expect(requireLens(full)).toBe(acme.lens);
    expect(requireReveal(full)).toBe(acme.reveal);
  });
  it("throw a clear TypeError when the argument is not an object", () => {
    // `values.map(parseDelay)` passes the array index where the flavor goes.
    for (const value of [0, 1, "glass", undefined, null, true]) {
      expect(() => requireSurface(value as never), String(value)).toThrow(TypeError);
      expect(() => requireLens(value as never), String(value)).toThrow(/Expected a flavor object/);
      expect(() => requireReveal(value as never), String(value)).toThrow(/Expected a flavor object/);
      expect(() => springOf(value as never, "x"), String(value)).toThrow(/Expected a flavor object/);
    }
    expect(() => requireReveal(null as never)).toThrow("got null");
    expect(() => requireReveal(3 as never)).toThrow("got number");
  });
});

describe("validateFlavor", () => {
  const withAcme = (patch: Partial<Flavor>): Flavor => ({ ...acme, ...patch });
  it("accepts the glass flavor and a second flavor", () => {
    expect(() => validateFlavor(glassFlavor)).not.toThrow();
    expect(() => validateFlavor(acme)).not.toThrow();
    expect(() => validateFlavor(bare)).not.toThrow();
  });
  it("rejects a bad prefix and names the flavor", () => {
    for (const prefix of ["", "Lqg", "1abc", "a b", "a_b", "-a", "a.b", "é"]) {
      expect(() => validateFlavor(withAcme({ prefix })), prefix).toThrow(TypeError);
      expect(() => validateFlavor(withAcme({ prefix })), prefix).toThrow('The flavor "acme" has the prefix');
    }
    for (const prefix of ["a", "lqg", "acme-2", "a1-b2"]) expect(() => validateFlavor(withAcme({ prefix })), prefix).not.toThrow();
  });
  it("rejects an empty log label", () => {
    expect(() => validateFlavor(withAcme({ logLabel: "" }))).toThrow('The flavor "acme" has an empty log label.');
  });
  it("rejects a reveal fallback that is not a personality, including names Object has", () => {
    const reveal = { ...acme.reveal, fallback: "nope" as never };
    expect(() => validateFlavor(withAcme({ reveal }))).toThrow('The flavor "acme" has the reveal fallback "nope"');
    expect(() => validateFlavor(withAcme({ reveal: { ...acme.reveal, fallback: "constructor" as never } }))).toThrow(TypeError);
  });
  it("rejects a spring key that is missing from springs, for the surface and for the lens", () => {
    const { tap: _tap, ...noTap } = acme.springs;
    void _tap;
    expect(() => validateFlavor(withAcme({ springs: noTap }))).toThrow('The flavor "acme" has no spring named "tap".');
    const { slideW: _slideW, ...noSlideW } = acme.springs;
    void _slideW;
    expect(() => validateFlavor(withAcme({ springs: noSlideW }))).toThrow('The flavor "acme" has no spring named "slideW".');
  });
  it("is run by the require helpers", () => {
    expect(() => requireReveal(withAcme({ prefix: "Bad" }) as never)).toThrow('The flavor "acme" has the prefix');
    expect(() => requireSurface(withAcme({ logLabel: "" }))).toThrow("empty log label");
    expect(() => requireLens(withAcme({ springs: {} }))).toThrow(TypeError);
  });
  it("checks a flavor once: a flavor that passed is not read again", () => {
    const flavor = withAcme({});
    validateFlavor(flavor);
    (flavor as { prefix: string }).prefix = "Bad";
    expect(() => validateFlavor(flavor)).not.toThrow();
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
