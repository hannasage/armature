import { describe, expect, it } from "vitest";
import { attachSurface, type SurfaceOptions } from "../../src/dom/surface";
import { FakeEnv } from "../helpers/fake-env";

type Listener = (event: unknown) => void;

/** An element stand-in with a rectangle and a listener table. */
class FakeElement {
  listeners = new Map<string, Array<{ listener: Listener; options: unknown }>>();
  removed: Array<{ type: string; options: unknown }> = [];
  constructor(public rect = { left: 100, top: 50, width: 200, height: 100 }) {}
  addEventListener(type: string, listener: Listener, options?: unknown) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), { listener, options }]);
  }
  removeEventListener(type: string, listener: Listener, options?: unknown) {
    this.removed.push({ type, options });
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry.listener !== listener));
  }
  getBoundingClientRect() {
    return this.rect;
  }
  fire(type: string, event: Record<string, unknown> = {}) {
    for (const { listener } of this.listeners.get(type) ?? []) listener({ pointerType: "mouse", isPrimary: true, button: 0, pointerId: 1, clientX: 0, clientY: 0, ...event });
  }
  get listenerCount() {
    return [...this.listeners.values()].reduce((sum, entries) => sum + entries.length, 0);
  }
}

function setup(options: Partial<SurfaceOptions> = {}, rect?: FakeElement["rect"]) {
  const env = new FakeEnv();
  const element = new FakeElement(rect);
  const surface = attachSurface(element, { env, ...options });
  return { env, element, surface, v: (name: string, target: object = element) => env.read(target, name) };
}

const num = (value: string | undefined) => Number.parseFloat(value ?? "NaN");

describe("attachSurface frame timing", () => {
  it("measures each step from the previous frame time, even when now() runs ahead of the frame clock", () => {
    const run = (lag: number) => {
      const t = setup();
      t.element.fire("pointerdown");
      t.env.tick();
      t.env.lag = lag;
      for (let i = 0; i < 6; i += 1) t.env.tick();
      return t.surface.getState().scale;
    };
    expect(run(9)).toBeCloseTo(run(0), 8);
  });
});

describe("attachSurface press", () => {
  it("springs the scale down to 0.97 on pointerdown, with a small flex, and settles there", () => {
    const t = setup();
    t.element.fire("pointerdown");
    expect(t.env.pending).toBe(1);
    t.env.tick();
    expect(num(t.v("--lqg-press"))).toBeLessThan(1);
    t.env.settle();
    expect(num(t.v("--lqg-press"))).toBeCloseTo(0.97, 3);
    expect(t.surface.getState()).toMatchObject({ pressed: true, scale: expect.closeTo(0.97, 4) });
    expect(num(t.v("--lqg-flex"))).toBeCloseTo(0.015, 3);
    expect(t.env.pending).toBe(0);
  });

  it("does not bounce on the way down", () => {
    const t = setup();
    t.element.fire("pointerdown");
    let lowest = 1;
    while (t.env.pending > 0) { t.env.tick(); lowest = Math.min(lowest, t.surface.getState().scale); }
    expect(lowest).toBeGreaterThanOrEqual(0.97 - 0.0006);
  });

  it("springs back past 1 on release, then settles on exactly 1", () => {
    const t = setup();
    t.element.fire("pointerdown");
    t.env.settle();
    t.element.fire("pointerup");
    let peak = 0;
    let flexAtPeak = 0;
    while (t.env.pending > 0) {
      t.env.tick();
      const { scale } = t.surface.getState();
      if (scale > peak) { peak = scale; flexAtPeak = num(t.v("--lqg-flex")); }
    }
    expect(peak).toBeGreaterThan(1.002);
    expect(peak).toBeLessThan(1.03);
    expect(flexAtPeak).toBeLessThan(0);
    expect(t.v("--lqg-press")).toBe("1");
    expect(t.v("--lqg-flex")).toBe("0");
    expect(t.surface.getState().pressed).toBe(false);
  });

  it("releases on pointercancel and when the pointer leaves while pressed", () => {
    for (const type of ["pointercancel", "pointerleave"]) {
      const t = setup();
      t.element.fire("pointerdown");
      t.env.settle();
      t.element.fire(type);
      expect(t.surface.getState().pressed, type).toBe(false);
      t.env.settle();
      expect(t.v("--lqg-press"), type).toBe("1");
    }
  });

  it("keeps velocity when released mid-press", () => {
    const t = setup();
    t.element.fire("pointerdown");
    t.env.tick(); t.env.tick();
    const before = t.surface.getState();
    t.element.fire("pointerup");
    expect(t.surface.getState().scale).toBe(before.scale);
    expect(t.surface.getState().pressed).toBe(false);
    expect(t.env.pending).toBe(1);
  });

  it("ignores a secondary button and a non-primary pointer", () => {
    const t = setup();
    t.element.fire("pointerdown", { button: 2 });
    t.element.fire("pointerdown", { isPrimary: false });
    expect(t.surface.getState().pressed).toBe(false);
    expect(t.env.pending).toBe(0);
  });

  it("presses on touch too", () => {
    const t = setup();
    t.element.fire("pointerdown", { pointerType: "touch" });
    t.env.settle();
    expect(t.v("--lqg-press")).toBe("0.97");
  });

  it("takes a custom press scale and can turn the flex off", () => {
    const t = setup({ pressScale: 0.9, flex: 0 });
    t.element.fire("pointerdown");
    t.env.settle();
    expect(num(t.v("--lqg-press"))).toBeCloseTo(0.9, 3);
    expect(t.v("--lqg-flex")).toBe("0");
  });

  it("lands in nearly the same place at 30 and 144 frames per second", () => {
    const at = (ms: number) => {
      const t = setup();
      t.element.fire("pointerdown");
      for (let i = 0; i < Math.round(120 / ms); i += 1) t.env.tick(ms);
      return t.surface.getState().scale;
    };
    expect(Math.abs(at(1000 / 30) - at(1000 / 144))).toBeLessThan(0.004);
  });
});

describe("attachSurface specular", () => {
  it("follows the pointer as percentages of the element, and eases there", () => {
    const t = setup();
    // rect: left 100, top 50, 200 by 100. This point is 25 percent across and 80 percent down.
    t.element.fire("pointermove", { clientX: 150, clientY: 130 });
    expect(t.env.pending).toBe(1);
    t.env.tick();
    const first = num(t.v("--lqg-spec-x"));
    expect(first).toBeLessThan(50);
    expect(first).toBeGreaterThan(25);
    let previous = first;
    while (t.env.pending > 0) {
      t.env.tick();
      const now = num(t.v("--lqg-spec-x"));
      expect(now).toBeLessThanOrEqual(previous + 1e-9);
      previous = now;
    }
    expect(t.v("--lqg-spec-x")).toBe("25%");
    expect(t.v("--lqg-spec-y")).toBe("80%");
  });

  it("clamps to the element, so a pointer past the edge does not throw the glint away", () => {
    const t = setup();
    t.element.fire("pointermove", { clientX: 5000, clientY: -400 });
    t.env.settle();
    expect(t.v("--lqg-spec-x")).toBe("100%");
    expect(t.v("--lqg-spec-y")).toBe("0%");
  });

  it("eases back to the rest position when the pointer leaves", () => {
    const t = setup();
    t.element.fire("pointermove", { clientX: 150, clientY: 130 });
    t.env.settle();
    t.element.fire("pointerleave");
    t.env.settle();
    expect(t.v("--lqg-spec-x")).toBe("50%");
    expect(t.v("--lqg-spec-y")).toBe("0%");
  });

  it("does not track a touch pointer", () => {
    const t = setup();
    t.element.fire("pointermove", { pointerType: "touch", clientX: 150, clientY: 130 });
    expect(t.env.pending).toBe(0);
    expect(t.v("--lqg-spec-x")).toBeUndefined();
  });

  it("ignores an element with no size", () => {
    const t = setup({}, { left: 0, top: 0, width: 0, height: 0 });
    t.element.fire("pointermove", { clientX: 5, clientY: 5 });
    expect(t.env.pending).toBe(0);
  });

  it("writes nothing once everything is at rest", () => {
    const t = setup();
    t.element.fire("pointermove", { clientX: 150, clientY: 130 });
    t.env.settle();
    const writes = t.env.writes.length;
    t.env.tick(); t.env.tick();
    expect(t.env.writes.length).toBe(writes);
    expect(t.env.pending).toBe(0);
  });

  it("runs one frame loop however many events arrive", () => {
    const t = setup();
    for (let i = 0; i < 20; i += 1) t.element.fire("pointermove", { clientX: 100 + i * 5, clientY: 100 });
    t.element.fire("pointerdown");
    expect(t.env.pending).toBe(1);
    expect(t.env.requested).toBe(1);
  });
});

describe("attachSurface glow", () => {
  const neighbor = (left: number) => new FakeElement({ left, top: 50, width: 200, height: 100 });

  it("lights the element on hover, and its neighbours less the further away they are", () => {
    const near = neighbor(320);
    const mid = neighbor(520);
    const far = neighbor(5000);
    const t = setup({ neighbors: [near, mid, far] });
    t.element.fire("pointermove", { clientX: 150, clientY: 100 });
    t.env.settle();
    const own = num(t.v("--lqg-glow"));
    expect(own).toBeGreaterThan(0.3);
    const glowNear = num(t.v("--lqg-glow", near));
    const glowMid = num(t.v("--lqg-glow", mid));
    expect(glowNear).toBeGreaterThan(glowMid);
    expect(glowMid).toBeGreaterThan(0);
    expect(glowNear).toBeLessThan(own);
    expect(t.v("--lqg-glow", far)).toBe("0");
  });

  it("lights more on press than on hover", () => {
    const t = setup();
    t.element.fire("pointermove", { clientX: 150, clientY: 100 });
    t.env.settle();
    const hover = num(t.v("--lqg-glow"));
    t.element.fire("pointerdown", { clientX: 150, clientY: 100 });
    t.env.settle();
    expect(num(t.v("--lqg-glow"))).toBeGreaterThan(hover);
  });

  it("fades the element and every neighbour back to 0 when the pointer leaves", () => {
    const near = neighbor(320);
    const t = setup({ neighbors: [near] });
    t.element.fire("pointermove", { clientX: 150, clientY: 100 });
    t.env.settle();
    t.element.fire("pointerleave");
    t.env.settle();
    expect(t.v("--lqg-glow")).toBe("0");
    expect(t.v("--lqg-glow", near)).toBe("0");
  });

  it("gives a neighbour only its share of the glow, and clamps the share to 0 through 1", () => {
    const glowOf = (neighborShare?: number) => {
      const near = neighbor(320);
      const t = setup(neighborShare === undefined ? { neighbors: [near] } : { neighbors: [near], neighborShare });
      t.element.fire("pointermove", { clientX: 150, clientY: 100 });
      t.env.settle();
      return { own: num(t.v("--lqg-glow")), next: num(t.v("--lqg-glow", near)) };
    };
    const full = glowOf();
    expect(glowOf(0.5).next).toBeCloseTo(full.next * 0.5, 3);
    expect(glowOf(0.5).own).toBeCloseTo(full.own, 3);
    expect(glowOf(0).next).toBe(0);
    expect(glowOf(3).next).toBeCloseTo(full.next, 3);
    expect(glowOf(-1).next).toBe(0);
    expect(glowOf(Number.NaN).next).toBeCloseTo(full.next, 3);
  });

  it("registers and unregisters neighbours later, and resets a removed one", () => {
    const late = neighbor(320);
    const t = setup();
    t.surface.addNeighbor(late);
    t.element.fire("pointermove", { clientX: 150, clientY: 100 });
    t.env.settle();
    expect(num(t.v("--lqg-glow", late))).toBeGreaterThan(0);
    t.surface.removeNeighbor(late);
    expect(t.v("--lqg-glow", late)).toBe("0");
    const writes = t.env.writes.filter((write) => write.target === late).length;
    t.element.fire("pointermove", { clientX: 250, clientY: 100 });
    t.element.fire("pointerleave");
    t.env.settle();
    expect(t.env.writes.filter((write) => write.target === late).length).toBe(writes);
  });

  it("replaces the neighbour list, and resets the ones that left it", () => {
    const a = neighbor(320);
    const b = neighbor(520);
    const t = setup({ neighbors: [a] });
    t.element.fire("pointermove", { clientX: 150, clientY: 100 });
    t.env.settle();
    expect(num(t.v("--lqg-glow", a))).toBeGreaterThan(0);
    t.surface.setNeighbors([b, t.element]);
    expect(t.v("--lqg-glow", a)).toBe("0");
    t.env.settle();
    expect(num(t.v("--lqg-glow", b))).toBeGreaterThan(0);
  });

  it("does not light itself as its own neighbour", () => {
    const t = setup();
    t.surface.addNeighbor(t.element);
    t.element.fire("pointermove", { clientX: 150, clientY: 100 });
    t.env.settle();
    expect(num(t.v("--lqg-glow"))).toBeLessThan(0.7);
  });
});

describe("attachSurface reduced motion", () => {
  it("does nothing at all: no frame, no variable, no tracking", () => {
    const t = setup();
    t.env.reduced = true;
    t.element.fire("pointerdown", { clientX: 150, clientY: 100 });
    t.element.fire("pointermove", { clientX: 160, clientY: 100 });
    t.element.fire("pointerup");
    t.element.fire("pointerleave");
    expect(t.env.pending).toBe(0);
    expect(t.env.requested).toBe(0);
    expect(t.env.writes).toHaveLength(0);
    expect(t.surface.getState()).toMatchObject({ pressed: false, scale: 1 });
  });

  it("neither tracks the specular nor lights neighbours", () => {
    const near = new FakeElement();
    const t = setup({ neighbors: [near] });
    t.env.reduced = true;
    t.element.fire("pointermove", { clientX: 150, clientY: 100 });
    expect(t.v("--lqg-spec-x")).toBeUndefined();
    expect(t.v("--lqg-glow", near)).toBeUndefined();
  });

  it("snaps an animation in flight to rest when the setting turns on", () => {
    const t = setup();
    t.element.fire("pointerdown");
    t.env.tick(); t.env.tick();
    expect(t.surface.getState().scale).toBeLessThan(1);
    t.env.reduced = true;
    t.element.fire("pointermove", { clientX: 150, clientY: 100 });
    expect(t.env.pending).toBe(0);
    expect(t.surface.getState()).toMatchObject({ scale: 1, pressed: false });
    expect(t.v("--lqg-press")).toBe("1");
    expect(t.v("--lqg-flex")).toBe("0");
  });
});

describe("attachSurface destroy", () => {
  it("removes every listener it added, with the same options, and cancels the frame", () => {
    const t = setup();
    const types = [...t.element.listeners.keys()].sort();
    expect(types).toEqual(["pointercancel", "pointerdown", "pointerleave", "pointermove", "pointerup"]);
    t.element.fire("pointerdown");
    expect(t.env.pending).toBe(1);
    t.surface.destroy();
    expect(t.element.listenerCount).toBe(0);
    expect(t.env.pending).toBe(0);
    expect(t.element.removed).toHaveLength(5);
    for (const { options } of t.element.removed) expect(options).toEqual({ passive: true });
  });

  it("adds its listeners as passive", () => {
    const t = setup();
    for (const entries of t.element.listeners.values()) for (const { options } of entries) expect(options).toEqual({ passive: true });
  });

  it("is safe to call twice, and later neighbour calls do nothing", () => {
    const t = setup();
    t.surface.destroy();
    expect(() => { t.surface.destroy(); t.surface.addNeighbor(new FakeElement()); t.surface.removeNeighbor(new FakeElement()); }).not.toThrow();
    expect(t.surface.getState().destroyed).toBe(true);
  });

  it("leaves the element at rest values so a removed surface is not stuck pressed", () => {
    const t = setup();
    t.element.fire("pointerdown");
    t.env.settle();
    t.surface.destroy();
    expect(t.v("--lqg-press")).toBe("1");
    expect(t.v("--lqg-flex")).toBe("0");
    expect(t.v("--lqg-glow")).toBe("0");
  });
});
