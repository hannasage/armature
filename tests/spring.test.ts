import { describe, expect, it } from "vitest";
import {
  FIXED_STEP,
  createSpring,
  criticalDamping,
  gentle,
  isAtRest,
  lensWidth,
  lensX,
  press,
  release,
  reconfigure,
  retarget,
  stepSpring,
  stiff,
  type SpringConfig,
  type SpringState,
} from "../src/core/spring";

/** Steps in 1/60 s frames until rest. Returns the frames used, the highest value seen, and the end state. */
function run(config: SpringConfig, from: number, to: number, frameSeconds = 1 / 60, limit = 20_000) {
  let state = retarget(createSpring(config, from), to);
  let peak = from;
  let frames = 0;
  while (!isAtRest(state) && frames < limit) {
    state = stepSpring(state, to, frameSeconds);
    peak = Math.max(peak, state.value);
    frames += 1;
  }
  return { frames, peak, state };
}

describe("spring presets", () => {
  it("export the stiffness, damping, and mass the design names", () => {
    expect(lensX).toMatchObject({ stiffness: 210, damping: 20, mass: 1 });
    expect(lensWidth).toMatchObject({ stiffness: 180, damping: 12, mass: 1 });
    expect(press).toMatchObject({ stiffness: 170, damping: 26, mass: 1 });
    expect(gentle).toMatchObject({ stiffness: 120, damping: 14, mass: 1 });
    expect(stiff).toMatchObject({ stiffness: 210, damping: 20, mass: 1 });
    expect(release).toMatchObject({ stiffness: 300, damping: 14, mass: 1 });
  });

  it("release overshoots by about a quarter of its travel", () => {
    const { peak } = run(release, 0, 100);
    expect(peak - 100).toBeGreaterThan(20);
    expect(peak - 100).toBeLessThan(30);
  });

  it("are frozen, so one caller cannot retune another", () => {
    expect(Object.isFrozen(lensX)).toBe(true);
    expect(() => { (lensX as { stiffness: number }).stiffness = 1; }).toThrow();
  });
});

describe("createSpring", () => {
  it("starts at rest on its starting value", () => {
    const state = createSpring(lensX, 5);
    expect(state).toMatchObject({ value: 5, velocity: 0, target: 5 });
    expect(isAtRest(state)).toBe(true);
  });

  it("defaults the start to 0 and the mass to 1", () => {
    const state = createSpring({ stiffness: 100, damping: 10 });
    expect(state.value).toBe(0);
    expect(state.config.mass).toBe(1);
  });

  it("replaces a broken config with safe numbers instead of throwing", () => {
    const state = createSpring({ stiffness: Number.NaN, damping: -3, mass: 0 }, Number.POSITIVE_INFINITY);
    expect(Number.isFinite(state.config.stiffness) && state.config.stiffness > 0).toBe(true);
    expect(Number.isFinite(state.config.damping) && state.config.damping >= 0).toBe(true);
    expect(state.config.mass).toBeGreaterThan(0);
    expect(state.value).toBe(0);
  });

  it("computes critical damping as 2 sqrt(k m)", () => {
    expect(criticalDamping(210, 1)).toBeCloseTo(2 * Math.sqrt(210), 12);
    expect(criticalDamping(100, 4)).toBeCloseTo(40, 12);
  });
});

describe("stepSpring numerics", () => {
  it("a critically damped spring never overshoots", () => {
    for (const stiffness of [60, 120, 210, 600]) {
      const config = { stiffness, damping: criticalDamping(stiffness, 1) };
      const { peak, state } = run(config, 0, 100);
      expect(peak, `stiffness ${stiffness}`).toBeLessThanOrEqual(100 + 1e-6);
      expect(state.value).toBe(100);
    }
  });

  it("a critically damped spring never overshoots going down either", () => {
    const config = { stiffness: 210, damping: criticalDamping(210, 1) };
    let state = retarget(createSpring(config, 100), 0);
    let lowest = 100;
    for (let frame = 0; frame < 600 && !isAtRest(state); frame += 1) {
      state = stepSpring(state, 0, 1 / 60);
      lowest = Math.min(lowest, state.value);
    }
    expect(lowest).toBeGreaterThanOrEqual(-1e-6);
  });

  it("an underdamped spring overshoots, and by about the textbook amount", () => {
    const config = { stiffness: 210, damping: 10 };
    const { peak } = run(config, 0, 100);
    const zeta = config.damping / criticalDamping(210, 1);
    const expected = 100 * Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta));
    expect(peak).toBeGreaterThan(100);
    expect(peak - 100).toBeGreaterThan(expected * 0.9);
    expect(peak - 100).toBeLessThan(expected * 1.1);
  });

  it("the shipped presets that overshoot do so by a small, bounded amount", () => {
    for (const [name, config] of [["lensX", lensX], ["lensWidth", lensWidth], ["gentle", gentle]] as const) {
      const { peak } = run(config, 0, 100);
      expect(peak, name).toBeGreaterThan(100);
      expect(peak, name).toBeLessThan(140);
    }
  });

  it("press is nearly critically damped, so it barely overshoots", () => {
    const { peak } = run(press, 0, 100);
    expect(peak).toBeLessThan(100.5);
  });

  it("a stiffer spring at the same damping ratio settles faster", () => {
    const soft = run({ stiffness: 60, damping: criticalDamping(60, 1) }, 0, 100);
    const firm = run({ stiffness: 240, damping: criticalDamping(240, 1) }, 0, 100);
    expect(firm.frames).toBeLessThan(soft.frames);
  });

  it("a stiffer spring with the same damping arrives at the target sooner", () => {
    const timeToTarget = (stiffness: number) => {
      let state = retarget(createSpring({ stiffness, damping: 14 }, 0), 100);
      for (let frame = 1; frame < 2000; frame += 1) {
        state = stepSpring(state, 100, 1 / 60);
        if (state.value >= 100) return frame;
      }
      return Number.POSITIVE_INFINITY;
    };
    expect(timeToTarget(300)).toBeLessThan(timeToTarget(100));
  });

  it("settles on the exact target and reports rest", () => {
    const { state } = run(lensX, 0, 250);
    expect(state.value).toBe(250);
    expect(state.velocity).toBe(0);
    expect(isAtRest(state)).toBe(true);
  });

  it("settles in under two seconds for every preset", () => {
    for (const config of [lensX, lensWidth, press, gentle, stiff]) {
      expect(run(config, 0, 100).frames).toBeLessThan(120);
    }
  });

  it("tracks the closed-form critically damped solution within 5 percent of the travel", () => {
    // x(t) = target - (target - x0)(1 + w t) e^{-w t}, with w = sqrt(k/m).
    const k = 210;
    const w = Math.sqrt(k);
    let state = retarget(createSpring({ stiffness: k, damping: criticalDamping(k, 1) }, 0), 1);
    for (let frame = 1; frame <= 30; frame += 1) {
      state = stepSpring(state, 1, 1 / 60);
      const t = frame / 60;
      const exact = 1 - (1 + w * t) * Math.exp(-w * t);
      // Semi-implicit Euler is first order. Measured worst case is 3.8 percent of the travel, at 83 ms.
      expect(Math.abs(state.value - exact), `t=${t}`).toBeLessThan(0.05);
    }
  });

  it("does not depend on the frame rate: 1 x 16.7 ms lands near 2 x 8.35 ms", () => {
    const config = lensX;
    const whole = stepSpring(retarget(createSpring(config, 0), 100), 100, 0.0167);
    let halves = retarget(createSpring(config, 0), 100);
    halves = stepSpring(halves, 100, 0.00835);
    halves = stepSpring(halves, 100, 0.00835);
    expect(Math.abs(whole.value - halves.value)).toBeLessThan(0.05);
    expect(Math.abs(whole.velocity - halves.velocity)).toBeLessThan(1);
  });

  it("lands in the same place after one second at 30, 60, and 144 frames per second", () => {
    const at = (fps: number) => {
      let state = retarget(createSpring(lensWidth, 0), 100);
      for (let frame = 0; frame < fps; frame += 1) state = stepSpring(state, 100, 1 / fps);
      return state;
    };
    const reference = at(240);
    for (const fps of [30, 60, 144]) {
      expect(Math.abs(at(fps).value - reference.value), `${fps} fps`).toBeLessThan(0.6);
    }
  });

  it("matches a step-by-step reference to within a pixel at uneven frame times", () => {
    const frames = [0.004, 0.0167, 0.0333, 0.0083, 0.0167, 0.025, 0.0125, 0.0167];
    let uneven = retarget(createSpring(lensX, 0), 100);
    for (const dt of frames) uneven = stepSpring(uneven, 100, dt);
    const total = frames.reduce((a, b) => a + b, 0);
    let fine = retarget(createSpring(lensX, 0), 100);
    for (let i = 0; i < 1000; i += 1) fine = stepSpring(fine, 100, total / 1000);
    expect(Math.abs(uneven.value - fine.value)).toBeLessThan(0.5);
  });

  it("uses the fixed step: a frame shorter than one step still moves the display value, and two halves equal one whole step", () => {
    expect(FIXED_STEP).toBeCloseTo(1 / 120, 12);
    const start = retarget(createSpring(lensX, 0), 100);
    const half = stepSpring(start, 100, FIXED_STEP / 2);
    expect(half.value).toBeGreaterThan(0);
    expect(half.value).toBeLessThan(0.5);
    const whole = stepSpring(start, 100, FIXED_STEP);
    const twoHalves = stepSpring(half, 100, FIXED_STEP / 2);
    expect(Math.abs(twoHalves.value - whole.value)).toBeLessThan(1e-9);
  });

  it("returns the same state for a zero, negative, or non-finite dt", () => {
    const start = stepSpring(retarget(createSpring(lensX, 0), 100), 100, 0.05);
    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const next = stepSpring(start, 100, dt);
      expect(next.value).toBe(start.value);
      expect(next.velocity).toBe(start.velocity);
    }
  });

  it("never lets NaN or Infinity into the state", () => {
    let state: SpringState = retarget(createSpring(lensX, 0), 100);
    for (const target of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      state = stepSpring(state, target, 1 / 60);
      expect(Number.isFinite(state.value)).toBe(true);
      expect(Number.isFinite(state.velocity)).toBe(true);
      expect(state.target).toBe(100);
    }
    expect(Number.isFinite(retarget(state, Number.NaN).target)).toBe(true);
  });

  it("stays finite and stable for a very stiff spring and a huge frame", () => {
    let state = retarget(createSpring({ stiffness: 1e6, damping: 5e3 }, 0), 100);
    state = stepSpring(state, 100, 1e9);
    expect(Number.isFinite(state.value)).toBe(true);
    expect(Math.abs(state.value - 100)).toBeLessThan(1);
    for (let i = 0; i < 600; i += 1) state = stepSpring(state, 100, 1 / 60);
    expect(state.value).toBe(100);
  });

  it("does not mutate the state it is given", () => {
    const before = retarget(createSpring(lensX, 0), 100);
    const snapshot = JSON.stringify(before);
    stepSpring(before, 100, 0.1);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("handles a heavier mass", () => {
    const light = run({ stiffness: 100, damping: 4, mass: 1 }, 0, 100);
    const heavy = run({ stiffness: 100, damping: 4, mass: 4 }, 0, 100);
    expect(heavy.frames).toBeGreaterThan(0);
    expect(heavy.state.value).toBe(100);
    expect(light.state.value).toBe(100);
  });
});

describe("retarget", () => {
  it("keeps position and velocity and changes only the target", () => {
    const moving = stepSpring(retarget(createSpring(lensX, 0), 100), 100, 0.1);
    expect(moving.velocity).toBeGreaterThan(0);
    const turned = retarget(moving, 20);
    expect(turned.value).toBe(moving.value);
    expect(turned.velocity).toBe(moving.velocity);
    expect(turned.target).toBe(20);
  });

  it("carries the momentum into the new direction instead of stopping dead", () => {
    const moving = stepSpring(retarget(createSpring(lensX, 0), 100), 100, 0.1);
    const turned = retarget(moving, 0);
    const next = stepSpring(turned, 0, 1 / 60);
    // The spring was moving up fast. One frame later it is still higher than where the turn happened.
    expect(next.value).toBeGreaterThan(turned.value);
  });

  it("makes a resting spring active again", () => {
    const resting = createSpring(lensX, 10);
    expect(isAtRest(resting)).toBe(true);
    expect(isAtRest(retarget(resting, 200))).toBe(false);
  });

  it("returns a new object and leaves the old one alone", () => {
    const resting = createSpring(lensX, 10);
    const next = retarget(resting, 20);
    expect(next).not.toBe(resting);
    expect(resting.target).toBe(10);
  });
});

describe("isAtRest", () => {
  it("needs both a low speed and a small distance", () => {
    const config = { stiffness: 100, damping: 10, restSpeed: 0.5, restDelta: 0.5 };
    const base = createSpring(config, 10);
    expect(isAtRest({ ...base, value: 10.2, velocity: 0.2 })).toBe(true);
    expect(isAtRest({ ...base, value: 11, velocity: 0.2 })).toBe(false);
    expect(isAtRest({ ...base, value: 10.2, velocity: 2 })).toBe(false);
    expect(isAtRest({ ...base, value: 11, velocity: 2 })).toBe(false);
  });

  it("uses the thresholds with strict less-than at the boundary", () => {
    const base = createSpring({ stiffness: 100, damping: 10, restSpeed: 0.5, restDelta: 0.5 }, 0);
    expect(isAtRest({ ...base, value: 0.5, velocity: 0 })).toBe(false);
    expect(isAtRest({ ...base, value: 0, velocity: 0.5 })).toBe(false);
  });

  it("accepts another config for the check", () => {
    const base = { ...createSpring(lensX, 0), value: 0.05, velocity: 0 };
    expect(isAtRest(base, { stiffness: 1, damping: 1, restDelta: 0.1, restSpeed: 0.1 })).toBe(true);
    expect(isAtRest(base, { stiffness: 1, damping: 1, restDelta: 0.01, restSpeed: 0.1 })).toBe(false);
  });

  it("treats a state with a non-finite value as not at rest", () => {
    const base = createSpring(lensX, 0);
    expect(isAtRest({ ...base, value: Number.NaN })).toBe(false);
  });
});

describe("reconfigure", () => {
  it("swaps the spring's constants and keeps position, velocity, and target", () => {
    const moving = stepSpring(retarget(createSpring(lensX, 0), 100), 100, 0.1);
    const next = reconfigure(moving, { stiffness: 400, damping: 9 });
    expect(next.config.stiffness).toBe(400);
    expect(next.config.damping).toBe(9);
    expect(next.value).toBe(moving.value);
    expect(next.velocity).toBe(moving.velocity);
    expect(next.target).toBe(100);
    expect(moving.config.stiffness).toBe(210);
  });

  it("makes the same later motion as a spring that had those constants from the start", () => {
    const fresh = retarget(createSpring({ stiffness: 400, damping: 9 }, 0), 100);
    const swapped = reconfigure(retarget(createSpring(lensX, 0), 100), { stiffness: 400, damping: 9 });
    let a = fresh;
    let b = swapped;
    for (let i = 0; i < 30; i += 1) {
      a = stepSpring(a, 100, 1 / 60);
      b = stepSpring(b, 100, 1 / 60);
    }
    expect(b.value).toBeCloseTo(a.value, 9);
  });

  it("falls back to safe numbers for a broken config", () => {
    const next = reconfigure(createSpring(lensX, 0), { stiffness: Number.NaN, damping: Number.NaN, mass: -1 });
    expect(Number.isFinite(next.config.stiffness)).toBe(true);
    expect(next.config.mass).toBe(1);
  });
});
