import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { FIXED_STEP } from "../../src/engine/spring";
import { createScheduler, type Scheduler } from "../../src/frame";
import { createShared, type Shared, type SharedOptions } from "../../src/layout";
import { box, FakeLayoutEnv } from "../helpers/fake-layout-env";
import { lofty } from "../helpers/layout-flavor";

// Shared elements: two elements with the same key, one leaving and one entering, animate as one. The leaving element is measured, and the
// entering element is inverted onto that box and springs to its own place.

let error: MockInstance<typeof console.error>;
beforeEach(() => {
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

interface Rig {
  env: FakeLayoutEnv;
  scheduler: Scheduler;
  shared: Shared;
  a: object;
  b: object;
  slices(n: number): void;
}

function rig(options: Partial<SharedOptions> = {}): Rig {
  const env = new FakeLayoutEnv();
  const scheduler = createScheduler(env);
  const shared = createShared({ flavor: lofty, env, scheduler, ...options });
  const a = {};
  const b = {};
  env.place(a, box(10, 10, 100, 50));
  env.place(b, box(400, 200, 300, 150));
  return { env, scheduler, shared, a, b, slices: (n) => { for (let i = 0; i < n; i++) scheduler.advance(FIXED_STEP); } };
}

describe("a pair with one key", () => {
  it("starts the entering element on the box of the leaving element, with no jump", () => {
    const r = rig();
    r.shared.leave("hero", r.a);
    r.shared.enter("hero", r.b);
    const seen = r.env.visual(r.b);
    expect(seen.x).toBeCloseTo(10, 1);
    expect(seen.y).toBeCloseTo(10, 1);
    expect(seen.width).toBeCloseTo(100, 1);
    expect(seen.height).toBeCloseTo(50, 1);
    // First center (60, 35), last center (550, 275).
    expect(r.env.style(r.b, "translate")).toBe("-490px -240px");
    expect(r.env.style(r.b, "scale")).toBe("0.33333 0.33333");
  });

  it("moves it to its own place as one motion, and rests there with the offset removed", () => {
    const r = rig();
    r.shared.leave("hero", r.a);
    const layout = r.shared.enter("hero", r.b);
    expect(layout.getState().moving).toBe(true);
    r.slices(10);
    const mid = r.env.visual(r.b);
    expect(mid.x).toBeGreaterThan(10);
    expect(mid.x).toBeLessThan(400);
    expect(mid.width).toBeGreaterThan(100);
    r.env.run(10_000);
    expect(r.env.visual(r.b)).toEqual(box(400, 200, 300, 150));
    expect(r.env.style(r.b, "translate")).toBeUndefined();
    expect(layout.getState().moving).toBe(false);
  });

  it("measures the leaving element and writes nothing to it", () => {
    const r = rig();
    r.shared.leave("hero", r.a);
    r.shared.enter("hero", r.b);
    r.env.run(10_000);
    expect(r.env.measured[0]).toBe(r.a);
    expect(r.env.styles.has(r.a)).toBe(false);
    expect(r.env.properties).toEqual(["scale", "translate"]);
  });

  it("takes the box at the time of the leave, and not at the time of the enter", () => {
    const r = rig();
    r.shared.leave("hero", r.a);
    r.env.place(r.a, box(900, 900, 5, 5));
    r.shared.enter("hero", r.b);
    expect(r.env.visual(r.b).x).toBeCloseTo(10, 1);
  });

  it("matches by key: two pairs animate on their own", () => {
    const r = rig();
    const c = {};
    const d = {};
    r.env.place(c, box(0, 300, 60, 60));
    r.env.place(d, box(200, 300, 120, 60));
    r.shared.leave("one", r.a);
    r.shared.leave("two", c);
    r.shared.enter("two", d);
    r.shared.enter("one", r.b);
    expect(r.env.visual(d).x).toBeCloseTo(0, 1);
    expect(r.env.visual(r.b).x).toBeCloseTo(10, 1);
    r.env.run(10_000);
    expect(r.env.visual(d)).toEqual(box(200, 300, 120, 60));
    expect(r.env.visual(r.b)).toEqual(box(400, 200, 300, 150));
  });

  it("uses a key once: a second enter with the same key does not animate", () => {
    const r = rig();
    const other = {};
    r.env.place(other, box(0, 0, 10, 10));
    r.shared.leave("hero", r.a);
    r.shared.enter("hero", r.b);
    const second = r.shared.enter("hero", other);
    expect(second.getState().moving).toBe(false);
    expect(r.env.styles.has(other)).toBe(false);
  });

  it("takes the later leave when a key is left twice", () => {
    const r = rig();
    const c = {};
    r.env.place(c, box(50, 50, 20, 20));
    r.shared.leave("hero", r.a);
    r.shared.leave("hero", c);
    r.shared.enter("hero", r.b);
    expect(r.env.visual(r.b).x).toBeCloseTo(50, 1);
    expect(r.env.visual(r.b).width).toBeCloseTo(20, 1);
  });

  it("gives a layout at rest for a key that nothing left: no write, no frame", () => {
    const r = rig();
    const layout = r.shared.enter("lonely", r.b);
    expect(layout.getState().moving).toBe(false);
    expect(r.env.writes).toEqual([]);
    expect(r.env.requested).toBe(0);
  });

  it("returns a layout that a later change can use: snapshot, change, play", () => {
    const r = rig();
    r.shared.leave("hero", r.a);
    const layout = r.shared.enter("hero", r.b);
    r.env.run(10_000);
    layout.snapshot();
    r.env.place(r.b, box(0, 0, 50, 50));
    layout.play();
    expect(layout.getState().moving).toBe(true);
    r.env.run(10_000);
    expect(r.env.visual(r.b)).toEqual(box(0, 0, 50, 50));
  });

  it("hands the speed of a leaving element that is moving to the next one", () => {
    const r = rig();
    r.shared.leave("hero", r.a);
    const first = r.shared.enter("hero", r.b);
    r.slices(10);
    const speed = first.getState().velocity;
    const shown = r.env.visual(r.b);
    expect(Math.abs(speed[0])).toBeGreaterThan(100);
    const c = {};
    r.env.place(c, box(0, 600, 80, 80));
    r.shared.leave("hero", r.b);
    const second = r.shared.enter("hero", c);
    expect(second.getState().velocity).toEqual(speed);
    expect(r.env.visual(c).x).toBeCloseTo(shown.x, 2);
    expect(r.env.visual(c).width).toBeCloseTo(shown.width, 2);
    r.env.run(10_000);
    expect(r.env.visual(c)).toEqual(box(0, 600, 80, 80));
  });
});

describe("keys and elements", () => {
  it("accepts a text key and a number key", () => {
    const r = rig();
    expect(() => r.shared.leave("a", r.a)).not.toThrow();
    expect(() => r.shared.leave(7, r.a)).not.toThrow();
    expect(() => r.shared.enter(7, r.b)).not.toThrow();
  });

  it.each([[""], [NaN], [Infinity], [undefined], [null], [{}], [true]])("throws a TypeError for the key %s", (key) => {
    const r = rig();
    expect(() => r.shared.leave(key as never, r.a)).toThrow(TypeError);
    expect(() => r.shared.enter(key as never, r.b)).toThrow(TypeError);
    expect(() => r.shared.cancel(key as never)).toThrow(TypeError);
  });

  it("throws a TypeError for an element that is not an object", () => {
    const r = rig();
    for (const bad of [undefined, null, 5, "x"]) {
      expect(() => r.shared.leave("k", bad as never)).toThrow(TypeError);
      expect(() => r.shared.enter("k", bad as never)).toThrow(TypeError);
    }
  });

  it("counts the keys that wait, drops one on cancel, and drops one when it is used", () => {
    const r = rig();
    r.shared.leave("a", r.a);
    r.shared.leave("b", r.a);
    expect(r.shared.getState().pending).toBe(2);
    r.shared.cancel("a");
    expect(r.shared.getState().pending).toBe(1);
    r.shared.enter("b", r.b);
    expect(r.shared.getState().pending).toBe(0);
    expect(() => r.shared.cancel("none")).not.toThrow();
  });

  it("fails when the environment measures NaN, logs once, and still gives a layout", () => {
    const r = rig();
    r.env.script(r.a, box(NaN, 0, 1, 1));
    expect(() => r.shared.leave("hero", r.a)).not.toThrow();
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("[lofty]");
    const layout = r.shared.enter("hero", r.b);
    expect(layout.getState().moving).toBe(false);
    expect(r.env.styles.has(r.b)).toBe(false);
  });

  it("fails when the environment cannot measure at all, logs once, and does not throw into the page", () => {
    const r = rig();
    r.env.measureFails = new Error("no layout");
    expect(() => r.shared.leave("hero", r.a)).not.toThrow();
    expect(() => r.shared.leave("hero", r.a)).not.toThrow();
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe("options", () => {
  it("checks the flavor, and an environment that cannot measure", () => {
    const env = new FakeLayoutEnv();
    expect(() => createShared({ flavor: undefined as never, env })).toThrow(TypeError);
    expect(() => createShared({ flavor: lofty, env: { ...env, measure: undefined } as never })).toThrow(/measure/);
    expect(() => createShared(undefined as never)).toThrow(TypeError);
  });

  it("passes the children option to every layout it makes", () => {
    const kid = {};
    const r = rig({ children: [kid] });
    r.shared.leave("hero", r.a);
    r.shared.enter("hero", r.b);
    expect(r.env.style(kid, "scale")).toBeDefined();
  });

  it("makes one frame loop for the layouts it makes on a scheduler of its own", () => {
    const env = new FakeLayoutEnv();
    const shared = createShared({ flavor: lofty, env });
    const [a, b, c, d] = [{}, {}, {}, {}];
    env.place(a, box(0, 0, 10, 10));
    env.place(b, box(100, 0, 10, 10));
    env.place(c, box(0, 100, 10, 10));
    env.place(d, box(100, 100, 10, 10));
    shared.leave("x", a);
    shared.leave("y", c);
    shared.enter("x", b);
    shared.enter("y", d);
    expect(env.pending).toBe(1);
  });
});

describe("destroy", () => {
  it("stops the layouts it made, leaves their elements at rest, drops the keys that wait, and logs nothing", () => {
    const env = new FakeLayoutEnv();
    const shared = createShared({ flavor: lofty, env });
    const a = {};
    const b = {};
    env.place(a, box(10, 10, 100, 50));
    env.place(b, box(400, 200, 300, 150));
    shared.leave("hero", a);
    shared.leave("other", a);
    const layout = shared.enter("hero", b);
    env.tick();
    shared.destroy();
    expect(env.style(b, "translate")).toBeUndefined();
    expect(env.style(b, "scale")).toBeUndefined();
    expect(env.pending).toBe(0);
    expect(layout.getState().destroyed).toBe(true);
    expect(shared.getState().pending).toBe(0);
    expect(shared.getState().destroyed).toBe(true);
    expect(error).not.toHaveBeenCalled();
  });

  it("is safe to call twice, and gives an inert layout for every later enter", () => {
    const r = rig();
    r.shared.destroy();
    expect(() => r.shared.destroy()).not.toThrow();
    r.shared.leave("hero", r.a);
    const layout = r.shared.enter("hero", r.b);
    expect(layout.getState().destroyed).toBe(true);
    expect(r.env.measured).toEqual([]);
    expect(r.env.writes).toEqual([]);
    expect(() => r.shared.cancel("hero")).not.toThrow();
  });

  it("leaves a layout that the caller destroyed out of the work of destroy", () => {
    const r = rig();
    r.shared.leave("hero", r.a);
    const layout = r.shared.enter("hero", r.b);
    layout.destroy();
    expect(() => r.shared.destroy()).not.toThrow();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("retention and fights", () => {
  it("keeps no layout once it rests: the tracked count stays bounded across many enters", () => {
    const r = rig();
    for (let i = 0; i < 50; i++) {
      const from = {};
      const to = {};
      r.env.place(from, box(0, 0, 10, 10));
      r.env.place(to, box(100, 100, 10, 10));
      r.shared.leave(`k${i}`, from);
      r.shared.enter(`k${i}`, to);
      expect(r.shared.getState().layouts).toBeLessThanOrEqual(1);
      r.env.run(10_000);
      r.slices(400);
      expect(r.shared.getState().layouts).toBe(0);
    }
  });

  it("does not track a layout that has nothing to move", () => {
    const r = rig();
    r.shared.enter("lonely", r.b);
    expect(r.shared.getState().layouts).toBe(0);
  });

  it("stops the earlier layout when a second enter moves the same element, so two layouts never fight", () => {
    const r = rig();
    r.shared.leave("one", r.a);
    const first = r.shared.enter("one", r.b);
    r.slices(3);
    const c = {};
    r.env.place(c, box(0, 500, 50, 50));
    r.shared.leave("two", c);
    const second = r.shared.enter("two", r.b);
    expect(first.getState().destroyed).toBe(true);
    expect(second.getState().moving).toBe(true);
    expect(r.shared.getState().layouts).toBe(1);
    r.env.run(10_000);
    r.slices(400);
    expect(r.env.visual(r.b)).toEqual(box(400, 200, 300, 150));
  });

  it("gives the live layout back for a second enter that has no key waiting, and makes no second layout", () => {
    const r = rig();
    r.shared.leave("one", r.a);
    const first = r.shared.enter("one", r.b);
    r.slices(3);
    const again = r.shared.enter("none", r.b);
    expect(again).toBe(first);
    expect(first.getState().destroyed).toBe(false);
  });
});

describe("a chain", () => {
  it("never writes to the leaving element: its layout stops and leaves the styles as they are", () => {
    const r = rig();
    r.shared.leave("hero", r.a);
    r.shared.enter("hero", r.b);
    r.slices(10);
    const c = {};
    r.env.place(c, box(0, 600, 80, 80));
    const writes = r.env.writes.filter((w) => w.target === r.b).length;
    r.shared.leave("hero", r.b);
    const second = r.shared.enter("hero", c);
    expect(r.env.writes.filter((w) => w.target === r.b).length).toBe(writes);
    r.slices(20);
    expect(r.env.writes.filter((w) => w.target === r.b).length).toBe(writes);
    expect(second.getState().moving).toBe(true);
    expect(r.env.pending + r.scheduler.size).toBeGreaterThan(0);
  });
});

describe("keys that wait", () => {
  it("expires after the time to live, on the clock of the environment, so a key nobody enters does not stay", () => {
    const r = rig();
    r.shared.leave("hero", r.a);
    expect(r.shared.getState().pending).toBe(1);
    r.env.time += 2500;
    expect(r.shared.getState().pending).toBe(0);
    const layout = r.shared.enter("hero", r.b);
    expect(layout.getState().moving).toBe(false);
    expect(r.env.styles.has(r.b)).toBe(false);
  });

  it("keeps a key that is young enough, and takes the time to live from the options", () => {
    const r = rig({ ttl: 100 });
    r.shared.leave("hero", r.a);
    r.env.time += 50;
    expect(r.shared.getState().pending).toBe(1);
    r.env.time += 100;
    expect(r.shared.getState().pending).toBe(0);
    for (const bad of [0, -1, NaN, "x"]) expect(() => createShared({ flavor: lofty, env: r.env, ttl: bad as never })).toThrow(TypeError);
  });
});

describe("a leave that fails", () => {
  it("drops the stale key of an earlier leave, and exposes failed", () => {
    const r = rig();
    r.shared.leave("hero", r.a);
    expect(r.shared.getState().pending).toBe(1);
    r.env.measureFails = new Error("no layout");
    r.shared.leave("hero", r.a);
    r.env.measureFails = undefined;
    expect(r.shared.getState().pending).toBe(0);
    expect(r.shared.getState().failed?.message).toBe("no layout");
    const layout = r.shared.enter("hero", r.b);
    expect(layout.getState().moving).toBe(false);
  });

  it("logs once for each distinct failure", () => {
    const r = rig();
    r.env.measureFails = new Error("one");
    r.shared.leave("a", r.a);
    r.shared.leave("a", r.a);
    expect(error).toHaveBeenCalledTimes(1);
    r.env.measureFails = new Error("two");
    r.shared.leave("a", r.a);
    expect(error).toHaveBeenCalledTimes(2);
  });

  it("treats an all-zero box as no layout: no key is kept, and it logs once", () => {
    const r = rig();
    r.shared.leave("hero", r.a);
    r.env.script(r.a, box(0, 0, 0, 0));
    r.shared.leave("hero", r.a);
    expect(r.shared.getState().pending).toBe(0);
    r.env.script(r.a, box(0, 0, 0, 0));
    r.shared.leave("other", r.a);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe("fix round 2", () => {
  it("untracks a layout that the caller released, and a later enter gets a working layout", () => {
    const r = rig();
    r.shared.leave("one", r.a);
    const first = r.shared.enter("one", r.b);
    expect(r.shared.getState().layouts).toBe(1);
    first.release();
    expect(r.shared.getState().layouts).toBe(0);
    const c = {};
    r.env.place(c, box(0, 300, 50, 50));
    r.shared.leave("two", c);
    const second = r.shared.enter("two", r.b);
    expect(second).not.toBe(first);
    expect(second.getState().moving).toBe(true);
  });

  it("untracks a layout that failed, and a later enter gets a working layout", () => {
    const r = rig();
    r.shared.leave("one", r.a);
    const first = r.shared.enter("one", r.b);
    r.env.failWith = new Error("write refused");
    r.slices(2);
    r.env.failWith = undefined;
    expect(first.getState().failed).toBeInstanceOf(Error);
    expect(r.shared.getState().layouts).toBe(0);
    r.shared.leave("two", r.a);
    const second = r.shared.enter("two", r.b);
    expect(second).not.toBe(first);
    expect(second.getState().moving).toBe(true);
  });

  it("does not return a destroyed or failed layout as the live one", () => {
    const r = rig();
    r.shared.leave("one", r.a);
    const first = r.shared.enter("one", r.b);
    first.destroy();
    const again = r.shared.enter("none", r.b);
    expect(again).not.toBe(first);
    expect(again.getState().destroyed).toBe(false);
  });
});
