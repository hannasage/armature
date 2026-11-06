import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cssVar, dataAttr, logTag } from "../src/engine/flavor";
import { glassFlavor } from "../src/glass/flavor";
import { LQG_PREFIX } from "../src/index";
import * as legacyDelegate from "./golden/legacy/delegate";
import * as legacyMotion from "./golden/legacy/scroll-motion";
import * as legacyReveal from "./golden/legacy/scroll-reveal";
import * as legacySpring from "./golden/legacy/spring";

// Each field is checked against the old constant. A field that came from an exported constant is compared with that
// export, imported from the frozen legacy copy. A field that came from an inline value has no export, so it is
// compared with the value in the source, and the test also checks that the value appears in the legacy file.
const source = (file: string) => readFileSync(new URL(`./golden/legacy/${file}`, import.meta.url), "utf8");
const legacy = { surface: source("surface.ts"), lens: source("lens.ts"), reveal: source("scroll-reveal.ts"), motion: source("scroll-motion.ts"), guard: source("guard.ts"), mount: source("scroll-mount.ts") };
const inLegacy = (file: keyof typeof legacy, text: string) => expect(legacy[file], `${text} in ${file}`).toContain(text);

const { surface, lens, reveal } = glassFlavor;

describe("identity", () => {
  it("keeps the lqg prefix and the liquid-glass log label", () => {
    expect(glassFlavor.name).toBe("glass");
    expect(glassFlavor.prefix).toBe("lqg");
    expect(glassFlavor.prefix).toBe(LQG_PREFIX);
    expect(logTag(glassFlavor)).toBe("[liquid-glass]");
    for (const file of ["guard", "reveal", "mount"] as const) inLegacy(file, "[liquid-glass]");
  });
});

describe("springs", () => {
  it("has the six presets, equal to the legacy presets", () => {
    expect(Object.keys(glassFlavor.springs)).toEqual(["lensX", "lensWidth", "press", "release", "gentle", "stiff"]);
    for (const name of Object.keys(glassFlavor.springs) as Array<keyof typeof glassFlavor.springs>) {
      expect(glassFlavor.springs[name], name).toStrictEqual(legacySpring[name as keyof typeof legacySpring]);
      expect(Object.isFrozen(glassFlavor.springs[name]), name).toBe(true);
    }
  });
});

describe("surface", () => {
  it("names the variables the legacy surface writes", () => {
    const names = {
      press: "--lqg-press", flex: "--lqg-flex", specX: "--lqg-spec-x", specY: "--lqg-spec-y", glow: "--lqg-glow",
    };
    for (const [key, name] of Object.entries(names)) {
      expect(cssVar(glassFlavor, surface.vars[key as keyof typeof surface.vars]), key).toBe(name);
      inLegacy("surface", `"${name}"`);
    }
  });
  it("names the attributes the legacy delegate exports", () => {
    expect(dataAttr(glassFlavor, surface.attributes.surface)).toBe(legacyDelegate.SURFACE_ATTRIBUTE);
    expect(dataAttr(glassFlavor, surface.attributes.group)).toBe(legacyDelegate.GROUP_ATTRIBUTE);
    expect(dataAttr(glassFlavor, surface.attributes.feel)).toBe(legacyDelegate.FEEL_ATTRIBUTE);
  });
  it("uses the press and release springs of the legacy surface", () => {
    expect(glassFlavor.springs[surface.springKeys.press]).toBe(glassFlavor.springs.press);
    expect(glassFlavor.springs[surface.springKeys.release]).toBe(glassFlavor.springs.release);
    expect(glassFlavor.springs[surface.springKeys.press]).toStrictEqual(legacySpring.press);
    expect(glassFlavor.springs[surface.springKeys.release]).toStrictEqual(legacySpring.release);
    inLegacy("surface", "options.springs?.press ?? press");
    inLegacy("surface", "options.springs?.release ?? release");
  });
  it("has the rest thresholds, defaults, time constants, and hover glow of the legacy surface", () => {
    expect(surface.rest).toEqual({ restDelta: 0.0005, restSpeed: 0.01 });
    inLegacy("surface", "{ restDelta: 0.0005, restSpeed: 0.01, ...config }");
    expect(surface.defaults).toEqual({ pressScale: 0.97, flex: 0.5, glowFalloff: 160, neighborShare: 1, specularRest: { x: 50, y: 0 } });
    inLegacy("surface", ": 0.97");
    inLegacy("surface", ": 0.5;");
    inLegacy("surface", ": 160;");
    inLegacy("surface", ".neighborShare!)) : 1;");
    inLegacy("surface", "options.specularRest?.x ?? 50");
    inLegacy("surface", "options.specularRest?.y ?? 0");
    expect(surface.specularTauMs).toBe(90);
    inLegacy("surface", "const SPECULAR_TAU_MS = 90;");
    expect(surface.glowTauMs).toBe(140);
    inLegacy("surface", "const GLOW_TAU_MS = 140;");
    expect(surface.hoverGlow).toBe(0.6);
    inLegacy("surface", "const HOVER_GLOW = 0.6;");
  });
  it("has the legacy feels", () => {
    expect(surface.feels).toStrictEqual(legacyDelegate.FEELS);
  });
});

describe("lens", () => {
  it("names the variables and the attribute the legacy lens writes", () => {
    const names = { x: "--lqg-lens-x", y: "--lqg-lens-y", w: "--lqg-lens-w", h: "--lqg-lens-h", sx: "--lqg-lens-sx", sy: "--lqg-lens-sy" };
    for (const [key, name] of Object.entries(names)) {
      expect(cssVar(glassFlavor, lens.vars[key as keyof typeof lens.vars]), key).toBe(name);
      inLegacy("lens", `"${name}"`);
    }
    expect(dataAttr(glassFlavor, lens.readyAttribute)).toBe("data-lqg-lens");
    inLegacy("lens", '"data-lqg-lens", "ready"');
    expect(lens.readyValue).toBe("ready");
  });
  it("uses the lens springs, the pixel rest, and the stretch numbers of the legacy lens", () => {
    expect(glassFlavor.springs[lens.springKeys.x]).toStrictEqual(legacySpring.lensX);
    expect(glassFlavor.springs[lens.springKeys.width]).toStrictEqual(legacySpring.lensWidth);
    inLegacy("lens", "options.springs?.x ?? lensX");
    inLegacy("lens", "options.springs?.width ?? lensWidth");
    expect(lens.pixelRest).toEqual({ restDelta: 0.05, restSpeed: 1 });
    inLegacy("lens", "{ restDelta: 0.05, restSpeed: 1, ...config }");
    expect(lens.stretchVelocity).toBe(10_000);
    inLegacy("lens", "const DEFAULT_STRETCH_VELOCITY = 10_000;");
    expect(lens.maxStretch).toBe(0.12);
    inLegacy("lens", "const DEFAULT_MAX_STRETCH = 0.12;");
  });
});

describe("reveal attributes", () => {
  it("name the attributes the legacy reveal exports", () => {
    const a = reveal.attributes;
    expect(dataAttr(glassFlavor, a.reveal)).toBe(legacyReveal.REVEAL_ATTRIBUTE);
    expect(dataAttr(glassFlavor, a.group)).toBe(legacyReveal.REVEAL_GROUP_ATTRIBUTE);
    expect(dataAttr(glassFlavor, a.delay)).toBe(legacyReveal.REVEAL_DELAY_ATTRIBUTE);
    expect(dataAttr(glassFlavor, a.revealed)).toBe(legacyReveal.REVEALED_ATTRIBUTE);
    expect(dataAttr(glassFlavor, a.drag)).toBe(legacyReveal.DRAG_ATTRIBUTE);
    expect(dataAttr(glassFlavor, a.depth)).toBe(legacyReveal.DEPTH_ATTRIBUTE);
    expect(dataAttr(glassFlavor, a.tilt)).toBe(legacyReveal.TILT_ATTRIBUTE);
    expect(dataAttr(glassFlavor, a.side)).toBe(legacyReveal.SIDE_ATTRIBUTE);
    expect(dataAttr(glassFlavor, a.line)).toBe(legacyReveal.LINE_ATTRIBUTE);
    expect(cssVar(glassFlavor, reveal.delayProperty)).toBe(legacyReveal.REVEAL_DELAY_PROPERTY);
  });
});

describe("reveal numbers", () => {
  it("has the velocity thresholds, springs, stagger, fold, and safety time of the legacy reveal", () => {
    expect(reveal.velocity).toEqual({ slow: legacyMotion.SLOW_VELOCITY, fast: legacyMotion.FAST_VELOCITY });
    expect(reveal.springs.slow).toStrictEqual(legacyMotion.revealSlow);
    expect(reveal.springs.fast).toStrictEqual(legacyMotion.revealFast);
    expect(reveal.springs.calm).toStrictEqual(legacyMotion.revealCalm);
    expect(reveal.stagger).toEqual({ stepMs: legacyMotion.REVEAL_STAGGER_MS, maxSteps: legacyMotion.REVEAL_MAX_STEPS, maxDelayMs: legacyMotion.REVEAL_MAX_DELAY_MS });
    expect(reveal.foldPercent).toBe(legacyReveal.FOLD_PERCENT);
    expect(reveal.safetyMs).toBe(legacyReveal.SAFETY_MS);
    expect(reveal.tiltLimit).toBe(legacyMotion.TILT_LIMIT);
  });
  it("has the opacity point, the clip side, and the will-change hints of the legacy reveal", () => {
    expect(reveal.opacityDone).toBe(0.6);
    inLegacy("motion", "const OPACITY_DONE = 0.6;");
    expect(reveal.clipSide).toBe("-8px");
    inLegacy("reveal", 'const CLIP_SIDE = "-8px";');
    expect(reveal.hints.move).toBe("translate, scale, rotate, opacity");
    inLegacy("reveal", 'const MOVE_HINT = "translate, scale, rotate, opacity";');
    expect(reveal.hints.clip).toBe("clip-path");
    inLegacy("reveal", 'const CLIP_HINT = "clip-path";');
    expect(reveal.hints.drag).toBe("translate, rotate");
    inLegacy("reveal", 'const DRAG_HINT = "translate, rotate";');
  });
  it("has the drag numbers of the legacy reveal", () => {
    expect(reveal.drag.shiftMax).toBe(legacyMotion.DRAG_SHIFT_MAX);
    expect(reveal.drag.rotateMax).toBe(legacyMotion.DRAG_ROTATE_MAX);
    expect(reveal.drag.fullVelocity).toBe(legacyMotion.DRAG_FULL_VELOCITY);
    expect(reveal.drag.depth).toEqual({ min: legacyMotion.DEPTH_MIN, max: legacyMotion.DEPTH_MAX, fallback: legacyMotion.DEPTH_DEFAULT });
    expect(reveal.drag.spring).toStrictEqual(legacyMotion.dragSpring);
  });
});

describe("reveal personalities", () => {
  it("lists the legacy personalities and falls back to drop", () => {
    expect(Object.keys(reveal.personalities).sort()).toEqual([...legacyMotion.REVEAL_PERSONALITIES].sort());
    expect(reveal.fallback).toBe("drop");
    expect(legacyMotion.parsePersonality("nonsense")).toBe(reveal.fallback);
  });
  it("sets the traits the legacy engine branched on", () => {
    // scroll-reveal.ts: `=== "drop"` writes scale and rotate. `=== "mask"` clips and skips the hidden translate. `=== "fade"` uses the calm spring.
    for (const name of legacyMotion.REVEAL_PERSONALITIES) {
      const spec = reveal.personalities[name];
      expect(spec.scaleRotate, name).toBe(name === "drop");
      expect(spec.clips, name).toBe(name === "mask");
      expect(spec.hiddenTranslate, name).toBe(name !== "mask");
      expect(spec.spring, name).toBe(name === "fade" ? "calm" : "speed");
    }
    inLegacy("reveal", 'target.personality === "drop"');
    inLegacy("reveal", 'target.personality !== "mask"');
    inLegacy("reveal", 'target.personality === "fade" ? revealCalm');
    inLegacy("reveal", 'target.personality === "mask"');
  });
  it("computes the same start pose as the legacy revealStart over a grid of inputs", () => {
    const velocities = [-50_000, -3200, -1800, -400, -1, 0, 1, 399, 400, 1000, 1800, 3199, 3200, 9000, 50_000, Number.NaN, Infinity, -Infinity];
    const tilts = [undefined, 0, -1, 0.3, 1.5, 2.2, 4, 99, Number.NaN];
    const heights = [undefined, 0, -5, 10, 50, 96, 200, Number.NaN];
    const sides = [undefined, -1, 1] as const;
    let compared = 0;
    for (const personality of legacyMotion.REVEAL_PERSONALITIES) {
      for (const velocity of velocities) {
        const context = { t: legacyMotion.velocityBlend(velocity), direction: legacyMotion.scrollDirection(velocity) };
        for (const index of [undefined, 0, 1, 2, 3]) {
          for (const side of sides) {
            for (const tilt of tilts) {
              for (const height of heights) {
                const input = { personality, velocity, index, side, tilt, height };
                expect(reveal.personalities[personality].start(input, context)).toStrictEqual(legacyMotion.revealStart(input));
                compared += 1;
              }
            }
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(10_000);
  });
  it("names the numbers that were inline in the slide and mask bodies", () => {
    inLegacy("motion", "lerp(8, 24, t)");
    inLegacy("motion", "Math.min(input.height!, 96) : 24");
  });
});
