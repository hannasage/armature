import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { FIXED_STEP } from "../../src/engine/spring";
import { createLayout, createPresence, createShared } from "../../src/layout";
import { checkPage, root } from "../helpers/doc-pages";
import { box, FakeLayoutEnv } from "../helpers/fake-layout-env";
import { lofty } from "../helpers/layout-flavor";

// The numbers of docs/layout.md. The layouts per frame come from the browser measure saved in tests/browser/results/distortion.json.
// The others are worked out by running the controllers on a fake environment.

type Run = { mode: string; children: number; layoutsPerFrame: number };
const runs = (JSON.parse(readFileSync(join(root, "tests/browser/results/distortion.json"), "utf8")) as { results: { runs: Run[] } }).results.runs;

/** A layout of one element from a first box to its natural box. */
function moved(first = box(0, 0, 100, 100)) {
  const env = new FakeLayoutEnv();
  const el = {};
  env.place(el, box(200, 0, 100, 100));
  const layout = createLayout(el, { flavor: lofty, env });
  layout.snapshot(first);
  layout.play();
  return { env, el, layout };
}

checkPage("layout.md", [
  {
    text: "Counter-scale did 0.02 layouts per frame, and a size animation did 1.01",
    check: () => {
      const counter = runs.filter((run) => run.mode === "counter");
      const size = runs.filter((run) => run.mode === "size");
      expect(counter.length).toBeGreaterThan(0);
      expect(size.length).toBeGreaterThan(0);
      for (const run of counter) expect(Math.round(run.layoutsPerFrame * 100) / 100, `${run.children}`).toBe(0.02);
      for (const run of size) expect(Math.round(run.layoutsPerFrame * 100) / 100, `${run.children}`).toBe(1.01);
    },
  },
  {
    text: "(2,000 by default)",
    check: () => {
      const waited = (ms: number) => {
        const env = new FakeLayoutEnv();
        const [from, to] = [{}, {}];
        env.place(from, box(0, 0, 50, 50));
        env.place(to, box(300, 300, 100, 100));
        const shared = createShared({ flavor: lofty, env });
        shared.leave("key", from);
        env.time += ms;
        return shared.enter("key", to).getState().moving;
      };
      expect(waited(1999)).toBe(true);
      expect(waited(2001)).toBe(false);
    },
  },
  {
    text: "after 5 seconds",
    check: () => {
      const env = new FakeLayoutEnv();
      const [container, el] = [{}, {}];
      env.place(el, box(0, 0, 100, 100));
      createPresence(container, { flavor: lofty, env }).exit(el);
      expect(env.timers.map((timer) => timer.ms)).toEqual([5000]);
    },
  },
  { text: "1/120 s", check: () => expect(FIXED_STEP * 120).toBe(1) },
  {
    text: "A 30, 60, or 144 Hz screen gives the same positions",
    check: () => {
      // 1/6 s is a whole number of frames at all three rates.
      const at = (hz: number) => {
        const { env, el } = moved();
        for (let i = 0; i < hz / 6; i++) env.tick(1000 / hz);
        return env.offsetOf(el).translate[0];
      };
      const at60 = at(60);
      expect(at60).toBeLessThan(0);
      expect(at(30)).toBeCloseTo(at60, 6);
      expect(at(144)).toBeCloseTo(at60, 6);
    },
  },
  {
    text: "A number written is cut to 1,000,000,000, rounded to 3 decimals for pixels and 5 for a scale",
    check: () => {
      const far = moved(box(-5e9, 0, 100, 100));
      expect(far.env.style(far.el, "translate")).toBe("-1000000000px 0px");
      const fine = moved(box(200.1234567, 0, 100 * 1.234567891, 100));
      const [x, scale] = [fine.env.style(fine.el, "translate")!, fine.env.style(fine.el, "scale")!];
      expect(x).toMatch(/^-?\d+\.\d{3}px 0px$/);
      expect(scale).toMatch(/^\d+\.\d{5} 1$/);
      expect(parseFloat(scale)).toBe(Number((1.234567891).toFixed(5)));
    },
  },
]);
