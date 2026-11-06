import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("a follower and reduced motion that starts in flight", () => {
  it("jumps to the target on the next frame when the setting flips, with no new setTarget", () => {
    const { env, element, follower } = make();
    follower.setTarget(1);
    env.tick();
    env.tick();
    expect(follower.getState().moving).toBe(true);
    env.reduced = true;
    env.tick();
    expect(env.pending).toBe(0);
    expect(env.read(element, "--acme-grow")).toBe("1");
    expect(follower.getState()).toMatchObject({ value: 1, velocity: 0, target: 1, moving: false });
    const requested = env.requested;
    env.tick();
    expect(env.requested).toBe(requested);
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

  it("throws a named TypeError at creation when the initial value is not finite, and writes nothing", () => {
    for (const bad of [NaN, Infinity, -Infinity, "1" as never]) {
      const env = new FakeEnv();
      expect(() => createFollower({}, { flavor, name: "grow", env, initial: bad }), String(bad)).toThrow(TypeError);
      expect(() => createFollower({}, { flavor, name: "grow", env, initial: bad }), String(bad)).toThrow('The follower "grow" of the flavor "acme" got an initial value that is not a finite number.');
      expect(env.writes).toEqual([]);
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

describe("a follower whose write fails", () => {
  afterEach(() => vi.restoreAllMocks());

  /** An environment whose style write throws while `fail` is true. It records each attempt. */
  function failing() {
    const env = new FakeEnv();
    const original = env.setCSSVariable;
    const state = { fail: false, attempts: [] as string[] };
    env.setCSSVariable = (target, name, value) => {
      state.attempts.push(value);
      if (state.fail) throw new Error("boom");
      original(target, name, value);
    };
    return { env, state };
  }

  it("logs once with the flavor's label, stops the frame loop, and is not moving", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { env, state } = failing();
    const follower = createFollower({}, { flavor, name: "grow", env });
    follower.setTarget(1);
    env.tick();
    state.fail = true;
    env.tick();
    expect(env.pending).toBe(0);
    expect(follower.getState().moving).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toMatch(/^\[acme-motion\] /);
    expect(spy.mock.calls[0]?.[1]).toBeInstanceOf(Error);
    env.tick();
    follower.setTarget(2);
    follower.setTarget(3);
    env.tick();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(env.pending).toBe(0);
    expect(follower.getState().moving).toBe(false);
  });

  it("does not throw into the caller from setTarget, snap, or a frame", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { env, state } = failing();
    state.fail = true;
    expect(() => createFollower({}, { flavor, name: "grow", env })).not.toThrow();
    const follower = createFollower({}, { flavor, name: "grow", env });
    expect(() => follower.setTarget(1)).not.toThrow();
    expect(() => env.tick()).not.toThrow();
    expect(() => follower.snap(4)).not.toThrow();
    expect(follower.getState()).toMatchObject({ moving: false, destroyed: false });
  });

  it("records a value as written only after the write works, so a later write of the same text goes through", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { env, state } = failing();
    const element = {};
    const follower = createFollower(element, { flavor, name: "grow", env });
    follower.setTarget(1);
    state.fail = true;
    env.tick();
    const lost = state.attempts[state.attempts.length - 1];
    expect(env.read(element, "--acme-grow")).toBe("0");
    state.fail = false;
    follower.snap(Number(lost));
    expect(env.read(element, "--acme-grow")).toBe(lost);
  });

  it("works again after the environment recovers", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { env, state } = failing();
    const element = {};
    const follower = createFollower(element, { flavor, name: "grow", env });
    state.fail = true;
    follower.setTarget(1);
    env.tick();
    state.fail = false;
    follower.setTarget(2);
    env.settle();
    expect(env.read(element, "--acme-grow")).toBe("2");
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

describe("a follower made with bad arguments", () => {
  it("throws a named TypeError when there is no element, and writes nothing", () => {
    for (const bad of [undefined, null, 5, "x"]) {
      const env = new FakeEnv();
      expect(() => createFollower(bad as never, { flavor, name: "grow", env }), String(bad)).toThrow(TypeError);
      expect(() => createFollower(bad as never, { flavor, name: "grow", env }), String(bad)).toThrow('The follower "grow" of the flavor "acme" needs an element to write to.');
      expect(env.writes).toEqual([]);
    }
  });

  it("keeps the flavor's rest limits when the spring option has keys set to undefined", () => {
    // The flavor rest of "loose" is large. A spring that names restDelta and restSpeed as undefined must not erase it.
    const bare = { stiffness: 400, damping: 40, mass: 1 };
    const withUndefined = make({ spring: { ...bare, restDelta: undefined, restSpeed: undefined } }, "loose");
    withUndefined.follower.setTarget(1);
    const plain = make({ spring: bare }, "loose");
    plain.follower.setTarget(1);
    const frames = withUndefined.env.settle();
    expect(frames).toBe(plain.env.settle());
    const tight = make({ spring: { ...bare, restDelta: 0.001, restSpeed: 0.01 } }, "loose");
    tight.follower.setTarget(1);
    expect(frames).toBeLessThan(tight.env.settle());
  });

  it("lets a spring option set its own rest limits", () => {
    const loose = make({}, "fade");
    loose.follower.setTarget(1);
    const own = make({ spring: { stiffness: 400, damping: 40, mass: 1, restDelta: 0.3, restSpeed: 10 } }, "fade");
    own.follower.setTarget(1);
    expect(own.env.settle()).toBeLessThan(loose.env.settle());
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
