import { describe, expect, it } from "vitest";
import { attachSurface, createSurface } from "../src/dom/surface";
import type { Flavor } from "../src/engine/flavor";
import { FakeEnv } from "./helpers/fake-env";
import { acme } from "./helpers/other-flavor";

const box = (left: number, top: number) => ({ getBoundingClientRect: () => ({ left, top, width: 100, height: 40 }) });
const press = { clientX: 50, clientY: 20, pointerType: "mouse", isPrimary: true, button: 0 };

/** A pointer that enters and moves over the element, with the frames run until the motion settles. */
function hover(options: Parameters<typeof createSurface>[1]) {
  const env = new FakeEnv();
  const element = box(0, 0);
  const surface = createSurface(element, { env, ...options });
  surface.move({ clientX: 100, clientY: 40, pointerType: "mouse" });
  env.settle();
  return { env, element, surface };
}

describe("a surface with another flavor", () => {
  it("writes the flavor's variables and no glass variable", () => {
    const env = new FakeEnv();
    const element = box(0, 0);
    const neighbor = box(200, 0);
    const surface = createSurface(element, { env, flavor: acme, neighbors: [neighbor] });
    surface.move({ clientX: 10, clientY: 10, pointerType: "mouse" });
    surface.down({ ...press });
    env.settle();
    surface.up();
    env.settle();
    const names = new Set(env.writes.map((write) => write.name));
    expect([...names].sort()).toEqual(["--acme-bend", "--acme-halo", "--acme-shine-x", "--acme-shine-y", "--acme-squeeze"]);
    expect(env.writes.some((write) => write.name.includes("lqg"))).toBe(false);
    expect(env.writes.some((write) => write.target === neighbor && write.name === "--acme-halo")).toBe(true);
  });

  it("reads the flavor's defaults: press scale, flex, hover glow, and the specular rest", () => {
    const env = new FakeEnv();
    const element = box(0, 0);
    const surface = createSurface(element, { env, flavor: acme });
    surface.down({ ...press });
    env.settle();
    expect(env.read(element, "--acme-squeeze")).toBe("0.9");
    expect(env.read(element, "--acme-bend")).toBe("0.025");
    surface.up();
    env.settle();
    expect(env.read(element, "--acme-squeeze")).toBe("1");

    const hovered = hover({ flavor: acme });
    expect(hovered.env.read(hovered.element, "--acme-halo")).toBe("0.3");
    hovered.surface.leave();
    hovered.env.settle();
    expect(hovered.env.read(hovered.element, "--acme-shine-x")).toBe("20%");
    expect(hovered.env.read(hovered.element, "--acme-shine-y")).toBe("80%");
    expect(hovered.env.read(hovered.element, "--acme-halo")).toBe("0");
  });

  it("lights a neighbour by the flavor's falloff and share", () => {
    const neighbor = box(100, 0);
    const { env } = hover({ flavor: acme, neighbors: [neighbor] });
    // The centres are 100 px apart. The level is the hover glow 0.3, the share 0.4, and the falloff 80 px.
    const expected = Number((0.3 * 0.4 * Math.exp(-100 / 80)).toFixed(3));
    expect(Number(env.read(neighbor, "--acme-halo"))).toBe(expected);
  });

  it("an option still beats the flavor's default", () => {
    const env = new FakeEnv();
    const element = box(0, 0);
    const surface = createSurface(element, { env, flavor: acme, pressScale: 0.5, flex: 1, specularRest: { x: 10, y: 10 } });
    surface.down({ ...press });
    env.settle();
    expect(env.read(element, "--acme-squeeze")).toBe("0.5");
    expect(env.read(element, "--acme-bend")).toBe("0.5");
  });

  it("uses the springs the flavor names, not the glass presets", () => {
    const rest = { restDelta: 0.001, restSpeed: 0.02 };
    const trace = (env: FakeEnv, element: object, name: string) => {
      const out: string[] = [];
      for (let i = 0; i < 40; i++) {
        env.tick();
        out.push(env.read(element, name) ?? "");
      }
      return out;
    };
    const flavorEnv = new FakeEnv();
    const flavorElement = box(0, 0);
    createSurface(flavorElement, { env: flavorEnv, flavor: acme, pressScale: 0.97, flex: 0.5 }).down({ ...press });
    const glassEnv = new FakeEnv();
    const glassElement = box(0, 0);
    createSurface(glassElement, { env: glassEnv, springs: { press: { ...acme.springs.tap, ...rest }, release: { ...acme.springs.letgo, ...rest } } }).down({ ...press });
    expect(trace(flavorEnv, flavorElement, "--acme-squeeze")).toEqual(trace(glassEnv, glassElement, "--lqg-press"));

    const plain = new FakeEnv();
    const plainElement = box(0, 0);
    createSurface(plainElement, { env: plain }).down({ ...press });
    expect(trace(plain, plainElement, "--lqg-press")).not.toEqual(trace(glassEnv, glassElement, "--lqg-press"));
  });

  it("uses the flavor's time constants: the glint follows faster with a smaller time constant", () => {
    const follow = (flavor?: Flavor) => {
      const env = new FakeEnv();
      const element = box(0, 0);
      const surface = createSurface(element, { env, ...(flavor ? { flavor } : {}), specularRest: { x: 0, y: 0 } });
      surface.move({ clientX: 100, clientY: 40, pointerType: "mouse" });
      env.tick(16);
      return Number.parseFloat(env.read(element, flavor ? "--acme-shine-x" : "--lqg-spec-x")!);
    };
    const quick = follow(acme);
    const slow = follow();
    expect(quick).toBeGreaterThan(slow);
    expect(quick).toBeCloseTo(100 * (1 - Math.exp(-16 / 45)), 0);
    expect(slow).toBeCloseTo(100 * (1 - Math.exp(-16 / 90)), 0);
  });

  it("clears a removed neighbour's glow under the flavor's name", () => {
    const neighbor = box(100, 0);
    const { env, surface } = hover({ flavor: acme, neighbors: [neighbor] });
    surface.removeNeighbor(neighbor);
    expect(env.read(neighbor, "--acme-halo")).toBe("0");
  });

  it("attachSurface takes the flavor too", () => {
    const env = new FakeEnv();
    const listeners = new Map<string, (event: unknown) => void>();
    const element = {
      ...box(0, 0),
      addEventListener: (type: string, listener: (event: unknown) => void) => { listeners.set(type, listener); },
      removeEventListener: () => undefined,
    };
    attachSurface(element, { env, flavor: acme });
    listeners.get("pointerdown")?.({ ...press });
    env.settle();
    expect(env.read(element, "--acme-squeeze")).toBe("0.9");
  });

  it("fails with a clear error when the flavor has no surface part", () => {
    const bare: Flavor = { name: "bare", prefix: "zz", logLabel: "bare", springs: {} };
    expect(() => createSurface(box(0, 0), { env: new FakeEnv(), flavor: bare })).toThrow('The flavor "bare" has no surface part.');
  });

  it("fails with a clear error when a named spring is missing", () => {
    const broken: Flavor = { ...acme, springs: {} };
    expect(() => createSurface(box(0, 0), { env: new FakeEnv(), flavor: broken })).toThrow('The flavor "acme" has no spring named "tap".');
  });

  it("still snaps to rest under reduced motion", () => {
    const env = new FakeEnv();
    const element = box(0, 0);
    const surface = createSurface(element, { env, flavor: acme });
    surface.down({ ...press });
    env.settle(1000 / 60, 3);
    env.reduced = true;
    surface.up();
    expect(env.read(element, "--acme-squeeze")).toBe("1");
    expect(env.read(element, "--acme-halo")).toBe("0");
  });
});
