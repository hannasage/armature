import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createSpring, FIXED_STEP, retarget, stepSpring, type SpringConfig, type SpringState } from "../../src/engine/spring";
import { createScheduler, type Scheduler } from "../../src/frame";
import { createPresence, type Presence, type PresenceOptions } from "../../src/layout";
import { box, FakeLayoutEnv } from "../helpers/fake-layout-env";
import { lofty } from "../helpers/layout-flavor";

// Presence: an element that is removed stays mounted until its exit rests, then it unmounts. The exit is a spring from where the element
// is to a pose (a shift and a scale), and the default pose is scale 0.

let error: MockInstance<typeof console.error>;
beforeEach(() => {
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

/** The exit spring: the exit key of the flavor, with the rest limits of the part under it. */
const EXIT: SpringConfig = { restDelta: 0.05, restSpeed: 0.5, stiffness: 300, damping: 30 };

interface Rig {
  env: FakeLayoutEnv;
  scheduler: Scheduler;
  container: object;
  el: object;
  present: Presence;
  slices(n: number): void;
}

function rig(options: Partial<PresenceOptions> = {}): Rig {
  const env = new FakeLayoutEnv();
  const scheduler = createScheduler(env);
  const container = {};
  const el = {};
  env.place(el, box(0, 0, 100, 50));
  const present = createPresence(container, { flavor: lofty, env, scheduler, ...options });
  return { env, scheduler, container, el, present, slices: (n) => { for (let i = 0; i < n; i++) scheduler.advance(FIXED_STEP); } };
}

/** The values a spring from 0 to `goal` takes slice by slice, by the engine's own functions. */
function oracle(goal: number, config: SpringConfig = EXIT): number[] {
  let state: SpringState = retarget(createSpring(config, 0), goal);
  const series = [state.value];
  for (let i = 0; i < 2000 && !(state.value === goal && state.velocity === 0 && i > 0); i++) {
    state = stepSpring(state, goal, FIXED_STEP);
    series.push(state.value);
  }
  return series;
}

/** The slice at which the last of the springs of an element rests. */
const lastSlice = (...goals: number[]) => Math.max(...goals.map((goal) => oracle(goal).length - 1));
const scaleOf = (r: Rig, el = r.el) => r.env.offsetOf(el).scale;

describe("an exit", () => {
  it("stays mounted until it rests, and then unmounts once, from its container", () => {
    const r = rig();
    const gone = vi.fn();
    r.present.on("exit", gone);
    r.present.exit(r.el);
    expect(r.present.getState().exiting).toBe(1);
    const last = lastSlice(-100, -50);
    r.slices(last - 1);
    expect(r.env.unmounted).toEqual([]);
    expect(gone).not.toHaveBeenCalled();
    expect(r.present.getState().exiting).toBe(1);
    r.slices(1);
    expect(r.env.unmounted).toHaveLength(1);
    expect(r.env.unmounted[0].container).toBe(r.container);
    expect(r.env.unmounted[0].target).toBe(r.el);
    expect(gone).toHaveBeenCalledTimes(1);
    expect(gone).toHaveBeenCalledWith(r.el);
    expect(r.present.getState().exiting).toBe(0);
    r.slices(20);
    expect(r.env.unmounted).toHaveLength(1);
  });

  it("measures the element once, writes nothing at the call, and asks for one frame loop", () => {
    const r = rig();
    r.present.exit(r.el);
    expect(r.env.measured).toEqual([r.el]);
    expect(r.env.writes).toEqual([]);
    expect(r.env.pending).toBe(1);
  });

  it("springs the scale to zero on the exit spring, slice by slice, and writes only translate and scale", () => {
    const r = rig();
    r.present.exit(r.el);
    const w = oracle(-100);
    const h = oracle(-50);
    for (let k = 1; k < 12; k++) {
      r.slices(1);
      const [sx, sy] = scaleOf(r);
      expect(sx).toBeCloseTo((100 + w[k]) / 100, 4);
      expect(sy).toBeCloseTo((50 + h[k]) / 50, 4);
    }
    expect(r.env.properties).toEqual(["scale"]);
  });

  it("ends on the pose and leaves it written, because the element goes away with it", () => {
    const r = rig();
    r.present.exit(r.el);
    r.env.run(10_000);
    expect(r.env.style(r.el, "scale")).toBe("0 0");
    expect(r.env.pending).toBe(0);
    expect(r.env.unmounted).toHaveLength(1);
  });

  it("takes a pose with a shift and a scale", () => {
    const r = rig();
    r.present.exit(r.el, { to: { x: 50, y: -20, scale: 0.5 } });
    r.env.run(10_000);
    expect(r.env.style(r.el, "translate")).toBe("50px -20px");
    expect(r.env.style(r.el, "scale")).toBe("0.5 0.5");
    expect(r.env.unmounted).toHaveLength(1);
  });

  it("never writes a negative scale, even when a springy exit overshoots below zero", () => {
    const r = rig({ flavor: { ...lofty, layout: { springKeys: { move: "move", exit: "loose" }, rest: { restDelta: 0.05, restSpeed: 0.5 } } } });
    r.present.exit(r.el);
    let zero = false;
    for (let i = 0; i < 1200 && r.env.unmounted.length === 0; i++) {
      r.slices(1);
      const scale = r.env.style(r.el, "scale");
      if (scale !== undefined) {
        for (const n of scale.split(" ")) expect(parseFloat(n)).toBeGreaterThanOrEqual(0);
        if (scale === "0 0") zero = true;
      }
    }
    expect(zero).toBe(true);
    expect(r.env.unmounted).toHaveLength(1);
  });

  it("uses the move spring when the part names no exit spring", () => {
    const r = rig({ flavor: { ...lofty, layout: { springKeys: { move: "move" }, rest: { restDelta: 0.05, restSpeed: 0.5 } } } });
    r.present.exit(r.el);
    r.slices(3);
    const w = oracle(-100, { restDelta: 0.05, restSpeed: 0.5, stiffness: 170, damping: 26 });
    expect(scaleOf(r)[0]).toBeCloseTo((100 + w[3]) / 100, 4);
  });

  it("is a no-op for an element that is already exiting", () => {
    const r = rig();
    r.present.exit(r.el);
    r.slices(5);
    const writes = r.env.writes.length;
    r.present.exit(r.el);
    expect(r.present.getState().exiting).toBe(1);
    expect(r.env.measured).toEqual([r.el]);
    expect(r.env.writes.length).toBe(writes);
  });

  it("unmounts at once when the pose is where the element already is", () => {
    const r = rig();
    r.present.exit(r.el, { to: { scale: 1 } });
    expect(r.env.unmounted).toHaveLength(1);
    expect(r.env.pending).toBe(0);
  });

  it("exits two elements by their own springs: the nearer pose unmounts first", () => {
    const r = rig();
    const small = {};
    r.env.place(small, box(0, 0, 10, 10));
    r.present.exit(r.el);
    r.present.exit(small);
    expect(r.present.getState().exiting).toBe(2);
    expect(r.env.pending).toBe(1);
    r.slices(lastSlice(-10) );
    expect(r.env.unmounted.map((u) => u.target)).toEqual([small]);
    r.slices(lastSlice(-100, -50) - lastSlice(-10));
    expect(r.env.unmounted.map((u) => u.target)).toEqual([small, r.el]);
    expect(r.present.getState().exiting).toBe(0);
  });

  it("can exit an element again after it unmounted, and a later exit starts a new frame loop", () => {
    const r = rig();
    r.present.exit(r.el);
    r.env.run(10_000);
    expect(r.env.pending).toBe(0);
    const again = {};
    r.env.place(again, box(0, 0, 30, 30));
    r.present.exit(again);
    expect(r.env.pending).toBe(1);
    r.env.run(10_000);
    expect(r.env.unmounted.map((u) => u.target)).toEqual([r.el, again]);
  });

  it("uses the unmount of the options in place of the environment", () => {
    const unmount = vi.fn();
    const r = rig({ unmount });
    r.present.exit(r.el);
    r.env.run(10_000);
    expect(unmount).toHaveBeenCalledTimes(1);
    expect(unmount).toHaveBeenCalledWith(r.el);
    expect(r.env.unmounted).toEqual([]);
  });
});

describe("reduced motion", () => {
  it("unmounts at once, with no frame and no write", () => {
    const r = rig();
    r.env.reduced = true;
    const gone = vi.fn();
    r.present.on("exit", gone);
    r.present.exit(r.el);
    expect(r.env.unmounted).toHaveLength(1);
    expect(r.env.requested).toBe(0);
    expect(r.env.writes).toEqual([]);
    expect(gone).toHaveBeenCalledTimes(1);
    expect(r.present.getState().exiting).toBe(0);
  });

  it("unmounts an exit that is under way when the reader turns it on", () => {
    const r = rig();
    r.present.exit(r.el);
    r.slices(3);
    r.env.reduced = true;
    r.slices(1);
    expect(r.env.unmounted).toHaveLength(1);
    expect(r.present.getState().exiting).toBe(0);
  });
});

describe("the frame rate", () => {
  const run = (hz: number) => {
    const env = new FakeLayoutEnv();
    const el = {};
    env.place(el, box(0, 0, 100, 50));
    const present = createPresence({}, { flavor: lofty, env });
    present.exit(el);
    env.run(100, 1000 / hz);
    const scale = env.offsetOf(el).scale;
    env.run(20_000, 1000 / hz);
    return { scale, at: env.unmounted[0].time };
  };

  it.each([30, 60, 144])("is at the same scale at 100 ms, and unmounts within one frame of the same time, at %i Hz", (hz) => {
    const reference = run(60);
    const other = run(hz);
    expect(other.scale[0]).toBeCloseTo(reference.scale[0], 6);
    expect(other.scale[1]).toBeCloseTo(reference.scale[1], 6);
    expect(Math.abs(other.at - reference.at)).toBeLessThan(1000 / 30 + 1e-6);
  });
});

describe("bad input", () => {
  it.each([
    ["x is NaN", { x: NaN }],
    ["y is Infinity", { y: Infinity }],
    ["scale is NaN", { scale: NaN }],
    ["scale is Infinity", { scale: Infinity }],
    ["scale is negative", { scale: -0.1 }],
    ["x is text", { x: "5" }],
  ])("throws a TypeError, and changes nothing, when the pose has %s", (_name, to) => {
    const r = rig();
    expect(() => r.present.exit(r.el, { to: to as never })).toThrow(TypeError);
    expect(r.env.measured).toEqual([]);
    expect(r.present.getState().exiting).toBe(0);
    expect(r.env.pending).toBe(0);
  });

  it("throws a TypeError for an element or options that are not objects", () => {
    const r = rig();
    for (const bad of [undefined, null, 5, "x"]) expect(() => r.present.exit(bad as never)).toThrow(TypeError);
    expect(() => r.present.exit(r.el, 5 as never)).toThrow(TypeError);
    expect(() => r.present.exit(r.el, { to: 5 as never })).toThrow(TypeError);
  });

  it("throws a TypeError for a container that is not an object, and for an environment that cannot unmount", () => {
    const env = new FakeLayoutEnv();
    for (const bad of [undefined, null, 5]) expect(() => createPresence(bad as never, { flavor: lofty, env })).toThrow(TypeError);
    expect(() => createPresence({}, { flavor: lofty, env: { ...env, unmount: undefined } as never })).toThrow(/unmount/);
    expect(() => createPresence({}, { flavor: lofty, env: { ...env, measure: undefined } as never })).toThrow(/measure/);
    expect(() => createPresence({}, { flavor: lofty, env: { ...env, unmount: undefined } as never, unmount: () => undefined })).not.toThrow();
    expect(() => createPresence({}, { flavor: lofty, env, unmount: 5 as never })).toThrow(TypeError);
  });

  it("stops with a failure, logged once, and unmounts the element, when the environment measures NaN", () => {
    const r = rig();
    r.env.script(r.el, box(NaN, 0, 1, 1));
    expect(() => r.present.exit(r.el)).not.toThrow();
    expect(r.present.getState().failed).toBeInstanceOf(Error);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("[lofty]");
    expect(r.env.unmounted.map((u) => u.target)).toEqual([r.el]);
  });

  it("cuts the output to 1,000,000,000 for a pose that is far away", () => {
    const r = rig();
    r.present.exit(r.el, { to: { x: 1e15, y: -1e15, scale: 1e15 } });
    r.slices(10);
    const translate = r.env.style(r.el, "translate")!;
    expect(translate).not.toMatch(/e/i);
    expect(parseFloat(translate.split(" ")[0])).toBeLessThanOrEqual(1e9);
    expect(parseFloat(translate.split(" ")[1])).toBeGreaterThanOrEqual(-1e9);
    expect(parseFloat(r.env.style(r.el, "scale")!)).toBeLessThanOrEqual(1e9);
  });
});

describe("a failure", () => {
  it("in a write logs once with the label, sets failed, and still unmounts every element that is leaving", () => {
    const r = rig();
    const second = {};
    r.env.place(second, box(0, 0, 40, 40));
    r.present.exit(r.el);
    r.present.exit(second);
    r.slices(2);
    r.env.failWith = new Error("write refused");
    expect(() => r.slices(3)).not.toThrow();
    r.env.failWith = undefined;
    expect(r.present.getState().failed?.message).toBe("write refused");
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("[lofty]");
    expect(r.env.unmounted.map((u) => u.target).sort()).toEqual([r.el, second].sort());
    expect(r.present.getState().exiting).toBe(0);
    expect(r.env.pending).toBe(0);
  });

  it("in an unmount logs once, sets failed, and does not throw into the page", () => {
    const r = rig();
    r.env.unmountFails = new Error("cannot remove");
    r.present.exit(r.el);
    expect(() => r.env.run(10_000)).not.toThrow();
    expect(r.present.getState().failed?.message).toBe("cannot remove");
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("ignores every later call after a failure", () => {
    const r = rig();
    r.env.unmountFails = new Error("cannot remove");
    r.present.exit(r.el);
    r.env.run(10_000);
    const measured = r.env.measured.length;
    r.env.unmountFails = undefined;
    r.present.exit({});
    expect(r.env.measured.length).toBe(measured);
  });
});

describe("listeners", () => {
  it("logs the error of an exit listener once for that listener, counts each throw, and runs the others", () => {
    const r = rig();
    const bad = vi.fn(() => { throw new Error("one"); });
    const good = vi.fn();
    r.present.on("exit", bad);
    r.present.on("exit", good);
    const second = {};
    r.env.place(second, box(0, 0, 20, 20));
    r.present.exit(r.el);
    r.present.exit(second);
    r.env.run(10_000);
    expect(bad).toHaveBeenCalledTimes(2);
    expect(good).toHaveBeenCalledTimes(2);
    expect(error.mock.calls.filter((call) => String(call[0]).includes("listener"))).toHaveLength(1);
    expect(r.present.getState().listenerErrors).toBe(2);
    expect(r.present.getState().failed).toBeUndefined();
  });

  it("lets a listener unsubscribe, and rejects a bad event or a listener that is not a function", () => {
    const r = rig();
    const fn = vi.fn();
    const off = r.present.on("exit", fn);
    off();
    r.present.exit(r.el);
    r.env.run(10_000);
    expect(fn).not.toHaveBeenCalled();
    expect(() => r.present.on("enter" as never, fn)).toThrow(TypeError);
    expect(() => r.present.on("exit", 5 as never)).toThrow(TypeError);
  });
});

describe("destroy", () => {
  it("in the middle of an exit unmounts the elements that are leaving, logs nothing, calls no listener, and stops the frame loop", () => {
    const env = new FakeLayoutEnv();
    const container = {};
    const present = createPresence(container, { flavor: lofty, env });
    const a = {};
    const b = {};
    env.place(a, box(0, 0, 100, 50));
    env.place(b, box(0, 0, 100, 50));
    const gone = vi.fn();
    present.on("exit", gone);
    present.exit(a);
    present.exit(b);
    env.tick();
    env.tick();
    present.destroy();
    expect(env.unmounted.map((u) => u.target)).toEqual([a, b]);
    expect(env.pending).toBe(0);
    expect(gone).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(present.getState().destroyed).toBe(true);
    expect(present.getState().exiting).toBe(0);
  });

  it("is safe to call twice, and ignores every later call", () => {
    const r = rig();
    r.present.destroy();
    expect(() => r.present.destroy()).not.toThrow();
    r.present.exit(r.el);
    const off = r.present.on("exit", vi.fn());
    expect(() => off()).not.toThrow();
    expect(r.env.measured).toEqual([]);
    expect(r.env.unmounted).toEqual([]);
  });

  it("leaves a shared scheduler to its owner", () => {
    const r = rig();
    r.present.exit(r.el);
    r.present.destroy();
    expect(r.scheduler.size).toBe(0);
    const probe = { step: () => true };
    r.scheduler.add(probe);
    expect(r.scheduler.size).toBe(1);
  });

  it("does not throw when an unmount fails during destroy, and logs nothing", () => {
    const r = rig();
    r.present.exit(r.el);
    r.env.unmountFails = new Error("x");
    expect(() => r.present.destroy()).not.toThrow();
    expect(error).not.toHaveBeenCalled();
  });
});
