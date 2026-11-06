import { describe, expect, it } from "vitest";
import { createSurface } from "../../src/dom/surface";
import { validateFlavor, type Flavor } from "../../src/engine/flavor";
import { glassFlavor } from "../../src/glass/flavor";
import { FakeEnv } from "../helpers/fake-env";
import { acme } from "../helpers/other-flavor";

// The surface part has two optional switches, `specular` and `glow`. Both default to true. A flavor that sets one to false
// gets a surface that never writes that effect's variables and never asks for a frame because of it.

const box = (left: number) => ({ getBoundingClientRect: () => ({ left, top: 0, width: 100, height: 40 }) });
const withSurface = (patch: object): Flavor => ({ ...acme, surface: { ...acme.surface, ...patch } });
const names = (env: FakeEnv) => [...new Set(env.writes.map((write) => write.name))].sort();

/** The pointer enters and moves over the element, then the frames run until the motion settles. */
function hover(flavor: Flavor, neighbors: Array<ReturnType<typeof box>> = []) {
  const env = new FakeEnv();
  const element = box(0);
  const surface = createSurface(element, { env, flavor, neighbors });
  surface.move({ clientX: 80, clientY: 10, pointerType: "mouse" });
  const afterMove = env.requested;
  env.settle();
  return { env, element, surface, afterMove, neighbors };
}

describe("the default", () => {
  it("is on: a flavor with no switches behaves like one with both set to true", () => {
    const plain = hover(acme);
    const explicit = hover(withSurface({ specular: true, glow: true }));
    expect(plain.afterMove).toBeGreaterThan(0);
    const text = (env: FakeEnv) => env.writes.map((write) => `${write.name}=${write.value}`);
    expect(text(plain.env)).toEqual(text(explicit.env));
    expect(plain.env.requested).toBe(explicit.env.requested);
    expect(names(plain.env)).toEqual(["--acme-halo", "--acme-shine-x", "--acme-shine-y"]);
  });

  it("leaves the glass flavor as it was: a hover writes the glint and the glow and asks for frames", () => {
    expect(glassFlavor.surface?.specular).toBeUndefined();
    expect(glassFlavor.surface?.glow).toBeUndefined();
    const run = hover(glassFlavor);
    expect(names(run.env)).toEqual(["--lqg-glow", "--lqg-spec-x", "--lqg-spec-y"]);
    expect(run.afterMove).toBe(1);
    expect(run.env.requested).toBeGreaterThan(5);
  });
});

describe("both switches off", () => {
  const off = withSurface({ specular: false, glow: false });

  it("writes nothing on a hover and asks for no frame", () => {
    const run = hover(off);
    expect(run.afterMove).toBe(0);
    expect(run.env.requested).toBe(0);
    expect(run.env.writes).toEqual([]);
    expect(run.surface.getState()).toMatchObject({ hovered: true, moving: false });
  });

  it("writes only the press and flex variables on a press, and lights no neighbor", () => {
    const env = new FakeEnv();
    const neighbor = box(120);
    const surface = createSurface(box(0), { env, flavor: off, neighbors: [neighbor] });
    surface.move({ clientX: 10, clientY: 10, pointerType: "mouse" });
    surface.down({ clientX: 10, clientY: 10, isPrimary: true, button: 0 });
    env.settle();
    surface.up();
    env.settle();
    expect(names(env)).toEqual(["--acme-bend", "--acme-squeeze"]);
    expect(env.vars.has(neighbor)).toBe(false);
    expect(surface.getState()).toMatchObject({ scale: 1, pressed: false, moving: false });
  });

  it("still springs the press and release", () => {
    const env = new FakeEnv();
    const surface = createSurface(box(0), { env, flavor: off });
    surface.down({ clientX: 10, clientY: 10 });
    for (let i = 0; i < 40; i++) env.tick();
    expect(surface.getState().scale).toBeLessThan(0.95);
    surface.leave();
    env.settle();
    expect(surface.getState()).toMatchObject({ scale: 1, pressed: false });
  });

  it("asks for no frame when the pointer leaves, or when a neighbor is added while hovering", () => {
    const env = new FakeEnv();
    const surface = createSurface(box(0), { env, flavor: off });
    surface.move({ clientX: 10, clientY: 10, pointerType: "mouse" });
    surface.addNeighbor(box(120));
    surface.setNeighbors([box(120), box(240)]);
    surface.leave();
    expect(env.requested).toBe(0);
    expect(env.writes).toEqual([]);
  });
});

describe("one switch off", () => {
  it("specular off keeps the glow", () => {
    const run = hover(withSurface({ specular: false }));
    expect(names(run.env)).toEqual(["--acme-halo"]);
    expect(run.afterMove).toBe(1);
  });

  it("glow off keeps the glint, and a neighbor stays dark", () => {
    const neighbor = box(120);
    const run = hover(withSurface({ glow: false }), [neighbor]);
    expect(names(run.env)).toEqual(["--acme-shine-x", "--acme-shine-y"]);
    expect(run.env.vars.has(neighbor)).toBe(false);
  });
});

describe("validateFlavor and the switches", () => {
  it("accepts a flavor that turns either switch off", () => {
    expect(() => validateFlavor(withSurface({ specular: false, glow: false }))).not.toThrow();
    expect(() => validateFlavor(withSurface({ specular: true }))).not.toThrow();
  });

  it("rejects a switch that is not a boolean, and names the flavor and the switch", () => {
    expect(() => validateFlavor(withSurface({ specular: "no" }))).toThrow('The flavor "acme" has a surface switch "specular" that is not a boolean.');
    expect(() => validateFlavor(withSurface({ glow: 0 }))).toThrow(/surface switch "glow"/);
    expect(() => validateFlavor(withSurface({ glow: 0 }))).toThrow(TypeError);
  });
});
