import { describe, expect, it } from "vitest";
import type { LensBox } from "../../src/dom/lens";
import { createLens } from "../helpers/glass";
import { FakeEnv } from "../helpers/fake-env";

const container = { id: "row" };

function setup(options: Partial<Parameters<typeof createLens>[0]> = {}) {
  const env = new FakeEnv();
  let box: LensBox | null = { x: 100, y: 4, w: 80, h: 40 };
  const lens = createLens({ container, measure: () => box, env, ...options });
  return {
    env,
    lens,
    setBox: (next: LensBox | null) => { box = next; },
    var: (name: string) => env.read(container, name),
  };
}

describe("createLens first paint", () => {
  it("jumps to the first box without a frame, and writes every variable", () => {
    const t = setup();
    t.lens.update();
    expect(t.env.pending).toBe(0);
    expect(t.lens.getState()).toMatchObject({ ready: true, x: 100, y: 4, w: 80, h: 40, sx: 1, sy: 1, moving: false });
    expect(t.var("--lqg-lens-x")).toBe("100px");
    expect(t.var("--lqg-lens-y")).toBe("4px");
    expect(t.var("--lqg-lens-w")).toBe("80px");
    expect(t.var("--lqg-lens-h")).toBe("40px");
    expect(t.var("--lqg-lens-sx")).toBe("1");
    expect(t.var("--lqg-lens-sy")).toBe("1");
  });

  it("marks the container ready, so CSS can show the lens", () => {
    const t = setup();
    expect(t.env.attrs.get(container)?.["data-lqg-lens"]).toBeUndefined();
    t.lens.update();
    expect(t.env.attrs.get(container)?.["data-lqg-lens"]).toBe("ready");
  });

  it("stays hidden while the target cannot be measured, then appears", () => {
    const t = setup();
    t.setBox(null);
    t.lens.update();
    expect(t.lens.getState().ready).toBe(false);
    expect(t.env.writes).toHaveLength(0);
    t.setBox({ x: 10, y: 0, w: 50, h: 30 });
    t.lens.update();
    expect(t.lens.getState()).toMatchObject({ ready: true, x: 10, w: 50 });
    expect(t.env.pending).toBe(0);
  });

  it("treats a box with no size, or a non-finite number, as unmeasurable", () => {
    for (const bad of [{ x: 0, y: 0, w: 0, h: 20 }, { x: 0, y: 0, w: 20, h: 0 }, { x: Number.NaN, y: 0, w: 20, h: 20 }, { x: 0, y: 0, w: Number.POSITIVE_INFINITY, h: 20 }]) {
      const t = setup();
      t.setBox(bad);
      t.lens.update();
      expect(t.lens.getState().ready, JSON.stringify(bad)).toBe(false);
    }
  });

  it("hides again when the target disappears, and takes a fresh first place when it returns", () => {
    const t = setup();
    t.lens.update();
    t.setBox(null);
    t.lens.update();
    expect(t.lens.getState().ready).toBe(false);
    expect(t.env.attrs.get(container)?.["data-lqg-lens"]).toBeUndefined();
    t.setBox({ x: 500, y: 4, w: 60, h: 40 });
    t.lens.update();
    expect(t.lens.getState()).toMatchObject({ ready: true, x: 500, w: 60 });
    expect(t.env.pending).toBe(0);
  });

  it("grows in from zero width when the first-paint jump rule is off", () => {
    const t = setup({ jumpRules: { first: false } });
    t.lens.update();
    expect(t.lens.getState()).toMatchObject({ x: 100, w: 0 });
    expect(t.env.pending).toBe(1);
    t.env.settle();
    expect(t.lens.getState().w).toBe(80);
  });
});

describe("createLens travel", () => {
  it("animates a retarget over several frames and lands exactly", () => {
    const t = setup();
    t.lens.update();
    t.setBox({ x: 300, y: 4, w: 120, h: 40 });
    t.lens.update();
    expect(t.env.pending).toBe(1);
    expect(t.lens.getState()).toMatchObject({ x: 100, w: 80, moving: true });
    t.env.tick();
    const early = t.lens.getState();
    expect(early.x).toBeGreaterThan(100);
    expect(early.x).toBeLessThan(300);
    const frames = t.env.settle();
    expect(frames).toBeGreaterThan(10);
    expect(frames).toBeLessThan(200);
    expect(t.lens.getState()).toMatchObject({ x: 300, w: 120, sx: 1, sy: 1, moving: false });
    expect(t.var("--lqg-lens-x")).toBe("300px");
    expect(t.var("--lqg-lens-w")).toBe("120px");
  });

  it("springs x and width on their own curves, so the width lags and overshoots differently", () => {
    const t = setup();
    t.lens.update();
    t.setBox({ x: 300, y: 4, w: 180, h: 40 });
    t.lens.update();
    const path: Array<{ xFraction: number; wFraction: number }> = [];
    for (let i = 0; i < 12; i += 1) {
      t.env.tick();
      const s = t.lens.getState();
      path.push({ xFraction: (s.x - 100) / 200, wFraction: (s.w - 80) / 100 });
    }
    expect(path.some(({ xFraction, wFraction }) => Math.abs(xFraction - wFraction) > 0.01)).toBe(true);
  });

  it("overshoots the target slightly, as a liquid would, and then settles", () => {
    const t = setup();
    t.lens.update();
    t.setBox({ x: 400, y: 4, w: 80, h: 40 });
    t.lens.update();
    let peak = 0;
    while (t.env.pending > 0) { t.env.tick(); peak = Math.max(peak, t.lens.getState().x); }
    expect(peak).toBeGreaterThan(400);
    expect(peak).toBeLessThan(430);
  });

  it("keeps velocity when the target changes mid-flight", () => {
    const t = setup();
    t.lens.update();
    t.setBox({ x: 500, y: 4, w: 80, h: 40 });
    t.lens.update();
    for (let i = 0; i < 6; i += 1) t.env.tick();
    const before = t.lens.getState();
    expect(before.vx).toBeGreaterThan(100);
    t.setBox({ x: 20, y: 4, w: 80, h: 40 });
    t.lens.update();
    const after = t.lens.getState();
    expect(after.x).toBe(before.x);
    expect(after.vx).toBe(before.vx);
    expect(t.env.pending).toBe(1);
    t.env.tick();
    // Still moving right for a frame: the momentum is not thrown away.
    expect(t.lens.getState().x).toBeGreaterThan(before.x);
    t.env.settle();
    expect(t.lens.getState().x).toBe(20);
  });

  it("runs one frame loop, however many times it is retargeted", () => {
    const t = setup();
    t.lens.update();
    for (const x of [200, 300, 150, 420]) {
      t.setBox({ x, y: 4, w: 80, h: 40 });
      t.lens.update();
      expect(t.env.pending).toBe(1);
      t.env.tick();
    }
    expect(t.env.pending).toBe(1);
  });

  it("leaves a running travel alone when the target has not changed", () => {
    const t = setup();
    t.lens.update();
    t.setBox({ x: 300, y: 4, w: 80, h: 40 });
    t.lens.update();
    t.env.tick();
    t.env.tick();
    const before = t.lens.getState();
    const requested = t.env.requested;
    t.lens.update();
    expect(t.lens.getState().vx).toBe(before.vx);
    expect(t.env.requested).toBe(requested);
  });

  it("writes y and height straight to the target, because a row does not travel up and down", () => {
    const t = setup();
    t.lens.update();
    t.setBox({ x: 300, y: 10, w: 80, h: 52 });
    t.lens.update();
    expect(t.lens.getState()).toMatchObject({ y: 10, h: 52 });
    expect(t.var("--lqg-lens-y")).toBe("10px");
    expect(t.var("--lqg-lens-h")).toBe("52px");
  });
});

describe("createLens stretch", () => {
  it("stretches with speed, caps scaleX at 1.12, and keeps scaleY as its inverse", () => {
    const t = setup();
    t.lens.update();
    t.setBox({ x: 1500, y: 4, w: 80, h: 40 });
    t.lens.update();
    let highest = 1;
    let sawStretch = false;
    while (t.env.pending > 0) {
      t.env.tick();
      const { sx, sy } = t.lens.getState();
      highest = Math.max(highest, sx);
      expect(sx).toBeLessThanOrEqual(1.12 + 1e-12);
      expect(sx).toBeGreaterThanOrEqual(1);
      expect(sx * sy).toBeCloseTo(1, 9);
      if (sx > 1.01) sawStretch = true;
    }
    expect(sawStretch).toBe(true);
    expect(highest).toBeCloseTo(1.12, 6);
  });

  it("stretches the same way when travelling left", () => {
    const t = setup();
    t.setBox({ x: 1500, y: 4, w: 80, h: 40 });
    t.lens.update();
    t.setBox({ x: 100, y: 4, w: 80, h: 40 });
    t.lens.update();
    t.env.tick();
    t.env.tick();
    expect(t.lens.getState().sx).toBeGreaterThan(1);
    expect(t.lens.getState().vx).toBeLessThan(0);
  });

  it("stretches in proportion to speed below the cap", () => {
    const slow = setup({ stretchVelocity: 100_000 });
    slow.lens.update();
    slow.setBox({ x: 400, y: 4, w: 80, h: 40 });
    slow.lens.update();
    for (let i = 0; i < 5; i += 1) slow.env.tick();
    const { sx, vx } = slow.lens.getState();
    expect(sx).toBeCloseTo(1 + Math.abs(vx) / 100_000, 9);
  });

  it("can be turned off with a zero cap", () => {
    const t = setup({ maxStretch: 0 });
    t.lens.update();
    t.setBox({ x: 1500, y: 4, w: 80, h: 40 });
    t.lens.update();
    while (t.env.pending > 0) { t.env.tick(); expect(t.lens.getState().sx).toBe(1); }
  });

  it("writes the stretch variables as it goes", () => {
    const t = setup();
    t.lens.update();
    t.setBox({ x: 1500, y: 4, w: 80, h: 40 });
    t.lens.update();
    t.env.tick(); t.env.tick(); t.env.tick();
    expect(Number(t.var("--lqg-lens-sx"))).toBeGreaterThan(1);
    expect(Number(t.var("--lqg-lens-sy"))).toBeLessThan(1);
  });
});

describe("createLens frame loop", () => {
  it("stops the loop at rest and writes nothing more", () => {
    const t = setup();
    t.lens.update();
    t.setBox({ x: 300, y: 4, w: 80, h: 40 });
    t.lens.update();
    t.env.settle();
    expect(t.env.pending).toBe(0);
    const writes = t.env.writes.length;
    const requested = t.env.requested;
    t.env.tick(); t.env.tick();
    expect(t.env.writes.length).toBe(writes);
    expect(t.env.requested).toBe(requested);
  });

  it("writes only the variables that changed in a frame", () => {
    const t = setup();
    t.lens.update();
    t.setBox({ x: 300, y: 4, w: 80, h: 40 });
    t.lens.update();
    t.env.tick(); t.env.tick();
    // y, h, and w never change on this travel (the width springs only when it has somewhere to go).
    expect(t.env.writesTo("--lqg-lens-y").length).toBe(1);
    expect(t.env.writesTo("--lqg-lens-h").length).toBe(1);
    expect(t.env.writesTo("--lqg-lens-x").length).toBeGreaterThan(2);
  });

  it("lands in nearly the same place at 30 and 144 frames per second", () => {
    const at = (ms: number) => {
      const t = setup();
      t.lens.update();
      t.setBox({ x: 400, y: 4, w: 160, h: 40 });
      t.lens.update();
      const frames = Math.round(300 / ms);
      for (let i = 0; i < frames; i += 1) t.env.tick(ms);
      return t.lens.getState();
    };
    const slow = at(1000 / 30);
    const fast = at(1000 / 144);
    expect(Math.abs(slow.x - fast.x)).toBeLessThan(8);
    expect(Math.abs(slow.w - fast.w)).toBeLessThan(8);
  });

  it("measures each step from the previous frame time, even when now() runs ahead of the frame clock", () => {
    const run = (lag: number) => {
      const t = setup();
      t.lens.update();
      t.setBox({ x: 400, y: 4, w: 160, h: 40 });
      t.lens.update();
      t.env.tick();
      t.env.lag = lag;
      for (let i = 0; i < 12; i += 1) t.env.tick();
      return t.lens.getState();
    };
    const exact = run(0);
    const late = run(9);
    expect(late.x).toBeCloseTo(exact.x, 6);
    expect(late.w).toBeCloseTo(exact.w, 6);
    expect(late.vx).toBeCloseTo(exact.vx, 6);
  });

  it("survives a long stalled frame without jumping to nonsense", () => {
    const t = setup();
    t.lens.update();
    t.setBox({ x: 300, y: 4, w: 80, h: 40 });
    t.lens.update();
    t.env.tick(60_000);
    const s = t.lens.getState();
    expect(Number.isFinite(s.x)).toBe(true);
    expect(s.x).toBeGreaterThan(100);
    expect(s.x).toBeLessThan(400);
  });
});

describe("createLens jump rules", () => {
  it("jumps under reduced motion, without a frame", () => {
    const t = setup();
    t.lens.update();
    t.env.reduced = true;
    t.setBox({ x: 300, y: 4, w: 120, h: 40 });
    t.lens.update();
    expect(t.env.pending).toBe(0);
    expect(t.lens.getState()).toMatchObject({ x: 300, w: 120, moving: false });
    expect(t.var("--lqg-lens-x")).toBe("300px");
  });

  it("reads reduced motion at every update, so turning it on takes effect at once", () => {
    const t = setup();
    t.lens.update();
    t.setBox({ x: 300, y: 4, w: 80, h: 40 });
    t.lens.update();
    expect(t.env.pending).toBe(1);
    t.env.reduced = true;
    t.setBox({ x: 600, y: 4, w: 80, h: 40 });
    t.lens.update();
    expect(t.env.pending).toBe(0);
    expect(t.lens.getState().x).toBe(600);
  });

  it("jumps for a keyboard-initiated change, and animates the next pointer one", () => {
    const t = setup();
    t.lens.update();
    t.setBox({ x: 300, y: 4, w: 80, h: 40 });
    t.lens.update({ keyboard: true });
    expect(t.env.pending).toBe(0);
    expect(t.lens.getState().x).toBe(300);
    t.setBox({ x: 500, y: 4, w: 80, h: 40 });
    t.lens.update({ keyboard: false });
    expect(t.env.pending).toBe(1);
    expect(t.lens.getState().x).toBe(300);
  });

  it("lets a rule be switched off", () => {
    const t = setup({ jumpRules: { keyboard: false, reducedMotion: false } });
    t.lens.update();
    t.env.reduced = true;
    t.setBox({ x: 300, y: 4, w: 80, h: 40 });
    t.lens.update({ keyboard: true });
    expect(t.env.pending).toBe(1);
  });

  it("jump() moves to the measured box at once, cancels the travel, and clears velocity", () => {
    const t = setup();
    t.lens.update();
    t.setBox({ x: 500, y: 4, w: 80, h: 40 });
    t.lens.update();
    t.env.tick(); t.env.tick();
    t.setBox({ x: 40, y: 4, w: 90, h: 40 });
    t.lens.jump();
    expect(t.lens.getState()).toMatchObject({ x: 40, w: 90, vx: 0, vw: 0, sx: 1, sy: 1, moving: false });
    expect(t.env.pending).toBe(0);
    expect(t.var("--lqg-lens-x")).toBe("40px");
  });
});

describe("createLens resize", () => {
  it("watches the container and refits at once when the box moved", () => {
    const t = setup();
    t.lens.update();
    expect(t.env.resizeCallbacks.has(container)).toBe(true);
    t.setBox({ x: 160, y: 4, w: 96, h: 40 });
    t.env.resizeCallbacks.get(container)!();
    expect(t.lens.getState()).toMatchObject({ x: 160, w: 96, moving: false });
    expect(t.env.pending).toBe(0);
  });

  it("leaves a running travel alone when the box did not change", () => {
    const t = setup();
    t.lens.update();
    t.setBox({ x: 300, y: 4, w: 80, h: 40 });
    t.lens.update();
    t.env.tick(); t.env.tick();
    const vx = t.lens.getState().vx;
    t.env.resizeCallbacks.get(container)!();
    expect(t.lens.getState().vx).toBe(vx);
    expect(t.env.pending).toBe(1);
  });

  it("takes a first place when it was hidden and now has a box", () => {
    const t = setup();
    t.setBox(null);
    t.lens.update();
    t.setBox({ x: 70, y: 2, w: 66, h: 36 });
    t.lens.refit();
    expect(t.lens.getState()).toMatchObject({ ready: true, x: 70, w: 66 });
  });

  it("hides when a refit finds nothing to measure", () => {
    const t = setup();
    t.lens.update();
    t.setBox(null);
    t.lens.refit();
    expect(t.lens.getState().ready).toBe(false);
  });

  it("works without a resize observer in the environment", () => {
    const env = new FakeEnv();
    (env as { observeResize?: unknown }).observeResize = undefined;
    const lens = createLens({ container, measure: () => ({ x: 1, y: 1, w: 10, h: 10 }), env });
    expect(() => lens.update()).not.toThrow();
    lens.destroy();
  });
});

describe("createLens destroy", () => {
  it("cancels the pending frame and disconnects the resize observer", () => {
    const t = setup();
    t.lens.update();
    t.setBox({ x: 300, y: 4, w: 80, h: 40 });
    t.lens.update();
    t.env.tick();
    expect(t.env.pending).toBe(1);
    t.lens.destroy();
    expect(t.env.pending).toBe(0);
    expect(t.env.cancelled.length).toBeGreaterThan(0);
    expect(t.env.disconnected).toBe(1);
    expect(t.lens.getState().destroyed).toBe(true);
  });

  it("ignores update, jump, and refit afterwards, and can be called twice", () => {
    const t = setup();
    t.lens.update();
    t.lens.destroy();
    const writes = t.env.writes.length;
    t.setBox({ x: 900, y: 4, w: 80, h: 40 });
    t.lens.update();
    t.lens.jump();
    t.lens.refit();
    t.lens.destroy();
    expect(t.env.writes.length).toBe(writes);
    expect(t.env.pending).toBe(0);
    expect(t.env.disconnected).toBe(1);
  });
});
