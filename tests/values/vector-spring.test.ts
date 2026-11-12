import { describe, expect, it } from "vitest";
import {
  createVectorSpring, isVectorAtRest, reconfigureVector, retargetVector, stepVectorSpring,
} from "../../src/values";
import { createSpring, isAtRest, reconfigure, retarget, stepSpring, type SpringConfig, type SpringState } from "../../src/engine/spring";

// A spring over a vector is one scalar spring per component. It must match the scalar spring component by component on any script.

const config: SpringConfig = { stiffness: 220, damping: 14, restDelta: 0.001, restSpeed: 0.01 };
const stiff: SpringConfig = { stiffness: 900, damping: 40, restDelta: 0.001, restSpeed: 0.01 };
const initial = [0, 10, -4];
const targets = [1, -20, 6];
/** Frame times in seconds: 60 Hz, 30 Hz, 144 Hz, a stalled frame, a zero, a negative, and NaN. */
const DTS = [1 / 60, 1 / 60, 1 / 30, 1 / 144, 1 / 144, 0.5, 0, -1, NaN, 1 / 60, 1 / 120, 1 / 60];

function expectSame(vector: ReturnType<typeof createVectorSpring>, scalars: SpringState[]) {
  expect(vector.parts).toHaveLength(scalars.length);
  scalars.forEach((scalar, i) => {
    expect(vector.parts[i], `component ${i}`).toEqual(scalar);
    expect(vector.value[i]).toBe(scalar.value);
    expect(vector.velocity[i]).toBe(scalar.velocity);
    expect(vector.target[i]).toBe(scalar.target);
  });
}

describe("a vector spring", () => {
  it("matches the scalar spring component by component on a scripted run", () => {
    let vector = createVectorSpring(config, initial);
    let scalars = initial.map((value) => createSpring(config, value));
    expectSame(vector, scalars);
    DTS.forEach((dt) => {
      vector = stepVectorSpring(vector, targets, dt);
      scalars = scalars.map((state, i) => stepSpring(state, targets[i], dt));
      expectSame(vector, scalars);
    });
  });

  it("matches the scalar spring through a retarget and a reconfigure in flight", () => {
    let vector = createVectorSpring(config, initial);
    let scalars = initial.map((value) => createSpring(config, value));
    for (let i = 0; i < 5; i += 1) {
      vector = stepVectorSpring(vector, targets, 1 / 60);
      scalars = scalars.map((state, j) => stepSpring(state, targets[j], 1 / 60));
    }
    const back = [0, 0, 0];
    vector = reconfigureVector(retargetVector(vector, back), stiff);
    scalars = scalars.map((state, j) => reconfigure(retarget(state, back[j]), stiff));
    expectSame(vector, scalars);
    for (let i = 0; i < 12; i += 1) {
      vector = stepVectorSpring(vector, back, 1 / 60);
      scalars = scalars.map((state, j) => stepSpring(state, back[j], 1 / 60));
      expectSame(vector, scalars);
    }
  });

  it("matches until rest, and lands on the target", () => {
    let vector = createVectorSpring(config, initial);
    let scalars = initial.map((value) => createSpring(config, value));
    vector = retargetVector(vector, targets);
    scalars = scalars.map((state, i) => retarget(state, targets[i]));
    let frames = 0;
    while (!isVectorAtRest(vector) && frames < 2000) {
      vector = stepVectorSpring(vector, targets, 1 / 60);
      scalars = scalars.map((state, i) => stepSpring(state, targets[i], 1 / 60));
      expectSame(vector, scalars);
      frames += 1;
    }
    expect(frames).toBeGreaterThan(10);
    expect(frames).toBeLessThan(2000);
    expect(vector.value).toEqual(targets);
    expect(vector.velocity).toEqual([0, 0, 0]);
  });

  it("with one component is the scalar spring", () => {
    let vector = createVectorSpring(config, [0.5]);
    let scalar = createSpring(config, 0.5);
    for (const dt of DTS) {
      vector = stepVectorSpring(vector, [2], dt);
      scalar = stepSpring(scalar, 2, dt);
      expect(vector.parts[0]).toEqual(scalar);
    }
  });

  it("rests only when every component rests", () => {
    let vector = createVectorSpring(config, [0, 0]);
    expect(isVectorAtRest(vector)).toBe(true);
    vector = retargetVector(vector, [0, 5]);
    expect(isVectorAtRest(vector)).toBe(false);
    expect(isAtRest(vector.parts[0])).toBe(true);
    expect(isAtRest(vector.parts[1])).toBe(false);
    vector = stepVectorSpring(vector, [0, 5], 1 / 60);
    expect(isVectorAtRest(vector)).toBe(false);
  });

  it("is pure: a state is never changed", () => {
    const start = createVectorSpring(config, initial);
    const copy = JSON.stringify(start);
    stepVectorSpring(start, targets, 1 / 60);
    retargetVector(start, targets);
    reconfigureVector(start, stiff);
    expect(JSON.stringify(start)).toBe(copy);
    expect(Object.isFrozen(start)).toBe(true);
  });

  it("ignores a component target that is not finite, as the scalar spring does", () => {
    let vector = createVectorSpring(config, [1, 2]);
    vector = retargetVector(vector, [NaN, 5]);
    expect(vector.target).toEqual([1, 5]);
    vector = stepVectorSpring(vector, [Infinity, 7], 1 / 60);
    expect(vector.target).toEqual([1, 7]);
  });

  it("gives an empty vector and rests at once", () => {
    const vector = createVectorSpring(config, []);
    expect(vector.value).toEqual([]);
    expect(isVectorAtRest(stepVectorSpring(vector, [], 1 / 60))).toBe(true);
  });

  it("throws a TypeError for a target of the wrong length", () => {
    const vector = createVectorSpring(config, [0, 0]);
    expect(() => retargetVector(vector, [1])).toThrow(TypeError);
    expect(() => retargetVector(vector, [1])).toThrow("A vector target has 1 components, and the spring has 2.");
    expect(() => stepVectorSpring(vector, [1, 2, 3], 1 / 60)).toThrow(TypeError);
    expect(() => retargetVector(vector, null as never)).toThrow(TypeError);
  });

  it("throws a TypeError when the initial value is not an array", () => {
    expect(() => createVectorSpring(config, 3 as never)).toThrow(TypeError);
  });

  it("handles a large vector", () => {
    const big = Array.from({ length: 10_000 }, (_, i) => i);
    let vector = createVectorSpring(config, big);
    const goal = big.map((n) => n + 1);
    vector = stepVectorSpring(vector, goal, 1 / 60);
    expect(vector.value).toHaveLength(10_000);
    expect(vector.value[9_999]).toBe(stepSpring(createSpring(config, 9_999), 10_000, 1 / 60).value);
  });
});
