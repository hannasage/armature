import { afterEach, describe, expect, it, vi } from "vitest";
import { createScheduler } from "../../src/frame";
import { numberKind, vectorKind } from "../../src/values";
import { FIXED_STEP } from "../../src/engine/spring";
import { createTweenValue, easing } from "../../src/curves";
import { FakeEnv } from "../helpers/fake-env";

// The tween value controller: a tween over a kind, run by the G1 scheduler.

function setup() {
  const env = new FakeEnv();
  const scheduler = createScheduler(env);
  return { env, scheduler };
}

afterEach(() => vi.restoreAllMocks());

describe("a number tween value", () => {
  it("starts at rest on its initial value and asks for no frame", () => {
    const { env, scheduler } = setup();
    const value = createTweenValue(scheduler, numberKind, 3, { duration: 0.5 });
    expect(value.get()).toBe(3);
    expect(value.getState()).toEqual({ value: 3, target: 3, moving: false });
    expect(env.requested).toBe(0);
    expect(scheduler.size).toBe(0);
  });

  it("runs on the scheduler, calls onChange per frame, and ends exactly on the target", () => {
    const { scheduler } = setup();
    const seen: number[] = [];
    const value = createTweenValue(scheduler, numberKind, 0.1, { duration: 0.5, onChange: (v) => seen.push(v) });
    value.to(0.3);
    expect(value.getState().moving).toBe(true);
    for (let i = 0; i < 100; i += 1) scheduler.advance(1 / 60);
    expect(value.get()).toBe(0.3);
    expect(seen.at(-1)).toBe(0.3);
    expect(value.getState().moving).toBe(false);
    expect(scheduler.size).toBe(0);
  });

  it("follows its curve at the middle of the move", () => {
    const { scheduler } = setup();
    const curve = easing("projection");
    const value = createTweenValue(scheduler, numberKind, 0, { duration: 1, curve });
    value.to(10);
    for (let i = 0; i < 60; i += 1) scheduler.advance(FIXED_STEP);
    expect(value.get()).toBeCloseTo(10 * curve(0.5), 6);
  });

  it("takes a duration and a curve for one move", () => {
    const { scheduler } = setup();
    const value = createTweenValue(scheduler, numberKind, 0, { duration: 5 });
    value.to(4, { duration: 0.1 });
    for (let i = 0; i < 20; i += 1) scheduler.advance(FIXED_STEP);
    expect(value.get()).toBe(4);
  });

  it("turns in flight from the value on screen", () => {
    const { scheduler } = setup();
    const value = createTweenValue(scheduler, numberKind, 0, { duration: 1 });
    value.to(10);
    for (let i = 0; i < 60; i += 1) scheduler.advance(FIXED_STEP);
    const mid = value.get();
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(10);
    value.to(-10);
    expect(value.getState().target).toBe(-10);
    scheduler.advance(FIXED_STEP);
    expect(Math.abs(value.get() - mid)).toBeLessThan(1);
    for (let i = 0; i < 200; i += 1) scheduler.advance(FIXED_STEP);
    expect(value.get()).toBe(-10);
  });

  it("jumps with set(), stops the frame, and calls onChange", () => {
    const { scheduler } = setup();
    const seen: number[] = [];
    const value = createTweenValue(scheduler, numberKind, 0, { duration: 1, onChange: (v) => seen.push(v) });
    value.to(10);
    value.set(7);
    expect(value.get()).toBe(7);
    expect(value.getState()).toEqual({ value: 7, target: 7, moving: false });
    expect(scheduler.size).toBe(0);
    expect(seen.at(-1)).toBe(7);
  });

  it("jumps to the target at once when reduced motion is on", () => {
    const { scheduler } = setup();
    const value = createTweenValue(scheduler, numberKind, 0, { duration: 1, reducedMotion: () => true });
    value.to(9);
    expect(value.get()).toBe(9);
    expect(scheduler.size).toBe(0);
  });

  it("jumps at once for a zero duration", () => {
    const { scheduler } = setup();
    const value = createTweenValue(scheduler, numberKind, 0, { duration: 0 });
    value.to(9);
    expect(value.get()).toBe(9);
    expect(scheduler.size).toBe(0);
  });

  it("throws a TypeError for a target the kind cannot parse, and changes nothing", () => {
    const { scheduler } = setup();
    const value = createTweenValue(scheduler, numberKind, 1, { duration: 1 });
    expect(() => value.to(Number.NaN)).toThrow(TypeError);
    expect(value.getState()).toEqual({ value: 1, target: 1, moving: false });
  });

  it("throws a TypeError for a duration that is not usable", () => {
    const { scheduler } = setup();
    expect(() => createTweenValue(scheduler, numberKind, 0, { duration: -1 })).toThrow(TypeError);
    const value = createTweenValue(scheduler, numberKind, 0, { duration: 1 });
    expect(() => value.to(1, { duration: Number.NaN })).toThrow(TypeError);
  });

  it("ignores every call after destroy and keeps the last value", () => {
    const { scheduler } = setup();
    const value = createTweenValue(scheduler, numberKind, 0, { duration: 1 });
    value.to(10);
    scheduler.advance(0.1);
    const at = value.get();
    value.destroy();
    value.destroy();
    value.to(50);
    value.set(3);
    expect(value.get()).toBe(at);
    expect(scheduler.size).toBe(0);
  });

  it("leaves the frame loop when onChange throws, and recovers on the next to()", () => {
    const { scheduler } = setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let fail = true;
    const value = createTweenValue(scheduler, numberKind, 0, {
      duration: 1,
      onChange: () => {
        if (fail) throw new Error("draw failed");
      },
    });
    value.to(10);
    scheduler.advance(FIXED_STEP);
    expect(scheduler.size).toBe(0);
    fail = false;
    value.to(5);
    for (let i = 0; i < 200; i += 1) scheduler.advance(FIXED_STEP);
    expect(value.get()).toBe(5);
  });
});

describe("a vector tween value", () => {
  it("tweens every component and ends exactly on the target", () => {
    const { scheduler } = setup();
    const value = createTweenValue(scheduler, vectorKind(2), [0, 0], { duration: 0.3, curve: easing("ease-in-out") });
    value.to([0.7, -0.1]);
    for (let i = 0; i < 100; i += 1) scheduler.advance(FIXED_STEP);
    expect(value.get()).toEqual([0.7, -0.1]);
  });

  it("throws a TypeError for a target of the wrong length", () => {
    const { scheduler } = setup();
    const value = createTweenValue(scheduler, vectorKind(2), [0, 0], { duration: 0.3 });
    expect(() => value.to([1] as unknown as number[])).toThrow(TypeError);
  });
});

describe("failure and teardown", () => {
  it("snaps to the target, stops, and throws when the curve returns a value that is not finite", () => {
    const { scheduler } = setup();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const value = createTweenValue(scheduler, numberKind, 0, { duration: 1, curve: () => Number.NaN });
    value.to(10);
    scheduler.advance(FIXED_STEP);
    expect(logged).toHaveBeenCalled();
    expect(String(logged.mock.calls[0])).toMatch(/not finite/);
    expect(value.get()).toBe(10);
    expect(value.getState()).toEqual({ value: 10, target: 10, moving: false });
    expect(scheduler.size).toBe(0);
  });

  it("also rejects an infinite curve output", () => {
    const { scheduler } = setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const value = createTweenValue(scheduler, numberKind, 0, { duration: 1, curve: () => Number.POSITIVE_INFINITY });
    value.to(10);
    scheduler.advance(FIXED_STEP);
    expect(value.getState().moving).toBe(false);
    expect(value.get()).toBe(10);
  });

  it("rests on the target when the kind throws inside a step, so moving is false", () => {
    const { scheduler } = setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = { ...numberKind, interpolate: () => { throw new Error("blend failed"); } };
    const value = createTweenValue(scheduler, broken, 0, { duration: 1 });
    value.to(10);
    scheduler.advance(FIXED_STEP);
    expect(value.getState()).toEqual({ value: 10, target: 10, moving: false });
    expect(scheduler.size).toBe(0);
  });

  it("calls onChange with the target after a step fails on a curve value that is not finite", () => {
    const { scheduler } = setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const seen: number[] = [];
    const value = createTweenValue(scheduler, numberKind, 0, { duration: 1, curve: () => Number.NaN, onChange: (v) => seen.push(v) });
    value.to(10);
    scheduler.advance(FIXED_STEP);
    expect(seen).toEqual([10]);
    expect(value.get()).toBe(10);
  });

  it("calls onChange with the target after the kind throws inside a step", () => {
    const { scheduler } = setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const seen: number[] = [];
    const broken = { ...numberKind, interpolate: () => { throw new Error("blend failed"); } };
    const value = createTweenValue(scheduler, broken, 0, { duration: 1, onChange: (v) => seen.push(v) });
    value.to(10);
    scheduler.advance(FIXED_STEP);
    expect(seen).toEqual([10]);
  });

  it("still throws the step error when onChange throws during the snap", () => {
    const { scheduler } = setup();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const value = createTweenValue(scheduler, numberKind, 0, {
      duration: 1,
      curve: () => Number.NaN,
      onChange: () => { throw new Error("draw failed"); },
    });
    value.to(10);
    scheduler.advance(FIXED_STEP);
    expect(String(logged.mock.calls[0])).toMatch(/not finite/);
    expect(value.getState().moving).toBe(false);
  });

  it("recovers on the next to() after a step throws", () => {
    const { scheduler } = setup();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let fail = true;
    const kind = { ...numberKind, interpolate: (a: number, b: number, p: number) => { if (fail) throw new Error("x"); return numberKind.interpolate(a, b, p); } };
    const value = createTweenValue(scheduler, kind, 0, { duration: 0.1 });
    value.to(10);
    scheduler.advance(FIXED_STEP);
    fail = false;
    value.to(2);
    for (let i = 0; i < 50; i += 1) scheduler.advance(FIXED_STEP);
    expect(value.get()).toBe(2);
  });

  it("reports moving as false after destroy in the middle of a move, and keeps the value", () => {
    const { scheduler } = setup();
    const value = createTweenValue(scheduler, numberKind, 0, { duration: 1 });
    value.to(10);
    scheduler.advance(0.1);
    const at = value.get();
    expect(value.getState().moving).toBe(true);
    value.destroy();
    expect(value.getState()).toEqual({ value: at, target: at, moving: false });
    expect(value.get()).toBe(at);
  });
});
