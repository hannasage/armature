import { describe, expect, it } from "vitest";
import { createFollower, type FollowerOptions } from "../../src/dom/follower";
import { MAX_FRAME } from "../../src/engine/spring";
import type { Flavor } from "../../src/engine/flavor";
import { glassFlavor } from "../../src/glass/flavor";
import { FakeEnv } from "../helpers/fake-env";
import { acme } from "../helpers/other-flavor";

// The test flavor gets a follower part. `grow` is underdamped (ratio 0.3), `calm` is critically damped.
const flavor: Flavor = {
  ...acme,
  springs: {
    ...acme.springs,
    bouncy: { stiffness: 400, damping: 12, mass: 1 },
    calm: { stiffness: 400, damping: 40, mass: 1 },
  },
  follower: {
    grow: { var: "grow", springKey: "bouncy", rest: { restDelta: 0.001, restSpeed: 0.01 } },
    fade: { var: "fade", springKey: "calm", rest: { restDelta: 0.001, restSpeed: 0.01 } },
    loose: { var: "loose", springKey: "calm", rest: { restDelta: 0.2, restSpeed: 5 } },
  },
};

function make(extra: Partial<FollowerOptions> = {}, name = "grow") {
  const env = new FakeEnv();
  const element = {};
  const follower = createFollower(element, { flavor, name, env, ...extra });
  return { env, element, follower };
}

describe("a follower", () => {
  it("writes its start value under the flavor's prefix and variable, and no glass name", () => {
    const { env, element } = make();
    expect(env.vars.get(element)).toEqual({ "--acme-grow": "0" });
    expect(env.pending).toBe(0);
  });

  it("writes the initial value it was given", () => {
    const { env, element, follower } = make({ initial: 0.75 });
    expect(env.read(element, "--acme-grow")).toBe("0.75");
    expect(follower.getState()).toMatchObject({ value: 0.75, target: 0.75, velocity: 0, moving: false });
  });

  it("springs toward a target, lands on it, and stops its frame loop", () => {
    const { env, element, follower } = make();
    follower.setTarget(1);
    expect(env.pending).toBe(1);
    expect(follower.getState().moving).toBe(true);
    const frames = env.settle();
    expect(frames).toBeGreaterThan(5);
    expect(env.pending).toBe(0);
    expect(env.read(element, "--acme-grow")).toBe("1");
    expect(follower.getState()).toMatchObject({ value: 1, velocity: 0, target: 1, moving: false });
    const requested = env.requested;
    env.tick();
    expect(env.requested).toBe(requested);
  });

  it("overshoots when its spring is underdamped and does not when it is critical", () => {
    const peak = (name: string) => {
      const { env, follower } = make({}, name);
      follower.setTarget(1);
      let high = 0;
      for (let i = 0; i < 200; i++) {
        env.tick();
        high = Math.max(high, follower.getState().value);
      }
      return high;
    };
    expect(peak("grow")).toBeGreaterThan(1.1);
    expect(peak("fade")).toBeLessThanOrEqual(1.0005);
  });

  it("asks for no frame when the target is where it already is", () => {
    const { env, follower } = make({ initial: 0.5 });
    follower.setTarget(0.5);
    expect(env.requested).toBe(0);
    expect(env.pending).toBe(0);
  });

  it("keeps its position and velocity when the target changes in flight", () => {
    const { env, follower } = make();
    follower.setTarget(1);
    for (let i = 0; i < 4; i++) env.tick();
    const before = follower.getState();
    expect(before.value).toBeGreaterThan(0.05);
    expect(before.value).toBeLessThan(1);
    expect(before.velocity).toBeGreaterThan(0);
    follower.setTarget(0);
    const after = follower.getState();
    expect(after.value).toBe(before.value);
    expect(after.velocity).toBe(before.velocity);
    expect(after.target).toBe(0);
    expect(env.pending).toBe(1);
    env.tick();
    // The velocity carries on in the old direction for a moment, so the value is still above where it was one frame ago.
    expect(follower.getState().value).toBeGreaterThan(before.value * 0.9);
    env.settle();
    expect(follower.getState()).toMatchObject({ value: 0, moving: false });
  });

  it("does not start a second frame loop when the target changes twice before a frame", () => {
    const { env, follower } = make();
    follower.setTarget(1);
    follower.setTarget(2);
    follower.setTarget(3);
    expect(env.pending).toBe(1);
    expect(env.requested).toBe(1);
  });

  it("writes only when the text changes, and rounds to four places", () => {
    const { env, element, follower } = make();
    follower.setTarget(1);
    env.settle();
    const writes = env.writesTo("--acme-grow").map((write) => write.value);
    for (let i = 1; i < writes.length; i++) expect(writes[i]).not.toBe(writes[i - 1]);
    for (const text of writes) expect(text).toBe(String(Number(Number(text).toFixed(4))));
    expect(env.writes.every((write) => write.target === element)).toBe(true);
  });

  it("lands in the same place at 30, 60, and 144 Hz", () => {
    const at = (hz: number, seconds: number) => {
      const { env, follower } = make();
      follower.setTarget(1);
      const frames = Math.round(seconds * hz);
      for (let i = 0; i < frames; i++) env.tick(1000 / hz);
      return follower.getState();
    };
    for (const seconds of [1 / 6, 0.5]) {
      const states = [30, 60, 144].map((hz) => at(hz, seconds));
      expect(states[0].moving).toBe(true);
      expect(Math.abs(states[0].value - states[1].value)).toBeLessThan(0.02);
      expect(Math.abs(states[0].value - states[2].value)).toBeLessThan(0.02);
      expect(Math.abs(states[1].value - states[2].value)).toBeLessThan(0.02);
    }
    for (const hz of [30, 60, 144]) {
      const { env, element, follower } = make();
      follower.setTarget(1);
      env.settle(1000 / hz);
      expect(env.read(element, "--acme-grow")).toBe("1");
      expect(follower.getState().value).toBe(1);
    }
  });

  it("clamps a long frame, so a stalled tab does not fast-forward the spring", () => {
    const { env, follower } = make({}, "fade");
    follower.setTarget(1);
    env.tick(5000);
    const state = follower.getState();
    expect(state.value).toBeLessThan(1);
    expect(state.moving).toBe(true);
    expect(MAX_FRAME).toBe(0.1);
  });

  it("uses the rest limits of the flavor to stop earlier", () => {
    const tight = make({}, "fade");
    tight.follower.setTarget(1);
    const loose = make({}, "loose");
    loose.follower.setTarget(1);
    expect(loose.env.settle()).toBeLessThan(tight.env.settle());
    expect(loose.follower.getState().value).toBe(1);
  });

  it("takes a spring from the call and not from the flavor", () => {
    const stiff = make({ spring: { stiffness: 4000, damping: 130, mass: 1 } }, "fade");
    stiff.follower.setTarget(1);
    const normal = make({}, "fade");
    normal.follower.setTarget(1);
    expect(stiff.env.settle()).toBeLessThan(normal.env.settle());
  });
});

describe("a follower and reduced motion", () => {
  it("snaps to the target at once, with no frame", () => {
    const { env, element, follower } = make();
    env.reduced = true;
    follower.setTarget(1);
    expect(env.pending).toBe(0);
    expect(env.requested).toBe(0);
    expect(env.read(element, "--acme-grow")).toBe("1");
    expect(follower.getState()).toMatchObject({ value: 1, velocity: 0, target: 1, moving: false });
  });

  it("stops motion in flight when the reader asks for less motion", () => {
    const { env, element, follower } = make();
    follower.setTarget(1);
    env.tick();
    env.tick();
    env.reduced = true;
    follower.setTarget(0.25);
    expect(env.pending).toBe(0);
    expect(env.read(element, "--acme-grow")).toBe("0.25");
    expect(follower.getState()).toMatchObject({ value: 0.25, velocity: 0, moving: false });
  });
});

describe("a follower snap", () => {
  it("jumps to a value, clears the velocity, and cancels the frame", () => {
    const { env, element, follower } = make();
    follower.setTarget(1);
    env.tick();
    env.tick();
    follower.snap(0.4);
    expect(env.pending).toBe(0);
    expect(env.read(element, "--acme-grow")).toBe("0.4");
    expect(follower.getState()).toMatchObject({ value: 0.4, velocity: 0, target: 0.4, moving: false });
  });

  it("jumps to the current target when it is called with no value", () => {
    const { env, element, follower } = make();
    follower.setTarget(1);
    env.tick();
    follower.snap();
    expect(env.read(element, "--acme-grow")).toBe("1");
    expect(follower.getState()).toMatchObject({ value: 1, velocity: 0, moving: false });
    expect(env.pending).toBe(0);
  });

  it("lets the next setTarget start again from the snapped value", () => {
    const { env, follower } = make();
    follower.snap(2);
    follower.setTarget(3);
    expect(env.pending).toBe(1);
    env.settle();
    expect(follower.getState().value).toBe(3);
  });
});

describe("a follower and bad numbers", () => {
  it("ignores a target that is not finite", () => {
    const { env, follower } = make({ initial: 0.5 });
    for (const bad of [NaN, Infinity, -Infinity]) follower.setTarget(bad);
    expect(env.requested).toBe(0);
    expect(follower.getState()).toMatchObject({ value: 0.5, target: 0.5, moving: false });
    expect(env.writes.some((write) => /NaN|Infinity/.test(write.value))).toBe(false);
  });

  it("ignores a target that is not finite in flight", () => {
    const { env, follower } = make();
    follower.setTarget(1);
    env.tick();
    follower.setTarget(NaN);
    follower.setTarget(Infinity);
    expect(follower.getState().target).toBe(1);
    env.settle();
    expect(follower.getState().value).toBe(1);
  });

  it("ignores a snap value that is not finite", () => {
    const { env, element, follower } = make();
    follower.setTarget(1);
    env.tick();
    const before = follower.getState();
    follower.snap(NaN);
    follower.snap(-Infinity);
    expect(follower.getState()).toEqual(before);
    expect(env.pending).toBe(1);
    env.settle();
    expect(env.read(element, "--acme-grow")).toBe("1");
  });

  it("starts at 0 when the initial value is not finite", () => {
    for (const bad of [NaN, Infinity]) {
      const { env, element, follower } = make({ initial: bad });
      expect(env.read(element, "--acme-grow")).toBe("0");
      expect(follower.getState().value).toBe(0);
    }
  });

  it("writes a negative number, and never writes negative zero", () => {
    const { env, element, follower } = make({ initial: 1 }, "fade");
    follower.setTarget(-2);
    env.settle();
    expect(env.read(element, "--acme-fade")).toBe("-2");
    follower.snap(-0.00001);
    expect(env.read(element, "--acme-fade")).toBe("0");
  });
});

describe("a follower destroy", () => {
  it("cancels the frame and ignores every later call", () => {
    const { env, follower } = make();
    follower.setTarget(1);
    env.tick();
    const writes = env.writes.length;
    follower.destroy();
    expect(env.pending).toBe(0);
    expect(follower.getState().destroyed).toBe(true);
    follower.setTarget(0);
    follower.snap(5);
    env.tick();
    expect(env.writes.length).toBe(writes);
    expect(env.pending).toBe(0);
  });

  it("is safe to call twice, and on a follower that never moved", () => {
    const { follower } = make();
    follower.destroy();
    expect(() => follower.destroy()).not.toThrow();
  });
});

describe("a follower with a flavor that cannot serve it", () => {
  const element = {};
  it("throws a clear TypeError when the flavor is missing", () => {
    expect(() => createFollower(element, { name: "grow", env: new FakeEnv() } as never)).toThrow(/Expected a flavor object, got undefined/);
  });
  it("throws a clear TypeError when the flavor has no follower part", () => {
    expect(() => createFollower(element, { flavor: glassFlavor, name: "grow", env: new FakeEnv() })).toThrow('The flavor "glass" has no follower part.');
    expect(() => createFollower(element, { flavor: acme, name: "grow", env: new FakeEnv() })).toThrow(TypeError);
  });
  it("throws a clear TypeError for a follower name the flavor does not have", () => {
    expect(() => createFollower(element, { flavor, name: "nope", env: new FakeEnv() })).toThrow('The flavor "acme" has no follower named "nope".');
  });
  it("writes nothing when it throws", () => {
    const env = new FakeEnv();
    expect(() => createFollower(element, { flavor, name: "nope", env })).toThrow();
    expect(env.writes).toEqual([]);
  });
});
