import { describe, expect, it } from "vitest";
import { createFollower, createLens, createScrollReveal, createSurface } from "@hannasage/armature/dom";
import { criticalDamping, cssVar, dataAttr, requireFollower, requireSurface, springOf, validateFlavor } from "@hannasage/armature";
import { projection } from "../../examples/projection/flavor";
import { FakeEnv } from "../helpers/fake-env";
import { FakeRoot, FakeScrollEnv } from "../helpers/fake-scroll-env";

const box = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 40 }) };

describe("the package names in the examples", () => {
  it("resolve to the source entries and not to an old build", async () => {
    expect(createFollower).toBe((await import("../../src/dom/follower")).createFollower);
    expect(validateFlavor).toBe((await import("../../src/engine/flavor")).validateFlavor);
  });
});

describe("the Projection flavor", () => {
  it("holds together", () => {
    expect(() => validateFlavor(projection)).not.toThrow();
    expect(projection.prefix).toBe("pui");
    expect(projection.name).toBe("projection");
  });

  it("has the two Mechanical springs with Hanna's numbers", () => {
    expect(springOf(projection, "mechanical")).toMatchObject({ stiffness: 600, damping: 28, mass: 1 });
    expect(springOf(projection, "settle")).toMatchObject({ stiffness: 600, mass: 1 });
    expect(springOf(projection, "settle").damping).toBe(2 * Math.sqrt(600));
    expect(springOf(projection, "settle").damping).toBe(criticalDamping(600, 1));
    expect(Object.keys(projection.springs).sort()).toEqual(["mechanical", "settle"]);
  });

  it("has a surface, followers, and no lens and no reveal", () => {
    expect(projection.surface).toBeDefined();
    expect(projection.follower).toBeDefined();
    expect(projection.lens).toBeUndefined();
    expect(projection.reveal).toBeUndefined();
  });

  it("names the followers and gives each the right spring", () => {
    const key = (name: string) => requireFollower(projection, name).springKey;
    expect(key("thumb")).toBe("mechanical");
    expect(key("enter")).toBe("mechanical");
    expect(key("exit")).toBe("settle");
    expect(key("dialog")).toBe("settle");
    expect(Object.keys(projection.follower ?? {}).sort()).toEqual(["dialog", "enter", "exit", "thumb"]);
  });

  it("builds names that cannot meet a Projection UI token", () => {
    expect(cssVar(projection, "thumb")).toBe("--pui-thumb");
    expect(dataAttr(projection)).toBe("data-pui");
    expect(dataAttr(projection, "group")).toBe("data-pui-group");
  });
});

describe("the Projection surface (the Button press)", () => {
  const config = requireSurface(projection);

  it("presses with the Mechanical spring and releases with it", () => {
    expect(config.springKeys).toEqual({ press: "mechanical", release: "mechanical" });
  });

  it("turns the glass extras off as far as the engine allows", () => {
    expect(config.defaults.flex).toBe(0);
    expect(config.defaults.neighborShare).toBe(0);
    expect(config.hoverGlow).toBe(0);
  });

  it("scales on press, springs a little past 1 on release, and settles at 1", () => {
    const env = new FakeEnv();
    const surface = createSurface(box, { flavor: projection, env });
    surface.down({ clientX: 50, clientY: 20, isPrimary: true, button: 0 });
    let low = 1;
    for (let i = 0; i < 60; i++) {
      env.tick();
      low = Math.min(low, surface.getState().scale);
    }
    expect(low).toBeLessThan(config.defaults.pressScale);
    expect(low).toBeGreaterThan(config.defaults.pressScale - 0.01);
    surface.up();
    let high = 1;
    for (let i = 0; i < 120; i++) {
      env.tick();
      high = Math.max(high, surface.getState().scale);
    }
    expect(high).toBeGreaterThan(1);
    expect(high).toBeLessThan(1.01);
    expect(surface.getState()).toMatchObject({ scale: 1, pressed: false });
  });

  it("never squashes, never lights a neighbour, and writes only pui names", () => {
    const env = new FakeEnv();
    const neighbor = { getBoundingClientRect: () => ({ left: 120, top: 0, width: 100, height: 40 }) };
    const surface = createSurface(box, { flavor: projection, env, neighbors: [neighbor] });
    surface.down({ clientX: 50, clientY: 20 });
    env.settle();
    surface.up();
    env.settle();
    expect(env.writes.length).toBeGreaterThan(0);
    expect(env.writes.every((write) => write.name.startsWith("--pui-"))).toBe(true);
    expect(env.read(box, "--pui-flex")).toBe("0");
    expect(env.read(neighbor, "--pui-glow")).toBe("0");
  });

  it("does nothing under reduced motion", () => {
    const env = new FakeEnv();
    env.reduced = true;
    const surface = createSurface(box, { flavor: projection, env });
    surface.down({ clientX: 50, clientY: 20 });
    surface.up();
    expect(env.writes).toEqual([]);
    expect(env.pending).toBe(0);
  });
});

describe("the Projection followers", () => {
  const NAMES = ["thumb", "enter", "exit", "dialog"];
  const make = (name: string, reduced = false) => {
    const env = new FakeEnv();
    env.reduced = reduced;
    const element = {};
    return { env, element, follower: createFollower(element, { flavor: projection, name, env }) };
  };

  it("write one --pui variable each", () => {
    for (const name of NAMES) {
      const { env, element, follower } = make(name);
      follower.setTarget(1);
      env.settle();
      expect(env.read(element, `--pui-${name}`), name).toBe("1");
      expect(Object.keys(env.vars.get(element) ?? {}), name).toEqual([`--pui-${name}`]);
    }
  });

  it("let the thumb and the enter overshoot a little, and keep the exit and the dialog from bouncing", () => {
    const peak = (name: string) => {
      const { env, follower } = make(name);
      follower.setTarget(1);
      let high = 0;
      for (let i = 0; i < 200; i++) {
        env.tick();
        high = Math.max(high, follower.getState().value);
      }
      return high;
    };
    expect(peak("thumb")).toBeGreaterThan(1.05);
    expect(peak("enter")).toBeGreaterThan(1.05);
    expect(peak("exit")).toBeLessThan(1.005);
    expect(peak("dialog")).toBeLessThan(1.005);
  });

  it("turn the thumb in flight and keep its velocity", () => {
    const { env, follower } = make("thumb");
    follower.setTarget(1);
    for (let i = 0; i < 3; i++) env.tick();
    const before = follower.getState();
    follower.setTarget(0);
    const after = follower.getState();
    expect(after.value).toBe(before.value);
    expect(after.velocity).toBe(before.velocity);
    expect(before.velocity).toBeGreaterThan(0);
    env.settle();
    expect(follower.getState().value).toBe(0);
  });

  it("snap under reduced motion", () => {
    for (const name of NAMES) {
      const { env, element, follower } = make(name, true);
      follower.setTarget(1);
      expect(env.pending, name).toBe(0);
      expect(env.read(element, `--pui-${name}`), name).toBe("1");
      expect(follower.getState().moving, name).toBe(false);
    }
  });
});

describe("what the Projection flavor leaves out", () => {
  it("makes a lens and a scroll reveal fail with a clear error", () => {
    expect(() => createLens({ container: {}, measure: () => null, env: new FakeEnv(), flavor: projection })).toThrow('The flavor "projection" has no lens part.');
    expect(() => createScrollReveal({ root: new FakeRoot(), env: new FakeScrollEnv(), flavor: projection })).toThrow('The flavor "projection" has no reveal part.');
  });
});
