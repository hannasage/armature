import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { easing } from "../../src/curves";
import { createSpring, FIXED_STEP, retarget, stepSpring, type SpringConfig } from "../../src/engine/spring";
import { createScheduler, type Scheduler } from "../../src/frame";
import { createTimeline, type Keyframe, type Timeline, type TimelineOptions } from "../../src/timeline";
import { FakeTimelineEnv } from "../helpers/fake-timeline-env";

const STEP_MS = FIXED_STEP * 1000;
const SPRING: SpringConfig = { stiffness: 170, damping: 26 };
const SOFT: SpringConfig = { stiffness: 40, damping: 4 };

let error: MockInstance<typeof console.error>;
beforeEach(() => {
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

interface Rig {
  env: FakeTimelineEnv;
  scheduler: Scheduler;
  tl: Timeline;
  targets: object[];
  /** Runs `n` whole slices by hand. */
  slices(n: number): void;
}

/** A timeline on a scheduler of its own, stepped by hand. `keys` gives one track, and `options` can give any number. */
function rig(keys: readonly Keyframe[] | null, options: Partial<TimelineOptions> & { value?: string } = {}): Rig {
  const env = new FakeTimelineEnv();
  const scheduler = createScheduler(env);
  const { value = "opacity", ...rest } = options;
  const targets: object[] = [];
  const tracks = rest.tracks ?? [{ target: (targets[0] = {}), value, keys: keys ?? [] }];
  const tl = createTimeline(env, { scheduler, ...rest, tracks });
  return { env, scheduler, tl, targets, slices: (n) => { for (let i = 0; i < n; i++) scheduler.advance(FIXED_STEP); } };
}

/** The values a spring from `from` to `to` takes slice by slice, by the engine's own functions. The last one is the rest. */
function oracle(config: SpringConfig, from: number, to: number): number[] {
  let state = retarget(createSpring(config, from), to);
  const series = [state.value];
  for (let i = 0; i < 5000 && !(state.value === to && state.velocity === 0 && i > 0); i++) {
    state = stepSpring(state, to, FIXED_STEP);
    series.push(state.value);
  }
  return series;
}

const ease = easing("ease-out");
const SPEC_KEYS: Keyframe[] = [[0, 0], [300, 120, ease], [800, 0, SPRING]];

describe("a track on the fixed step", () => {
  it("writes pinned frames: a linear move gives one value per slice, and writes the start pose at play", () => {
    const { env, targets, tl, slices } = rig([[0, 0], [100, 100]]);
    tl.play();
    slices(3);
    expect(env.valuesOf(targets[0], "opacity")).toEqual(["0", "8.3333", "16.6667", "25"]);
  });

  it("ends exactly on the last key, stops its frame, and calls the complete listeners once", () => {
    const { env, scheduler, targets, tl, slices } = rig([[0, 0], [100, 100]]);
    const done = vi.fn();
    tl.on("complete", done);
    tl.play();
    slices(40);
    expect(env.valuesOf(targets[0], "opacity").at(-1)).toBe("100");
    expect(tl.getState()).toMatchObject({ time: 100, duration: 100, playing: false, reversed: false, destroyed: false });
    expect(scheduler.size).toBe(0);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("shapes the segment that ends at a key with the curve of that key", () => {
    const { env, targets, tl } = rig([[0, 0], [100, 100, (p: number) => p * p]]);
    tl.seek(50);
    expect(env.valuesOf(targets[0], "opacity")).toEqual(["25"]);
  });

  it("holds the first value before the first key and the last value after the last key", () => {
    const { tl } = rig([[100, 10], [200, 30]]);
    tl.seek(0);
    expect(tl.getState().values).toEqual([10]);
    tl.seek(150);
    expect(tl.getState().values[0]).toBeCloseTo(20, 9);
    tl.seek(1e6);
    expect(tl.getState().values).toEqual([30]);
  });

  it("takes a time-zero jump: two keys at one time make a step", () => {
    const { tl } = rig([[0, 0], [100, 10], [100, 50], [200, 100]]);
    tl.seek(99);
    expect(tl.getState().values[0]).toBeCloseTo(9.9, 9);
    tl.seek(100);
    expect(tl.getState().values[0]).toBeCloseTo(50, 9);
    tl.seek(150);
    expect(tl.getState().values[0]).toBeCloseTo(75, 9);
  });

  it("writes a unit after the number, or whatever a format function says", () => {
    const a = rig([[0, 0], [100, 100]], { value: "width" });
    a.tl.seek(50);
    expect(a.env.writes[0]).toMatchObject({ property: "width", value: "50" });
    const env = new FakeTimelineEnv();
    const target = {};
    const tl = createTimeline(env, { tracks: [
      { target, value: "width", unit: "px", keys: [[0, 0], [100, 100]] },
      { target, value: "rotate", format: (n) => `${n.toFixed(1)}deg`, keys: [[0, 0], [100, 90]] },
    ] });
    tl.seek(50);
    expect(env.writes.map((w) => `${w.property}:${w.value}`)).toEqual(["width:50px", "rotate:45.0deg"]);
    tl.destroy();
  });

  it("runs the example of the spec: a curve to 120, then a spring back to 0", () => {
    const { tl, slices } = rig(SPEC_KEYS);
    tl.seek(0);
    expect(tl.getState().values[0]).toBe(0);
    tl.seek(300);
    expect(tl.getState().values[0]).toBeCloseTo(120, 9);
    tl.seek(150);
    expect(tl.getState().values[0]).toBeCloseTo(120 * ease(0.5), 9);
    tl.seek(tl.getState().duration);
    expect(tl.getState().values[0]).toBe(0);
    tl.seek(0);
    tl.play();
    slices(400);
    expect(tl.getState()).toMatchObject({ playing: false, time: tl.getState().duration, values: [0] });
  });
});

describe("a spring step", () => {
  it("starts at the time of the previous key, from where the track is, and follows the spring of the engine slice by slice", () => {
    const { tl } = rig(SPEC_KEYS);
    const reference = oracle(SPRING, 120, 0);
    for (const k of [0, 1, 2, 10, 37, 60]) {
      tl.seek(300 + k * STEP_MS);
      expect(tl.getState().values[0], `slice ${k}`).toBeCloseTo(reference[k], 9);
    }
  });

  it("is the last key: the timeline lasts until the spring rests, and lands exactly on the target", () => {
    const { tl } = rig(SPEC_KEYS);
    const reference = oracle(SPRING, 120, 0);
    expect(reference.length).toBeGreaterThan(60);
    expect(tl.getState().duration).toBeCloseTo(Math.max(800, 300 + (reference.length - 1) * STEP_MS), 6);
    tl.seek(tl.getState().duration);
    expect(tl.getState().values[0]).toBe(0);
  });

  it("is cut by the next key, which takes over with the position and the speed of the spring", () => {
    const { tl } = rig([[0, 0], [100, 100, SOFT], [500, 0, SOFT]]);
    tl.seek(100);
    const at = tl.getState().values[0];
    expect(at).toBeGreaterThan(5);
    expect(at).toBeLessThan(60);
    tl.seek(100 + STEP_MS);
    expect(Math.abs(tl.getState().values[0] - at)).toBeLessThan(6);
    // A spring that restarted from rest would fall at once. This one keeps its speed, so it climbs first.
    let peak = at;
    for (let ms = 100; ms <= 300; ms += STEP_MS) {
      tl.seek(ms);
      peak = Math.max(peak, tl.getState().values[0]);
    }
    expect(peak).toBeGreaterThan(at + 1);
  });

  it("is deterministic: two timelines give the same frames, and a seek leaves no trace", () => {
    const a = rig(SPEC_KEYS);
    const b = rig(SPEC_KEYS);
    for (const r of [a, b]) {
      r.tl.play();
      r.slices(200);
    }
    expect(a.env.valuesOf(a.targets[0], "opacity")).toEqual(b.env.valuesOf(b.targets[0], "opacity"));
    const { tl } = rig(SPEC_KEYS);
    tl.seek(700);
    const first = tl.getState().values[0];
    tl.seek(300);
    tl.seek(1000);
    tl.seek(700);
    expect(tl.getState().values[0]).toBe(first);
  });
});

describe("a decay step", () => {
  const decay = { decay: { velocity: 600, friction: 4, rest: { restSpeed: 5 } } };

  it("slows by friction and stops where its speed falls under the rest speed", () => {
    const { tl } = rig([[0, 100], [1000, null, decay]]);
    let v = 600;
    let p = 100;
    let slices = 0;
    const factor = Math.exp(-4 * FIXED_STEP);
    for (;;) {
      v *= factor;
      p += v * FIXED_STEP;
      slices += 1;
      if (Math.abs(v) < 5) break;
    }
    expect(tl.getState().duration).toBeCloseTo(Math.max(1000, slices * STEP_MS), 6);
    tl.seek(tl.getState().duration);
    expect(tl.getState().values[0]).toBeCloseTo(p, 6);
    expect(p).toBeGreaterThan(140);
  });

  it("takes the speed of the step before it when it names none", () => {
    const { tl } = rig([[0, 0], [200, 100, SOFT], [2000, null, { decay: { friction: 4, rest: { restSpeed: 5 } } }]]);
    tl.seek(200);
    const at = tl.getState().values[0];
    tl.seek(tl.getState().duration);
    expect(tl.getState().values[0]).toBeGreaterThan(at + 1);
  });
});

describe("seek, play, reverse", () => {
  const MIXED: Keyframe[] = [[0, 0], [250, 100, ease], [500, 20, SPRING]];

  it("gives at a whole slice the same value as playing to it, and within one slice of it at any other time", () => {
    const grid = rig(MIXED).tl;
    const duration = grid.getState().duration;
    const series: number[] = [];
    for (let n = 0; n * STEP_MS <= duration; n++) {
      grid.seek(n * STEP_MS);
      series.push(grid.getState().values[0]);
    }
    const bound = Math.max(...series.slice(1).map((v, i) => Math.abs(v - series[i])));
    const played = rig(MIXED);
    played.tl.play();
    const probe = rig(MIXED).tl;
    for (let n = 1; n < series.length; n++) {
      played.slices(1);
      if (!played.tl.getState().playing) break;
      probe.seek(played.tl.getState().time);
      expect(played.tl.getState().values[0], `slice ${n}`).toBeCloseTo(series[n], 9);
      expect(probe.getState().values[0], `slice ${n}`).toBeCloseTo(series[n], 9);
    }
    for (const t of [3, 61.3, 250, 251, 333.3, 499.9, 612.5]) {
      const n = Math.floor(t / STEP_MS + 1e-9);
      const seeker = rig(MIXED).tl;
      seeker.seek(t);
      expect(Math.abs(seeker.getState().values[0] - series[n]), `t ${t}`).toBeLessThanOrEqual(bound + 1e-9);
    }
  });

  it("retraces on reverse: the slice m of the way back gives the value of the slice N - m of the way forward", () => {
    const { tl, slices } = rig(MIXED);
    tl.seek(0);
    const forward = [tl.getState().values[0]];
    tl.play();
    let n = 0;
    while (tl.getState().playing && n < 1000) {
      slices(1);
      n += 1;
      forward.push(tl.getState().values[0]);
    }
    expect(n).toBeGreaterThan(60);
    expect(tl.getState().time).toBe(tl.getState().duration);
    tl.reverse();
    expect(tl.getState()).toMatchObject({ playing: true, reversed: true });
    for (let m = 1; m <= n; m++) {
      slices(1);
      expect(tl.getState().values[0], `slice ${m} back`).toBeCloseTo(forward[n - m], 9);
    }
    expect(tl.getState()).toMatchObject({ playing: false, time: 0 });
  });

  it("turns back from the middle when reverse is called while it plays", () => {
    const { tl, slices } = rig([[0, 0], [1000, 100]]);
    tl.play();
    slices(30);
    const mid = tl.getState().time;
    tl.reverse();
    slices(30);
    expect(tl.getState().time).toBeCloseTo(mid - 30 * STEP_MS, 6);
    expect(tl.getState().time).toBeCloseTo(0, 6);
    expect(tl.getState().playing).toBe(false);
    tl.reverse();
    expect(tl.getState().reversed).toBe(false);
  });

  it("pauses, holds its time, and plays on from there", () => {
    const { env, scheduler, tl, slices } = rig([[0, 0], [1000, 100]]);
    tl.play();
    slices(10);
    tl.pause();
    expect(scheduler.size).toBe(0);
    const held = tl.getState().time;
    const writes = env.writes.length;
    slices(10);
    expect(tl.getState()).toMatchObject({ time: held, playing: false });
    expect(env.writes.length).toBe(writes);
    tl.play();
    slices(5);
    expect(tl.getState().time).toBeCloseTo(held + 5 * STEP_MS, 6);
    expect(env.writes.length).toBeGreaterThan(writes);
  });

  it("restarts from the start when play is called at the end, and plays back when reverse is called at the end", () => {
    const { tl, slices } = rig([[0, 0], [100, 100]]);
    tl.play();
    slices(20);
    expect(tl.getState().time).toBe(100);
    tl.play();
    expect(tl.getState()).toMatchObject({ time: 0, playing: true });
    slices(20);
    tl.reverse();
    slices(5);
    expect(tl.getState().time).toBeCloseTo(100 - 5 * STEP_MS, 6);
  });

  it("finishes at once when reverse is called at the start", () => {
    const { tl } = rig([[0, 0], [100, 100]]);
    const done = vi.fn();
    tl.on("complete", done);
    tl.reverse();
    expect(tl.getState()).toMatchObject({ time: 0, playing: false, reversed: true });
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("seeks without starting, and keeps playing when it was playing", () => {
    const a = rig([[0, 0], [1000, 100]]);
    a.tl.seek(500);
    expect(a.tl.getState()).toMatchObject({ time: 500, playing: false });
    expect(a.scheduler.size).toBe(0);
    a.tl.play();
    a.slices(3);
    a.tl.seek(200);
    a.slices(3);
    expect(a.tl.getState()).toMatchObject({ playing: true });
    expect(a.tl.getState().time).toBeCloseTo(200 + 3 * STEP_MS, 6);
  });

  it("scrubs by progress and pauses", () => {
    const { tl, slices } = rig([[0, 0], [1000, 100]]);
    tl.play();
    slices(3);
    tl.scrub(0.25);
    expect(tl.getState()).toMatchObject({ time: 250, playing: false });
    expect(tl.getState().values[0]).toBeCloseTo(25, 9);
    tl.scrub(2);
    expect(tl.getState().time).toBe(1000);
    tl.scrub(-1);
    expect(tl.getState().time).toBe(0);
  });

  it("clamps a seek to the length of the timeline, and ignores a time that is not finite", () => {
    const { env, tl } = rig([[0, 0], [1000, 100]]);
    tl.seek(-5);
    expect(tl.getState().time).toBe(0);
    tl.seek(1e9);
    expect(tl.getState().time).toBe(1000);
    const writes = env.writes.length;
    for (const bad of [NaN, Infinity, -Infinity]) {
      tl.seek(bad);
      tl.scrub(bad);
    }
    tl.seek("12" as unknown as number);
    expect(tl.getState().time).toBe(1000);
    expect(env.writes.length).toBe(writes);
  });
});

describe("tracks in time", () => {
  const line = (n: number): TimelineOptions["tracks"] => Array.from({ length: n }, () => ({ target: {}, value: "opacity", keys: [[0, 0], [100, 100]] as Keyframe[] }));

  it("starts a track at its offset", () => {
    const { tl } = rig(null, { tracks: [{ target: {}, value: "opacity", offset: 40, keys: [[0, 0], [100, 100]] }] });
    expect(tl.getState().duration).toBe(140);
    tl.seek(90);
    expect(tl.getState().values[0]).toBeCloseTo(50, 9);
    tl.seek(20);
    expect(tl.getState().values[0]).toBe(0);
  });

  it("staggers a list: each track starts the stagger after the one before", () => {
    const { tl } = rig(null, { tracks: line(4), stagger: 50 });
    expect(tl.getState().duration).toBe(250);
    tl.seek(75);
    expect(tl.getState().values.map((v) => Number(v.toFixed(6)))).toEqual([75, 25, 0, 0]);
    tl.seek(150);
    expect(tl.getState().values.map((v) => Number(v.toFixed(6)))).toEqual([100, 100, 50, 0]);
    tl.seek(250);
    expect(tl.getState().values).toEqual([100, 100, 100, 100]);
  });

  it("runs the tracks in sequence: each starts when the one before ends, and the stagger is a gap", () => {
    const a = rig(null, { tracks: line(3), place: "sequence" });
    expect(a.tl.getState().duration).toBe(300);
    a.tl.seek(150);
    expect(a.tl.getState().values.map((v) => Number(v.toFixed(6)))).toEqual([100, 50, 0]);
    const b = rig(null, { tracks: line(3), place: "sequence", stagger: 20 });
    expect(b.tl.getState().duration).toBe(340);
    b.tl.seek(170);
    expect(b.tl.getState().values.map((v) => Number(v.toFixed(6)))).toEqual([100, 50, 0]);
  });

  it("counts the rest of a spring in the end of a track when it places the next one in sequence", () => {
    const { tl } = rig(null, { tracks: [
      { target: {}, value: "opacity", keys: [[0, 0], [100, 100, SPRING]] },
      { target: {}, value: "opacity", keys: [[0, 0], [100, 100]] },
    ], place: "sequence" });
    const spring = oracle(SPRING, 0, 100);
    const first = Math.max(100, (spring.length - 1) * STEP_MS);
    expect(tl.getState().duration).toBeCloseTo(first + 100, 6);
  });

  it("holds an empty timeline of no tracks: it finishes at once", () => {
    const { tl } = rig(null, { tracks: [] });
    const done = vi.fn();
    tl.on("complete", done);
    tl.play();
    expect(tl.getState()).toMatchObject({ duration: 0, playing: false });
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("does not slow down with a long list", () => {
    const started = performance.now();
    const { tl } = rig(null, { tracks: line(5000), stagger: 1 });
    tl.seek(2500);
    tl.seek(0);
    tl.play();
    expect(performance.now() - started).toBeLessThan(5000);
    expect(tl.getState().values).toHaveLength(5000);
  });
});

describe("two timelines on one scheduler", () => {
  const keysA: Keyframe[] = [[0, 0], [200, 100, ease], [400, 30, SPRING]];
  const keysB: Keyframe[] = [[0, 50], [300, 0, SOFT]];

  function pair(withB: boolean) {
    const env = new FakeTimelineEnv();
    const scheduler = createScheduler(env);
    const a = {};
    const b = {};
    const tlA = createTimeline(env, { scheduler, tracks: [{ target: a, value: "opacity", keys: keysA }] });
    const tlB = withB ? createTimeline(env, { scheduler, tracks: [{ target: b, value: "scale", keys: keysB }] }) : null;
    tlA.play();
    tlB?.play();
    for (let i = 0; i < 90; i++) scheduler.advance(FIXED_STEP);
    return { a: env.valuesOf(a, "opacity"), b: env.valuesOf(b, "scale"), scheduler, tlA, tlB };
  }

  it("leaves the frames of each as they are when it runs alone", () => {
    const alone = pair(false);
    const both = pair(true);
    expect(both.a).toEqual(alone.a);
    expect(both.a.length).toBeGreaterThan(30);
    const onlyB = (() => {
      const env = new FakeTimelineEnv();
      const scheduler = createScheduler(env);
      const target = {};
      const tl = createTimeline(env, { scheduler, tracks: [{ target, value: "scale", keys: keysB }] });
      tl.play();
      for (let i = 0; i < 90; i++) scheduler.advance(FIXED_STEP);
      return env.valuesOf(target, "scale");
    })();
    expect(both.b).toEqual(onlyB);
  });

  it("leaves the other one running when one is paused or destroyed", () => {
    const env = new FakeTimelineEnv();
    const scheduler = createScheduler(env);
    const a = {};
    const b = {};
    const tlA = createTimeline(env, { scheduler, tracks: [{ target: a, value: "opacity", keys: [[0, 0], [1000, 100]] }] });
    const tlB = createTimeline(env, { scheduler, tracks: [{ target: b, value: "opacity", keys: [[0, 0], [1000, 100]] }] });
    tlA.play();
    tlB.play();
    scheduler.advance(FIXED_STEP * 10);
    tlA.destroy();
    expect(scheduler.size).toBe(1);
    scheduler.advance(FIXED_STEP * 10);
    expect(tlB.getState().time).toBeCloseTo(20 * STEP_MS, 6);
    expect(tlA.getState().time).toBeCloseTo(10 * STEP_MS, 6);
    expect(error).not.toHaveBeenCalled();
  });
});

describe("frame rate", () => {
  const keys: Keyframe[] = [[0, 0], [250, 100, ease], [500, 20, SPRING]];
  const at500 = (hz: number) => {
    const env = new FakeTimelineEnv();
    const target = {};
    const tl = createTimeline(env, { tracks: [{ target, value: "opacity", keys }] });
    tl.play();
    env.run(500, 1000 / hz);
    const reading = { time: tl.getState().time, value: tl.getState().values[0] };
    env.run(10000, 1000 / hz);
    return { reading, end: tl.getState(), last: env.valuesOf(target, "opacity").at(-1), pending: env.pending };
  };

  it.each([30, 60, 144])("lands on the same value at 500 ms, and at the end, at %i Hz", (hz) => {
    const reference = at500(60);
    const run = at500(hz);
    expect(run.reading.time).toBeCloseTo(500, 5);
    expect(run.reading.value).toBeCloseTo(reference.reading.value, 9);
    expect(run.end.playing).toBe(false);
    expect(run.end.time).toBeCloseTo(reference.end.time, 6);
    expect(run.last).toBe("20");
    expect(run.pending).toBe(0);
  });
});

describe("reduced motion", () => {
  it("snaps to the end on play, writes the end pose, asks for no frame, and completes", () => {
    const { env, scheduler, targets, tl } = rig([[0, 0], [300, 100]]);
    const done = vi.fn();
    tl.on("complete", done);
    env.reduced = true;
    tl.play();
    expect(env.valuesOf(targets[0], "opacity")).toEqual(["100"]);
    expect(tl.getState()).toMatchObject({ time: 300, playing: false });
    expect(scheduler.size).toBe(0);
    expect(env.requested).toBe(0);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("snaps to the start on reverse", () => {
    const { env, tl } = rig([[0, 0], [300, 100]]);
    tl.seek(300);
    env.reduced = true;
    tl.reverse();
    expect(tl.getState()).toMatchObject({ time: 0, playing: false, values: [0] });
  });

  it("snaps when the reader turns it on in the middle of a flight", () => {
    const env = new FakeTimelineEnv();
    const target = {};
    const tl = createTimeline(env, { tracks: [{ target, value: "opacity", keys: [[0, 0], [1000, 100]] }] });
    tl.play();
    env.tick(1000 / 60);
    env.tick(1000 / 60);
    expect(tl.getState().playing).toBe(true);
    env.reduced = true;
    env.tick(1000 / 60);
    expect(tl.getState()).toMatchObject({ time: 1000, playing: false });
    expect(env.valuesOf(target, "opacity").at(-1)).toBe("100");
    expect(env.pending).toBe(0);
  });

  it("leaves a seek and a scrub alone, because the reader asked for them", () => {
    const { env, tl } = rig([[0, 0], [300, 100]]);
    env.reduced = true;
    tl.scrub(0.5);
    expect(tl.getState().time).toBe(150);
  });
});

describe("destroy", () => {
  it("in the middle of a play leaves the values where they are, stops the frame, and logs nothing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { env, scheduler, targets, tl, slices } = rig(SPEC_KEYS);
    const update = vi.fn();
    tl.on("update", update);
    tl.play();
    slices(20);
    const values = tl.getState().values;
    const writes = env.writes.length;
    const calls = update.mock.calls.length;
    tl.destroy();
    slices(20);
    tl.play();
    tl.seek(500);
    tl.reverse();
    tl.scrub(0.5);
    tl.destroy();
    expect(scheduler.size).toBe(0);
    expect(env.writes.length).toBe(writes);
    expect(tl.getState()).toMatchObject({ destroyed: true, playing: false, values });
    expect(tl.getState().failed).toBeUndefined();
    expect(update.mock.calls.length).toBe(calls);
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(env.valuesOf(targets[0], "opacity").at(-1)).toBe(String(Number(values[0].toFixed(4))));
  });

  it("cancels the frame of a scheduler it made itself", () => {
    const env = new FakeTimelineEnv();
    const tl = createTimeline(env, { tracks: [{ target: {}, value: "opacity", keys: [[0, 0], [1000, 100]] }] });
    tl.play();
    expect(env.pending).toBe(1);
    tl.destroy();
    expect(env.pending).toBe(0);
    expect(env.cancelled.length).toBe(1);
  });

  it("leaves a scheduler it was given alone", () => {
    const { env, scheduler, tl } = rig([[0, 0], [1000, 100]]);
    tl.play();
    tl.destroy();
    scheduler.advance(FIXED_STEP);
    const other = createTimeline(env, { scheduler, tracks: [{ target: {}, value: "opacity", keys: [[0, 0], [100, 1]] }] });
    other.play();
    expect(scheduler.size).toBe(1);
  });
});

describe("a failure", () => {
  it("in a write ends the play, logs once with the label, sets failed, and does not throw into the page", () => {
    const env = new FakeTimelineEnv();
    const scheduler = createScheduler(env);
    const tl = createTimeline(env, { scheduler, tracks: [{ target: {}, value: "opacity", keys: [[0, 0], [1000, 100]] }] });
    tl.play();
    env.failWith = new Error("write refused");
    expect(() => {
      env.tick(1000 / 60);
      env.tick(1000 / 60);
      env.tick(1000 / 60);
    }).not.toThrow();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("[armature]");
    expect(tl.getState().failed?.message).toBe("write refused");
    expect(tl.getState()).toMatchObject({ playing: false, destroyed: false });
    expect(scheduler.size).toBe(0);
    env.failWith = undefined;
    const writes = env.writes.length;
    tl.play();
    tl.seek(10);
    expect(env.writes.length).toBe(writes);
    expect(scheduler.size).toBe(0);
  });

  it("in a write during a seek is caught the same way", () => {
    const { env, tl } = rig([[0, 0], [100, 100]]);
    env.failWith = new Error("no");
    expect(() => tl.seek(50)).not.toThrow();
    expect(tl.getState().failed?.message).toBe("no");
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("wraps a throw that is not an Error", () => {
    const { env, tl } = rig([[0, 0], [100, 100]]);
    env.setStyle = () => { throw "plain text"; };
    tl.seek(50);
    expect(tl.getState().failed).toBeInstanceOf(Error);
    expect(tl.getState().failed?.message).toBe("plain text");
  });

  it("in a format function, or in a curve that returns no number, is a failure too", () => {
    const a = rig(null, { tracks: [{ target: {}, value: "opacity", format: () => { throw new Error("bad format"); }, keys: [[0, 0], [100, 100]] }] });
    a.tl.seek(10);
    expect(a.tl.getState().failed?.message).toBe("bad format");
    for (const bad of [NaN, Infinity, -Infinity]) {
      const b = rig([[0, 0], [100, 100, () => bad]]);
      expect(() => b.tl.seek(50)).not.toThrow();
      expect(b.tl.getState().failed, String(bad)).toBeInstanceOf(Error);
      expect(b.env.writes).toEqual([]);
    }
  });

  it("logs the error of a listener once for that listener, and runs the other listeners", () => {
    const { tl, slices } = rig([[0, 0], [1000, 100]]);
    const bad = vi.fn(() => { throw new Error("listener one"); });
    const worse = vi.fn(() => { throw new Error("listener two"); });
    const fine = vi.fn();
    tl.on("update", bad);
    tl.on("update", worse);
    tl.on("update", fine);
    tl.play();
    slices(10);
    expect(bad.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(fine.mock.calls.length).toBe(bad.mock.calls.length);
    expect(error).toHaveBeenCalledTimes(2);
    expect(tl.getState().failed).toBeUndefined();
  });

  it("logs the error of a complete listener once, and a listener can unsubscribe", () => {
    const { tl, slices } = rig([[0, 0], [50, 100]]);
    const bad = vi.fn(() => { throw new Error("late"); });
    const off = tl.on("complete", bad);
    tl.play();
    slices(20);
    tl.play();
    slices(20);
    expect(bad).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
    off();
    tl.play();
    slices(20);
    expect(bad).toHaveBeenCalledTimes(2);
  });

  it("passes the time to an update listener", () => {
    const { tl } = rig([[0, 0], [100, 100]]);
    const seen: number[] = [];
    tl.on("update", (time) => seen.push(time));
    tl.seek(40);
    tl.seek(60);
    expect(seen).toEqual([40, 60]);
  });
});

describe("what goes in", () => {
  const ok: Keyframe[] = [[0, 0], [100, 100]];
  const build = (track: Record<string, unknown>, options: Record<string, unknown> = {}, env: unknown = new FakeTimelineEnv()) =>
    () => createTimeline(env as FakeTimelineEnv, { tracks: [{ target: {}, value: "opacity", keys: ok, ...track }], ...options } as unknown as TimelineOptions);

  it.each([
    ["no keys", { keys: undefined }],
    ["an empty key list", { keys: [] }],
    ["keys that are not a list", { keys: "0,0" }],
    ["a key that is not a list", { keys: [[0, 0], 5] }],
    ["a key time of NaN", { keys: [[NaN, 0], [100, 1]] }],
    ["a key time of Infinity", { keys: [[0, 0], [Infinity, 1]] }],
    ["a negative key time", { keys: [[-1, 0], [100, 1]] }],
    ["keys that go back in time", { keys: [[0, 0], [100, 1], [50, 2]] }],
    ["a key value of NaN", { keys: [[0, NaN], [100, 1]] }],
    ["a key value of Infinity", { keys: [[0, 0], [100, Infinity]] }],
    ["a key value that is a string", { keys: [[0, 0], [100, "1"]] }],
    ["a first key with no number", { keys: [[0, null], [100, 1]] }],
    ["a null value on a key that is not a decay", { keys: [[0, 0], [100, null]] }],
    ["a spring step with a stiffness of NaN", { keys: [[0, 0], [100, 1, { stiffness: NaN, damping: 1 }]] }],
    ["a step that is a number", { keys: [[0, 0], [100, 1, 5]] }],
    ["a decay with a friction of 0", { keys: [[0, 0], [100, null, { decay: { friction: 0, rest: { restSpeed: 1 } } }]] }],
    ["a decay with a friction of NaN", { keys: [[0, 0], [100, null, { decay: { friction: NaN, rest: { restSpeed: 1 } } }]] }],
    ["a decay with no rest speed", { keys: [[0, 0], [100, null, { decay: { friction: 4, rest: {} } }]] }],
    ["a decay with a speed of Infinity", { keys: [[0, 0], [100, null, { decay: { velocity: Infinity, friction: 4, rest: { restSpeed: 1 } } }]] }],
    ["a step name with no flavor", { keys: [[0, 0], [100, 1, "ease-out"]] }],
    ["a sequence name with no flavor", { keys: undefined, sequence: "enter" }],
    ["the property transform", { value: "transform" }],
    ["the property Transform", { value: "Transform" }],
    ["an empty property", { value: "" }],
    ["a property that is not text", { value: 5 }],
    ["a property with a semicolon", { value: "opacity;color" }],
    ["an offset of NaN", { offset: NaN }],
    ["a negative offset", { offset: -1 }],
    ["a target of null", { target: null }],
    ["a target that is a number", { target: 5 }],
    ["a unit that is not text", { unit: 5 }],
    ["a format that is not a function", { format: "px" }],
  ])("throws a TypeError for %s, before it writes anything", (_name, track) => {
    const env = new FakeTimelineEnv();
    expect(build(track as Record<string, unknown>, {}, env)).toThrow(TypeError);
    expect(env.writes).toEqual([]);
    expect(env.requested).toBe(0);
  });

  it.each([
    ["tracks that are not a list", { tracks: "x" }],
    ["tracks of null", { tracks: null }],
    ["a stagger of NaN", { stagger: NaN }],
    ["a negative stagger", { stagger: -1 }],
    ["a stagger of Infinity", { stagger: Infinity }],
    ["a place that is not known", { place: "after" }],
    ["a scheduler with no add", { scheduler: {} }],
  ])("throws a TypeError for %s", (_name, options) => {
    expect(build({}, options as Record<string, unknown>)).toThrow(TypeError);
  });

  it("throws a TypeError for an environment that cannot write, or that is missing", () => {
    const env = new FakeTimelineEnv();
    expect(build({}, {}, { ...env, setStyle: undefined, requestFrame: env.requestFrame })).toThrow(TypeError);
    expect(() => createTimeline(undefined as unknown as FakeTimelineEnv, { tracks: [] })).toThrow(TypeError);
    expect(build({}, {}, null)).toThrow(TypeError);
    expect(build({}, {}, {})).toThrow(TypeError);
  });

  it("throws for options that are missing, and for a listener that is not a function", () => {
    const env = new FakeTimelineEnv();
    expect(() => createTimeline(env, undefined as unknown as TimelineOptions)).toThrow(TypeError);
    const tl = createTimeline(env, { tracks: [] });
    expect(() => tl.on("update", "x" as unknown as () => void)).toThrow(TypeError);
    expect(() => tl.on("nope" as "update", () => undefined)).toThrow(TypeError);
  });

  it("accepts custom properties and individual transform properties", () => {
    for (const value of ["--x", "translate", "scale", "rotate", "opacity"]) expect(build({ value })).not.toThrow();
  });

  it("copies the keys, so a change after the call does nothing", () => {
    const keys: Keyframe[] = [[0, 0], [100, 100]];
    const { tl } = rig(null, { tracks: [{ target: {}, value: "opacity", keys }] });
    keys[1] = [100, 5];
    tl.seek(100);
    expect(tl.getState().values).toEqual([100]);
  });
});

describe("what comes out", () => {
  const written = (keys: Keyframe[]) => {
    const r = rig(keys);
    r.tl.seek(r.tl.getState().duration);
    return r.env.writes.map((w) => w.value);
  };

  it("never writes exponent text: a large number is cut to 1,000,000,000, and a tiny one is 0", () => {
    expect(written([[0, 0], [100, 1e30]])).toEqual(["1000000000"]);
    expect(written([[0, 0], [100, -1e30]])).toEqual(["-1000000000"]);
    expect(written([[0, 1e-30], [100, 1e-30]])).toEqual(["0"]);
    expect(written([[0, 0], [100, 1e21]])[0]).not.toMatch(/e/i);
    expect(written([[0, 5], [100, -0]])).toEqual(["0"]);
  });

  it("writes only when the text changed", () => {
    const { env, tl, slices } = rig([[0, 0], [100, 100], [1000, 100]]);
    tl.play();
    slices(200);
    const list = env.writes.map((w) => w.value);
    expect(new Set(list).size).toBe(list.length);
    expect(list.at(-1)).toBe("100");
  });

  it("gives a copy of the values in the state", () => {
    const { tl } = rig([[0, 0], [100, 100]]);
    tl.seek(10);
    tl.getState().values[0] = 999;
    expect(tl.getState().values[0]).toBeCloseTo(10, 9);
  });
});
