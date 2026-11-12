import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useArmatureFollower } from "../../src/react";
import type { Flavor } from "../../src/engine/flavor";
import { FakeEnv } from "../helpers/fake-env";
import { acme } from "../helpers/other-flavor";

// Amendment 2, item 1. Node has no DOM, so effects are collected and run by hand, as the other React tests do.
const harness = vi.hoisted(() => ({ cells: [] as unknown[], cursor: 0, effects: [] as Array<() => unknown> }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useRef: (initial: unknown) => {
      const index = harness.cursor++;
      return (harness.cells[index] ??= { current: initial });
    },
    useMemo: (factory: () => unknown) => {
      const index = harness.cursor++;
      return (harness.cells[index] ??= factory());
    },
    useEffect: (effect: () => unknown) => { harness.effects.push(effect); },
  };
});

beforeEach(() => { harness.cells = []; harness.cursor = 0; harness.effects = []; });
afterEach(() => vi.restoreAllMocks());
const commit = () => harness.effects.map((effect) => effect()).filter((cleanup): cleanup is () => void => typeof cleanup === "function");
const rerender = () => { harness.cursor = 0; harness.effects = []; };

const rest = { restDelta: 0.001, restSpeed: 0.01 };
const flavor: Flavor = {
  ...acme,
  springs: { ...acme.springs, mechanical: { stiffness: 400, damping: 12 }, settle: { stiffness: 120, damping: 26 } },
  followers: { thumb: { var: "thumb", springKey: "mechanical", rest } },
};

describe("useArmatureFollower", () => {
  it("does nothing until the element mounts, and shows the initial state", () => {
    const env = new FakeEnv();
    const handle = useArmatureFollower({ current: null }, { flavor, name: "thumb", initial: 0.25, env });
    expect(handle.getState()).toEqual({ destroyed: false, value: 0.25, velocity: 0, target: 0.25, moving: false });
    expect(() => handle.setTarget(1)).not.toThrow();
    expect(() => handle.snap(0)).not.toThrow();
    commit();
    expect(env.writes).toHaveLength(0);
  });

  it("creates a follower on mount and writes the initial value", () => {
    const env = new FakeEnv();
    const element = {};
    useArmatureFollower({ current: element as unknown as HTMLElement }, { flavor, name: "thumb", initial: 0.5, env });
    commit();
    expect(env.read(element, "--acme-thumb")).toBe("0.5");
  });

  it("moves the follower through the handle, with a spring for one move", () => {
    const env = new FakeEnv();
    const element = {};
    const thumb = useArmatureFollower({ current: element as unknown as HTMLElement }, { flavor, name: "thumb", initial: 0, env });
    commit();
    thumb.setTarget(1, { springKey: "settle" });
    expect(thumb.getState().moving).toBe(true);
    env.settle();
    expect(thumb.getState()).toMatchObject({ value: 1, target: 1, moving: false });
    expect(env.read(element, "--acme-thumb")).toBe("1");
    thumb.snap(0);
    expect(env.read(element, "--acme-thumb")).toBe("0");
  });

  it("has setTarget, snap, and getState, and no destroy", () => {
    const thumb = useArmatureFollower({ current: null }, { flavor, name: "thumb", env: new FakeEnv() });
    expect(Object.keys(thumb).sort()).toEqual(["getState", "setTarget", "snap"]);
    expect("destroy" in thumb).toBe(false);
  });

  it("stops its frame loop and ignores the handle after unmount", () => {
    const env = new FakeEnv();
    const element = {};
    const thumb = useArmatureFollower({ current: element as unknown as HTMLElement }, { flavor, name: "thumb", env });
    const cleanups = commit();
    thumb.setTarget(1);
    expect(env.pending).toBe(1);
    for (const cleanup of cleanups) cleanup();
    expect(env.pending).toBe(0);
    const writes = env.writes.length;
    thumb.setTarget(0);
    thumb.snap(2);
    expect(env.pending).toBe(0);
    expect(env.writes).toHaveLength(writes);
    expect(thumb.getState()).toMatchObject({ value: 0, target: 0, moving: false });
  });

  it("keeps one follower and one handle across renders with new options", () => {
    const env = new FakeEnv();
    const element = {};
    const ref = { current: element as unknown as HTMLElement };
    const first = useArmatureFollower(ref, { flavor, name: "thumb", initial: 0, env });
    commit();
    expect(env.writes).toHaveLength(1);
    rerender();
    const second = useArmatureFollower(ref, { flavor, name: "thumb", initial: 7, env });
    // React runs the first effect again on a render, to keep the latest options. The mount effect depends on the ref and does not run.
    harness.effects[0]();
    expect(second).toBe(first);
    expect(env.writes).toHaveLength(1);
    expect(env.vars.get(element)).toEqual({ "--acme-thumb": "0" });
  });

  it("logs one line and does not throw when the flavor has no follower part", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = new FakeEnv();
    const thumb = useArmatureFollower({ current: {} as unknown as HTMLElement }, { flavor: acme, name: "thumb", env });
    expect(() => commit()).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toContain("acme follower failed to start and was skipped.");
    expect(() => thumb.setTarget(1)).not.toThrow();
    expect(env.pending).toBe(0);
  });

  it("logs one line when a call has no flavor, and when it has no options at all", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    useArmatureFollower({ current: {} as unknown as HTMLElement }, { name: "thumb", env: new FakeEnv() } as never);
    expect(() => commit()).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
    harness.cells = [];
    harness.cursor = 0;
    harness.effects = [];
    const handle = useArmatureFollower({ current: {} as unknown as HTMLElement }, undefined as never);
    expect(() => commit()).not.toThrow();
    expect(handle.getState()).toMatchObject({ value: 0, target: 0 });
  });
});
