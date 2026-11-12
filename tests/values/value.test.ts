import { afterEach, describe, expect, it, vi } from "vitest";
import { createScheduler, type Scheduler } from "../../src/frame";
import { createValue, numberKind, vectorKind } from "../../src/values";
import { createSpring, FIXED_STEP, retarget, stepSpring, type SpringConfig } from "../../src/engine/spring";
import { FakeEnv } from "../helpers/fake-env";

// The value controller: a spring over a kind, stepped by the shared scheduler.

const spring: SpringConfig = { stiffness: 220, damping: 14, restDelta: 0.001, restSpeed: 0.01 };
const calm: SpringConfig = { stiffness: 120, damping: 26, restDelta: 0.001, restSpeed: 0.01 };

function setup() {
  const env = new FakeEnv();
  const scheduler = createScheduler(env);
  return { env, scheduler };
}

afterEach(() => vi.restoreAllMocks());

describe("a number value", () => {
  it("starts at rest on its initial value and asks for no frame", () => {
    const { env, scheduler } = setup();
    const value = createValue(scheduler, numberKind, 3, { spring });
    expect(value.get()).toBe(3);
    expect(value.getState()).toEqual({ value: 3, velocity: 0, target: 3, moving: false });
    expect(env.pending).toBe(0);
  });

  it("springs to a target through the scheduler and matches the scalar spring slice by slice", () => {
    const { env, scheduler } = setup();
    const seen: number[] = [];
    const value = createValue(scheduler, numberKind, 0, { spring, onChange: (next) => seen.push(next) });
    value.to(1);
    expect(env.pending).toBe(1);
    expect(value.getState().moving).toBe(true);
    // One frame of 1/120 s is one slice, so each frame's value is the scalar spring's value after one more slice.
    let scalar = retarget(createSpring(spring, 0), 1);
    const expected: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      env.tick(FIXED_STEP * 1000);
      scalar = stepSpring(scalar, 1, FIXED_STEP);
      expected.push(scalar.value);
    }
    expect(seen.slice(0, 40)).toEqual(expected);
    env.settle(1000 / 60);
    expect(value.getState()).toEqual({ value: 1, velocity: 0, target: 1, moving: false });
    expect(env.pending).toBe(0);
    expect(scheduler.size).toBe(0);
  });

  it("calls onChange once per frame in which the value changed, with the final value last", () => {
    const { env, scheduler } = setup();
    const seen: number[] = [];
    const value = createValue(scheduler, numberKind, 0, { spring, onChange: (next) => seen.push(next) });
    value.to(1);
    env.tick(1000 / 30);
    expect(seen).toHaveLength(1);
    env.settle(1000 / 30);
    expect(seen[seen.length - 1]).toBe(1);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("keeps its speed when the target turns in flight", () => {
    const { env, scheduler } = setup();
    const value = createValue(scheduler, numberKind, 0, { spring });
    value.to(1);
    for (let i = 0; i < 8; i += 1) env.tick(1000 / 60);
    const before = value.getState();
    value.to(0);
    const after = value.getState();
    expect(after.value).toBe(before.value);
    expect(after.velocity).toBe(before.velocity);
    expect(after.target).toBe(0);
  });

  it("takes a spring for one move, and keeps it for the next", () => {
    const a = setup();
    const b = setup();
    const first = createValue(a.scheduler, numberKind, 0, { spring });
    const second = createValue(b.scheduler, numberKind, 0, { spring: calm });
    first.to(1, { spring: calm });
    second.to(1);
    for (let i = 0; i < 30; i += 1) {
      a.env.tick(1000 / 60);
      b.env.tick(1000 / 60);
    }
    expect(first.get()).toBe(second.get());
    first.to(0);
    second.to(0);
    for (let i = 0; i < 30; i += 1) {
      a.env.tick(1000 / 60);
      b.env.tick(1000 / 60);
    }
    expect(first.get()).toBe(second.get());
  });

  it("jumps with set, with no travel and no velocity, and stops the frame", () => {
    const { env, scheduler } = setup();
    const seen: number[] = [];
    const value = createValue(scheduler, numberKind, 0, { spring, onChange: (next) => seen.push(next) });
    value.to(1);
    env.tick(1000 / 60);
    value.set(0.4);
    expect(value.getState()).toEqual({ value: 0.4, velocity: 0, target: 0.4, moving: false });
    expect(seen[seen.length - 1]).toBe(0.4);
    expect(scheduler.size).toBe(0);
    expect(env.pending).toBe(0);
  });

  it("finishes at once, with no frame, when the target is the value", () => {
    const { env, scheduler } = setup();
    const seen: number[] = [];
    const value = createValue(scheduler, numberKind, 2, { spring, onChange: (next) => seen.push(next) });
    value.to(2);
    expect(env.pending).toBe(0);
    expect(seen).toEqual([]);
  });

  it("snaps under reduced motion", () => {
    const { env, scheduler } = setup();
    let reduced = true;
    const value = createValue(scheduler, numberKind, 0, { spring, reducedMotion: () => reduced });
    value.to(1);
    expect(value.getState()).toEqual({ value: 1, velocity: 0, target: 1, moving: false });
    expect(env.pending).toBe(0);
    reduced = false;
    value.to(0);
    expect(value.getState().moving).toBe(true);
  });

  it("throws a TypeError for a target that is not a finite number, and changes nothing", () => {
    const { env, scheduler } = setup();
    const value = createValue(scheduler, numberKind, 1, { spring });
    for (const bad of [NaN, Infinity, "2", null, undefined]) expect(() => value.to(bad as never), String(bad)).toThrow(TypeError);
    expect(() => value.set(NaN)).toThrow(TypeError);
    expect(value.getState()).toEqual({ value: 1, velocity: 0, target: 1, moving: false });
    expect(env.pending).toBe(0);
  });

  it("throws a TypeError at creation for an initial value that is not a finite number", () => {
    const { scheduler } = setup();
    expect(() => createValue(scheduler, numberKind, NaN, { spring })).toThrow(TypeError);
  });

  it("ignores every call after destroy and leaves the scheduler empty", () => {
    const { env, scheduler } = setup();
    const value = createValue(scheduler, numberKind, 0, { spring });
    value.to(1);
    value.destroy();
    expect(scheduler.size).toBe(0);
    expect(env.pending).toBe(0);
    value.to(5);
    value.set(3);
    expect(env.pending).toBe(0);
    expect(value.get()).toBeLessThan(1);
    expect(() => value.destroy()).not.toThrow();
  });

  it("logs a throwing onChange once, removes the task, and rests", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { env, scheduler } = setup();
    const value = createValue(scheduler, numberKind, 0, { spring, onChange: () => { throw new Error("boom"); } });
    value.to(1);
    env.tick(1000 / 60);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(scheduler.size).toBe(0);
  });
});

describe("a throwing onChange", () => {
  it("leaves the last emitted value unchanged, so the next emit retries", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { env, scheduler } = setup();
    let fail = true;
    const seen: number[] = [];
    const value = createValue(scheduler, numberKind, 0, {
      spring,
      onChange: (next) => {
        if (fail) throw new Error("boom");
        seen.push(next);
      },
    });
    value.to(1);
    env.tick(1000 / 60);
    expect(scheduler.size).toBe(0);
    fail = false;
    value.set(1);
    expect(seen).toEqual([1]);
  });
});

describe("a vector value", () => {
  it("springs each component and rests when every component rests", () => {
    const { env, scheduler } = setup();
    const seen: number[][] = [];
    const point = createValue(scheduler, vectorKind(2), [0, 10], { spring, onChange: (next) => seen.push(next) });
    point.to([1, -10]);
    for (let i = 0; i < 6; i += 1) env.tick(1000 / 60);
    const x = retarget(createSpring(spring, 0), 1);
    const y = retarget(createSpring(spring, 10), -10);
    let sx = x;
    let sy = y;
    for (let i = 0; i < 12; i += 1) {
      sx = stepSpring(sx, 1, FIXED_STEP);
      sy = stepSpring(sy, -10, FIXED_STEP);
    }
    expect(point.get()).toEqual([sx.value, sy.value]);
    env.settle(1000 / 60);
    expect(point.get()).toEqual([1, -10]);
    expect(point.getState()).toEqual({ value: [1, -10], velocity: [0, 0], target: [1, -10], moving: false });
  });

  it("gives out a copy, so a caller cannot change the state", () => {
    const { scheduler } = setup();
    const point = createValue(scheduler, vectorKind(2), [1, 2], { spring });
    point.get()[0] = 99;
    expect(point.get()).toEqual([1, 2]);
  });

  it("throws a TypeError for a target of the wrong length", () => {
    const { scheduler } = setup();
    const point = createValue(scheduler, vectorKind(2), [0, 0], { spring });
    expect(() => point.to([1, 2, 3])).toThrow(TypeError);
  });
});

describe("two values on one scheduler", () => {
  it("do not change each other's frames", () => {
    const solo = setup();
    const lone = createValue(solo.scheduler, numberKind, 0, { spring });
    lone.to(1);
    const shared = setup();
    const one = createValue(shared.scheduler, numberKind, 0, { spring });
    const two = createValue(shared.scheduler, numberKind, 5, { spring: calm });
    one.to(1);
    two.to(0);
    for (let i = 0; i < 25; i += 1) {
      solo.env.tick(1000 / 60);
      shared.env.tick(1000 / 60);
    }
    expect(one.get()).toBe(lone.get());
    expect(two.get()).not.toBe(5);
  });

  it("use a manual scheduler with advance", () => {
    const env = new FakeEnv();
    const scheduler: Scheduler = createScheduler(env);
    const value = createValue(scheduler, numberKind, 0, { spring });
    value.to(1);
    scheduler.advance(1 / 60);
    expect(value.get()).toBeGreaterThan(0);
  });
});
