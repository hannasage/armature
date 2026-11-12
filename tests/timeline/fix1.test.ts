import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createSpring, FIXED_STEP, retarget, stepSpring, type SpringConfig } from "../../src/engine/spring";
import { createScheduler, type FrameTask } from "../../src/frame";
import { createTimeline, type Keyframe, type TimelineOptions } from "../../src/timeline";
import { FakeTimelineEnv } from "../helpers/fake-timeline-env";
import { tempo } from "../helpers/timeline-flavor";

const STEP_MS = FIXED_STEP * 1000;
const SOFT: SpringConfig = { stiffness: 40, damping: 4 };
const DECAY = { decay: { friction: 4, rest: { restSpeed: 5 } } };

let error: MockInstance<typeof console.error>;
beforeEach(() => {
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

function rig(keys: readonly Keyframe[], extra: Partial<TimelineOptions> = {}) {
  const env = new FakeTimelineEnv();
  const scheduler = createScheduler(env);
  const tl = createTimeline(env, { scheduler, tracks: [{ target: {}, value: "opacity", keys }], ...extra });
  return { env, scheduler, tl, slices: (n: number) => { for (let i = 0; i < n; i++) scheduler.advance(FIXED_STEP); } };
}

/** The states a spring takes slice by slice from a position and a speed, by the engine's own functions. */
function oracleFrom(config: SpringConfig, p: number, v: number, to: number, count: number) {
  let state = { ...retarget(createSpring(config, p), to), velocity: v, settledVelocity: v };
  const out = [{ p: state.value, v: state.velocity }];
  for (let i = 0; i < count; i++) {
    state = stepSpring(state, to, FIXED_STEP);
    out.push({ p: state.value, v: state.velocity });
  }
  return out;
}

describe("H1: a listener that pauses or destroys during play", () => {
  it("pause inside the first update of play stops the timeline, and the frame loop is not added", () => {
    const { env, scheduler, tl, slices } = rig([[0, 0], [1000, 100]]);
    tl.on("update", () => tl.pause());
    tl.play();
    expect(tl.getState().playing).toBe(false);
    expect(scheduler.size).toBe(0);
    slices(5);
    expect(tl.getState().time).toBe(0);
    expect(env.writes.length).toBe(1);
  });

  it("pause inside the first update of reverse stops it the same way", () => {
    const { scheduler, tl, slices } = rig([[0, 0], [1000, 100]]);
    tl.seek(500);
    tl.on("update", () => tl.pause());
    tl.reverse();
    expect(tl.getState().playing).toBe(false);
    expect(scheduler.size).toBe(0);
    slices(5);
    expect(tl.getState().time).toBe(500);
  });

  it("destroy inside the first update, on a shared scheduler, leaves no task and no frame", () => {
    const { env, scheduler, tl, slices } = rig([[0, 0], [1000, 100]]);
    tl.on("update", () => tl.destroy());
    tl.play();
    expect(scheduler.size).toBe(0);
    expect(env.requested).toBe(0);
    slices(5);
    expect(env.writes.length).toBe(1);
    expect(tl.getState()).toMatchObject({ destroyed: true, playing: false });
  });

  it("destroy inside the first update, on a scheduler of its own, leaves no frame", () => {
    const env = new FakeTimelineEnv();
    const tl = createTimeline(env, { tracks: [{ target: {}, value: "opacity", keys: [[0, 0], [1000, 100]] }] });
    tl.on("update", () => tl.destroy());
    tl.play();
    expect(env.pending).toBe(0);
    expect(env.requested).toBe(0);
    env.tick();
    expect(env.writes.length).toBe(1);
  });

  it("destroy inside a later update stops every write at once", () => {
    const { env, scheduler, tl, slices } = rig([[0, 0], [1000, 100]]);
    tl.on("update", (time) => {
      if (time > 50) tl.destroy();
    });
    tl.play();
    slices(30);
    const writes = env.writes.length;
    slices(10);
    expect(env.writes.length).toBe(writes);
    expect(scheduler.size).toBe(0);
    expect(error).not.toHaveBeenCalled();
  });
});

describe("H2: samples that are not finite", () => {
  it("throws a TypeError at build for a decay that runs to infinity", () => {
    const keys: Keyframe[] = [[0, 0], [100, null, { decay: { velocity: 1.7e308, friction: 1e-9, rest: { restSpeed: 1 } } }]];
    expect(() => rig(keys)).toThrow(TypeError);
  });

  it("never writes a value that is not a number for a spring with a huge stiffness", () => {
    let writes: Array<string | null> = [];
    try {
      const { env, tl } = rig([[0, 0], [100, 100, { stiffness: 1e300, damping: 1 }]]);
      tl.seek(tl.getState().duration);
      tl.seek(50);
      writes = env.writes.map((w) => w.value);
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(TypeError);
    }
    for (const value of writes) expect(value).toMatch(/^-?\d+(\.\d+)?$/);
  });
});

describe("M1: a tween hands over the speed it ends with", () => {
  it("lets a decay carry on from a linear tween", () => {
    const { tl } = rig([[0, 0], [1000, 100], [3000, null, DECAY]]);
    tl.seek(1000 + 10 * STEP_MS);
    expect(tl.getState().values[0]).toBeGreaterThan(107);
    tl.seek(tl.getState().duration);
    expect(tl.getState().values[0]).toBeGreaterThan(120);
    expect(tl.getState().values[0]).toBeLessThan(125);
  });

  it("lets a spring carry on from a linear tween", () => {
    const { tl } = rig([[0, 0], [1000, 100], [2000, 0, SOFT]]);
    tl.seek(1000 + 3 * STEP_MS);
    expect(tl.getState().values[0]).toBeGreaterThan(100.5);
  });

  it("hands over no speed from a curve that ends flat", () => {
    const { tl } = rig([[0, 0], [1000, 100, (p: number) => p * (2 - p)], [2000, 0, SOFT]]);
    tl.seek(1000 + STEP_MS);
    expect(tl.getState().values[0]).toBeLessThan(100.001);
  });
});

describe("M2: the cap of 10 seconds", () => {
  it("snaps a last-key spring with no damping to its target, and says so with capped", () => {
    const { tl } = rig([[0, 0], [100, 100, { stiffness: 170, damping: 0 }]]);
    expect(tl.getState().capped).toBe(true);
    expect(tl.getState().duration).toBeCloseTo(1200 * STEP_MS, 6);
    tl.seek(tl.getState().duration);
    expect(tl.getState().values[0]).toBe(100);
  });

  it("snaps a spring cut by a key more than 10 seconds away", () => {
    const { tl } = rig([[0, 0], [20000, 100, { stiffness: 170, damping: 0 }], [21000, 0]]);
    expect(tl.getState().capped).toBe(true);
    tl.seek(12000);
    expect(tl.getState().values[0]).toBe(100);
  });

  it("stops a decay that never rests where it is, and says so with capped", () => {
    const { tl } = rig([[0, 0], [100, null, { decay: { velocity: 1000, friction: 1e-9, rest: { restSpeed: 1 } } }]]);
    expect(tl.getState().capped).toBe(true);
    const end = tl.getState().duration;
    tl.seek(end);
    const at = tl.getState().values[0];
    expect(at).toBeGreaterThan(9000);
    tl.seek(end + 5000);
    expect(tl.getState().values[0]).toBe(at);
  });

  it("is false when nothing hit the cap", () => {
    expect(rig([[0, 0], [100, 100, { stiffness: 170, damping: 26 }]]).tl.getState().capped).toBe(false);
    expect(rig([[0, 0], [100, 100]]).tl.getState().capped).toBe(false);
  });
});

describe("M3: vendor names of transform", () => {
  it.each(["-webkit-transform", "-moz-transform", "-ms-transform", "Transform", "-WEBKIT-Transform"])("throws a TypeError for %s", (value) => {
    expect(() => rig([[0, 0], [100, 1]], { tracks: [{ target: {}, value, keys: [[0, 0], [100, 1]] }] })).toThrow(TypeError);
  });

  it("accepts a property that only holds the word", () => {
    for (const value of ["-webkit-mask-position", "transform-origin", "transform-box"]) {
      expect(() => rig([[0, 0], [100, 1]], { tracks: [{ target: {}, value, keys: [[0, 0], [100, 1]] }] })).not.toThrow();
    }
  });
});

describe("M4: overflow", () => {
  const line = (n: number) => Array.from({ length: n }, () => ({ target: {}, value: "opacity", keys: [[0, 0], [100, 1]] as Keyframe[] }));

  it("throws for a stagger that overflows the start of a track", () => {
    expect(() => rig([[0, 0], [100, 1]], { tracks: line(3), stagger: 1e308 })).toThrow(TypeError);
    expect(() => rig([[0, 0], [100, 1]], { tracks: line(3), place: "sequence", stagger: 1e308 })).toThrow(TypeError);
  });

  it("throws for key times that overflow with the offset", () => {
    expect(() => rig([[0, 0], [100, 1]], { tracks: [{ target: {}, value: "opacity", offset: 1.7e308, keys: [[0, 0], [1.7e308, 1]] }] })).toThrow(TypeError);
  });
});

describe("L1: a stale complete", () => {
  it("does not fire early in the next play after another task moved the timeline in the same frame", () => {
    const env = new FakeTimelineEnv();
    const scheduler = createScheduler(env);
    const tl = createTimeline(env, { scheduler, tracks: [{ target: {}, value: "opacity", keys: [[0, 0], [20, 1]] }] });
    let armed = false;
    const other: FrameTask = { step: () => true, frame: () => { if (armed) { armed = false; tl.seek(0); } } };
    scheduler.add(other);
    const done = vi.fn();
    tl.on("complete", done);
    tl.play();
    for (let i = 0; i < 2; i++) scheduler.advance(FIXED_STEP);
    armed = true;
    scheduler.advance(FIXED_STEP);
    expect(tl.getState()).toMatchObject({ playing: false, time: 0 });
    tl.play();
    scheduler.advance(FIXED_STEP);
    expect(done).not.toHaveBeenCalled();
  });
});

describe("L2: a named spring is checked like an inline one", () => {
  it("throws a TypeError for a spring of the flavor that is not usable", () => {
    const flavor = { ...tempo, springs: { ...tempo.springs, broken: { stiffness: -1, damping: 1 } } };
    expect(() => rig([[0, 0], [100, 1, "broken"]], { flavor })).toThrow(TypeError);
    expect(() => rig([[0, 0], [100, 1, "settle"]], { flavor })).not.toThrow();
  });
});

describe("L3: the slices after a hand-over follow an oracle that starts from the position and the speed", () => {
  it("after a spring cut by a spring", () => {
    const first = oracleFrom(SOFT, 0, 0, 100, 12);
    const { p, v } = first[12];
    const second = oracleFrom(SOFT, p, v, 0, 30);
    const { tl } = rig([[0, 0], [100, 100, SOFT], [500, 0, SOFT]]);
    for (let j = 0; j <= 30; j++) {
      tl.seek(100 + j * STEP_MS);
      expect(tl.getState().values[0], `slice ${j}`).toBeCloseTo(second[j].p, 9);
    }
  });

  it("after a spring cut by a decay", () => {
    const { p, v } = oracleFrom(SOFT, 0, 0, 100, 24)[24];
    const { tl } = rig([[0, 0], [200, 100, SOFT], [3000, null, DECAY]]);
    const factor = Math.exp(-4 * FIXED_STEP);
    let position = p;
    let speed = v;
    for (let j = 1; j <= 40; j++) {
      speed *= factor;
      position += speed * FIXED_STEP;
      tl.seek(200 + j * STEP_MS);
      expect(tl.getState().values[0], `slice ${j}`).toBeCloseTo(position, 9);
    }
  });
});

describe("L7: listeners, snapshots, and counts", () => {
  it("makes on() after destroy a no-op that returns a no-op unsubscribe", () => {
    const { tl } = rig([[0, 0], [100, 1]]);
    tl.destroy();
    const listener = vi.fn();
    const off = tl.on("update", listener);
    expect(typeof off).toBe("function");
    expect(() => off()).not.toThrow();
    tl.seek(10);
    expect(listener).not.toHaveBeenCalled();
  });

  it("reads the unit, the format, the target, and the property at build, so a later change does nothing", () => {
    const env = new FakeTimelineEnv();
    const target = {};
    const spec = { target, value: "width", unit: "px", keys: [[0, 0], [100, 100]] as Keyframe[] } as { target: object; value: string; unit?: string; keys: Keyframe[] };
    const tl = createTimeline(env, { tracks: [spec] });
    spec.unit = "em";
    spec.value = "height";
    spec.target = {};
    tl.seek(50);
    expect(env.writes).toEqual([{ target, property: "width", value: "50px" }]);
  });

  it("counts the errors of listeners on the state, and logs once per listener", () => {
    const { tl, slices } = rig([[0, 0], [1000, 100]]);
    tl.on("update", () => { throw new Error("x"); });
    tl.play();
    slices(4);
    expect(tl.getState().listenerErrors).toBe(5);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
