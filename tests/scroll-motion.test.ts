import { describe, expect, it } from "vitest";
import { createSpring, retarget, stepSpring } from "../src/engine/spring";
import {
  DRAG_ROTATE_MAX, DRAG_SHIFT_MAX, FAST_VELOCITY, OFFSET_FAST, OFFSET_SLOW, REST_POSE, SLOW_VELOCITY, TILT_FAST,
  dragTarget, parseDelay, parseDepth, parsePersonality, revealFast, revealPose, revealSlow, revealSpring, revealStart, scrollDirection, staggerDelay, velocityBlend,
} from "../src/dom/reveal-motion";

/** The peak overshoot of a spring from 0 to 1, as a share of the travel, stepped at 60 frames per second. */
function overshoot(config: ReturnType<typeof revealSpring>) {
  let state = retarget(createSpring(config, 0), 1);
  let peak = 0;
  for (let i = 0; i < 600; i++) {
    state = stepSpring(state, 1, 1 / 60);
    peak = Math.max(peak, state.value - 1);
  }
  return peak;
}

describe("velocity blend", () => {
  it("is 0 at a slow speed and 1 at a fast one, with the sign ignored", () => {
    expect(velocityBlend(0)).toBe(0);
    expect(velocityBlend(SLOW_VELOCITY)).toBe(0);
    expect(velocityBlend(-SLOW_VELOCITY)).toBe(0);
    expect(velocityBlend(FAST_VELOCITY)).toBe(1);
    expect(velocityBlend(-FAST_VELOCITY * 3)).toBe(1);
    expect(velocityBlend((SLOW_VELOCITY + FAST_VELOCITY) / 2)).toBeCloseTo(0.5, 5);
  });
  it("reads a bad number as slow", () => {
    expect(velocityBlend(Number.NaN)).toBe(0);
    expect(velocityBlend(Infinity)).toBe(0);
  });
  it("direction is down for 0 and a positive speed, and up for a negative one", () => {
    expect(scrollDirection(0)).toBe(1);
    expect(scrollDirection(900)).toBe(1);
    expect(scrollDirection(-900)).toBe(-1);
    expect(scrollDirection(Number.NaN)).toBe(1);
  });
});

describe("reveal spring", () => {
  it("is the slow constants at a slow speed and the fast constants at a fast one, blended between", () => {
    expect(revealSpring(0)).toMatchObject({ stiffness: 120, damping: 16 });
    expect(revealSpring(FAST_VELOCITY)).toMatchObject({ stiffness: 180, damping: 15 });
    const mid = revealSpring((SLOW_VELOCITY + FAST_VELOCITY) / 2);
    expect(mid.stiffness).toBeCloseTo(150, 5);
    expect(mid.damping).toBeCloseTo(15.5, 5);
  });
  it("the slow spring overshoots by under 4 percent of the travel, and the fast one by about 12 percent", () => {
    expect(overshoot(revealSlow)).toBeGreaterThan(0.02);
    expect(overshoot(revealSlow)).toBeLessThan(0.04);
    expect(overshoot(revealFast)).toBeGreaterThan(0.10);
    expect(overshoot(revealFast)).toBeLessThan(0.14);
    expect(overshoot(revealSpring(2000))).toBeGreaterThan(overshoot(revealSpring(0)));
  });
});

describe("start pose", () => {
  it("a slow scroll starts 28 px away and a fast one 110 px, capped there however fast", () => {
    expect(revealStart({ personality: "drop", velocity: 0 }).y).toBe(OFFSET_SLOW);
    expect(OFFSET_SLOW).toBe(28);
    expect(revealStart({ personality: "drop", velocity: FAST_VELOCITY }).y).toBe(OFFSET_FAST);
    expect(revealStart({ personality: "drop", velocity: 50_000 }).y).toBe(110);
    const mid = revealStart({ personality: "drop", velocity: 1800 }).y;
    expect(mid).toBeGreaterThan(28);
    expect(mid).toBeLessThan(110);
  });
  it("the offset and the tilt flip with the scroll direction", () => {
    const down = revealStart({ personality: "drop", velocity: 2000 });
    const up = revealStart({ personality: "drop", velocity: -2000 });
    expect(up.y).toBe(-down.y);
    expect(up.rotate).toBe(-down.rotate);
    expect(down.rotate).toBeGreaterThan(0);
  });
  it("drop scales from 0.94 and tilts up to 1.5 degrees, or up to a tilt that is given, never past 4", () => {
    const fast = revealStart({ personality: "drop", velocity: FAST_VELOCITY });
    expect(fast.scale).toBe(0.94);
    expect(fast.rotate).toBe(TILT_FAST);
    expect(revealStart({ personality: "drop", velocity: 0 }).rotate).toBeLessThan(TILT_FAST);
    expect(revealStart({ personality: "drop", velocity: FAST_VELOCITY, tilt: 2.2 }).rotate).toBe(2.2);
    expect(revealStart({ personality: "drop", velocity: FAST_VELOCITY, tilt: 99 }).rotate).toBe(4);
  });
  it("slide starts on alternating sides by index, farther when faster", () => {
    expect(revealStart({ personality: "slide", velocity: 0, index: 0 }).x).toBe(-40);
    expect(revealStart({ personality: "slide", velocity: 0, index: 1 }).x).toBe(40);
    expect(revealStart({ personality: "slide", velocity: 0, index: 2 }).x).toBe(-40);
    expect(revealStart({ personality: "slide", velocity: FAST_VELOCITY, index: 3 }).x).toBe(120);
    expect(revealStart({ personality: "slide", velocity: 0, index: 0 }).rotate).toBe(0);
  });
  it("a side given beats the parity of the index", () => {
    expect(revealStart({ personality: "slide", velocity: 0, index: 0, side: 1 }).x).toBe(40);
    expect(revealStart({ personality: "slide", velocity: 0, index: 1, side: -1 }).x).toBe(-40);
    expect(revealStart({ personality: "slide", velocity: FAST_VELOCITY, index: 5, side: 1 }).x).toBe(120);
  });
  it("fade rises 12 px whatever the speed, with no scale or tilt", () => {
    expect(revealStart({ personality: "fade", velocity: 0 })).toEqual({ x: 0, y: 12, scale: 1, rotate: 0 });
    expect(revealStart({ personality: "fade", velocity: -FAST_VELOCITY }).y).toBe(-12);
  });
  it("mask rises by a share of the line height", () => {
    expect(revealStart({ personality: "mask", velocity: 0, height: 50 }).y).toBe(30);
    expect(revealStart({ personality: "mask", velocity: FAST_VELOCITY, height: 50 }).y).toBe(50);
  });
});

describe("pose", () => {
  const start = revealStart({ personality: "drop", velocity: FAST_VELOCITY });
  it("is the start at progress 0 and exactly the rest pose at 1", () => {
    expect(revealPose(start, 0)).toMatchObject({ x: 0, y: 110, scale: 0.94, rotate: 1.5, opacity: 0, clipTop: 100 });
    expect(revealPose(start, 1)).toEqual({ x: 0, y: 0, scale: 1, rotate: 0, opacity: 1, clipTop: 0 });
    expect(revealPose(start, 1)).toEqual(REST_POSE);
  });
  it("overshoots past the rest pose when progress passes 1, and opacity stays at 1", () => {
    const over = revealPose(start, 1.1);
    expect(over.y).toBeCloseTo(-11, 5);
    expect(over.scale).toBeGreaterThan(1);
    expect(over.rotate).toBeLessThan(0);
    expect(over.opacity).toBe(1);
    expect(over.clipTop).toBeLessThan(0);
  });
  it("is solid before it has finished moving", () => {
    expect(revealPose(start, 0.6).opacity).toBe(1);
    expect(revealPose(start, 0.3).opacity).toBeCloseTo(0.5, 5);
  });
});

describe("stagger and parsing", () => {
  it("steps 60 ms and caps at 6 steps", () => {
    expect([0, 1, 2, 5, 6, 7, 40].map(staggerDelay)).toEqual([0, 60, 120, 300, 360, 360, 360]);
    expect(staggerDelay(-1)).toBe(0);
    expect(staggerDelay(Number.NaN)).toBe(0);
  });
  it("reads a delay in whole ms, 0 for anything bad, and 2000 at most", () => {
    expect(parseDelay("120.9")).toBe(120);
    expect(parseDelay("-5")).toBe(0);
    expect(parseDelay("soon")).toBe(0);
    expect(parseDelay(null)).toBe(0);
    expect(parseDelay("")).toBe(0);
    expect(parseDelay("99999")).toBe(2000);
  });
  it("reads a personality, and anything unknown is drop", () => {
    expect(["drop", "mask", "slide", "fade", "spin", "", null, undefined].map(value => parsePersonality(value))).toEqual(["drop", "mask", "slide", "fade", "drop", "drop", "drop", "drop"]);
  });
});

describe("drag", () => {
  it("is 0 at rest and grows with the speed to 6 px and 0.8 degrees at full depth", () => {
    expect(dragTarget(0, 1)).toEqual({ shift: 0, turn: 0 });
    expect(dragTarget(800, 1).shift).toBeCloseTo(3, 5);
    expect(dragTarget(1600, 1)).toEqual({ shift: DRAG_SHIFT_MAX, turn: DRAG_ROTATE_MAX });
  });
  it("is clamped however fast the page scrolls, and signed with the scroll", () => {
    expect(dragTarget(90_000, 1)).toEqual({ shift: 6, turn: 0.8 });
    expect(dragTarget(-90_000, 1)).toEqual({ shift: -6, turn: -0.8 });
    expect(dragTarget(Number.NaN, 1)).toEqual({ shift: 0, turn: 0 });
  });
  it("scales with depth, clamped from 0.4 to 1", () => {
    expect(dragTarget(1600, 0.5).shift).toBeCloseTo(3, 5);
    expect(dragTarget(1600, 0.1).shift).toBeCloseTo(2.4, 5);
    expect(dragTarget(1600, 5).shift).toBe(6);
  });
  it("reads a depth, 0.7 by default and for a bad value, clamped to 0.4 to 1", () => {
    expect(parseDepth("0.55")).toBe(0.55);
    expect(parseDepth("0.1")).toBe(0.4);
    expect(parseDepth("3")).toBe(1);
    expect(parseDepth("deep")).toBe(0.7);
    expect(parseDepth(null)).toBe(0.7);
  });
});
