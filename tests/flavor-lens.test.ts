import { describe, expect, it } from "vitest";
import { createLens, type LensBox } from "../src/dom/lens";
import type { Flavor } from "../src/engine/flavor";
import { FakeEnv } from "./helpers/fake-env";
import { acme } from "./helpers/other-flavor";

function make(flavor?: Flavor, extra: Partial<Parameters<typeof createLens>[0]> = {}) {
  const env = new FakeEnv();
  const container = {};
  let box: LensBox | null = { x: 10, y: 4, w: 80, h: 32 };
  const lens = createLens({ container, env, measure: () => box, ...(flavor ? { flavor } : {}), ...extra });
  return { env, container, lens, move: (next: LensBox | null) => { box = next; } };
}

/** The largest stretch the lens shows while it travels 10 px to 400 px. */
function peakStretch(flavor?: Flavor, extra: Partial<Parameters<typeof createLens>[0]> = {}) {
  const { env, lens, move } = make(flavor, extra);
  lens.update();
  move({ x: 400, y: 4, w: 80, h: 32 });
  lens.update();
  let peak = 1;
  for (let i = 0; i < 120; i++) {
    env.tick();
    peak = Math.max(peak, lens.getState().sx);
  }
  return peak;
}

describe("a lens with another flavor", () => {
  it("writes the flavor's variables and attribute and no glass name", () => {
    const { env, container, lens, move } = make(acme);
    lens.update();
    expect(env.vars.get(container)).toEqual({
      "--acme-bar-x": "10px", "--acme-bar-y": "4px", "--acme-bar-w": "80px", "--acme-bar-h": "32px", "--acme-bar-sx": "1", "--acme-bar-sy": "1",
    });
    expect(env.attrs.get(container)).toEqual({ "data-acme-bar": "on" });
    move({ x: 200, y: 4, w: 100, h: 32 });
    lens.update();
    env.settle();
    expect(env.writes.some((write) => write.name.includes("lqg"))).toBe(false);
    expect(env.read(container, "--acme-bar-x")).toBe("200px");
    move(null);
    lens.update();
    expect(env.attrs.get(container)).toEqual({});
  });

  it("uses the flavor's springs: the travel differs from the glass travel", () => {
    const frames = (flavor?: Flavor) => {
      const { env, container, lens, move } = make(flavor);
      lens.update();
      move({ x: 300, y: 4, w: 80, h: 32 });
      lens.update();
      const name = flavor ? "--acme-bar-x" : "--lqg-lens-x";
      const out: string[] = [];
      for (let i = 0; i < 20; i++) {
        env.tick();
        out.push(env.read(container, name) ?? "");
      }
      return out;
    };
    expect(frames(acme)).not.toEqual(frames());
    // The flavor's springs are slideX (260, 24) and slideW (220, 14). Passing them to a glass lens, with the flavor's pixel rest, gives the same x.
    const rest = { restDelta: 0.1, restSpeed: 2 };
    const glassWithAcmeSprings = (() => {
      const { env, container, lens, move } = make(undefined, { springs: { x: { ...acme.springs.slideX, ...rest }, width: { ...acme.springs.slideW, ...rest } } });
      lens.update();
      move({ x: 300, y: 4, w: 80, h: 32 });
      lens.update();
      const out: string[] = [];
      for (let i = 0; i < 20; i++) {
        env.tick();
        out.push(env.read(container, "--lqg-lens-x") ?? "");
      }
      return out;
    })();
    expect(frames(acme)).toEqual(glassWithAcmeSprings);
  });

  it("uses the flavor's stretch cap and speed", () => {
    expect(peakStretch()).toBeLessThanOrEqual(1.12 + 1e-12);
    const stretched = peakStretch(acme);
    expect(stretched).toBeGreaterThan(1.12);
    expect(stretched).toBeLessThanOrEqual(1.3 + 1e-12);
  });

  it("an option still beats the flavor's stretch numbers", () => {
    expect(peakStretch(acme, { maxStretch: 0 })).toBe(1);
  });

  it("fails with a clear error when the flavor has no lens part", () => {
    const bare: Flavor = { name: "bare", prefix: "zz", logLabel: "bare", springs: {} };
    expect(() => createLens({ container: {}, env: new FakeEnv(), measure: () => null, flavor: bare })).toThrow('The flavor "bare" has no lens part.');
  });

  it("fails with a clear error when a named spring is missing", () => {
    const { slideX: _removed, ...springs } = acme.springs;
    void _removed;
    const broken: Flavor = { ...acme, springs: { ...springs, tap: acme.springs.tap, letgo: acme.springs.letgo } };
    expect(() => createLens({ container: {}, env: new FakeEnv(), measure: () => null, flavor: broken })).toThrow('The flavor "acme" has no spring named "slideX".');
  });
});
