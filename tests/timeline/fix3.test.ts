import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bezier, easing } from "../../src/curves";
import { FIXED_STEP, type SpringConfig } from "../../src/engine/spring";
import { createScheduler } from "../../src/frame";
import { createTimeline, type Keyframe } from "../../src/timeline";
import { FakeTimelineEnv } from "../helpers/fake-timeline-env";

const STEP_MS = FIXED_STEP * 1000;
const SOFT: SpringConfig = { stiffness: 40, damping: 4 };
const DECAY = { decay: { friction: 4, rest: { restSpeed: 5 } } };
const FACTOR = Math.exp(-4 * FIXED_STEP);

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

function build(keys: readonly Keyframe[]) {
  const env = new FakeTimelineEnv();
  return createTimeline(env, { scheduler: createScheduler(env), tracks: [{ target: {}, value: "opacity", keys }] });
}

describe("a bezier with a vertical end tangent hands over no speed", () => {
  it.each([
    ["(0.2, 0, 1, 0.5)", bezier(0.2, 0, 1, 0.5)],
    ["(0.25, 0.1, 1, 1.2)", bezier(0.25, 0.1, 1, 1.2)],
  ])("%s into a spring from 1 to 0.5 stays inside the span", (_name, curve) => {
    const tl = build([[0, 0], [1000, 1, curve], [3000, 0.5, SOFT]]);
    tl.seek(1000 + STEP_MS);
    expect(Math.abs(tl.getState().values[0] - 1)).toBeLessThan(0.01);
    let low = Infinity;
    let high = -Infinity;
    for (let ms = 1000; ms <= tl.getState().duration; ms += STEP_MS) {
      tl.seek(ms);
      low = Math.min(low, tl.getState().values[0]);
      high = Math.max(high, tl.getState().values[0]);
    }
    expect(high).toBeLessThan(1.01);
    expect(low).toBeGreaterThan(0.2);
  });

  it("still hands over 1 for linear and about 1.72 for ease-in", () => {
    for (const [curve, slope] of [[easing("linear"), 1], [easing("ease-in"), 1 / 0.58]] as const) {
      const tl = build([[0, 0], [1000, 100, curve], [3000, null, DECAY]]);
      tl.seek(1000);
      const at = tl.getState().values[0];
      tl.seek(1000 + STEP_MS);
      const expected = 100 * slope * FACTOR * FIXED_STEP;
      expect(tl.getState().values[0] - at).toBeGreaterThan(expected * 0.95);
      expect(tl.getState().values[0] - at).toBeLessThan(expected * 1.05);
    }
  });
});

describe("the speed handed over is at most the span in one slice", () => {
  it("cuts the speed of a steep user curve", () => {
    const steep = (p: number) => (p < 0.9999 ? 0 : p >= 1 ? 1 : (p - 0.9999) * 1e4);
    const tl = build([[0, 0], [1000, 1, steep], [3000, 0.5, SOFT]]);
    tl.seek(1000 + STEP_MS);
    expect(Math.abs(tl.getState().values[0] - 1)).toBeLessThanOrEqual(1 + 1e-9);
    let peak = 0;
    for (let ms = 1000; ms <= tl.getState().duration; ms += STEP_MS) {
      tl.seek(ms);
      peak = Math.max(peak, Math.abs(tl.getState().values[0]));
    }
    expect(peak).toBeLessThan(20);
  });
});
