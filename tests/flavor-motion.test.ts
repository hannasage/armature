import { describe, expect, it } from "vitest";
import { glassFlavor } from "../src/glass/flavor";
import * as motion from "../src/core/scroll-motion";
import * as legacy from "./golden/legacy/scroll-motion";
import { acme } from "./helpers/other-flavor";
import type { Flavor } from "../src/engine/flavor";

describe("scroll-motion keeps its old exports", () => {
  it("has every export the legacy module had, with the same value for each constant", () => {
    for (const [name, value] of Object.entries(legacy)) {
      expect(name in motion, name).toBe(true);
      const now = (motion as Record<string, unknown>)[name];
      if (typeof value === "function") expect(typeof now, name).toBe("function");
      else expect(now, name).toStrictEqual(value);
    }
  });
  it("keeps frozen springs", () => {
    for (const name of ["revealSlow", "revealFast", "revealCalm", "dragSpring"] as const) expect(Object.isFrozen(motion[name]), name).toBe(true);
  });
});

describe("without a flavor the functions are the glass functions", () => {
  const velocities = [-50_000, -3200, -1800, -400, -1, 0, 1, 399, 400, 1000, 1800, 3199, 3200, 9000, Number.NaN, Infinity];
  it("velocityBlend, revealSpring, and dragTarget match the legacy functions", () => {
    for (const velocity of velocities) {
      expect(motion.velocityBlend(velocity), `blend ${velocity}`).toBe(legacy.velocityBlend(velocity));
      expect(motion.revealSpring(velocity), `spring ${velocity}`).toStrictEqual(legacy.revealSpring(velocity));
      for (const depth of [0, 0.4, 0.7, 1, 3, Number.NaN]) expect(motion.dragTarget(velocity, depth), `drag ${velocity} ${depth}`).toStrictEqual(legacy.dragTarget(velocity, depth));
    }
  });
  it("parsePersonality, parseDelay, parseDepth, and staggerDelay match the legacy functions", () => {
    for (const value of [null, undefined, "", "drop", "mask", "slide", "fade", "wipe", "constructor", "__proto__", "toString"]) expect(motion.parsePersonality(value), String(value)).toBe(legacy.parsePersonality(value));
    for (const value of [null, undefined, "", " ", "0", "12.9", "-3", "2000", "99999", "abc", "NaN"]) {
      expect(motion.parseDelay(value), `delay ${value}`).toBe(legacy.parseDelay(value));
      expect(motion.parseDepth(value), `depth ${value}`).toBe(legacy.parseDepth(value));
    }
    for (const index of [-1, 0, 0.5, 1, 5, 6, 7, 100, Number.NaN, Infinity]) expect(motion.staggerDelay(index), `stagger ${index}`).toBe(legacy.staggerDelay(index));
  });
  it("revealPose matches the legacy function across the progress range", () => {
    const start = { x: 12, y: -34, scale: 0.9, rotate: 2 };
    for (let p = -0.5; p <= 1.6; p += 0.05) expect(motion.revealPose(start, p), `p ${p}`).toStrictEqual(legacy.revealPose(start, p));
    expect(motion.revealPose(start, 1)).toStrictEqual(legacy.revealPose(start, 1));
  });
  it("revealStart matches the legacy function and an explicit glass flavor", () => {
    for (const personality of legacy.REVEAL_PERSONALITIES) {
      for (const velocity of velocities) {
        const input = { personality, velocity, index: 1, tilt: 2, height: 40 };
        expect(motion.revealStart(input)).toStrictEqual(legacy.revealStart(input));
        expect(motion.revealStart(input, glassFlavor)).toStrictEqual(legacy.revealStart(input));
      }
    }
  });
  it("staggerDelay can still be passed to map", () => {
    expect([0, 1, 2, 9].map(motion.staggerDelay)).toEqual([0, 60, 120, 360]);
  });
});

describe("with another flavor the functions read that flavor", () => {
  it("velocityBlend uses the flavor's thresholds", () => {
    expect(motion.velocityBlend(100, acme)).toBe(0);
    expect(motion.velocityBlend(1000, acme)).toBe(1);
    expect(motion.velocityBlend(550, acme)).toBe(0.5);
    expect(motion.velocityBlend(-550, acme)).toBe(0.5);
    expect(motion.velocityBlend(Number.NaN, acme)).toBe(0);
  });
  it("revealSpring blends the flavor's slow and fast springs", () => {
    expect(motion.revealSpring(0, acme)).toEqual({ stiffness: 100, damping: 20, mass: 1, restSpeed: 0.03, restDelta: 0.003 });
    expect(motion.revealSpring(1000, acme)).toEqual({ stiffness: 200, damping: 10, mass: 1, restSpeed: 0.03, restDelta: 0.003 });
    expect(motion.revealSpring(550, acme)).toEqual({ stiffness: 150, damping: 15, mass: 1, restSpeed: 0.03, restDelta: 0.003 });
  });
  it("parsePersonality knows the flavor's names and falls back to the flavor's fallback", () => {
    expect(motion.parsePersonality("pop", acme)).toBe("pop");
    expect(motion.parsePersonality("wipe", acme)).toBe("wipe");
    expect(motion.parsePersonality("drop", acme)).toBe("float");
    expect(motion.parsePersonality(null, acme)).toBe("float");
    expect(motion.parsePersonality("constructor", acme)).toBe("float");
  });
  it("staggerDelayFor and parseDelay use the flavor's step, cap, and limit", () => {
    expect(motion.staggerDelayFor(2, acme)).toBe(200);
    expect(motion.staggerDelayFor(10, acme)).toBe(300);
    expect(motion.staggerDelayFor(-1, acme)).toBe(0);
    expect(motion.parseDelay("9999", acme)).toBe(500);
    expect(motion.parseDelay("250", acme)).toBe(250);
  });
  it("revealStart asks the flavor's personality, and gives an unknown name the fallback", () => {
    expect(motion.revealStart({ personality: "pop", velocity: 1000 }, acme)).toEqual({ x: 0, y: 60, scale: 0.5, rotate: 3 });
    expect(motion.revealStart({ personality: "pop", velocity: -100 }, acme)).toEqual({ x: 0, y: -10, scale: 0.5, rotate: -3 });
    expect(motion.revealStart({ personality: "wipe", velocity: 0, height: 33 }, acme)).toEqual({ x: 0, y: 33, scale: 1, rotate: 0 });
    expect(motion.revealStart({ personality: "nonsense" as "pop", velocity: 0 }, acme)).toEqual({ x: 0, y: 7, scale: 1, rotate: 0 });
  });
  it("revealPose reaches full opacity at the flavor's point", () => {
    const start = { x: 0, y: 10, scale: 1, rotate: 0 };
    expect(motion.revealPose(start, 0.25, acme).opacity).toBe(0.5);
    expect(motion.revealPose(start, 0.5, acme).opacity).toBe(1);
    expect(motion.revealPose(start, 0.25).opacity).toBeCloseTo(0.25 / 0.6, 12);
  });
  it("parseDepth and dragTarget use the flavor's range and limits", () => {
    expect(motion.parseDepth(null, acme)).toBe(1);
    expect(motion.parseDepth("5", acme)).toBe(2);
    expect(motion.parseDepth("0.1", acme)).toBe(0.2);
    expect(motion.parseDepth("x", acme)).toBe(1);
    expect(motion.dragTarget(800, 2, acme)).toEqual({ shift: 24, turn: 4 });
    expect(motion.dragTarget(-400, 1, acme)).toEqual({ shift: -6, turn: -1 });
    expect(motion.dragTarget(Number.NaN, 1, acme)).toEqual({ shift: 0, turn: 0 });
  });
});

describe("a flavor with no reveal part", () => {
  const bare: Flavor = { name: "bare", prefix: "zz", logLabel: "bare", springs: {} };
  it("fails with a clear error", () => {
    expect(() => motion.velocityBlend(10, bare)).toThrow('The flavor "bare" has no reveal part.');
    expect(() => motion.parseDelay("1", bare)).toThrow(TypeError);
    expect(() => motion.revealStart({ personality: "drop", velocity: 0 }, bare as never)).toThrow(TypeError);
  });
});
