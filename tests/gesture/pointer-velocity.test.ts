import { describe, expect, it } from "vitest";
import { VELOCITY_MAX, VELOCITY_SMOOTHING_MS } from "../../src/engine/scroll-velocity";
import { createPointerVelocity } from "../../src/gesture";

describe("the pointer velocity tracker", () => {
  it("reads 0 on both axes before any sample, and after one sample", () => {
    const tracker = createPointerVelocity();
    expect(tracker.read(0)).toEqual({ x: 0, y: 0 });
    tracker.add(10, 10, 0);
    expect(tracker.read(0)).toEqual({ x: 0, y: 0 });
  });

  it("reads the speed of a steady move, in pixels per second and signed on each axis", () => {
    const tracker = createPointerVelocity();
    for (let i = 0; i <= 10; i++) tracker.add(i * 8, 100 - i * 4, i * 8);
    const v = tracker.read(80);
    expect(v.x).toBeCloseTo(1000, 6);
    expect(v.y).toBeCloseTo(-500, 6);
  });

  it("smooths with a time constant of 70 ms, so a change in speed is followed by the exponential", () => {
    expect(VELOCITY_SMOOTHING_MS).toBe(70);
    const tracker = createPointerVelocity();
    tracker.add(0, 0, 0);
    tracker.add(8, 0, 8); // 1000 px/s, the seed
    tracker.add(8, 0, 78); // raw speed 0 for 70 ms
    expect(tracker.read(78).x).toBeCloseTo(1000 * Math.exp(-1), 6);
  });

  it("decays an idle pointer: a read later than the last sample is the speed times the exponential of the idle time", () => {
    const tracker = createPointerVelocity();
    for (let i = 0; i <= 10; i++) tracker.add(i * 8, 0, i * 8);
    expect(tracker.read(80 + 70).x).toBeCloseTo(1000 * Math.exp(-1), 6);
    expect(tracker.read(80 + 700).x).toBeCloseTo(1000 * Math.exp(-10), 6);
  });

  it("treats two samples closer than 4 ms as one, so a jump in a single millisecond never reads as a huge speed", () => {
    const tracker = createPointerVelocity();
    tracker.add(0, 0, 0);
    tracker.add(100, 0, 1);
    expect(tracker.read(1)).toEqual({ x: 0, y: 0 });
    tracker.add(100, 0, 10); // measured from the first sample: 100 px in 10 ms
    expect(tracker.read(10).x).toBeCloseTo(10_000, 6);
  });

  it("never reads faster than VELOCITY_MAX", () => {
    const tracker = createPointerVelocity();
    tracker.add(0, 0, 0);
    tracker.add(5000, -5000, 10);
    expect(tracker.read(10)).toEqual({ x: VELOCITY_MAX, y: -VELOCITY_MAX });
  });

  it("starts again after reset", () => {
    const tracker = createPointerVelocity();
    tracker.add(0, 0, 0);
    tracker.add(80, 0, 80);
    tracker.reset();
    expect(tracker.read(80)).toEqual({ x: 0, y: 0 });
    tracker.add(500, 500, 100);
    tracker.add(500, 500, 108);
    expect(tracker.read(108)).toEqual({ x: 0, y: 0 });
  });

  it("takes its own time constant, and falls back to 70 ms for one that is not finite and above 0", () => {
    const slow = createPointerVelocity({ smoothingMs: 140 });
    slow.add(0, 0, 0);
    slow.add(8, 0, 8);
    expect(slow.read(8 + 140).x).toBeCloseTo(1000 * Math.exp(-1), 6);
    for (const bad of [0, -3, Number.NaN, Infinity]) {
      const tracker = createPointerVelocity({ smoothingMs: bad });
      tracker.add(0, 0, 0);
      tracker.add(8, 0, 8);
      expect(tracker.read(78).x, String(bad)).toBeCloseTo(1000 * Math.exp(-1), 6);
    }
  });

  it("ignores a sample that goes back in time or is not finite, and a read in the past", () => {
    const tracker = createPointerVelocity();
    tracker.add(0, 0, 100);
    tracker.add(8, 0, 108);
    const before = tracker.read(108);
    tracker.add(500, 0, 50);
    tracker.add(Number.NaN, 0, 120);
    tracker.add(0, Infinity, 120);
    tracker.add(0, 0, Number.NaN);
    expect(tracker.read(108)).toEqual(before);
    expect(tracker.read(20)).toEqual(before);
  });
});
