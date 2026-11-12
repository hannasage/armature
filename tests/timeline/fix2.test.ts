import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { easing } from "../../src/curves";
import { FIXED_STEP, type SpringConfig } from "../../src/engine/spring";
import { createScheduler } from "../../src/frame";
import { createTimeline, type Keyframe, type TimelineOptions } from "../../src/timeline";
import { FakeTimelineEnv } from "../helpers/fake-timeline-env";

const STEP_MS = FIXED_STEP * 1000;
const SOFT: SpringConfig = { stiffness: 40, damping: 4 };
const DECAY = { decay: { friction: 4, rest: { restSpeed: 5 } } };
const FACTOR = Math.exp(-4 * FIXED_STEP);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

function rig(keys: readonly Keyframe[], extra: Partial<TimelineOptions> = {}) {
  const env = new FakeTimelineEnv();
  const scheduler = createScheduler(env);
  const tl = createTimeline(env, { scheduler, tracks: [{ target: {}, value: "opacity", keys }], ...extra });
  return { env, scheduler, tl, slices: (n: number) => { for (let i = 0; i < n; i++) scheduler.advance(FIXED_STEP); } };
}

describe("a bezier that ends with x2 = 1 hands over its slope", () => {
  // The slope at the end of a curve with x2 = 1 is 1 / (1 - x1) for these points, because both y1 and y2 end flat in the limit.
  const cases: Array<[string, (p: number) => number, number]> = [
    ['easing("linear")', easing("linear"), 1],
    ['easing("ease-in")', easing("ease-in"), 1 / (1 - 0.42)],
  ];

  it.each(cases)("%s into a decay moves by the slope: one slice after the hand-over", (_name, curve, slope) => {
    const { tl } = rig([[0, 0], [1000, 100, curve], [3000, null, DECAY]]);
    tl.seek(1000);
    const at = tl.getState().values[0];
    tl.seek(1000 + STEP_MS);
    const moved = tl.getState().values[0] - at;
    const expected = 100 * slope * FACTOR * FIXED_STEP;
    expect(moved).toBeGreaterThan(expected * 0.95);
    expect(moved).toBeLessThan(expected * 1.05);
  });

  it("a flavor curve with x2 = 1 does the same", async () => {
    const { tempo } = await import("../helpers/timeline-flavor");
    const flavor = { ...tempo, timeline: { ...tempo.timeline, curves: { late: [0.5, 0, 1, 1] as const } } };
    const { tl } = rig([[0, 0], [1000, 100, "late"], [3000, null, DECAY]], { flavor });
    tl.seek(1000);
    const at = tl.getState().values[0];
    tl.seek(1000 + STEP_MS);
    const expected = 100 * 2 * FACTOR * FIXED_STEP;
    expect(tl.getState().values[0] - at).toBeGreaterThan(expected * 0.95);
    expect(tl.getState().values[0] - at).toBeLessThan(expected * 1.05);
  });
});

describe("the end slope of a curve is read only for a hand-over to a spring or a decay", () => {
  it("does not call the curve at build when a tween follows", () => {
    const curve = vi.fn((p: number) => p);
    rig([[0, 0], [100, 50, curve], [200, 100, (p: number) => p]]);
    expect(curve).not.toHaveBeenCalled();
  });

  it("calls the curve at build when a spring or a decay follows", () => {
    const a = vi.fn((p: number) => p);
    rig([[0, 0], [100, 50, a], [200, 0, SOFT]]);
    expect(a).toHaveBeenCalled();
    const b = vi.fn((p: number) => p);
    rig([[0, 0], [100, 50, b], [3000, null, DECAY]]);
    expect(b).toHaveBeenCalled();
  });
});

describe("seek versus play, and reverse, with a hand-over that has speed", () => {
  const variants: Array<[string, Keyframe[]]> = [
    ["a linear tween into a decay", [[0, 0], [250, 100], [500, null, DECAY]]],
    ["a linear tween into a spring", [[0, 0], [250, 100], [500, 0, SOFT]]],
    ["an ease-in tween into a spring", [[0, 0], [250, 100, easing("ease-in")], [500, 0, SOFT]]],
  ];

  it.each(variants)("%s: playing gives the seek at every whole slice, and a reverse retraces", (_name, keys) => {
    const grid = rig(keys).tl;
    const duration = grid.getState().duration;
    const series: number[] = [];
    for (let n = 0; n * STEP_MS <= duration + 1e-6; n++) {
      grid.seek(Math.min(n * STEP_MS, duration));
      series.push(grid.getState().values[0]);
    }
    expect(series.length).toBeGreaterThan(60);
    const { tl, slices } = rig(keys);
    tl.seek(0);
    tl.play();
    let n = 0;
    const forward = [tl.getState().values[0]];
    while (tl.getState().playing && n < 2000) {
      slices(1);
      n += 1;
      forward.push(tl.getState().values[0]);
      expect(forward[n], `slice ${n}`).toBeCloseTo(series[Math.min(n, series.length - 1)], 9);
    }
    tl.reverse();
    for (let m = 1; m <= n; m++) {
      slices(1);
      expect(tl.getState().values[0], `slice ${m} back`).toBeCloseTo(forward[n - m], 9);
    }
    expect(tl.getState()).toMatchObject({ playing: false, time: 0 });
  });
});

describe("after destroy, seek and scrub do nothing, whatever they are given", () => {
  it("ignores NaN and a value that is not a number", () => {
    const { tl } = rig([[0, 0], [100, 1]]);
    tl.destroy();
    for (const bad of [NaN, "x", undefined]) {
      expect(() => tl.seek(bad as unknown as number)).not.toThrow();
      expect(() => tl.scrub(bad as unknown as number)).not.toThrow();
    }
  });
});
