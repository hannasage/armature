import { describe, expect, it } from "vitest";
import { createScrollVelocity, VELOCITY_MAX, type ScrollVelocityOptions } from "../src/core/scroll-velocity";
import { FakeScrollEnv } from "./helpers/fake-scroll-env";

function setup(options?: ScrollVelocityOptions) {
  const env = new FakeScrollEnv();
  const velocity = createScrollVelocity(env, options);
  return { env, velocity };
}

/** Scrolls `perFrame` pixels on each of `frames` frames, as a wheel does. */
function scrollSteadily(env: FakeScrollEnv, perFrame: number, frames: number) {
  for (let i = 0; i < frames; i++) {
    env.scrollTo(env.y + perFrame);
    env.tick();
  }
}

describe("createScrollVelocity", () => {
  it("reads 0 before any scroll, and starts no frame", () => {
    const { env, velocity } = setup();
    expect(velocity.read()).toBe(0);
    expect(env.pending).toBe(0);
    expect(velocity.active).toBe(false);
  });

  it("reads a positive velocity close to the real speed while the page scrolls down", () => {
    const { env, velocity } = setup();
    scrollSteadily(env, 15, 30); // 15 px per 16.67 ms frame is 900 px/s
    expect(velocity.read()).toBeGreaterThan(800);
    expect(velocity.read()).toBeLessThan(950);
  });

  it("reads a negative velocity while the page scrolls up", () => {
    const env = new FakeScrollEnv();
    env.y = 2000;
    const velocity = createScrollVelocity(env);
    scrollSteadily(env, -15, 30);
    expect(velocity.read()).toBeLessThan(-800);
    expect(velocity.read()).toBeGreaterThan(-950);
  });

  it("smooths a sudden jump instead of reading it in one frame", () => {
    const { env, velocity } = setup();
    scrollSteadily(env, 100, 1); // 6000 px/s raw
    const first = velocity.read();
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(3600);
    scrollSteadily(env, 100, 8);
    expect(velocity.read()).toBeGreaterThan(first);
    expect(velocity.read()).toBeLessThanOrEqual(6000);
  });

  it("never reads past the cap, however big the jump", () => {
    const { env, velocity } = setup();
    scrollSteadily(env, 90_000, 5);
    expect(Math.abs(velocity.read())).toBeLessThanOrEqual(VELOCITY_MAX);
    expect(Math.abs(velocity.read())).toBe(VELOCITY_MAX);
  });

  it("decays to exactly 0 once the page stops, and tells its subscribers the 0", () => {
    const { env, velocity } = setup();
    const seen: number[] = [];
    velocity.subscribe(value => seen.push(value));
    scrollSteadily(env, 40, 20);
    expect(velocity.read()).toBeGreaterThan(1500);
    const frames = env.settle();
    expect(frames).toBeGreaterThan(5);
    expect(frames).toBeLessThan(60); // well under a second
    expect(velocity.read()).toBe(0);
    expect(seen[seen.length - 1]).toBe(0);
    expect(velocity.active).toBe(false);
  });

  it("decays smoothly: each frame at rest reads lower than the one before", () => {
    const { env, velocity } = setup();
    scrollSteadily(env, 40, 20);
    let last = velocity.read();
    while (env.pending > 0) {
      env.tick();
      const now = velocity.read();
      expect(now).toBeLessThanOrEqual(last);
      last = now;
    }
  });

  it("runs one animation frame while velocity is non-zero, and none once it is 0 and the page is idle", () => {
    const { env, velocity } = setup();
    env.scrollTo(30);
    expect(env.pending).toBe(1);
    env.scrollTo(60);
    env.scrollTo(90);
    expect(env.pending).toBe(1); // more scroll events do not add frames
    env.tick();
    expect(env.pending).toBe(1);
    env.settle();
    expect(env.pending).toBe(0);
    expect(velocity.read()).toBe(0);
  });

  it("does not start a frame on a scroll event that did not move the page", () => {
    const { env } = setup();
    for (const listener of [...env.scrollListeners]) listener();
    env.tick();
    expect(env.pending).toBe(0);
  });

  it("subscribe returns an unsubscribe, and a subscriber is not called after it", () => {
    const { env, velocity } = setup();
    const seen: number[] = [];
    const off = velocity.subscribe(value => seen.push(value));
    scrollSteadily(env, 20, 3);
    const count = seen.length;
    expect(count).toBeGreaterThan(0);
    off();
    scrollSteadily(env, 20, 3);
    expect(seen.length).toBe(count);
  });

  it("two frames closer than 4 ms apart do not turn one scroll step into a huge velocity", () => {
    const { env, velocity } = setup();
    env.scrollTo(60);
    env.tick(1); // 1 ms later: too soon to sample
    expect(Math.abs(velocity.read())).toBeLessThan(1);
    env.scrollTo(75);
    env.tick(16);
    expect(Math.abs(velocity.read())).toBeLessThan(3000);
  });

  it("a long stall between frames reads as the real average speed", () => {
    const { env, velocity } = setup();
    env.scrollTo(100);
    env.tick(2000); // the tab was busy for 2 s: 100 px in 2 s is 50 px/s
    expect(velocity.read()).toBeGreaterThan(40);
    expect(velocity.read()).toBeLessThan(60);
  });

  it("in driven mode asks the host to wake and requests no frame, and sample(time) does the same work", () => {
    let woke = 0;
    const { env, velocity } = setup({ onWake: () => { woke += 1; } });
    env.scrollTo(15);
    expect(woke).toBe(1);
    expect(env.pending).toBe(0);
    expect(env.requested).toBe(0);
    let time = 0;
    let active = true;
    for (let i = 0; i < 80 && active; i++) {
      time += 1000 / 60;
      if (i < 10) env.y += 15;
      active = velocity.sample(time);
    }
    expect(velocity.read()).toBe(0);
    expect(active).toBe(false);
    expect(env.requested).toBe(0);
  });

  it("destroy removes the scroll listener, cancels the pending frame, and later scrolls do nothing", () => {
    const { env, velocity } = setup();
    env.scrollTo(40);
    expect(env.pending).toBe(1);
    velocity.destroy();
    expect(env.cancelled.length).toBe(1);
    expect(env.pending).toBe(0);
    expect(env.scrollListeners.size).toBe(0);
    expect(env.removedScroll).toBe(env.addedScroll);
    env.scrollTo(400);
    env.tick();
    expect(env.pending).toBe(0);
    expect(velocity.read()).toBe(0);
    velocity.destroy(); // twice is safe
  });
});
