import { afterEach, describe, expect, it, vi } from "vitest";
import { drag, follow, layout, surface } from "../../src/svelte";
import type { Flavor } from "../../src/engine/flavor";
import { FakeEnv } from "../helpers/fake-env";
import { FakeLayoutEnv } from "../helpers/fake-layout-env";
import { FakePointerEnv } from "../helpers/fake-pointer-env";
import { lofty } from "../helpers/layout-flavor";
import { swipey } from "../helpers/gesture-flavor";
import { acme } from "../helpers/other-flavor";
import { FakeElement } from "../helpers/vue-host";

// A Svelte action is a function from a node and a parameter to an object with `destroy`. Svelte calls it when the node mounts, and calls
// `destroy` when the node leaves. These tests do the same calls by hand, with fake environments.

const follows: Flavor = { ...acme, followers: { thumb: { var: "thumb", springKey: "tap", rest: { restDelta: 0.001, restSpeed: 0.01 } } } };
const node = () => new FakeElement("div") as unknown as HTMLElement;

afterEach(() => vi.restoreAllMocks());

describe("surface", () => {
  it("attaches on mount and removes every listener on destroy", () => {
    const el = node() as unknown as FakeElement;
    const ready = vi.fn();
    const action = surface(el as unknown as HTMLElement, { flavor: acme, env: new FakeEnv(), onReady: ready });
    expect(el.listenerCount).toBeGreaterThan(0);
    const made = ready.mock.calls[0][0];
    expect(made.getState().destroyed).toBe(false);
    action.destroy();
    expect(el.listenerCount).toBe(0);
    expect(made.getState().destroyed).toBe(true);
    expect(ready).toHaveBeenLastCalledWith(null);
    expect(ready).toHaveBeenCalledTimes(2);
  });
});

describe("follow", () => {
  it("writes the initial value on mount, hands the follower to onReady, and destroys it on destroy", () => {
    const env = new FakeEnv();
    const el = node();
    const ready = vi.fn();
    const action = follow(el, { flavor: follows, name: "thumb", initial: 0.5, env, onReady: ready });
    expect(env.read(el, "--acme-thumb")).toBe("0.5");
    const follower = ready.mock.calls[0][0];
    follower.setTarget(1);
    env.settle();
    expect(env.read(el, "--acme-thumb")).toBe("1");
    follower.setTarget(0);
    expect(env.pending).toBe(1);
    action.destroy();
    expect(follower.getState().destroyed).toBe(true);
    expect(env.pending).toBe(0);
    expect(ready).toHaveBeenLastCalledWith(null);
  });

  it("does not pass its own options to the controller: onReady and onError are the adapter's", () => {
    const env = new FakeEnv();
    const ready = vi.fn();
    const action = follow(node(), { flavor: follows, name: "thumb", env, onReady: ready, onError: vi.fn() });
    expect(Object.keys(action)).toEqual(["destroy"]);
    action.destroy();
  });

  it("is safe to destroy twice", () => {
    const action = follow(node(), { flavor: follows, name: "thumb", env: new FakeEnv() });
    action.destroy();
    expect(() => action.destroy()).not.toThrow();
  });
});

describe("drag", () => {
  it("adds the pointer handlers on mount and removes them on destroy", () => {
    const env = new FakePointerEnv();
    const ready = vi.fn();
    const action = drag(node(), { flavor: swipey, axis: "x", env, onReady: ready });
    expect(env.added).toBe(1);
    action.destroy();
    expect(env.removed).toBe(1);
    expect(ready.mock.calls[0][0].getState().destroyed).toBe(true);
  });
});

describe("layout", () => {
  it("makes the layout on mount and destroys it on destroy", () => {
    const env = new FakeLayoutEnv();
    const ready = vi.fn();
    const action = layout(node(), { flavor: lofty, env, onReady: ready });
    const made = ready.mock.calls[0][0];
    expect(made.getState().destroyed).toBe(false);
    action.destroy();
    expect(made.getState().destroyed).toBe(true);
    expect(env.pending).toBe(0);
  });
});

describe("a failed start", () => {
  it("logs once with the label of the flavor, keeps the page up, and still returns a destroy", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ready = vi.fn();
    const action = follow(node(), { flavor: acme, name: "thumb", env: new FakeEnv(), onReady: ready });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain("[acme-motion]");
    expect(ready).not.toHaveBeenCalled();
    expect(() => action.destroy()).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("gives the error to onError, in place of the log line", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onError = vi.fn();
    follow(node(), { flavor: acme, name: "thumb", env: new FakeEnv(), onError });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(TypeError);
    expect(onError.mock.calls[0][1]).toContain("follower");
    expect(spy).not.toHaveBeenCalled();
  });

  it("treats a call with no parameter like a call with no flavor", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const action = surface(node(), undefined as never);
    expect(String(spy.mock.calls[0][0])).toContain("[armature]");
    expect(() => action.destroy()).not.toThrow();
  });

  it("logs an onReady that throws, once, and keeps the controller", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = new FakeEnv();
    const action = follow(node(), { flavor: follows, name: "thumb", env, onReady: () => { throw new Error("mine"); } });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain("onReady");
    action.destroy();
    expect(env.pending).toBe(0);
  });

  it("logs a destroy that throws, and does not let it reach Svelte", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ready = vi.fn();
    const action = layout(node(), { flavor: lofty, env: new FakeLayoutEnv(), onReady: ready });
    vi.spyOn(ready.mock.calls[0][0], "destroy").mockImplementation(() => {
      throw new Error("boom");
    });
    expect(() => action.destroy()).not.toThrow();
    expect(String(spy.mock.calls[0][0])).toContain("while stopping");
    expect(ready).toHaveBeenLastCalledWith(null);
  });
});
