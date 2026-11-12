import { describe, expect, it } from "vitest";
import { createScheduler } from "../../src/frame";
import type { SpringConfig } from "../../src/engine/spring";
import { colorKind, createValue, numberKind, pathKind, transform3dKind, vectorKind, type Kind } from "../../src/values";
import { FakeEnv } from "../helpers/fake-env";

// Review round 2: the scalar flag drives the velocity, a move spring inherits the rest distance in a set order, and a kind can be told its rest distance.

const setup = () => createScheduler(new FakeEnv());

// A custom number kind with no scalar flag, and one with the name "number".
const plain = (name: string): Kind<number, false> => ({
  name,
  parse: numberKind.parse,
  toArray: numberKind.toArray,
  fromArray: numberKind.fromArray,
  interpolate: numberKind.interpolate,
  distance: numberKind.distance,
  serialize: numberKind.serialize,
});

describe("the velocity of a value follows the scalar flag, and not the name", () => {
  const spring: SpringConfig = { stiffness: 170, damping: 26 };
  const velocityOf = <T, S extends boolean>(kind: Kind<T, S>, from: T, to: T) => {
    const scheduler = setup();
    const value = createValue(scheduler, kind, from, { spring });
    value.to(to);
    scheduler.advance(1 / 30);
    return value.getState();
  };

  it("sets the flag on the number kind only", () => {
    expect(numberKind.scalar).toBe(true);
    for (const kind of [vectorKind(2), colorKind, transform3dKind, pathKind("M0 0")] as Kind<unknown>[]) expect(kind.scalar, kind.name).toBeUndefined();
  });

  it("gives the number kind a number, and the type says number", () => {
    const state = velocityOf(numberKind, 0, 10);
    const velocity: number = state.velocity;
    expect(typeof velocity).toBe("number");
    expect(velocity).not.toBe(0);
  });

  it("gives a flagged kind with another name a number too", () => {
    const state = velocityOf({ ...numberKind, name: "count" }, 0, 10);
    const velocity: number = state.velocity;
    expect(typeof velocity).toBe("number");
  });

  it("gives a custom number kind with no flag a list, even if it is named number, and the type says a list", () => {
    for (const name of ["count", "number"]) {
      const state = velocityOf(plain(name), 0, 10);
      const velocity: number[] = state.velocity;
      expect(Array.isArray(velocity), name).toBe(true);
      expect(velocity).toHaveLength(1);
      expect(velocity[0]).not.toBe(0);
    }
  });

  it("gives a vector, a color, a path, and a 3D transform a list", () => {
    const vector: number[] = velocityOf(vectorKind(2), [0, 0], [5, 5]).velocity;
    expect(vector).toHaveLength(2);
    expect(velocityOf(colorKind, "#000", "#fff").velocity).toHaveLength(4);
  });
});

describe("the rest distance of a move spring", () => {
  const loose: SpringConfig = { stiffness: 170, damping: 26, restSpeed: 1000 };
  const coarse: Kind<number> = { ...numberKind, restDelta: 0.4 };
  /** The frames a move from 0 to 1 takes to rest. */
  const frames = (kind: Kind<number>, base: SpringConfig, move?: SpringConfig) => {
    const scheduler = setup();
    const value = createValue(scheduler, kind, 0, { spring: base });
    value.to(1, move ? { spring: move } : undefined);
    let n = 0;
    while (value.getState().moving && n < 4000) {
      scheduler.advance(1 / 120);
      n += 1;
    }
    expect(value.get()).toBe(1);
    return n;
  };
  const fine = frames(numberKind, loose);
  const wide = frames(numberKind, { ...loose, restDelta: 0.4 });

  it("has frame counts that tell the two distances apart", () => {
    expect(wide).toBeLessThan(fine);
  });

  it("takes the kind default when neither the move spring nor the base spring sets one", () => {
    expect(frames(coarse, loose, { ...loose })).toBe(wide);
    expect(frames(coarse, loose)).toBe(wide);
  });

  it("inherits the explicit restDelta of the base spring over the kind default", () => {
    expect(frames(coarse, { ...loose, restDelta: 0.01 }, { ...loose })).toBe(fine);
  });

  it("uses the engine default when nothing sets one", () => {
    expect(frames(numberKind, loose, { ...loose })).toBe(fine);
  });

  it("lets a move spring with its own restDelta win", () => {
    expect(frames(coarse, { ...loose, restDelta: 0.01 }, { ...loose, restDelta: 0.4 })).toBe(wide);
    expect(frames(coarse, loose, { ...loose, restDelta: 0.01 })).toBe(fine);
  });

  it("treats a restDelta that is not positive and finite as unset", () => {
    for (const bad of [0, NaN, -1, Infinity]) {
      expect(frames(coarse, { ...loose, restDelta: bad }), String(bad)).toBe(wide);
      expect(frames(coarse, loose, { ...loose, restDelta: bad }), String(bad)).toBe(wide);
      expect(frames(coarse, { ...loose, restDelta: 0.01 }, { ...loose, restDelta: bad }), String(bad)).toBe(fine);
    }
  });
});

describe("pathKind takes a rest distance", () => {
  const spring: SpringConfig = { stiffness: 170, damping: 26 };
  const from = "M 0 0 L 1 0 L 0.5 1 Z";
  const to = "M 0.2 0.1 L 0.9 0.2 L 0.4 0.7 Z";
  const run = (kind: Kind<string>) => {
    const scheduler = setup();
    const seen: string[] = [];
    const value = createValue(scheduler, kind, from, { spring, onChange: (d) => seen.push(d) });
    value.to(to);
    let n = 0;
    while (value.getState().moving && n < 2000) {
      scheduler.advance(1 / 60);
      n += 1;
    }
    expect(value.get()).toBe(to);
    const numbers = (d: string) => d.match(/-?[\d.]+/g)!.map(Number);
    const [a, b] = [numbers(seen.at(-2)!), numbers(seen.at(-1)!)];
    return { n, snap: Math.max(...a.map((x, i) => Math.abs(x - b[i]))) };
  };

  it("keeps 0.01 when none is given, and a unit viewBox then snaps by up to 0.01", () => {
    expect(pathKind(from).restDelta).toBeUndefined();
  });

  it("rests finer on a unit viewBox with { restDelta }, and snaps by less than 1e-3", () => {
    const coarse = run(pathKind(from));
    const unit = run(pathKind(from, { restDelta: 0.0001 }));
    expect(pathKind(from, { restDelta: 0.0001 }).restDelta).toBe(0.0001);
    expect(unit.n).toBeGreaterThan(coarse.n);
    expect(unit.snap).toBeLessThan(1e-3);
  });

  it("rejects a rest distance that is not positive and finite", () => {
    for (const bad of [0, -1, NaN, Infinity, "0.1" as unknown as number]) expect(() => pathKind(from, { restDelta: bad }), String(bad)).toThrow(TypeError);
  });
});

describe("the color kind needs exactly 4 parts", () => {
  it("throws for a fifth part", () => {
    expect(() => colorKind.fromArray([0.5, 0, 0, 1, 0])).toThrow(TypeError);
    expect(() => colorKind.fromArray([0.5, 0, 0, 1])).not.toThrow();
  });
});
