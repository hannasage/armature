import { describe, expect, it } from "vitest";
import { FIXED_STEP } from "../../src/engine/spring";
import { bezier, createTween, easing, isTweenDone, retargetTween, stepTween } from "../../src/curves";

// A tween has the step interface of the spring: a frozen state in, a frozen state out, and a dt in seconds.

describe("createTween", () => {
  it("starts on `from`, not done, with no elapsed time", () => {
    const state = createTween(2, 10, 0.5);
    expect(state).toMatchObject({ from: 2, to: 10, duration: 0.5, elapsed: 0, value: 2 });
    expect(isTweenDone(state)).toBe(false);
  });

  it("is done at once for a zero duration, and rests on the target", () => {
    const state = createTween(2, 10, 0);
    expect(state.value).toBe(10);
    expect(isTweenDone(state)).toBe(true);
  });

  it("is done at once when from equals to", () => {
    expect(isTweenDone(createTween(4, 4, 1))).toBe(true);
  });

  it("throws a TypeError for a value or a duration that is not usable", () => {
    expect(() => createTween(Number.NaN, 1, 1)).toThrow(TypeError);
    expect(() => createTween(0, Number.POSITIVE_INFINITY, 1)).toThrow(TypeError);
    expect(() => createTween(0, 1, -1)).toThrow(TypeError);
    expect(() => createTween(0, 1, Number.NaN)).toThrow(TypeError);
  });

  it("freezes the state", () => {
    expect(Object.isFrozen(createTween(0, 1, 1))).toBe(true);
  });
});

describe("stepTween", () => {
  it("does not change the state it is given", () => {
    const state = createTween(0, 1, 1);
    const next = stepTween(state, 0.25);
    expect(state.elapsed).toBe(0);
    expect(next).not.toBe(state);
    expect(next.elapsed).toBeCloseTo(0.25, 10);
  });

  it("follows a linear curve in proportion to elapsed time", () => {
    const state = stepTween(createTween(10, 20, 2), 0.5);
    expect(state.value).toBeCloseTo(12.5, 10);
  });

  it("follows the curve it is given", () => {
    const curve = easing("projection");
    const state = stepTween(createTween(0, 100, 1, curve), 0.25);
    expect(state.value).toBeCloseTo(100 * curve(0.25), 8);
  });

  it("ignores a zero, negative, or non-finite dt", () => {
    const state = stepTween(createTween(0, 1, 1), 0.2);
    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(stepTween(state, dt)).toBe(state);
  });

  it("ends exactly on the target when the duration has passed, in one big step", () => {
    const state = stepTween(createTween(0.1, 0.3, 0.2), 5);
    expect(state.value).toBe(0.3);
    expect(state.elapsed).toBe(0.2);
    expect(isTweenDone(state)).toBe(true);
  });

  it("stays on the target after it is done", () => {
    const done = stepTween(createTween(0, 1, 0.1), 1);
    expect(stepTween(done, FIXED_STEP)).toBe(done);
  });

  it("ends in the same slice count as duration divided by the slice, to within float slack", () => {
    let state = createTween(0, 1, 0.5);
    let steps = 0;
    while (!isTweenDone(state) && steps < 1000) {
      state = stepTween(state, FIXED_STEP);
      steps += 1;
    }
    expect(steps).toBe(60);
    expect(state.value).toBe(1);
  });

  it("gives the same end on a 30, 60, or 144 Hz frame size", () => {
    for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
      let state = createTween(5, -5, 0.4, easing("ease-in-out"));
      for (let i = 0; i < 1000 && !isTweenDone(state); i += 1) state = stepTween(state, dt);
      expect(state.value).toBe(-5);
    }
  });

  it("goes past the target for a curve that overshoots, then lands on it", () => {
    const curve = bezier(0.34, 1.56, 0.64, 1);
    let state = createTween(0, 1, 1, curve);
    let peak = 0;
    while (!isTweenDone(state)) {
      state = stepTween(state, FIXED_STEP);
      peak = Math.max(peak, state.value);
    }
    expect(peak).toBeGreaterThan(1.02);
    expect(state.value).toBe(1);
  });
});

describe("a tween ends exactly on its target (property)", () => {
  // A small seeded generator, so a failure repeats.
  let seed = 123456789;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };

  it("lands on the target for 500 random tweens, steps, and curves", () => {
    const names = ["linear", "ease", "ease-in", "ease-out", "ease-in-out", "projection"] as const;
    for (let n = 0; n < 500; n += 1) {
      const from = (random() - 0.5) * 2000;
      const to = (random() - 0.5) * 2000;
      const duration = random() * 3;
      const dt = 0.001 + random() * 0.09;
      let state = createTween(from, to, duration, easing(names[Math.floor(random() * names.length)]));
      for (let i = 0; i < 100000 && !isTweenDone(state); i += 1) state = stepTween(state, dt);
      expect(isTweenDone(state)).toBe(true);
      expect(state.value).toBe(to);
    }
  });

  it("lands on the target for 200 random tweens stepped by the fixed slice", () => {
    for (let n = 0; n < 200; n += 1) {
      const from = random() * 10 - 5;
      const to = random() * 10 - 5;
      let state = createTween(from, to, 0.05 + random() * 2, easing("projection"));
      for (let i = 0; i < 100000 && !isTweenDone(state); i += 1) state = stepTween(state, FIXED_STEP);
      expect(state.value).toBe(to);
    }
  });
});

describe("edge cases (property)", () => {
  it("lands on the target for a duration of 0, 1e-12, or 1e-9, and for a from equal to the target", () => {
    for (const duration of [0, 1e-12, 1e-9, 1e-6]) {
      for (const [from, to] of [[0, 1], [1, 1], [-3.5, 2.25], [0.1, 0.3]]) {
        let state = createTween(from, to, duration, easing("ease-in-out"));
        for (let i = 0; i < 10 && !isTweenDone(state); i += 1) state = stepTween(state, FIXED_STEP);
        expect(isTweenDone(state), `${duration} ${from}`).toBe(true);
        expect(state.value, `${duration} ${from}`).toBe(to);
      }
    }
  });

  it("lands on the target in one step for a huge dt", () => {
    for (const dt of [1e3, 1e9, 1e300, Number.MAX_VALUE]) {
      const state = stepTween(createTween(0.1, 0.3, 2, easing("projection")), dt);
      expect(state.value, String(dt)).toBe(0.3);
      expect(isTweenDone(state)).toBe(true);
    }
  });

  it("ignores an infinite dt, so a bad frame time cannot jump the tween", () => {
    const state = createTween(0, 1, 1);
    expect(stepTween(state, Number.POSITIVE_INFINITY)).toBe(state);
  });

  it("lands on the target for a very large and a very small value", () => {
    for (const [from, to] of [[0, 1e308], [-1e308, 1e308], [1e-300, 2e-300]]) {
      let state = createTween(from, to, 0.2);
      for (let i = 0; i < 100 && !isTweenDone(state); i += 1) state = stepTween(state, FIXED_STEP);
      expect(state.value).toBe(to);
    }
  });
});

describe("retargetTween", () => {
  it("starts a new tween from the value on screen", () => {
    const mid = stepTween(createTween(0, 10, 1), 0.5);
    const next = retargetTween(mid, 100);
    expect(next.from).toBe(mid.value);
    expect(next.to).toBe(100);
    expect(next.elapsed).toBe(0);
    expect(next.value).toBe(mid.value);
    expect(next.duration).toBe(1);
  });

  it("takes a new duration and a new curve", () => {
    const curve = easing("ease-out");
    const next = retargetTween(createTween(0, 1, 1), 2, 0.25, curve);
    expect(next.duration).toBe(0.25);
    expect(next.curve).toBe(curve);
  });

  it("throws a TypeError for a target that is not finite", () => {
    expect(() => retargetTween(createTween(0, 1, 1), Number.NaN)).toThrow(TypeError);
  });
});
