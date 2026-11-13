import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createSpring, FIXED_STEP, retarget, stepSpring, type SpringConfig, type SpringState } from "../../src/engine/spring";
import { createScheduler, type Scheduler } from "../../src/frame";
import { createLayout, type Layout, type LayoutOptions } from "../../src/layout";
import { box, FakeLayoutEnv } from "../helpers/fake-layout-env";
import { lofty } from "../helpers/layout-flavor";

// A layout controller is FLIP: snapshot (first), a change of the DOM, then play (last, invert, play). It writes the individual properties
// `translate` and `scale`, never `transform`, and springs the offset to zero.

let error: MockInstance<typeof console.error>;
beforeEach(() => {
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

/** The spring the controller builds from the flavor: the move spring, with the rest limits of the part under it. */
const MOVE: SpringConfig = { restDelta: 0.05, restSpeed: 0.5, stiffness: 170, damping: 26 };

interface Rig {
  env: FakeLayoutEnv;
  scheduler: Scheduler;
  el: object;
  layout: Layout;
  /** Runs `n` whole slices by hand. */
  slices(n: number): void;
}

function rig(options: Partial<LayoutOptions> = {}, first = box(0, 0, 100, 50)): Rig {
  const env = new FakeLayoutEnv();
  const scheduler = createScheduler(env);
  const el = {};
  env.place(el, first);
  const layout = createLayout(el, { flavor: lofty, env, scheduler, ...options });
  return { env, scheduler, el, layout, slices: (n) => { for (let i = 0; i < n; i++) scheduler.advance(FIXED_STEP); } };
}

/** First, change, play: the element sits at `first` and moves to `last`. */
function flip(r: Rig, last: ReturnType<typeof box>) {
  r.layout.snapshot();
  r.env.place(r.el, last);
  r.layout.play();
}

/** The values a spring from `from` to `to` takes slice by slice, by the engine's own functions, with a start speed. */
function oracle(from: number, speed = 0, config: SpringConfig = MOVE, slices = 600): number[] {
  let state: SpringState = { ...retarget(createSpring(config, from), 0), velocity: speed, settledVelocity: speed };
  const series = [state.value];
  for (let i = 0; i < slices && !(state.value === 0 && state.velocity === 0); i++) {
    state = stepSpring(state, 0, FIXED_STEP);
    series.push(state.value);
  }
  return series;
}

const px = (text: string | undefined, place = 0) => parseFloat(text!.split(" ")[place]);

describe("the inversion", () => {
  it("measures once at snapshot and once at play, and writes nothing until play", () => {
    const r = rig();
    r.layout.snapshot();
    expect(r.env.measured).toEqual([r.el]);
    expect(r.env.writes).toEqual([]);
    expect(r.env.requested).toBe(0);
    r.env.place(r.el, box(200, 100, 200, 100));
    expect(r.env.writes).toEqual([]);
    r.layout.play();
    expect(r.env.measured).toEqual([r.el, r.el]);
  });

  it("puts the element back where it was: translate by the center, scale by the size, and nothing but translate and scale", () => {
    const r = rig();
    flip(r, box(200, 100, 200, 100));
    // First center (50, 25), last center (300, 150). First size 100 by 50, last size 200 by 100.
    expect(r.env.style(r.el, "translate")).toBe("-250px -125px");
    expect(r.env.style(r.el, "scale")).toBe("0.5 0.5");
    expect(r.env.properties).toEqual(["scale", "translate"]);
  });

  it("shows the first box right after play, before any frame runs, so the picture does not jump", () => {
    const r = rig();
    flip(r, box(200, 100, 200, 100));
    const seen = r.env.visual(r.el);
    expect(seen.x).toBeCloseTo(0, 9);
    expect(seen.y).toBeCloseTo(0, 9);
    expect(seen.width).toBeCloseTo(100, 9);
    expect(seen.height).toBeCloseTo(50, 9);
  });

  it("works with scripted boxes: the first box and the last box come from the environment", () => {
    const r = rig();
    r.env.script(r.el, box(10, 20, 40, 40), box(110, 20, 80, 80));
    r.layout.snapshot();
    r.layout.play();
    // Centers (30, 40) and (150, 60). Sizes 40 and 80.
    expect(r.env.style(r.el, "translate")).toBe("-120px -20px");
    expect(r.env.style(r.el, "scale")).toBe("0.5 0.5");
  });

  it("writes scale on its own axes, and writes no scale for a pure move", () => {
    const wide = rig();
    flip(wide, box(0, 0, 200, 50));
    expect(wide.env.style(wide.el, "scale")).toBe("0.5 1");
    const move = rig();
    flip(move, box(300, 0, 100, 50));
    expect(move.env.style(move.el, "translate")).toBe("-300px 0px");
    expect(move.env.style(move.el, "scale")).toBeUndefined();
    expect(move.env.properties).toEqual(["translate"]);
  });

  it("does nothing when the box did not change: no write, no frame, and one rest", () => {
    const r = rig();
    const rest = vi.fn();
    r.layout.on("rest", rest);
    flip(r, box(0, 0, 100, 50));
    expect(r.env.writes).toEqual([]);
    expect(r.env.requested).toBe(0);
    expect(rest).toHaveBeenCalledTimes(1);
    expect(r.layout.getState().moving).toBe(false);
  });

  it("does nothing for a play with no snapshot, and clears a snapshot after one play", () => {
    const r = rig();
    r.layout.play();
    expect(r.env.measured).toEqual([]);
    flip(r, box(100, 0, 100, 50));
    const measured = r.env.measured.length;
    r.layout.play();
    expect(r.env.measured.length).toBe(measured);
  });

  it("takes the later of two snapshots", () => {
    const r = rig();
    r.layout.snapshot();
    r.env.place(r.el, box(50, 0, 100, 50));
    r.layout.snapshot();
    r.env.place(r.el, box(300, 0, 100, 50));
    r.layout.play();
    expect(r.env.style(r.el, "translate")).toBe("-250px 0px");
  });

  it("takes a first box from the caller, for an element that was somewhere else", () => {
    const r = rig();
    r.layout.snapshot(box(1000, 0, 100, 50));
    r.layout.play();
    expect(r.env.measured).toEqual([r.el]);
    expect(r.env.style(r.el, "translate")).toBe("1000px 0px");
  });
});

describe("the play", () => {
  it("springs the offset to zero on the engine's own spring, slice by slice", () => {
    const r = rig();
    flip(r, box(200, 100, 200, 100));
    const x = oracle(-250);
    const y = oracle(-125);
    for (let k = 1; k < 40; k++) {
      r.slices(1);
      expect(px(r.env.style(r.el, "translate"), 0)).toBeCloseTo(x[k], 3);
      expect(px(r.env.style(r.el, "translate"), 1)).toBeCloseTo(y[k], 3);
    }
  });

  it("scales on a spring too: the size difference springs to zero, so the scale comes back to 1", () => {
    const r = rig();
    flip(r, box(0, 0, 200, 100));
    const w = oracle(-100);
    r.slices(10);
    expect(px(r.env.style(r.el, "scale"), 0)).toBeCloseTo((200 + w[10]) / 200, 4);
  });

  it("rests on the new layout: the offset is removed, the frame loop stops, and rest fires once", () => {
    const r = rig();
    const update = vi.fn();
    const rest = vi.fn();
    r.layout.on("update", update);
    r.layout.on("rest", rest);
    flip(r, box(200, 100, 200, 100));
    expect(r.layout.getState().moving).toBe(true);
    r.env.run(10_000);
    expect(r.env.pending).toBe(0);
    expect(r.layout.getState().moving).toBe(false);
    expect(r.env.style(r.el, "translate")).toBeUndefined();
    expect(r.env.style(r.el, "scale")).toBeUndefined();
    expect(r.env.visual(r.el)).toEqual(box(200, 100, 200, 100));
    expect(rest).toHaveBeenCalledTimes(1);
    expect(update.mock.calls.length).toBeGreaterThan(5);
    expect(r.env.writes[r.env.writes.length - 1].value).toBeNull();
  });

  it("writes only when the text changed", () => {
    const r = rig();
    flip(r, box(200, 0, 100, 50));
    r.env.run(10_000);
    const translates = r.env.writes.filter((w) => w.property === "translate").map((w) => w.value);
    for (let i = 1; i < translates.length; i++) expect(translates[i]).not.toBe(translates[i - 1]);
  });

  it("reports the offset, the velocity, and the scale", () => {
    const r = rig();
    flip(r, box(200, 100, 200, 100));
    r.slices(5);
    const s = r.layout.getState();
    const x = oracle(-250);
    expect(s.offset[0]).toBeCloseTo(x[5], 3);
    expect(s.velocity[0]).toBeGreaterThan(0);
    expect(s.scaleX).toBeCloseTo((200 + s.offset[2]) / 200, 6);
    expect(s.destroyed).toBe(false);
    expect(s.listenerErrors).toBe(0);
    expect(s.failed).toBeUndefined();
    s.offset[0] = 99;
    expect(r.layout.getState().offset[0]).not.toBe(99);
  });

  it("rests at once when the first box is within the rest limit of the last", () => {
    const r = rig();
    flip(r, box(0.01, 0.01, 100, 50));
    expect(r.env.requested).toBe(0);
    expect(r.layout.getState().moving).toBe(false);
  });
});

describe("a change in flight", () => {
  it("retargets from where the element is now and keeps its velocity", () => {
    const r = rig();
    flip(r, box(300, 0, 100, 50));
    r.slices(10);
    const before = r.layout.getState();
    expect(Math.abs(before.velocity[0])).toBeGreaterThan(100);
    const seen = r.env.visual(r.el);
    // The second change. The snapshot sees the element where it is now, with the offset applied.
    r.layout.snapshot();
    r.env.place(r.el, box(600, 0, 100, 50));
    r.layout.play();
    const after = r.layout.getState();
    expect(after.velocity[0]).toBe(before.velocity[0]);
    // No jump: the element is where it was.
    expect(r.env.visual(r.el).x).toBeCloseTo(seen.x, 6);
    const offset = seen.x - 600;
    expect(after.offset[0]).toBeCloseTo(offset, 6);
    // And it goes on from there with that speed, on the same spring.
    const series = oracle(offset, before.velocity[0]);
    r.slices(1);
    expect(r.layout.getState().offset[0]).toBeCloseTo(series[1], 6);
    r.slices(6);
    expect(r.layout.getState().offset[0]).toBeCloseTo(series[7], 6);
    r.env.run(10_000);
    expect(r.env.visual(r.el)).toEqual(box(600, 0, 100, 50));
  });

  it("is not a restart from rest: the first slice after the change differs from the first slice of a spring with no speed", () => {
    const r = rig();
    flip(r, box(300, 0, 100, 50));
    r.slices(10);
    const v = r.layout.getState().velocity[0];
    r.layout.snapshot();
    r.env.place(r.el, box(600, 0, 100, 50));
    r.layout.play();
    const start = r.layout.getState().offset[0];
    r.slices(1);
    const kept = oracle(start, v)[1];
    const restart = oracle(start, 0)[1];
    expect(Math.abs(kept - restart)).toBeGreaterThan(0.5);
    expect(r.layout.getState().offset[0]).toBeCloseTo(kept, 6);
  });

  it("retargets the size too: the scale and its speed carry over", () => {
    const r = rig();
    flip(r, box(0, 0, 300, 50));
    r.slices(8);
    const before = r.layout.getState();
    const seen = r.env.visual(r.el);
    r.layout.snapshot();
    r.env.place(r.el, box(0, 0, 100, 50));
    r.layout.play();
    const after = r.layout.getState();
    expect(after.velocity[2]).toBe(before.velocity[2]);
    expect(r.env.visual(r.el).width).toBeCloseTo(seen.width, 6);
    expect(r.env.visual(r.el).x).toBeCloseTo(seen.x, 6);
    r.env.run(10_000);
    expect(r.env.visual(r.el)).toEqual(box(0, 0, 100, 50));
  });

  it("measures the element as it shows, so the first box of a snapshot in flight holds the offset", () => {
    const r = rig();
    flip(r, box(300, 0, 100, 50));
    r.slices(10);
    const shown = r.env.visual(r.el);
    r.env.scripted.clear();
    r.layout.snapshot();
    expect(r.env.measured[r.env.measured.length - 1]).toBe(r.el);
    r.env.place(r.el, box(300, 0, 100, 50));
    r.layout.play();
    expect(r.env.visual(r.el).x).toBeCloseTo(shown.x, 6);
  });

  it("removes the old offset before it measures the new layout, so the last box is the natural one", () => {
    const r = rig();
    flip(r, box(300, 0, 100, 50));
    r.slices(10);
    r.layout.snapshot();
    const writes = r.env.writes.length;
    r.layout.play();
    const cleared = r.env.writes.slice(writes).filter((w) => w.value === null).map((w) => w.property).sort();
    expect(cleared).toEqual(["translate"]);
  });
});

describe("the children", () => {
  const kids = () => [{}, {}];

  it("counter-scales each child by the inverse of the scale, so the children are not stretched", () => {
    const children = kids();
    const r = rig({ children });
    flip(r, box(0, 0, 200, 100));
    for (let i = 0; i < 12; i++) {
      const [sx, sy] = r.env.offsetOf(r.el).scale;
      for (const child of children) {
        const [cx, cy] = r.env.offsetOf(child).scale;
        expect(cx * sx).toBeCloseTo(1, 4);
        expect(cy * sy).toBeCloseTo(1, 4);
      }
      r.slices(1);
    }
    expect(r.env.style(children[0], "scale")).not.toBeUndefined();
  });

  it("removes the counter-scale at rest, and takes the children from a function at play, after the change", () => {
    const first = [{}];
    const later = [{}, {}, {}];
    let list = first;
    const r = rig({ children: () => list });
    r.layout.snapshot();
    list = later;
    r.env.place(r.el, box(0, 0, 200, 100));
    r.layout.play();
    expect(r.env.styles.has(first[0])).toBe(false);
    for (const child of later) expect(r.env.style(child, "scale")).toBeDefined();
    r.env.run(10_000);
    for (const child of later) expect(r.env.style(child, "scale")).toBeUndefined();
  });

  it("writes no counter-scale for a pure move", () => {
    const children = kids();
    const r = rig({ children });
    flip(r, box(300, 0, 100, 50));
    expect(r.env.styles.has(children[0])).toBe(false);
  });

  it("throws a TypeError for children that are not a list or a function", () => {
    const env = new FakeLayoutEnv();
    for (const bad of [5, "x", {}, null]) expect(() => createLayout({}, { flavor: lofty, env, children: bad as never })).toThrow(TypeError);
  });

  it("clears the children when it is destroyed in flight", () => {
    const children = kids();
    const r = rig({ children });
    flip(r, box(0, 0, 200, 100));
    r.layout.destroy();
    expect(r.env.style(children[0], "scale")).toBeUndefined();
  });
});

describe("reduced motion", () => {
  it("snaps: no frame, no offset left, and the element is on its new layout", () => {
    const r = rig();
    r.env.reduced = true;
    const rest = vi.fn();
    r.layout.on("rest", rest);
    flip(r, box(200, 100, 200, 100));
    expect(r.env.requested).toBe(0);
    expect(r.env.style(r.el, "translate")).toBeUndefined();
    expect(r.env.style(r.el, "scale")).toBeUndefined();
    expect(r.layout.getState().moving).toBe(false);
    expect(rest).toHaveBeenCalledTimes(1);
  });

  it("snaps a play that is under way when the reader turns it on", () => {
    const r = rig();
    flip(r, box(200, 100, 200, 100));
    r.slices(3);
    r.env.reduced = true;
    r.slices(1);
    expect(r.layout.getState().moving).toBe(false);
    expect(r.env.style(r.el, "translate")).toBeUndefined();
    expect(r.env.visual(r.el)).toEqual(box(200, 100, 200, 100));
  });
});

describe("the frame rate", () => {
  const run = (hz: number) => {
    const env = new FakeLayoutEnv();
    const el = {};
    env.place(el, box(0, 0, 100, 50));
    const layout = createLayout(el, { flavor: lofty, env });
    layout.snapshot();
    env.place(el, box(300, 100, 200, 100));
    layout.play();
    env.run(500, 1000 / hz);
    const at500 = layout.getState();
    env.run(20_000, 1000 / hz);
    return { at500, rested: env.time, state: layout.getState(), env, el };
  };

  it.each([30, 60, 144])("lands on the same offset at 500 ms, and rests in the same place, at %i Hz", (hz) => {
    const reference = run(60);
    const other = run(hz);
    for (let i = 0; i < 4; i++) {
      expect(other.at500.offset[i]).toBeCloseTo(reference.at500.offset[i], 6);
      expect(other.at500.velocity[i]).toBeCloseTo(reference.at500.velocity[i], 6);
    }
    expect(other.state.moving).toBe(false);
    expect(other.env.visual(other.el)).toEqual(box(300, 100, 200, 100));
    expect(Math.abs(other.rested - reference.rested)).toBeLessThan(1000 / 30 + 1e-6);
  });
});

describe("bad input", () => {
  it.each([
    ["NaN", box(NaN, 0, 10, 10)],
    ["Infinity", box(0, Infinity, 10, 10)],
    ["a negative width", box(0, 0, -5, 10)],
    ["an infinite height", box(0, 0, 10, Infinity)],
  ])("stops with a failure, logged once, when the environment measures %s", (_name, bad) => {
    const r = rig();
    r.env.script(r.el, box(0, 0, 100, 50), bad);
    r.layout.snapshot();
    expect(() => r.layout.play()).not.toThrow();
    const s = r.layout.getState();
    expect(s.failed).toBeInstanceOf(Error);
    expect(s.moving).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("[lofty]");
    expect(r.env.requested).toBe(0);
    expect(r.env.styles.get(r.el)?.translate).toBeUndefined();
  });

  it("fails when the first box is bad too, at the snapshot", () => {
    const r = rig();
    r.env.script(r.el, box(NaN, 0, 10, 10));
    expect(() => r.layout.snapshot()).not.toThrow();
    expect(r.layout.getState().failed).toBeInstanceOf(Error);
  });

  it("throws a TypeError for a first box from the caller that is not a box of finite numbers, and changes nothing", () => {
    const r = rig();
    for (const bad of [null, 5, "x", {}, box(NaN, 0, 1, 1), box(0, Infinity, 1, 1), box(0, 0, -1, 1), { x: 0, y: 0, width: 1 }]) {
      expect(() => r.layout.snapshot(bad as never), String(JSON.stringify(bad))).toThrow(TypeError);
    }
    expect(r.layout.getState().failed).toBeUndefined();
    r.layout.play();
    expect(r.env.writes).toEqual([]);
  });

  it("throws a TypeError for a velocity from the caller that is not four finite numbers", () => {
    const r = rig();
    for (const bad of [5, [1, 2, 3], [1, 2, 3, NaN], [1, 2, 3, Infinity], "abcd"]) {
      expect(() => r.layout.snapshot(box(0, 0, 1, 1), bad as never)).toThrow(TypeError);
    }
  });

  it("throws a TypeError for options that are missing", () => {
    const env = new FakeLayoutEnv();
    expect(() => createLayout(undefined as never, { flavor: lofty, env })).toThrow(TypeError);
    expect(() => createLayout(null as never, { flavor: lofty, env })).toThrow(TypeError);
    expect(() => createLayout(5 as never, { flavor: lofty, env })).toThrow(TypeError);
    expect(() => createLayout({}, { flavor: lofty, env: { ...env, measure: undefined } as never })).toThrow(/measure/);
  });

  it("does not take a zero-size natural box as a scale of Infinity or NaN", () => {
    const r = rig();
    r.env.script(r.el, box(0, 0, 100, 50), box(200, 0, 0, 0));
    r.layout.snapshot();
    r.layout.play();
    expect(r.layout.getState().failed).toBeUndefined();
    expect(r.env.style(r.el, "scale")).toBeUndefined();
    expect(r.env.style(r.el, "translate")).toBe("-150px 25px");
  });
});

describe("clamped output", () => {
  it("cuts every number written to 1,000,000,000, so no exponent text reaches CSS", () => {
    const r = rig();
    r.layout.snapshot(box(1e15, -1e15, 1e15, 1e15));
    r.layout.play();
    const translate = r.env.style(r.el, "translate")!;
    const scale = r.env.style(r.el, "scale")!;
    expect(translate).toBe("1000000000px -1000000000px");
    expect(scale).toBe("1000000000 1000000000");
    expect(translate + scale).not.toMatch(/e/i);
    r.slices(30);
    expect(`${r.env.style(r.el, "translate")} ${r.env.style(r.el, "scale")}`).not.toMatch(/e[+-]?\d|NaN|Infinity/);
  });

  it("never writes a negative scale, even when a fast spring carries the size below zero", () => {
    const r = rig({ flavor: { ...lofty, layout: { springKeys: { move: "loose" }, rest: { restDelta: 0.05, restSpeed: 0.5 } } } }, box(0, 0, 100, 100));
    r.layout.snapshot(box(0, 0, 1, 1), [0, 0, -3000, -3000]);
    r.layout.play();
    let zero = false;
    for (let i = 0; i < 400; i++) {
      r.slices(1);
      const scale = r.env.style(r.el, "scale");
      if (scale !== undefined) {
        expect(px(scale, 0)).toBeGreaterThanOrEqual(0);
        expect(px(scale, 1)).toBeGreaterThanOrEqual(0);
        if (scale === "0 0") zero = true;
      }
    }
    expect(zero).toBe(true);
  });

  it("writes numbers to 3 decimals for pixels, and to 5 for a scale", () => {
    const r = rig();
    flip(r, box(1 / 3, 2 / 3, 100 + 1 / 7, 50));
    r.slices(3);
    expect(r.env.style(r.el, "translate")).toMatch(/^-?\d+(\.\d{1,3})?px -?\d+(\.\d{1,3})?px$/);
    expect(r.env.style(r.el, "scale")).toMatch(/^\d+(\.\d{1,5})? \d+(\.\d{1,5})?$/);
  });
});

describe("listeners", () => {
  it("logs the error of a listener once for that listener, counts every throw, and runs the other listeners", () => {
    const r = rig();
    const bad = vi.fn(() => { throw new Error("one"); });
    const worse = vi.fn(() => { throw new Error("two"); });
    const good = vi.fn();
    r.layout.on("update", bad);
    r.layout.on("update", worse);
    r.layout.on("update", good);
    flip(r, box(300, 0, 100, 50));
    r.slices(5);
    expect(bad.mock.calls.length).toBeGreaterThan(2);
    expect(good.mock.calls.length).toBe(bad.mock.calls.length);
    const logged = error.mock.calls.filter((call) => String(call[0]).includes("listener"));
    expect(logged).toHaveLength(2);
    expect(String(logged[0][0])).toContain("[lofty]");
    expect(r.layout.getState().listenerErrors).toBe(bad.mock.calls.length + worse.mock.calls.length);
    expect(r.layout.getState().failed).toBeUndefined();
  });

  it("logs the error of a rest listener once", () => {
    const r = rig();
    const bad = vi.fn(() => { throw new Error("rest"); });
    r.layout.on("rest", bad);
    flip(r, box(300, 0, 100, 50));
    r.env.run(10_000);
    flip(r, box(0, 0, 100, 50));
    r.env.run(10_000);
    expect(bad).toHaveBeenCalledTimes(2);
    expect(error.mock.calls.filter((call) => String(call[0]).includes("listener"))).toHaveLength(1);
  });

  it("lets a listener unsubscribe, and rejects a bad event or a listener that is not a function", () => {
    const r = rig();
    const fn = vi.fn();
    const off = r.layout.on("update", fn);
    flip(r, box(300, 0, 100, 50));
    const calls = fn.mock.calls.length;
    off();
    r.slices(5);
    expect(fn.mock.calls.length).toBe(calls);
    expect(() => r.layout.on("done" as never, fn)).toThrow(TypeError);
    expect(() => r.layout.on("update", 5 as never)).toThrow(TypeError);
  });

  it("calls an update listener after the write, with the layout state readable", () => {
    const r = rig();
    const seen: number[] = [];
    r.layout.on("update", () => seen.push(r.layout.getState().offset[0]));
    flip(r, box(300, 0, 100, 50));
    expect(seen[0]).toBeCloseTo(-300, 6);
    r.slices(1);
    expect(seen[1]).toBeCloseTo(oracle(-300)[1], 3);
  });

  it("lets a listener pause the work by destroying the layout: nothing is written after it", () => {
    const r = rig();
    r.layout.on("update", () => r.layout.destroy());
    flip(r, box(300, 0, 100, 50));
    const writes = r.env.writes.length;
    r.slices(5);
    expect(r.env.writes.length).toBe(writes);
    expect(r.env.pending).toBe(0);
    expect(error).not.toHaveBeenCalled();
  });
});

describe("a failure", () => {
  it("in a write stops the play, logs once with the label, sets failed, and does not throw into the page", () => {
    const r = rig();
    flip(r, box(300, 0, 100, 50));
    r.env.failWith = new Error("write refused");
    expect(() => r.slices(3)).not.toThrow();
    const s = r.layout.getState();
    expect(s.failed?.message).toBe("write refused");
    expect(s.moving).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("[lofty]");
    r.env.failWith = undefined;
    const writes = r.env.writes.length;
    r.slices(5);
    r.layout.snapshot();
    r.layout.play();
    expect(r.env.writes.length).toBe(writes);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("in the first write of a play fails the same way", () => {
    const r = rig();
    r.layout.snapshot();
    r.env.place(r.el, box(300, 0, 100, 50));
    r.env.failWith = "plain text";
    expect(() => r.layout.play()).not.toThrow();
    expect(r.layout.getState().failed).toBeInstanceOf(Error);
    expect(r.layout.getState().failed?.message).toBe("plain text");
    expect(r.env.requested).toBe(0);
  });

  it("in a measure fails the same way", () => {
    const r = rig();
    r.env.measureFails = new Error("no layout");
    expect(() => r.layout.snapshot()).not.toThrow();
    expect(r.layout.getState().failed?.message).toBe("no layout");
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("does not log when the failed layout is destroyed", () => {
    const r = rig();
    flip(r, box(300, 0, 100, 50));
    r.env.failWith = new Error("x");
    r.slices(2);
    error.mockClear();
    r.layout.destroy();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("destroy", () => {
  it("in flight leaves the element at rest on its layout, logs nothing, and stops the frame loop", () => {
    const env = new FakeLayoutEnv();
    const el = {};
    env.place(el, box(0, 0, 100, 50));
    const layout = createLayout(el, { flavor: lofty, env });
    const rest = vi.fn();
    layout.on("rest", rest);
    layout.snapshot();
    env.place(el, box(300, 0, 100, 50));
    layout.play();
    env.tick();
    env.tick();
    layout.destroy();
    expect(env.style(el, "translate")).toBeUndefined();
    expect(env.style(el, "scale")).toBeUndefined();
    expect(env.pending).toBe(0);
    expect(layout.getState().destroyed).toBe(true);
    expect(layout.getState().moving).toBe(false);
    expect(rest).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("is safe to call twice, ignores every later call, and returns a function that does nothing from on", () => {
    const r = rig();
    flip(r, box(300, 0, 100, 50));
    r.layout.destroy();
    const writes = r.env.writes.length;
    const measured = r.env.measured.length;
    expect(() => r.layout.destroy()).not.toThrow();
    r.layout.snapshot();
    r.layout.play();
    const off = r.layout.on("update", vi.fn());
    expect(() => off()).not.toThrow();
    expect(r.env.writes.length).toBe(writes);
    expect(r.env.measured.length).toBe(measured);
    expect(error).not.toHaveBeenCalled();
  });

  it("destroys the scheduler it made, and leaves a shared scheduler running for the others", () => {
    const own = new FakeLayoutEnv();
    const a = {};
    own.place(a, box(0, 0, 10, 10));
    const layout = createLayout(a, { flavor: lofty, env: own });
    layout.snapshot();
    own.place(a, box(100, 0, 10, 10));
    layout.play();
    layout.destroy();
    expect(own.pending).toBe(0);

    const r = rig();
    const other = {};
    r.env.place(other, box(0, 0, 10, 10));
    const second = createLayout(other, { flavor: lofty, env: r.env, scheduler: r.scheduler });
    flip(r, box(300, 0, 100, 50));
    second.snapshot();
    r.env.place(other, box(100, 0, 10, 10));
    second.play();
    r.layout.destroy();
    r.slices(3);
    expect(second.getState().moving).toBe(true);
    expect(r.scheduler.size).toBe(1);
  });
});

describe("one scheduler", () => {
  it("does not change the frames of a layout when another runs on the same scheduler", () => {
    const alone = rig();
    flip(alone, box(300, 0, 100, 50));
    alone.slices(15);
    const reference = alone.layout.getState().offset[0];

    const pair = rig();
    const other = {};
    pair.env.place(other, box(0, 0, 40, 40));
    const second = createLayout(other, { flavor: lofty, env: pair.env, scheduler: pair.scheduler });
    flip(pair, box(300, 0, 100, 50));
    pair.slices(4);
    second.snapshot();
    pair.env.place(other, box(500, 500, 80, 80));
    second.play();
    pair.slices(11);
    expect(pair.layout.getState().offset[0]).toBe(reference);
  });

  it("makes one frame loop for the layouts that share a scheduler", () => {
    const r = rig();
    const other = {};
    r.env.place(other, box(0, 0, 40, 40));
    const second = createLayout(other, { flavor: lofty, env: r.env, scheduler: r.scheduler });
    flip(r, box(300, 0, 100, 50));
    second.snapshot();
    r.env.place(other, box(100, 0, 40, 40));
    second.play();
    expect(r.env.pending).toBe(1);
  });
});

describe("code that owns translate too", () => {
  it("restores the translate it found, and adds the pose to it while it moves, so a drag offset does not jump", () => {
    const r = rig();
    r.env.styles.set(r.el, { translate: "30px 10px" });
    r.layout.snapshot();
    r.env.place(r.el, box(300, 0, 100, 50));
    r.layout.play();
    // The element shows where it was, with its drag offset.
    expect(r.env.visual(r.el).x).toBeCloseTo(30, 2);
    r.slices(5);
    r.env.run(10_000);
    expect(r.env.style(r.el, "translate")).toBe("30px 10px");
    expect(r.env.visual(r.el).x).toBeCloseTo(330, 2);
  });
});

describe("a box with no layout", () => {
  it.each([["first", true], ["last", false]])("skips the move when the %s box is all zero, logs once, and rests", (_name, firstBox) => {
    const r = rig();
    const rest = vi.fn();
    r.layout.on("rest", rest);
    r.env.script(r.el, firstBox ? box(0, 0, 0, 0) : box(0, 0, 100, 50), firstBox ? box(5, 5, 10, 10) : box(0, 0, 0, 0));
    r.layout.snapshot();
    r.layout.play();
    expect(r.env.writes).toEqual([]);
    expect(r.env.requested).toBe(0);
    expect(rest).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(r.layout.getState().failed).toBeUndefined();
    r.env.script(r.el, box(0, 0, 0, 0), box(5, 5, 10, 10));
    r.layout.snapshot();
    r.layout.play();
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe("a clear that fails", () => {
  it("keeps clearing the other targets, and can be retried by destroy", () => {
    const kid = {};
    const r = rig({ children: [kid] });
    flip(r, box(0, 0, 200, 100));
    r.slices(2);
    r.env.failOnNull = true;
    r.env.reduced = true;
    expect(() => r.slices(1)).not.toThrow();
    expect(r.layout.getState().failed).toBeInstanceOf(Error);
    r.env.failOnNull = false;
    r.layout.destroy();
    expect(r.env.style(r.el, "translate")).toBeUndefined();
    expect(r.env.style(r.el, "scale")).toBeUndefined();
    expect(r.env.style(kid, "scale")).toBeUndefined();
  });

  it("clears the children even when the translate fails first", () => {
    const kid = {};
    const r = rig({ children: [kid] });
    flip(r, box(0, 0, 200, 100));
    r.slices(2);
    const real = r.env.setStyle;
    r.env.setStyle = (t, p, v) => {
      if (t === r.el && p === "translate" && v === null) throw new Error("stuck");
      real(t, p, v);
    };
    r.env.reduced = true;
    r.slices(1);
    expect(r.env.style(kid, "scale")).toBeUndefined();
  });
});

describe("release and children", () => {
  it("releases a layout without writing: the element stays as it shows", () => {
    const r = rig();
    flip(r, box(300, 0, 100, 50));
    r.slices(5);
    const writes = r.env.writes.length;
    r.layout.release();
    expect(r.env.writes.length).toBe(writes);
    expect(r.layout.getState().destroyed).toBe(true);
    r.slices(5);
    expect(r.env.writes.length).toBe(writes);
    expect(r.env.pending).toBe(0);
  });

  it("fails, logged once, when the children function returns something that is not a list", () => {
    const r = rig({ children: (() => 5) as never });
    r.layout.snapshot();
    r.env.place(r.el, box(300, 0, 100, 50));
    expect(() => r.layout.play()).not.toThrow();
    expect(r.layout.getState().failed).toBeInstanceOf(TypeError);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe("fix round 2", () => {
  it("never writes a counter-scale above 1,000", () => {
    const kid = {};
    const r = rig({ children: [kid] });
    r.layout.snapshot(box(5, 5, 0.01, 0.01));
    r.layout.play();
    for (let i = 0; i < 20; i++) {
      for (const n of (r.env.style(kid, "scale") ?? "1 1").split(" ")) expect(parseFloat(n)).toBeLessThanOrEqual(1000);
      r.slices(1);
    }
  });

  it("survives a remove of the scheduler that throws, and adds the task again at the next play", () => {
    const env = new FakeLayoutEnv();
    const add = vi.fn(() => () => {
      throw new Error("cannot remove");
    });
    const el = {};
    env.place(el, box(0, 0, 100, 50));
    const layout = createLayout(el, { flavor: lofty, env, scheduler: { add } });
    layout.snapshot();
    env.place(el, box(300, 0, 100, 50));
    layout.play();
    layout.destroy();
    expect(() => layout.destroy()).not.toThrow();
    const second = createLayout(el, { flavor: lofty, env, scheduler: { add } });
    second.snapshot();
    env.place(el, box(0, 0, 100, 50));
    second.play();
    expect(add).toHaveBeenCalledTimes(2);
  });

  it("reads a base translate that is not in pixels as 0, and puts its text back at rest", () => {
    const r = rig();
    r.env.styles.set(r.el, { translate: "calc(10px + 5%) 0" });
    flip(r, box(300, 0, 100, 50));
    expect(r.env.style(r.el, "translate")).toMatch(/^-?[\d.]+px -?[\d.]+px$/);
    r.env.run(10_000);
    expect(r.env.style(r.el, "translate")).toBe("calc(10px + 5%) 0");
  });

  it("replaces an inline scale that other code set while it resizes, and removes it at rest", () => {
    const r = rig();
    r.env.styles.set(r.el, { scale: "2" });
    flip(r, box(0, 0, 200, 100));
    expect(r.env.style(r.el, "scale")).not.toBe("2");
    r.env.run(10_000);
    expect(r.env.style(r.el, "scale")).toBeUndefined();
  });

  it("lets a rest listener play again, and one that destroys the layout", () => {
    const r = rig();
    let again = 0;
    r.layout.on("rest", () => {
      again += 1;
      if (again === 1) {
        r.layout.snapshot();
        r.env.place(r.el, box(0, 0, 100, 50));
        r.layout.play();
      }
    });
    flip(r, box(300, 0, 100, 50));
    r.env.run(10_000);
    r.slices(400);
    expect(again).toBe(2);
    expect(r.env.visual(r.el)).toEqual(box(0, 0, 100, 50));

    const d = rig();
    d.layout.on("rest", () => d.layout.destroy());
    flip(d, box(300, 0, 100, 50));
    expect(() => d.env.run(10_000)).not.toThrow();
    expect(d.layout.getState().destroyed).toBe(true);
    expect(d.env.pending).toBe(0);
  });

  it("lets an update listener start another play", () => {
    const r = rig();
    let done = false;
    r.layout.on("update", () => {
      if (done) return;
      done = true;
      r.layout.snapshot();
      r.env.place(r.el, box(500, 0, 100, 50));
      r.layout.play();
    });
    flip(r, box(300, 0, 100, 50));
    r.env.run(10_000);
    r.slices(400);
    expect(r.env.visual(r.el)).toEqual(box(500, 0, 100, 50));
    expect(r.layout.getState().failed).toBeUndefined();
  });
});
