import { expect, vi } from "vitest";
import { FIXED_STEP, MAX_FRAME } from "../../src/engine/spring";
import { createScheduler } from "../../src/frame";
import { checkPage } from "../helpers/doc-pages";
import { FakeTimelineEnv } from "../helpers/fake-timeline-env";

// The numbers of docs/frame.md, worked out by running the scheduler on a fake frame loop.

/** A scheduler on a fake frame loop, with one task that counts its slices. */
function counting() {
  const env = new FakeTimelineEnv();
  const scheduler = createScheduler(env);
  const counter = { slices: 0 };
  scheduler.add({ step: () => void (counter.slices += 1) });
  return { env, scheduler, counter };
}

checkPage("frame.md", [
  {
    text: "So a 30, 60, or 144 Hz screen gives the same slices.",
    check: () => {
      // 1/6 s is a whole number of frames at all three rates.
      const slices = (hz: number) => {
        const { env, counter } = counting();
        for (let i = 0; i < hz / 6; i++) env.tick(1000 / hz);
        return counter.slices;
      };
      expect(slices(60)).toBe(20);
      expect(slices(30)).toBe(20);
      expect(slices(144)).toBe(20);
    },
  },
  { text: "Every slice is 1/120 s long.", check: () => expect(FIXED_STEP * 120).toBe(1) },
  {
    text: "0.1 s",
    check: () => {
      expect(MAX_FRAME).toBe(0.1);
      const { scheduler, counter } = counting();
      scheduler.advance(10);
      expect(counter.slices).toBe(Math.round(MAX_FRAME / FIXED_STEP));
    },
  },
  {
    text: "A frame of 250 ms, for example after the browser was busy, runs 12 slices",
    check: () => {
      const { env, counter } = counting();
      env.tick(250);
      expect(counter.slices).toBe(12);
    },
  },
  {
    text: "When the tab shows again, the clock starts from that moment, so the hidden time does not count.",
    check: () => {
      const env = new FakeTimelineEnv();
      let hidden = false;
      let listener: (isHidden: boolean) => void = () => undefined;
      const scheduler = createScheduler(Object.assign(env, { tabHidden: () => hidden, onVisibilityChange: (fn: (isHidden: boolean) => void) => ((listener = fn), () => undefined) }));
      const counter = { slices: 0 };
      scheduler.add({ step: () => void (counter.slices += 1) });
      hidden = true;
      listener(true);
      expect(env.pending).toBe(0);
      env.time += 5000;
      hidden = false;
      listener(false);
      env.tick(1000 / 60);
      expect(counter.slices).toBe(2);
    },
  },
  {
    text: "scheduler.advance(1 / 60); // two slices",
    check: () => {
      const { scheduler, counter } = counting();
      scheduler.advance(1 / 60);
      expect(counter.slices).toBe(2);
    },
  },
  {
    text: "A call of `advance` from inside a task is ignored and logged once",
    check: () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const scheduler = createScheduler(new FakeTimelineEnv());
        let slices = 0;
        scheduler.add({ step: () => void ((slices += 1), scheduler.advance(1)) });
        scheduler.advance(1 / 60);
        expect(slices).toBe(2);
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
      }
    },
  },
  {
    text: "One without the other throws a `TypeError`.",
    check: () => expect(() => createScheduler({ ...new FakeTimelineEnv(), tabHidden: () => false })).toThrow(TypeError),
  },
]);
