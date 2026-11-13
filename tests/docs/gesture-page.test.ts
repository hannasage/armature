import { expect } from "vitest";
import { FIXED_STEP } from "../../src/engine/spring";
import { createDrag, createPointerVelocity } from "../../src/gesture";
import { checkPage } from "../helpers/doc-pages";
import { FakePointerEnv } from "../helpers/fake-pointer-env";
import { swipey } from "../helpers/gesture-flavor";

// The numbers of docs/gesture.md, worked out by running a drag and the pointer velocity tracker on a fake environment.

const reach = swipey.gesture!.rubberBand.reach;
const x = (env: FakePointerEnv, el: object) => parseFloat(env.read(el) ?? "0");

/** Pulls an element 200 px past the bound of [0, 100], holds still, and releases. Returns its position 1/6 s later at `hz` frames per second. */
function bandReturn(hz: number): number {
  const env = new FakePointerEnv();
  const el = {};
  createDrag(el, { flavor: swipey, axis: "x", bounds: [0, 100], env });
  env.press(el, [0, 0], [300, 0], 200);
  env.time += 500;
  env.up(el, 300, 0);
  for (let i = 0; i < Math.round(hz / 6); i++) env.tick(1000 / hz);
  return x(env, el);
}

checkPage("gesture.md", [
  {
    text: "A position is never written larger than 1,000,000,000 px",
    check: () => {
      const env = new FakePointerEnv();
      const el = {};
      createDrag(el, { flavor: swipey, axis: "x", env });
      env.down(el, 0, 0);
      env.time += 16;
      env.move(el, 5e9, 0);
      expect(env.read(el)).toBe("1000000000px 0px");
    },
  },
  {
    text: "12,000 px per second",
    check: () => {
      const velocity = createPointerVelocity();
      velocity.add(0, 0, 0);
      velocity.add(1000, 0, 10);
      expect(velocity.read(10).x).toBe(12000);
    },
  },
  {
    text: "0.999",
    check: () => {
      const env = new FakePointerEnv();
      const el = {};
      createDrag(el, { flavor: swipey, axis: "x", bounds: [0, 100], env });
      env.press(el, [0, 0], [1e6, 0], 100);
      expect(x(env, el) - 100).toBeCloseTo(0.999 * reach, 6);
    },
  },
  { text: "1/120 s", check: () => expect(FIXED_STEP * 120).toBe(1) },
  {
    text: "so a 30, 60, or 144 Hz screen returns at the same pace",
    check: () => {
      const at60 = bandReturn(60);
      expect(at60).toBeGreaterThan(100);
      expect(at60).toBeLessThan(100 + reach);
      expect(bandReturn(30)).toBeCloseTo(at60, 6);
      expect(bandReturn(144)).toBeCloseTo(at60, 6);
    },
  },
  {
    text: "the speed at which a critically damped spring of the band stiffness peaks at 0.8 times",
    check: () => {
      // A hard flick outward from past the bound is clamped to the band speed as the band spring starts. A critically damped spring that leaves
      // its rest point at speed v peaks at v / (omega e), with omega the square root of the stiffness.
      const env = new FakePointerEnv();
      const el = {};
      const drag = createDrag(el, { flavor: swipey, axis: "x", bounds: [0, 100], env });
      env.press(el, [0, 0], [110, 0], 8);
      env.up(el, 110, 0);
      const speed = drag.getState().vx;
      const peak = speed / (Math.sqrt(swipey.gesture!.rubberBand.stiffness) * Math.E);
      expect(Math.round((peak / reach) * 10) / 10).toBe(0.8);
    },
  },
  {
    text: "a flick at the speed ceiling, with a band stiffness of 300 and a reach of 120, peaks at 0.96 times",
    check: () => {
      // A flick at the speed ceiling, released just inside the bound with no snap points, decays into the band. The largest overshoot it shows is measured.
      expect(swipey.gesture!.rubberBand).toEqual({ stiffness: 300, reach: 120 });
      const env = new FakePointerEnv();
      const el = {};
      createDrag(el, { flavor: swipey, axis: "x", bounds: [0, 100], env });
      env.press(el, [0, 0], [99, 0], 8);
      env.up(el, 99, 0);
      let peak = 0;
      for (let i = 0; i < 600 && env.pending > 0; i++) {
        env.tick();
        peak = Math.max(peak, x(env, el) - 100);
      }
      expect(Math.round((peak / reach) * 100) / 100).toBe(0.96);
    },
  },
  {
    text: "70 ms",
    check: () => {
      const velocity = createPointerVelocity();
      velocity.add(0, 0, 0);
      velocity.add(100, 0, 10);
      expect(velocity.read(80).x / velocity.read(10).x).toBeCloseTo(Math.exp(-1), 9);
    },
  },
  {
    text: "less than 4 ms apart",
    check: () => {
      const tracker = () => {
        const velocity = createPointerVelocity();
        velocity.add(0, 0, 0);
        velocity.add(10, 0, 10);
        return velocity;
      };
      const close = tracker();
      close.add(1000, 0, 13);
      expect(close.read(13).x).toBeCloseTo(1000 * Math.exp(-3 / 70), 9);
      const apart = tracker();
      apart.add(1000, 0, 14);
      expect(apart.read(14).x).toBeGreaterThan(1000);
    },
  },
]);
