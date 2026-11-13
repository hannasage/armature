import { expect } from "vitest";
import { FIXED_STEP } from "../../src/engine/spring";
import { createTimeline, type Keyframe } from "../../src/timeline";
import { checkPage } from "../helpers/doc-pages";
import { FakeTimelineEnv } from "../helpers/fake-timeline-env";

// The numbers of docs/timeline.md, worked out by running timelines on a fake environment.

const target = {};
function timeline(keys: readonly Keyframe[], extra: { format?: (value: number) => string } = {}) {
  const env = new FakeTimelineEnv();
  const tl = createTimeline(env, { tracks: [{ target, value: "opacity", keys, ...extra }] });
  return { env, tl };
}

checkPage("timeline.md", [
  {
    text: "cut to 1,000,000,000",
    check: () => {
      const seen: number[] = [];
      const { env, tl } = timeline([[0, 5e9], [100, 5e9]], { format: (value) => (seen.push(value), String(value)) });
      tl.seek(50);
      expect(seen.at(-1)).toBe(1e9);
      const plain = timeline([[0, 5e9], [100, 5e9]]);
      plain.tl.seek(50);
      expect(plain.env.valuesOf(target, "opacity").at(-1)).toBe("1000000000");
      expect(env.valuesOf(target, "opacity").at(-1)).toBe("1000000000");
    },
  },
  {
    text: "rounded to 4 decimals",
    check: () => {
      const { env, tl } = timeline([[0, 0.123456789], [100, 0.123456789]]);
      tl.seek(50);
      expect(env.valuesOf(target, "opacity").at(-1)).toBe("0.1235");
    },
  },
  {
    text: "so a linear tween from 0 to 100 over one second hands over 100 units per second",
    check: () => {
      // A decay with no speed of its own takes the speed of the step before it. Each slice h keeps r = exp(-c h) of the speed and then moves,
      // so a decay of speed v travels v h r / (1 - r) in all. The speed handed over is read back from the distance.
      const friction = 4;
      const { tl } = timeline([[0, 0], [1000, 100], [1000, null, { decay: { friction, rest: { restSpeed: 1e-6 } } }]]);
      tl.seek(Infinity);
      const travelled = tl.getState().values[0] - 100;
      const r = Math.exp(-friction * FIXED_STEP);
      expect((travelled * (1 - r)) / (FIXED_STEP * r)).toBeCloseTo(100, 3);
    },
  },
  {
    text: "10 seconds",
    check: () => {
      // The cut lands on the first whole slice past 10 seconds.
      const slice = FIXED_STEP * 1000 + 1e-9;
      const { tl } = timeline([[0, 0], [100, 1, { stiffness: 100, damping: 0 }]]);
      expect(tl.getState().capped).toBe(true);
      expect(Math.abs(tl.getState().duration - 10000)).toBeLessThanOrEqual(slice);
      const decay = timeline([[0, 0], [0, null, { decay: { velocity: 100, friction: 0.01, rest: { restSpeed: 0.001 } } }]]);
      expect(decay.tl.getState().capped).toBe(true);
      expect(Math.abs(decay.tl.getState().duration - 10000)).toBeLessThanOrEqual(slice);
    },
  },
  { text: "1/120 s", check: () => expect(FIXED_STEP * 120).toBe(1) },
  {
    text: "A 30, 60, or 144 Hz screen gives the same values",
    check: () => {
      // 1/6 s is a whole number of frames at all three rates.
      const at = (hz: number) => {
        const { env, tl } = timeline([[0, 0], [100, 1, { stiffness: 170, damping: 12 }]]);
        tl.play();
        for (let i = 0; i < hz / 6; i++) env.tick(1000 / hz);
        return tl.getState().values[0];
      };
      const at60 = at(60);
      expect(at60).toBeGreaterThan(0);
      expect(at(30)).toBeCloseTo(at60, 9);
      expect(at(144)).toBeCloseTo(at60, 9);
    },
  },
]);
