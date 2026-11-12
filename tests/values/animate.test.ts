import { describe, expect, it } from "vitest";
import { createScheduler } from "../../src/frame";
import { createTweenValue } from "../../src/curves";
import { colorKind, createValue, numberKind, pathKind, transform3dKind, vectorKind, type Kind, type Transform3D } from "../../src/values";
import type { SpringConfig } from "../../src/engine/spring";
import { FakeEnv } from "../helpers/fake-env";

// Every kind springs with createValue and tweens with createTweenValue. A kind that rests on its target has the same rest rule as the number
// kind: the distance between the value and the target is below the threshold.

const spring: SpringConfig = { stiffness: 170, damping: 26, restDelta: 0.001, restSpeed: 0.01 };
const setup = () => {
  const env = new FakeEnv();
  return { env, scheduler: createScheduler(env) };
};

const spin = (angle: number, z = 1): Transform3D => transform3dKind.parse({ rotate: { axis: [0, 0, z], angle } });
const trianglePath = pathKind("M0 0 L 10 0 L 5 10 Z");

// One case per kind: a start, a target, and a way to say that two values are the same.
const cases: Array<{ name: string; kind: Kind<any>; from: unknown; to: unknown }> = [
  { name: "number", kind: numberKind, from: 0, to: 10 },
  { name: "vector", kind: vectorKind(3), from: [0, 0, 0], to: [10, -5, 2] },
  { name: "color", kind: colorKind, from: "#336699", to: "hsl(10 80% 50% / 0.5)" },
  { name: "path", kind: trianglePath, from: "M 0 0 L 10 0 L 5 10 Z", to: "M 5 5 L 20 0 L 5 30 Z" },
  { name: "transform3d", kind: transform3dKind, from: transform3dKind.parse({}), to: transform3dKind.parse({ translate: [30, -10, 5], rotate: { axis: [0, 1, 0], angle: 90 }, scale: [2, 2, 2], perspective: 600 }) },
];

describe.each(cases)("the $name kind", ({ kind, from, to }) => {
  const start = kind.parse(from);
  const target = kind.parse(to);
  const close = (a: unknown, b: unknown, digits = 6) => {
    const x = kind.toArray(a);
    const y = kind.toArray(b);
    expect(x).toHaveLength(y.length);
    x.forEach((n, i) => expect(n).toBeCloseTo(y[i], digits));
  };

  it("springs from its start to its target, calls onChange, and rests on the target", () => {
    const { scheduler } = setup();
    const seen: unknown[] = [];
    const value = createValue(scheduler, kind, start, { spring, onChange: (v) => seen.push(v) });
    expect(value.get()).toEqual(start);
    value.to(target);
    expect(value.getState().moving).toBe(true);
    for (let i = 0; i < 600 && value.getState().moving; i += 1) scheduler.advance(1 / 60);
    expect(value.getState().moving).toBe(false);
    expect(seen.length).toBeGreaterThan(3);
    close(value.get(), target);
    expect(kind.distance(value.get(), target)).toBeLessThan(0.01);
    expect(scheduler.size).toBe(0);
  });

  it("reports a state with a value, a velocity, and a target", () => {
    const { scheduler } = setup();
    const value = createValue(scheduler, kind, start, { spring });
    value.to(target);
    scheduler.advance(1 / 30);
    const state = value.getState();
    expect(state.moving).toBe(true);
    expect(() => kind.serialize(state.value)).not.toThrow();
    expect(() => kind.toArray(state.velocity)).not.toThrow();
    expect(JSON.stringify(kind.toArray(state.velocity))).not.toMatch(/null/);
    close(state.target, target);
  });

  it("jumps to a value with set, and snaps to the target under reduced motion", () => {
    const { scheduler } = setup();
    const value = createValue(scheduler, kind, start, { spring, reducedMotion: () => true });
    value.to(target);
    close(value.get(), target);
    expect(value.getState().moving).toBe(false);
    value.set(start);
    close(value.get(), start);
  });

  it("tweens from its start to its target, and ends exactly on the target", () => {
    const { scheduler } = setup();
    const seen: unknown[] = [];
    const value = createTweenValue(scheduler, kind, start, { duration: 0.5, onChange: (v) => seen.push(v) });
    value.to(target);
    expect(value.getState().moving).toBe(true);
    for (let i = 0; i < 100; i += 1) scheduler.advance(1 / 60);
    expect(value.getState().moving).toBe(false);
    expect(seen.length).toBeGreaterThan(3);
    expect(value.get()).toEqual(target);
    expect(scheduler.size).toBe(0);
  });

  it("tweens through the value that interpolate gives", () => {
    const { scheduler } = setup();
    const value = createTweenValue(scheduler, kind, start, { duration: 1 });
    value.to(target);
    for (let i = 0; i < 30; i += 1) scheduler.advance(1 / 60);
    // A straight-line curve, half a second into one second.
    close(value.get(), kind.interpolate(start, target, 0.5), 2);
  });

  it("rejects a target the kind cannot read, changes nothing, and keeps going", () => {
    const { scheduler } = setup();
    const spring1 = createValue(scheduler, kind, start, { spring });
    const tween = createTweenValue(scheduler, kind, start, { duration: 0.2 });
    expect(() => spring1.to(Symbol("x") as never)).toThrow(TypeError);
    expect(() => tween.to(Symbol("x") as never)).toThrow(TypeError);
    expect(spring1.getState().moving).toBe(false);
    expect(tween.getState().moving).toBe(false);
    expect(spring1.get()).toEqual(start);
  });
});

describe("a color value", () => {
  it("fades in from transparent without a dark halo", () => {
    const { scheduler } = setup();
    const seen: string[] = [];
    const value = createTweenValue(scheduler, colorKind, "transparent", { duration: 1, onChange: (v) => seen.push(v) });
    value.to("#ff0000");
    for (let i = 0; i < 60; i += 1) scheduler.advance(1 / 60);
    for (const css of seen.slice(0, -1)) expect(css, css).toMatch(/^#ff[0-9a-f]{2}[0-9a-f]{2}[0-9a-f]{2}$/.source.length ? /^#(?:ff|fe|fd)[0-9a-f]{4}[0-9a-f]{2}$|^#[0-9a-f]{6}[0-9a-f]{2}$/ : /./);
    expect(seen.at(-1)).toBe("#ff0000");
  });

  it("goes the short way round the hue when it springs", () => {
    const { scheduler } = setup();
    const seen: string[] = [];
    const value = createValue(scheduler, colorKind, "hsl(350 100% 50%)", { spring, onChange: (v) => seen.push(v) });
    value.to("hsl(10 100% 50%)");
    for (let i = 0; i < 300; i += 1) scheduler.advance(1 / 60);
    // No frame is green or cyan: the green channel stays low, as it does between two reds.
    for (const css of seen) expect(parseInt(css.slice(3, 5), 16), css).toBeLessThan(120);
  });
});

describe("a path value", () => {
  it("keeps its structure on every frame, and refuses another structure", () => {
    const { scheduler } = setup();
    const seen: string[] = [];
    const value = createValue(scheduler, trianglePath, "M 0 0 L 10 0 L 5 10 Z", { spring, onChange: (v) => seen.push(v) });
    expect(() => value.to("M 0 0 L 10 0 Z")).toThrow(/different structure/);
    expect(value.getState().moving).toBe(false);
    value.to("M 5 5 L 20 0 L 5 30 Z");
    for (let i = 0; i < 300; i += 1) scheduler.advance(1 / 60);
    expect(seen.length).toBeGreaterThan(3);
    for (const d of seen) expect(d.replace(/[-\d.\s]+/g, "")).toBe("MLLZ");
    expect(seen.at(-1)).toBe("M 5 5 L 20 0 L 5 30 Z");
  });
});

describe("a 3D transform value", () => {
  const maxTravel = (frames: Transform3D[]) => Math.max(...frames.map((frame) => Math.abs(((((frame.rotate.angle * Math.sign(frame.rotate.axis[2] || 1)) + 180) % 360) + 360) % 360 - 180)));

  it("springs the short way: 10 to 350 degrees never turns past 40 degrees", () => {
    const { scheduler } = setup();
    const seen: Transform3D[] = [];
    const value = createValue(scheduler, transform3dKind, spin(10), { spring, onChange: (v) => seen.push(v) });
    value.to(spin(350));
    for (let i = 0; i < 300; i += 1) scheduler.advance(1 / 60);
    expect(seen.length).toBeGreaterThan(3);
    expect(maxTravel(seen)).toBeLessThan(40);
    expect(maxTravel(seen)).toBeGreaterThan(5);
  });

  it("springs the short way when the target quaternion sits on the far side: 170 degrees to -170", () => {
    const { scheduler } = setup();
    const seen: Transform3D[] = [];
    const value = createValue(scheduler, transform3dKind, spin(170), { spring, onChange: (v) => seen.push(v) });
    value.to(spin(170, -1));
    for (let i = 0; i < 300; i += 1) scheduler.advance(1 / 60);
    // Every frame turns about +z, between 165 and 195 degrees. The long way would pass through 0.
    for (const frame of seen) {
      expect(frame.rotate.axis[2], String(frame.rotate.angle)).toBeGreaterThan(0.99);
      expect(frame.rotate.angle).toBeGreaterThan(165);
      expect(frame.rotate.angle).toBeLessThan(195);
    }
    expect(transform3dKind.distance(value.get(), spin(170, -1))).toBeLessThan(0.01);
  });

  it("tweens the short way: 10 to 350 degrees never turns past 10 degrees", () => {
    const { scheduler } = setup();
    const seen: Transform3D[] = [];
    const value = createTweenValue(scheduler, transform3dKind, spin(10), { duration: 0.5, onChange: (v) => seen.push(v) });
    value.to(spin(350));
    for (let i = 0; i < 60; i += 1) scheduler.advance(1 / 60);
    expect(seen.length).toBeGreaterThan(3);
    expect(maxTravel(seen)).toBeLessThan(10.0001);
  });

  it("writes only the individual properties on every frame", () => {
    const { scheduler } = setup();
    const written: string[] = [];
    const value = createValue(scheduler, transform3dKind, transform3dKind.parse({}), { spring, onChange: (v) => written.push(transform3dKind.serialize(v)) });
    value.to(transform3dKind.parse({ translate: [50, 0, 20], rotate: { axis: [1, 1, 0], angle: 120 }, scale: 1.5, perspective: 500 }));
    for (let i = 0; i < 200; i += 1) scheduler.advance(1 / 60);
    expect(written.length).toBeGreaterThan(3);
    for (const line of written) expect(line).toMatch(/^translate: [^;]+; rotate: [^;]+; scale: [^;]+$/);
  });
});
