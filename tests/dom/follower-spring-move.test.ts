import { describe, expect, it } from "vitest";
import { createFollower } from "../../src/dom/follower";
import type { Flavor } from "../../src/engine/flavor";
import { createSpring, reconfigure, retarget, stepSpring, type SpringState } from "../../src/engine/spring";
import { FakeEnv } from "../helpers/fake-env";
import { acme } from "../helpers/other-flavor";

// Amendment 2, item 2: `setTarget(target, { springKey })` switches the spring for one move. Position, velocity, and target stay.

const mechanical = { stiffness: 400, damping: 12, mass: 1 };
const settle = { stiffness: 120, damping: 26, mass: 1 };
const rest = { restDelta: 0.001, restSpeed: 0.01 };
const flavor: Flavor = {
  ...acme,
  springs: { ...acme.springs, mechanical, settle },
  followers: {
    thumb: { var: "thumb", springKey: "mechanical", rest },
    loose: { var: "loose", springKey: "mechanical", rest: { restDelta: 0.2, restSpeed: 5 } },
  },
};

const FRAME = 1000 / 60;
const make = (name = "thumb") => {
  const env = new FakeEnv();
  const element = {};
  return { env, element, follower: createFollower(element, { flavor, name, env }) };
};

/** The model: the pure engine functions on the same frame times. It knows nothing about the controller. */
function model(plan: Array<{ frames: number; target: number; spring: typeof mechanical }>, initial = 0): SpringState[] {
  let state = createSpring({ ...rest, ...plan[0].spring }, initial);
  const seen: SpringState[] = [];
  for (const leg of plan) {
    state = retarget(reconfigure(state, { ...rest, ...leg.spring }), leg.target);
    for (let i = 0; i < leg.frames; i += 1) {
      state = stepSpring(state, leg.target, FRAME / 1000);
      seen.push(state);
    }
  }
  return seen;
}

describe("a follower move with its own spring", () => {
  it("keeps position, velocity, and target at the switch, and then follows the new spring", () => {
    const { env, follower } = make();
    follower.setTarget(1, { springKey: "mechanical" });
    for (let i = 0; i < 6; i += 1) env.tick();
    const before = follower.getState();
    expect(before.moving).toBe(true);
    expect(before.velocity).toBeGreaterThan(0);
    follower.setTarget(0, { springKey: "settle" });
    const after = follower.getState();
    expect(after.value).toBe(before.value);
    expect(after.velocity).toBe(before.velocity);
    expect(after.target).toBe(0);
  });

  it("matches the pure solver frame by frame: enter on one spring, reverse in flight on another", () => {
    const { env, element, follower } = make();
    const wrote = () => Number(env.read(element, "--acme-thumb"));
    follower.setTarget(1, { springKey: "mechanical" });
    const seen: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      env.tick();
      seen.push(wrote());
    }
    follower.setTarget(0, { springKey: "settle" });
    for (let i = 0; i < 40; i += 1) {
      env.tick();
      seen.push(wrote());
    }
    const expected = model([
      { frames: 6, target: 1, spring: mechanical },
      { frames: 40, target: 0, spring: settle },
    ]).map((state) => Number(state.value.toFixed(4)));
    expect(seen).toEqual(expected);
  });

  it("pins the first frames of the reversed move", () => {
    const { env, element, follower } = make();
    follower.setTarget(1, { springKey: "mechanical" });
    for (let i = 0; i < 6; i += 1) env.tick();
    follower.setTarget(0, { springKey: "settle" });
    const written: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      env.tick();
      written.push(env.read(element, "--acme-thumb") as string);
    }
    expect(written).toEqual(PINNED_REVERSE);
  });

  it("keeps the chosen spring for later moves that name none", () => {
    const { env, element, follower } = make();
    follower.setTarget(1, { springKey: "settle" });
    follower.setTarget(0);
    const seen: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      env.tick();
      seen.push(Number(env.read(element, "--acme-thumb")));
    }
    expect(seen).toEqual(model([{ frames: 30, target: 0, spring: settle }]).map((state) => Number(state.value.toFixed(4))));
  });

  it("gives a call with no options the frames it gave before", () => {
    const plain = make();
    const empty = make();
    const named = make();
    plain.follower.setTarget(1);
    empty.follower.setTarget(1, {});
    named.follower.setTarget(1, { springKey: "mechanical" });
    for (let i = 0; i < 40; i += 1) {
      plain.env.tick();
      empty.env.tick();
      named.env.tick();
    }
    expect(empty.env.writes.map((w) => w.value)).toEqual(plain.env.writes.map((w) => w.value));
    expect(named.env.writes.map((w) => w.value)).toEqual(plain.env.writes.map((w) => w.value));
  });
});

describe("a follower move with a spring key that does not exist", () => {
  it("throws the TypeError of the spring lookup, with the flavor and the key", () => {
    const { follower } = make();
    expect(() => follower.setTarget(1, { springKey: "nope" })).toThrow(TypeError);
    expect(() => follower.setTarget(1, { springKey: "nope" })).toThrow('The flavor "acme" has no spring named "nope".');
  });

  it("changes nothing when it throws: no frame, no new target, same spring", () => {
    const { env, follower } = make();
    follower.setTarget(1);
    for (let i = 0; i < 3; i += 1) env.tick();
    const before = follower.getState();
    const pending = env.pending;
    expect(() => follower.setTarget(0, { springKey: "constructor" })).toThrow(TypeError);
    expect(follower.getState()).toEqual(before);
    expect(env.pending).toBe(pending);
  });

  it("throws under reduced motion too, and a destroyed follower ignores the call", () => {
    const { env, follower } = make();
    env.reduced = true;
    expect(() => follower.setTarget(1, { springKey: "nope" })).toThrow(TypeError);
    follower.destroy();
    expect(() => follower.setTarget(1, { springKey: "nope" })).not.toThrow();
  });
});

describe("a move with a target that is not finite", () => {
  it("does not switch the spring, even with a valid key", () => {
    const { env, element, follower } = make();
    follower.setTarget(NaN, { springKey: "settle" });
    follower.setTarget(1);
    const seen: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      env.tick();
      seen.push(Number(env.read(element, "--acme-thumb")));
    }
    expect(seen).toEqual(model([{ frames: 30, target: 1, spring: mechanical }]).map((state) => Number(state.value.toFixed(4))));
  });
});

describe("a follower move with its own spring, and the rest limits", () => {
  it("still merges the rest limits of the follower under the chosen spring", () => {
    const tight = make("thumb");
    const loose = make("loose");
    tight.follower.setTarget(1, { springKey: "settle" });
    loose.follower.setTarget(1, { springKey: "settle" });
    const tightFrames = tight.env.settle();
    const looseFrames = loose.env.settle();
    expect(looseFrames).toBeLessThan(tightFrames);
    expect(tight.follower.getState()).toMatchObject({ value: 1, moving: false });
  });
});

describe("a follower move with its own spring and reduced motion", () => {
  it("snaps at once, whatever spring the move names, and uses that spring afterward", () => {
    const { env, element, follower } = make();
    env.reduced = true;
    follower.setTarget(1, { springKey: "settle" });
    expect(env.read(element, "--acme-thumb")).toBe("1");
    expect(follower.getState()).toMatchObject({ value: 1, velocity: 0, target: 1, moving: false });
    expect(env.pending).toBe(0);
    env.reduced = false;
    follower.setTarget(0);
    const seen: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      env.tick();
      seen.push(Number(env.read(element, "--acme-thumb")));
    }
    const state = retarget(createSpring({ ...rest, ...settle }, 1), 0);
    let walk = state;
    const expected: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      walk = stepSpring(walk, 0, FRAME / 1000);
      expected.push(Number(walk.value.toFixed(4)));
    }
    expect(seen).toEqual(expected);
  });
});

const PINNED_REVERSE = ["1.1826", "1.2079", "1.1877", "1.14", "1.077"];
