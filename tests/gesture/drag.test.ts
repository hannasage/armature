import { afterEach, describe, expect, it, vi } from "vitest";
import { createSpring, criticalDamping, FIXED_STEP, retarget, stepSpring } from "../../src/engine/spring";
import type { Flavor } from "../../src/engine/flavor";
import { createDrag, type DragOptions } from "../../src/gesture";
import { glassFlavor } from "../../src/glass/flavor";
import { FakePointerEnv } from "../helpers/fake-pointer-env";
import { swipey } from "../helpers/gesture-flavor";

type Target = Record<string, never>;
const setup = (options: Partial<DragOptions> = {}, flavor: Flavor = swipey) => {
  const env = new FakePointerEnv();
  const el = {} as Target;
  const drag = createDrag(el, { flavor, env, ...options } as DragOptions);
  return { env, el, drag };
};
/** Hold the pointer still for long enough that its smoothed speed is 0 at the release. */
const rest = (env: FakePointerEnv) => { env.time += 2000; };
const xOf = (text: string | null | undefined) => Number.parseFloat(text ?? "NaN");
const yOf = (text: string | undefined) => Number.parseFloat((text ?? "").split(" ")[1] ?? "NaN");

/** A plain loop of the decay v' = -c v in the engine's fixed slices. It is the reference the controller is held to. */
function decayRef(x: number, v: number, steps: number, c = 4, restSpeed = 5) {
  const f = Math.exp(-c * FIXED_STEP);
  for (let i = 0; i < steps; i++) {
    v *= f;
    x += v * FIXED_STEP;
    if (Math.abs(v) < restSpeed) return { x, v: 0 };
  }
  return { x, v };
}

afterEach(() => { vi.restoreAllMocks(); });

describe("dragging", () => {
  it("follows the pointer on the x axis only, and writes the individual property translate", () => {
    const { env, el } = setup({ axis: "x" });
    env.down(el, 100, 50);
    env.move(el, 160, 80);
    expect(env.read(el)).toBe("60px 0px");
  });

  it("follows the pointer on the y axis only", () => {
    const { env, el } = setup({ axis: "y" });
    env.down(el, 100, 50);
    env.move(el, 160, 80);
    expect(env.read(el)).toBe("0px 30px");
  });

  it("follows the pointer on both axes, which is the default", () => {
    const { env, el } = setup();
    env.down(el, 100, 50);
    env.move(el, 160, 80);
    expect(env.read(el)).toBe("60px 30px");
    env.move(el, 90, 20);
    expect(env.read(el)).toBe("-10px -30px");
  });

  it("writes only translate and touch-action, and never transform", () => {
    const { env, el, drag } = setup({ axis: "x", bounds: [0, 300], snap: [0, 150, 300] });
    env.press(el, [0, 0], [140, 0], 140, 10);
    env.up(el, 140, 0);
    env.settle();
    drag.destroy();
    const properties = new Set(env.writes.map((write) => write.property));
    expect([...properties].sort()).toEqual(["touch-action", "translate"]);
  });

  it("tells the browser which pan the drag leaves alone", () => {
    for (const [axis, value] of [["x", "pan-y"], ["y", "pan-x"], ["both", "none"]] as const) {
      const { env, el } = setup({ axis });
      expect(env.read(el, "touch-action"), axis).toBe(value);
    }
  });

  it("writes nothing to translate until the pointer moves, and a down alone moves nothing", () => {
    const { env, el } = setup();
    expect(env.writesTo("translate")).toEqual([]);
    env.down(el, 5, 5);
    expect(env.writesTo("translate")).toEqual([]);
    expect(env.pending).toBe(0);
  });

  it("follows one pointer: moves and releases of another pointer are ignored", () => {
    const { env, el } = setup({ axis: "x" });
    env.down(el, 100, 0, 1);
    env.move(el, 0, 0, 2);
    expect(env.writesTo("translate")).toEqual([]);
    env.move(el, 130, 0, 1);
    expect(env.read(el)).toBe("30px 0px");
    env.up(el, 130, 0, 2);
    env.move(el, 140, 0, 1);
    expect(env.read(el)).toBe("40px 0px");
  });

  it("treats a press of another pointer as the end of a press that lost its release, and follows the new one", () => {
    const { env, el, drag } = setup({ axis: "x" });
    const swipe = vi.fn();
    drag.onSwipe(swipe);
    env.press(el, [0, 0], [80, 0], 80, 8); // the up of pointer 1 never arrives
    env.down(el, 500, 0, 2);
    expect(drag.getState()).toMatchObject({ dragging: true, x: 80, vx: 0 });
    env.move(el, 510, 0, 2);
    expect(env.read(el)).toBe("90px 0px");
    env.move(el, 900, 0, 1); // the old pointer is not heard any more
    expect(env.read(el)).toBe("90px 0px");
    env.up(el, 510, 0, 2);
    expect(swipe).not.toHaveBeenCalled();
    expect(drag.getState().dragging).toBe(false);
  });

  it("ignores a second press of the pointer that is already down", () => {
    const { env, el } = setup({ axis: "x" });
    env.down(el, 100, 0, 1);
    env.move(el, 130, 0, 1);
    env.down(el, 0, 0, 1);
    env.move(el, 140, 0, 1);
    expect(env.read(el)).toBe("40px 0px");
  });

  it("ignores a press at a coordinate that is not finite", () => {
    const { env, el, drag } = setup({ axis: "x" });
    env.down(el, Number.NaN, 0);
    env.down(el, 0, Infinity);
    expect(drag.getState().dragging).toBe(false);
    env.move(el, 50, 0);
    expect(env.writesTo("translate")).toEqual([]);
    env.down(el, 0, 0);
    expect(drag.getState().dragging).toBe(true);
  });

  it("logs a pointer that could not be captured once, at warn level, with the label of the flavor", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { env, el } = setup({ axis: "x" });
    const handlers = env.handlers.get(el)!;
    handlers.fault?.(new Error("no such pointer"));
    handlers.fault?.(new Error("again"));
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("[swipey]");
  });

  it("writes no number as exponent text, whatever the pointer says", () => {
    const { env, el } = setup({ axis: "both" });
    env.down(el, 0, 0);
    env.move(el, 1e300, -1e300);
    expect(env.read(el)).toBe("1000000000px -1000000000px");
    for (const value of env.writesTo("translate")) expect(value).not.toMatch(/e/i);
  });

  it("reports the state while it drags", () => {
    const { env, el, drag } = setup({ axis: "x" });
    expect(drag.getState()).toEqual({ x: 0, y: 0, vx: 0, vy: 0, dragging: false, moving: false, destroyed: false });
    env.down(el, 100, 0);
    env.move(el, 130, 0);
    expect(drag.getState()).toMatchObject({ x: 30, y: 0, dragging: true, moving: false });
  });

  it("ignores a move that is not finite", () => {
    const { env, el } = setup({ axis: "x" });
    env.down(el, 100, 0);
    env.move(el, Number.NaN, 0);
    env.move(el, 110, Infinity);
    expect(env.read(el)).toBe("10px 0px");
  });
});

describe("bounds and the rubber band", () => {
  it("follows the pointer exactly inside the bounds", () => {
    const { env, el } = setup({ axis: "x", bounds: [0, 300] });
    env.down(el, 0, 0);
    env.move(el, 120, 0);
    expect(env.read(el)).toBe("120px 0px");
    env.move(el, 300, 0);
    expect(env.read(el)).toBe("300px 0px");
  });

  it("pulls back past either bound: the shown overshoot is d / (1 + d / reach), with the reach of the flavor", () => {
    const { env, el } = setup({ axis: "x", bounds: [0, 300] });
    env.down(el, 0, 0);
    env.move(el, -50, 0);
    expect(env.read(el)).toBe("-35.294px 0px");
    env.move(el, 400, 0);
    expect(env.read(el)).toBe("354.545px 0px");
  });

  it("never shows more overshoot than the reach", () => {
    const { env, el } = setup({ axis: "x", bounds: [0, 300] });
    env.down(el, 0, 0);
    env.move(el, 1_000_000, 0);
    expect(xOf(env.read(el))).toBeLessThan(420);
    expect(xOf(env.read(el))).toBeGreaterThan(419);
  });

  it("bounds each axis of a two-axis drag on its own", () => {
    const { env, el } = setup({ axis: "both", bounds: { y: [0, 100] } });
    env.down(el, 0, 0);
    env.move(el, 500, 200);
    expect(xOf(env.read(el))).toBe(500);
    expect(yOf(env.read(el))).toBeCloseTo(100 + 100 / (1 + 100 / 120), 3);
  });

  it("springs back to the bound on release and comes to rest exactly on it", () => {
    const { env, el, drag } = setup({ axis: "x", bounds: [0, 300] });
    env.down(el, 0, 0);
    env.move(el, 400, 0);
    rest(env);
    env.up(el, 400, 0);
    expect(env.pending).toBe(1);
    env.settle();
    expect(env.read(el)).toBe("300px 0px");
    expect(drag.getState()).toMatchObject({ x: 300, vx: 0, moving: false });
    expect(env.pending).toBe(0);
  });

  it("is stiffer the farther it is pulled: the first pull back is stronger than a band of the stiffness at the bound", () => {
    const { env, el, drag } = setup({ axis: "x", bounds: [0, 300] });
    env.press(el, [0, 0], [-50, 0], 400, 8); // shown overshoot 35.294
    rest(env);
    env.up(el, -50, 0);
    env.tick(1000 / 60); // two slices of the solver
    const start = -50 / (1 + 50 / 120);
    // The same two slices with the stiffness fixed at the bound (300, critically damped).
    let fixed = retarget(createSpring({ stiffness: 300, damping: criticalDamping(300), restSpeed: 5, restDelta: 0.5 }, start), 0);
    fixed = stepSpring(stepSpring(fixed, 0, FIXED_STEP), 0, FIXED_STEP);
    const ratio = drag.getState().vx / fixed.velocity;
    expect(ratio).toBeGreaterThan(1.15); // the band is 1.29 times as stiff at the start
    expect(ratio).toBeLessThan(1.4);
  });

  it("returns from the band at the same pace on a 30, 60, or 144 Hz screen", () => {
    const at = (hz: number) => {
      const { env, el, drag } = setup({ axis: "x", bounds: [0, 300] });
      env.press(el, [0, 0], [400, 0], 800, 8);
      rest(env);
      env.up(el, 400, 0);
      const frames = Math.round(hz / 6); // 1/6 s: 5, 10, and 24 frames
      for (let i = 0; i < frames; i++) env.tick(1000 / hz);
      return drag.getState().x;
    };
    const slow = at(30);
    expect(slow).toBeGreaterThan(300.5); // still on its way, so the three runs differ if the pace differs
    expect(at(60)).toBeCloseTo(slow, 2);
    expect(at(144)).toBeCloseTo(slow, 2);
  });

  it("never shows a hard flick past the reach: a decay that meets a bound at 12,000 px/s stays under 120 px past it", () => {
    const { env, el } = setup({ axis: "x", bounds: [0, 300] });
    env.press(el, [0, 0], [250, 0], 20, 4);
    env.up(el, 250, 0);
    env.settle();
    const xs = env.writesTo("translate").map(xOf);
    expect(Math.max(...xs)).toBeGreaterThan(330);
    expect(Math.max(...xs)).toBeLessThan(420);
    expect(env.read(el)).toBe("300px 0px");
  });

  it("never shows a release past the reach, from a pointer far past the bound", () => {
    const { env, el } = setup({ axis: "x", bounds: [0, 300] });
    env.press(el, [0, 0], [100_000, 0], 20, 4);
    env.up(el, 100_000, 0);
    env.settle();
    for (const value of env.writesTo("translate")) expect(xOf(value)).toBeLessThan(420);
    expect(env.read(el)).toBe("300px 0px");
  });

  it("lets a press grab an element that sits at the reach, with no jump", () => {
    const { env, el, drag } = setup({ axis: "x", bounds: [0, 300] });
    env.press(el, [0, 0], [100_000, 0], 20, 4);
    rest(env);
    env.up(el, 100_000, 0);
    env.tick(1000 / 60);
    const held = drag.getState().x;
    env.down(el, 0, 0);
    env.move(el, 0, 0);
    expect(drag.getState().x).toBeCloseTo(held, 6);
  });

  it("scales the release velocity by the band, so a hard flick outward does not shoot far past the reach", () => {
    const { env, el, drag } = setup({ axis: "x", bounds: [0, 300] });
    env.press(el, [0, 0], [400, 0], 160, 8); // 2500 px/s, 100 px past the bound
    env.up(el, 400, 0);
    const shown = drag.getState().x;
    expect(shown).toBeCloseTo(354.545, 2);
    // The pointer is 100 px past, so the shown speed is 2500 / (1 + 100 / 120)^2 = 747.9.
    expect(drag.getState().vx).toBeCloseTo(2500 / (1 + 100 / 120) ** 2, 0);
  });

  it("lets a drag that starts out of bounds grab the element where it is", () => {
    const { env, el, drag } = setup({ axis: "x", bounds: [0, 300] });
    env.press(el, [0, 0], [400, 0], 800, 8);
    rest(env);
    env.up(el, 400, 0);
    env.tick(40);
    const grabbed = drag.getState().x;
    expect(grabbed).toBeGreaterThan(300);
    env.down(el, 1000, 0);
    expect(env.pending).toBe(0);
    env.move(el, 1000, 0);
    expect(drag.getState().x).toBeCloseTo(grabbed, 2);
  });
});

describe("decay", () => {
  const flick = (options: Partial<DragOptions> = {}) => {
    const made = setup({ axis: "x", ...options });
    made.env.press(made.el, [0, 0], [80, 0], 80, 8); // 1000 px/s
    return made;
  };

  it("hands the pointer speed to the element on release: 1000 px/s", () => {
    const { env, el, drag } = flick();
    env.up(el, 80, 0);
    expect(drag.getState()).toMatchObject({ x: 80, vx: expect.closeTo(1000, 3) as number, dragging: false, moving: true });
  });

  it("slows by v' = -c v: after 0.5 s the speed is 1000 e^(-4 0.5)", () => {
    const { env, el, drag } = flick();
    env.up(el, 80, 0);
    for (let i = 0; i < 30; i++) env.tick();
    expect(drag.getState().vx).toBeCloseTo(1000 * Math.exp(-2), 0);
  });

  it("matches a plain loop of the same fixed slices, frame by frame", () => {
    const { env, el, drag } = flick();
    env.up(el, 80, 0);
    for (const frame of [1, 2, 3, 4, 5, 10, 30, 60]) {
      while (env.time < 80 + frame * (1000 / 60) - 1e-6) env.tick();
      const ref = decayRef(80, 1000, frame * 2);
      expect(drag.getState().x, `frame ${frame}`).toBeCloseTo(ref.x, 1);
    }
  });

  it("stops at its rest threshold: the speed is exactly 0, no frame is pending, and the travel is v / c to within the threshold", () => {
    const { env, el, drag } = flick();
    env.up(el, 80, 0);
    const frames = env.settle();
    expect(frames).toBeGreaterThan(75); // ln(1000 / 5) / 4 = 1.32 s
    expect(frames).toBeLessThan(85);
    const state = drag.getState();
    expect(state).toMatchObject({ vx: 0, moving: false });
    expect(env.pending).toBe(0);
    expect(state.x).toBeCloseTo(decayRef(80, 1000, 100_000).x, 1);
    expect(state.x).toBeGreaterThan(320);
    expect(state.x).toBeLessThan(332);
    expect(xOf(env.read(el))).toBeCloseTo(state.x, 2);
  });

  it("lands in the same place at 30 Hz and at 60 Hz", () => {
    const a = flick();
    a.env.up(a.el, 80, 0);
    a.env.settle(1000 / 30);
    const b = flick();
    b.env.up(b.el, 80, 0);
    b.env.settle(1000 / 60);
    expect(a.drag.getState().x).toBeCloseTo(b.drag.getState().x, 1);
  });

  it("decays each axis of a two-axis drag on its own", () => {
    const { env, el, drag } = setup();
    env.press(el, [0, 0], [80, 40], 80, 8);
    env.up(el, 80, 40);
    env.settle();
    expect(drag.getState().x).toBeCloseTo(decayRef(80, 1000, 100_000).x, 1);
    expect(drag.getState().y).toBeCloseTo(decayRef(40, 500, 100_000).x, 1);
  });

  it("starts no frame for a release at rest, and keeps the element where it is", () => {
    const { env, el, drag } = flick();
    rest(env);
    env.up(el, 80, 0);
    expect(env.pending).toBe(0);
    expect(drag.getState()).toMatchObject({ x: 80, vx: 0, moving: false });
  });

  it("is caught by the rubber band when it crosses a bound, and comes to rest on the bound", () => {
    const { env, el, drag } = setup({ axis: "x", bounds: [0, 300] });
    env.press(el, [0, 0], [250, 0], 250, 10); // 1000 px/s, 50 px short of the bound
    env.up(el, 250, 0);
    env.settle();
    const xs = env.writesTo("translate").map(xOf);
    expect(Math.max(...xs)).toBeGreaterThan(305);
    expect(Math.max(...xs)).toBeLessThan(340);
    expect(env.read(el)).toBe("300px 0px");
    expect(drag.getState()).toMatchObject({ x: 300, vx: 0, moving: false });
  });

  it("uses the friction of the flavor", () => {
    const heavy: Flavor = { ...swipey, gesture: { ...swipey.gesture!, friction: 8 } };
    const { env, el, drag } = setup({ axis: "x" }, heavy);
    env.press(el, [0, 0], [80, 0], 80, 8);
    env.up(el, 80, 0);
    env.settle();
    expect(drag.getState().x).toBeCloseTo(decayRef(80, 1000, 100_000, 8).x, 1);
  });
});

describe("snap", () => {
  const SNAP = [0, 150, 300];

  it("springs to the nearest snap point and comes to rest exactly on it", () => {
    for (const [from, to] of [[140, 150], [230, 300], [60, 0]] as const) {
      const { env, el, drag } = setup({ axis: "x", bounds: [0, 300], snap: SNAP });
      env.press(el, [0, 0], [from, 0], from, 10);
      rest(env);
      env.up(el, from, 0);
      env.settle();
      expect(env.read(el), String(from)).toBe(`${to}px 0px`);
      expect(drag.getState()).toMatchObject({ x: to, vx: 0, moving: false });
    }
  });

  it("hands the release velocity to the snap spring", () => {
    const { env, el, drag } = setup({ axis: "x", bounds: [0, 300], snap: SNAP });
    env.press(el, [0, 0], [140, 0], 140, 10); // 1000 px/s
    env.up(el, 140, 0);
    expect(drag.getState().vx).toBeCloseTo(1000, 3);
    env.tick(4);
    const fast = drag.getState().x;

    const twin = setup({ axis: "x", bounds: [0, 300], snap: SNAP });
    twin.env.press(twin.el, [0, 0], [140, 0], 140, 10);
    rest(twin.env);
    twin.env.up(twin.el, 140, 0);
    expect(twin.drag.getState().vx).toBeCloseTo(0, 3);
    twin.env.tick(4);
    // 1000 px/s for 4 ms is 4 px, less the damping of the spring over the same slice: the two runs differ by 3.5 px.
    expect(fast - twin.drag.getState().x).toBeGreaterThan(3);
    expect(fast - twin.drag.getState().x).toBeLessThan(4);
    env.settle();
    expect(env.read(el)).toBe("150px 0px");
  });

  it("uses the snap spring of the flavor", () => {
    const soft: Flavor = { ...swipey, gesture: { ...swipey.gesture!, springKeys: { snap: "soft" } } };
    const a = setup({ axis: "x", snap: SNAP }, soft);
    const b = setup({ axis: "x", snap: SNAP });
    for (const { env, el } of [a, b]) {
      env.press(el, [0, 0], [140, 0], 140, 10);
      rest(env);
      env.up(el, 140, 0);
      for (let i = 0; i < 6; i++) env.tick();
    }
    expect(a.drag.getState().x).toBeLessThan(b.drag.getState().x);
    expect(a.drag.getState().x).toBeGreaterThan(140);
  });

  it("snaps a two-axis drag to the nearest point by distance", () => {
    const { env, el, drag } = setup({ axis: "both", bounds: { x: [0, 300], y: [0, 100] }, snap: [[0, 0], [300, 100]] });
    env.press(el, [0, 0], [200, 60], 200, 10);
    rest(env);
    env.up(el, 200, 60);
    env.settle();
    expect(env.read(el)).toBe("300px 100px");
    expect(drag.getState()).toMatchObject({ x: 300, y: 100 });
  });

  it("treats an empty list as no snap, so the release decays", () => {
    const { env, el, drag } = setup({ axis: "x", snap: [] });
    env.press(el, [0, 0], [80, 0], 80, 8);
    env.up(el, 80, 0);
    env.settle();
    expect(drag.getState().x).toBeGreaterThan(320);
  });
});

describe("a scripted pointer run, with pinned frames", () => {
  // These are regression pins: the numbers are what the code gave when it was written. Only frame 1 of each run was checked by hand:
  // two slices of the solver (snap), and two slices of the decay (band run).
  it("pins the frames of a release that snaps: a flick of 1000 px/s at x = 140 with snap points at 0, 150, and 300", () => {
    const { env, el } = setup({ axis: "x", bounds: [0, 300], snap: [0, 150, 300] });
    env.press(el, [0, 0], [140, 0], 140, 10);
    env.up(el, 140, 0);
    const start = env.writes.length;
    for (let i = 0; i < 8; i++) env.tick();
    expect(env.writes.slice(start).map((write) => write.value)).toEqual([
      "151.376px 0px", "157.675px 0px", "160.662px 0px", "161.569px 0px", "161.241px 0px", "160.242px 0px", "158.937px 0px", "157.556px 0px",
    ]);
    env.settle();
    expect(env.read(el)).toBe("150px 0px");
  });

  it("pins the frames of a decay that meets a bound: 1000 px/s from x = 250 with a bound at 300", () => {
    const { env, el } = setup({ axis: "x", bounds: [0, 300] });
    env.press(el, [0, 0], [250, 0], 250, 10);
    env.up(el, 250, 0);
    const frames: Array<string | undefined> = [];
    for (let i = 0; i < 12; i++) {
      env.tick();
      frames.push(env.read(el));
    }
    expect(frames).toEqual([
      "265.856px 0px", "280.689px 0px", "294.566px 0px", "305.826px 0px", "310.991px 0px", "312.671px 0px",
      "312.503px 0px", "311.452px 0px", "310.059px 0px", "308.611px 0px", "307.249px 0px", "306.035px 0px",
    ]);
    expect(env.settle()).toBe(14);
    expect(env.read(el)).toBe("300px 0px");
  });
});

describe("swipe", () => {
  const release = (axis: "x" | "y" | "both", from: [number, number], to: [number, number], ms: number, flavor: Flavor = swipey) => {
    const { env, el, drag } = setup({ axis }, flavor);
    const seen: string[] = [];
    drag.onSwipe((direction) => seen.push(direction));
    env.press(el, [0, 0], to, ms, 8);
    env.up(el, to[0], to[1]);
    return { seen, env, el, drag, from };
  };

  it("fires a direction for a release with enough speed and distance", () => {
    expect(release("x", [0, 0], [80, 0], 80).seen).toEqual(["right"]);
    expect(release("x", [0, 0], [-80, 0], 80).seen).toEqual(["left"]);
    expect(release("y", [0, 0], [0, 80], 80).seen).toEqual(["down"]);
    expect(release("y", [0, 0], [0, -80], 80).seen).toEqual(["up"]);
  });

  it("fires nothing when the release is too slow or too short", () => {
    expect(release("x", [0, 0], [80, 0], 800).seen).toEqual([]); // 100 px/s
    expect(release("x", [0, 0], [20, 0], 8).seen).toEqual([]); // 2500 px/s, but 20 px
  });

  it("takes the thresholds from the flavor", () => {
    const stiff: Flavor = { ...swipey, gesture: { ...swipey.gesture!, swipe: { velocity: 2000, distance: 40 } } };
    expect(release("x", [0, 0], [80, 0], 80, stiff).seen).toEqual([]);
    expect(release("x", [0, 0], [80, 0], 32, stiff).seen).toEqual(["right"]); // 2500 px/s
  });

  it("fires the direction of the faster axis on a two-axis drag", () => {
    expect(release("both", [0, 0], [80, 20], 80).seen).toEqual(["right"]);
    expect(release("both", [0, 0], [20, 90], 80).seen).toEqual(["down"]);
  });

  it("reads only the axis of the drag", () => {
    expect(release("x", [0, 0], [10, 100], 80).seen).toEqual([]);
  });

  it("fires after a release that snaps or decays, and under reduced motion", () => {
    const { env, el, drag } = setup({ axis: "x", snap: [0, 150] });
    env.reduced = true;
    const seen: string[] = [];
    drag.onSwipe((direction) => seen.push(direction));
    env.press(el, [0, 0], [80, 0], 80, 8);
    env.up(el, 80, 0);
    expect(seen).toEqual(["right"]);
  });

  it("calls every listener, stops calling one that unsubscribed, and rejects a listener that is not a function", () => {
    const { env, el, drag } = setup({ axis: "x" });
    const a = vi.fn();
    const b = vi.fn();
    const offA = drag.onSwipe(a);
    drag.onSwipe(b);
    offA();
    env.press(el, [0, 0], [80, 0], 80, 8);
    env.up(el, 80, 0);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledExactlyOnceWith("right");
    expect(() => drag.onSwipe(null as never)).toThrow(TypeError);
  });

  it("logs each listener that throws once, and still calls the others", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { env, el, drag } = setup({ axis: "x" });
    const good = vi.fn();
    drag.onSwipe(() => { throw new Error("first"); });
    drag.onSwipe(() => { throw new Error("second"); });
    drag.onSwipe(good);
    for (let i = 0; i < 2; i++) {
      env.press(el, [0, 0], [80, 0], 80, 8);
      env.up(el, 80, 0);
      env.settle();
    }
    expect(good).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(2);
    expect(String(log.mock.calls[0][0])).toContain("[swipey]");
  });
});

describe("reduced motion", () => {
  it("snaps straight to the nearest snap point, with no frame and no inertia", () => {
    const { env, el, drag } = setup({ axis: "x", bounds: [0, 300], snap: [0, 150, 300] });
    env.reduced = true;
    env.press(el, [0, 0], [140, 0], 140, 10);
    env.up(el, 140, 0);
    expect(env.read(el)).toBe("150px 0px");
    expect(env.pending).toBe(0);
    expect(env.requested).toBe(0);
    expect(drag.getState()).toMatchObject({ x: 150, vx: 0, moving: false });
  });

  it("keeps a release in the bounds where it is, with no inertia", () => {
    const { env, el, drag } = setup({ axis: "x", bounds: [0, 300] });
    env.reduced = true;
    env.press(el, [0, 0], [80, 0], 80, 8);
    env.up(el, 80, 0);
    expect(env.pending).toBe(0);
    expect(drag.getState()).toMatchObject({ x: 80, vx: 0 });
  });

  it("clamps a release out of the bounds to the bound", () => {
    const { env, el } = setup({ axis: "x", bounds: [0, 300] });
    env.reduced = true;
    env.down(el, 0, 0);
    env.move(el, 400, 0);
    env.up(el, 400, 0);
    expect(env.read(el)).toBe("300px 0px");
    expect(env.pending).toBe(0);
  });

  it("jumps to the end point at once when the setting turns on in flight", () => {
    const { env, el, drag } = setup({ axis: "x", bounds: [0, 300], snap: [0, 150, 300] });
    env.press(el, [0, 0], [140, 0], 140, 10);
    env.up(el, 140, 0);
    env.tick();
    env.tick();
    env.reduced = true;
    env.tick();
    expect(env.read(el)).toBe("150px 0px");
    expect(env.pending).toBe(0);
    expect(drag.getState()).toMatchObject({ x: 150, vx: 0, moving: false });
  });

  it("stops a decay where it is when the setting turns on in flight", () => {
    const { env, el, drag } = setup({ axis: "x" });
    env.press(el, [0, 0], [80, 0], 80, 8);
    env.up(el, 80, 0);
    env.tick();
    env.reduced = true;
    env.tick();
    expect(env.pending).toBe(0);
    expect(drag.getState().vx).toBe(0);
    const at = drag.getState().x;
    env.tick();
    expect(drag.getState().x).toBe(at);
  });
});

describe("a pointer that is cancelled", () => {
  it("ends cleanly: no swipe, no velocity, and the element settles on the nearest snap point", () => {
    const { env, el, drag } = setup({ axis: "x", bounds: [0, 300], snap: [0, 150, 300] });
    const swipe = vi.fn();
    drag.onSwipe(swipe);
    env.press(el, [0, 0], [140, 0], 140, 10); // a fast move
    env.cancel(el, 140, 0);
    expect(swipe).not.toHaveBeenCalled();
    expect(drag.getState()).toMatchObject({ dragging: false, vx: 0 });
    env.settle();
    expect(env.read(el)).toBe("150px 0px");
    expect(drag.getState()).toMatchObject({ x: 150, vx: 0, moving: false });
  });

  it("springs back from the rubber band to the bound", () => {
    const { env, el } = setup({ axis: "x", bounds: [0, 300] });
    env.press(el, [0, 0], [400, 0], 400, 10);
    env.cancel(el, 400, 0);
    env.settle();
    expect(env.read(el)).toBe("300px 0px");
  });

  it("leaves an element in the bounds with no snap where it is, and asks for no frame", () => {
    const { env, el, drag } = setup({ axis: "x", bounds: [0, 300] });
    env.press(el, [0, 0], [80, 0], 80, 8);
    env.cancel(el, 80, 0);
    expect(env.pending).toBe(0);
    expect(drag.getState()).toMatchObject({ x: 80, vx: 0, dragging: false, moving: false });
  });

  it("ignores a cancel or an up of another pointer, and a cancel or an up with no press", () => {
    const { env, el, drag } = setup({ axis: "x" });
    env.cancel(el, 0, 0);
    env.up(el, 0, 0);
    env.down(el, 0, 0, 1);
    env.cancel(el, 0, 0, 2);
    env.up(el, 0, 0, 2);
    expect(drag.getState().dragging).toBe(true);
    env.cancel(el, 0, 0, 1);
    expect(drag.getState().dragging).toBe(false);
  });

  it("ignores a move after the cancel, and takes a new press", () => {
    const { env, el } = setup({ axis: "x" });
    env.down(el, 0, 0);
    env.move(el, 10, 0);
    env.cancel(el, 10, 0);
    env.move(el, 500, 0);
    expect(env.read(el)).toBe("10px 0px");
    env.down(el, 100, 0);
    env.move(el, 120, 0);
    expect(env.read(el)).toBe("30px 0px");
  });

  it("snaps straight to the end point under reduced motion", () => {
    const { env, el } = setup({ axis: "x", bounds: [0, 300], snap: [0, 150, 300] });
    env.reduced = true;
    env.press(el, [0, 0], [140, 0], 140, 10);
    env.cancel(el, 140, 0);
    expect(env.read(el)).toBe("150px 0px");
    expect(env.pending).toBe(0);
  });
});

describe("a new press during a flight", () => {
  it("stops the motion at once, and the drag carries on from where the element is", () => {
    const { env, el, drag } = setup({ axis: "x" });
    env.press(el, [0, 0], [80, 0], 80, 8);
    env.up(el, 80, 0);
    for (let i = 0; i < 5; i++) env.tick();
    const held = drag.getState().x;
    expect(held).toBeGreaterThan(80);
    env.down(el, 500, 0);
    expect(env.pending).toBe(0);
    expect(drag.getState()).toMatchObject({ x: held, vx: 0, moving: false, dragging: true });
    env.move(el, 510, 0);
    expect(drag.getState().x).toBeCloseTo(held + 10, 3);
  });
});

describe("destroy", () => {
  it("in the middle of a drag leaves the element at rest, removes the listeners, and logs nothing", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { env, el, drag } = setup({ axis: "x", bounds: [0, 300] });
    env.down(el, 0, 0);
    env.move(el, 120, 0);
    const stale = env.handlers.get(el)!;
    drag.destroy();
    expect(env.handlers.has(el)).toBe(false);
    expect(env.removed).toBe(1);
    expect(env.pending).toBe(0);
    expect(drag.getState()).toMatchObject({ x: 120, vx: 0, dragging: false, moving: false, destroyed: true });
    const writes = env.writes.length;
    stale.move({ id: 1, x: 500, y: 0, time: 10 });
    stale.up({ id: 1, x: 500, y: 0, time: 10 });
    stale.down({ id: 2, x: 0, y: 0, time: 10 });
    env.tick();
    expect(env.writes.length).toBe(writes);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("clamps an element that is out of the bounds, so a stretched band is not left behind", () => {
    const { env, el, drag } = setup({ axis: "x", bounds: [0, 300] });
    env.down(el, 0, 0);
    env.move(el, 400, 0);
    drag.destroy();
    expect(env.read(el)).toBe("300px 0px");
    expect(drag.getState().x).toBe(300);
  });

  it("in the middle of a flight cancels the frame and writes nothing more", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { env, el, drag } = setup({ axis: "x" });
    env.press(el, [0, 0], [80, 0], 80, 8);
    env.up(el, 80, 0);
    env.tick();
    env.tick();
    expect(env.pending).toBe(1);
    const at = env.read(el);
    drag.destroy();
    expect(env.pending).toBe(0);
    expect(env.cancelled.length).toBeGreaterThan(0);
    env.tick();
    expect(env.read(el)).toBe(at);
    expect(drag.getState()).toMatchObject({ vx: 0, moving: false });
    expect(log).not.toHaveBeenCalled();
  });

  it("gives touch-action back, never fires a swipe, and is safe to call twice", () => {
    const { env, el, drag } = setup({ axis: "x" });
    const swipe = vi.fn();
    drag.onSwipe(swipe);
    drag.destroy();
    expect(env.read(el, "touch-action")).toBeUndefined();
    expect(() => drag.destroy()).not.toThrow();
    expect(env.removed).toBe(1);
    expect(swipe).not.toHaveBeenCalled();
    expect(() => drag.onSwipe(() => undefined)()).not.toThrow();
  });
});

describe("a stop that is not a destroy", () => {
  it("after a failed write, removes touch-action, removes the listeners, and says it failed", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { env, el, drag } = setup({ axis: "x" });
    expect(env.read(el, "touch-action")).toBe("pan-y");
    env.down(el, 0, 0);
    env.failWith = new Error("boom");
    env.failProperty = "translate";
    env.move(el, 10, 0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(env.read(el, "touch-action")).toBeUndefined();
    expect(env.handlers.has(el)).toBe(false);
    expect(drag.getState()).toMatchObject({ destroyed: true, dragging: false, moving: false });
    expect(drag.getState().failed).toBeInstanceOf(Error);
    expect(drag.getState().failed?.message).toBe("boom");
  });

  it("has no failure in its state after a destroy of its own", () => {
    const { drag } = setup({ axis: "x" });
    drag.destroy();
    expect(drag.getState().failed).toBeUndefined();
  });

  it("removes touch-action in destroy even when the write of translate throws, and logs nothing", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { env, el, drag } = setup({ axis: "x", bounds: [0, 300] });
    env.down(el, 0, 0);
    env.move(el, 400, 0); // out of the bounds, so destroy writes the bound
    env.failWith = new Error("boom");
    env.failProperty = "translate";
    expect(() => drag.destroy()).not.toThrow();
    expect(env.read(el, "touch-action")).toBeUndefined();
    expect(env.handlers.has(el)).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it("removes the listeners in destroy even when touch-action cannot be removed", () => {
    const { env, drag } = setup({ axis: "x" });
    env.failWith = new Error("boom");
    expect(() => drag.destroy()).not.toThrow();
    expect(env.removed).toBe(1);
  });

  it("gives back the touch-action the author had set, and not a bare removal", () => {
    const env = new FakePointerEnv();
    const el = {} as Target;
    env.styles.set(el, { "touch-action": "manipulation" });
    const drag = createDrag(el, { flavor: swipey, env, axis: "x" });
    expect(env.read(el, "touch-action")).toBe("pan-y");
    drag.destroy();
    expect(env.read(el, "touch-action")).toBe("manipulation");
  });
});

describe("what the drag is given", () => {
  it("throws a TypeError when the element is not an object", () => {
    for (const bad of [null, undefined, 3, "div"]) expect(() => createDrag(bad as never, { flavor: swipey, env: new FakePointerEnv() })).toThrow(TypeError);
  });

  it("throws a clear TypeError when the flavor has no gesture part, or is missing", () => {
    expect(() => createDrag({}, { flavor: glassFlavor, env: new FakePointerEnv() })).toThrow('The flavor "glass" has no gesture part.');
    expect(() => createDrag({}, {} as never)).toThrow(TypeError);
  });

  it("throws a TypeError for an axis it does not know", () => {
    expect(() => setup({ axis: "z" as never })).toThrow(/axis/);
  });

  it("throws a TypeError for bounds that are not a pair of finite numbers in order, or the wrong shape", () => {
    expect(() => setup({ axis: "x", bounds: [10, 5] })).toThrow(/bounds/);
    expect(() => setup({ axis: "x", bounds: [0, Number.NaN] })).toThrow(/bounds/);
    expect(() => setup({ axis: "x", bounds: [0] as never })).toThrow(/bounds/);
    expect(() => setup({ axis: "x", bounds: { x: [0, 1] } as never })).toThrow(/bounds/);
    expect(() => setup({ axis: "both", bounds: [0, 1] as never })).toThrow(/bounds/);
    expect(() => setup({ axis: "both", bounds: { x: [5, 1] } })).toThrow(/bounds/);
  });

  it("throws a TypeError for a snap point that is not finite or the wrong shape", () => {
    expect(() => setup({ axis: "x", snap: [0, Number.NaN] })).toThrow(/snap/);
    expect(() => setup({ axis: "x", snap: [[0, 0]] as never })).toThrow(/snap/);
    expect(() => setup({ axis: "both", snap: [0, 1] as never })).toThrow(/snap/);
    expect(() => setup({ axis: "both", snap: [[0, Infinity]] })).toThrow(/snap/);
  });

  it("refuses a snap point outside the bounds", () => {
    expect(() => setup({ axis: "x", bounds: [0, 300], snap: [0, 400] })).toThrow(/snap/);
    expect(() => setup({ axis: "both", bounds: { y: [0, 100] }, snap: [[0, 0], [10, 101]] })).toThrow(/snap/);
    expect(() => setup({ axis: "both", bounds: { y: [0, 100] }, snap: [[0, 0], [9999, 100]] })).not.toThrow();
  });

  it("copies the snap points, so a later change of the caller's list does nothing", () => {
    const points: Array<[number, number]> = [[0, 0], [300, 100]];
    const { env, el, drag } = setup({ axis: "both", snap: points });
    points[1][0] = 0;
    points.push([200, 60]);
    env.press(el, [0, 0], [200, 60], 200, 10);
    rest(env);
    env.up(el, 200, 60);
    env.settle();
    expect(drag.getState()).toMatchObject({ x: 300, y: 100 });
  });

  it("throws nothing, and writes nothing to the element, when the options are bad", () => {
    const env = new FakePointerEnv();
    expect(() => createDrag({}, { flavor: swipey, env, axis: "x", bounds: [3, 1] })).toThrow(TypeError);
    expect(env.writes).toEqual([]);
    expect(env.added).toBe(0);
  });
});

describe("a write that fails", () => {
  it("is logged once with the label of the flavor, and the drag stops", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { env, el, drag } = setup({ axis: "x" });
    env.down(el, 0, 0);
    env.failWith = new Error("boom");
    env.move(el, 10, 0);
    env.move(el, 20, 0);
    env.up(el, 20, 0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("[swipey]");
    expect(env.pending).toBe(0);
    expect(drag.getState().moving).toBe(false);
  });
});
