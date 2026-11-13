import { afterEach, describe, expect, it, vi } from "vitest";
import { useArmatureDrag, useArmatureFollower, useArmatureLayout, useArmatureSurface } from "../../src/vue";
import type { Flavor } from "../../src/engine/flavor";
import { FakeEnv } from "../helpers/fake-env";
import { FakeLayoutEnv } from "../helpers/fake-layout-env";
import { FakePointerEnv } from "../helpers/fake-pointer-env";
import { lofty } from "../helpers/layout-flavor";
import { acme } from "../helpers/other-flavor";
import { swipey } from "../helpers/gesture-flavor";
import { mountWith, type FakeElement } from "../helpers/vue-host";

// The Vue composables are thin. Each one makes its controller when the component mounts, and destroys it when the component unmounts.
// These tests mount a real Vue component with Vue's own renderer, so the hooks Vue runs are the hooks a page runs.

const rest = { restDelta: 0.001, restSpeed: 0.01 };
const follows: Flavor = { ...acme, followers: { thumb: { var: "thumb", springKey: "tap", rest } } };

afterEach(() => vi.restoreAllMocks());

describe("useArmatureSurface", () => {
  it("attaches the surface when the component mounts, and removes every listener when it unmounts", () => {
    const env = new FakeEnv();
    let handle!: ReturnType<typeof useArmatureSurface>;
    const mounted = mountWith((el) => void (handle = useArmatureSurface(el, { flavor: acme, env })));
    const element = mounted.element() as FakeElement;
    expect(element.listenerCount).toBeGreaterThan(0);
    const surface = handle.controller.value!;
    expect(surface.getState().destroyed).toBe(false);
    mounted.unmount();
    expect(element.listenerCount).toBe(0);
    expect(surface.getState().destroyed).toBe(true);
    expect(handle.controller.value).toBeNull();
  });

  it("does nothing before the component mounts", () => {
    const env = new FakeEnv();
    let handle!: ReturnType<typeof useArmatureSurface>;
    mountWith((el) => {
      handle = useArmatureSurface(el, { flavor: acme, env });
      expect(handle.controller.value).toBeNull();
    });
    expect(handle.failed.value).toBeUndefined();
  });
});

describe("useArmatureFollower", () => {
  it("makes the follower on mount, writes the initial value, and moves with the controller", () => {
    const env = new FakeEnv();
    let handle!: ReturnType<typeof useArmatureFollower>;
    const mounted = mountWith((el) => void (handle = useArmatureFollower(el, { flavor: follows, name: "thumb", initial: 0.5, env })));
    const element = mounted.element();
    expect(env.read(element as object, "--acme-thumb")).toBe("0.5");
    handle.controller.value!.setTarget(1);
    env.settle();
    expect(env.read(element as object, "--acme-thumb")).toBe("1");
    mounted.unmount();
  });

  it("destroys the follower on unmount, stops its frame loop, and ignores later calls", () => {
    const env = new FakeEnv();
    let handle!: ReturnType<typeof useArmatureFollower>;
    const mounted = mountWith((el) => void (handle = useArmatureFollower(el, { flavor: follows, name: "thumb", env })));
    const follower = handle.controller.value!;
    follower.setTarget(1);
    expect(env.pending).toBe(1);
    mounted.unmount();
    expect(follower.getState().destroyed).toBe(true);
    expect(env.pending).toBe(0);
    const writes = env.writes.length;
    follower.setTarget(5);
    env.settle();
    expect(env.writes.length).toBe(writes);
    expect(handle.controller.value).toBeNull();
  });

  it("makes a new follower for a new mount, and leaves no frame behind after either unmount", () => {
    const env = new FakeEnv();
    for (let i = 0; i < 2; i += 1) {
      const mounted = mountWith((el) => void useArmatureFollower(el, { flavor: follows, name: "thumb", env }));
      mounted.unmount();
    }
    expect(env.pending).toBe(0);
  });
});

describe("useArmatureDrag", () => {
  it("adds the pointer handlers on mount and removes them on unmount", () => {
    const env = new FakePointerEnv();
    let handle!: ReturnType<typeof useArmatureDrag>;
    const mounted = mountWith((el) => void (handle = useArmatureDrag(el, { flavor: swipey, axis: "x", env })));
    expect(env.added).toBe(1);
    expect(env.removed).toBe(0);
    const drag = handle.controller.value!;
    mounted.unmount();
    expect(env.removed).toBe(1);
    expect(drag.getState().destroyed).toBe(true);
  });
});

describe("useArmatureLayout", () => {
  it("makes the layout on mount and destroys it on unmount", () => {
    const env = new FakeLayoutEnv();
    let handle!: ReturnType<typeof useArmatureLayout>;
    const mounted = mountWith((el) => void (handle = useArmatureLayout(el, { flavor: lofty, env })));
    const layout = handle.controller.value!;
    expect(layout.getState().destroyed).toBe(false);
    mounted.unmount();
    expect(layout.getState().destroyed).toBe(true);
    expect(handle.controller.value).toBeNull();
    expect(env.pending).toBe(0);
  });
});

describe("a failed start", () => {
  it("logs once, keeps the page up, and shows the error in `failed`", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let handle!: ReturnType<typeof useArmatureFollower>;
    const mounted = mountWith((el) => void (handle = useArmatureFollower(el, { flavor: acme, name: "thumb", env: new FakeEnv() })));
    expect(handle.controller.value).toBeNull();
    expect(handle.failed.value).toBeInstanceOf(TypeError);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain("[acme-motion]");
    expect(() => mounted.unmount()).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("treats a call with no options like a call with no flavor", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let handle!: ReturnType<typeof useArmatureSurface>;
    const mounted = mountWith((el) => void (handle = useArmatureSurface(el, undefined as never)));
    expect(handle.failed.value).toBeInstanceOf(Error);
    expect(String(spy.mock.calls[0][0])).toContain("[armature]");
    mounted.unmount();
  });

  it("logs a destroy that throws, and does not let it reach Vue", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = new FakeLayoutEnv();
    let handle!: ReturnType<typeof useArmatureLayout>;
    const mounted = mountWith((el) => void (handle = useArmatureLayout(el, { flavor: lofty, env })));
    const layout = handle.controller.value!;
    vi.spyOn(layout, "destroy").mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => mounted.unmount()).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain("while stopping");
  });

  it("makes no controller, logs nothing, and does not fail when the ref has no element", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let handle!: ReturnType<typeof useArmatureFollower>;
    const mounted = mountWith((el) => void (handle = useArmatureFollower(el, { flavor: follows, name: "thumb", env: new FakeEnv() })), { withRef: false });
    expect(handle.controller.value).toBeNull();
    expect(handle.failed.value).toBeUndefined();
    mounted.unmount();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("the handle", () => {
  it("is read-only state: a controller and a failed value, and nothing that holds motion", () => {
    let handle!: ReturnType<typeof useArmatureFollower>;
    const mounted = mountWith((el) => void (handle = useArmatureFollower(el, { flavor: follows, name: "thumb", env: new FakeEnv() })));
    expect(Object.keys(handle).sort()).toEqual(["controller", "failed"]);
    mounted.unmount();
  });
});
