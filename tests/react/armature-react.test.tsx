import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArmatureProvider, ArmatureRevealProvider, useArmatureLens, useArmatureReveal, useArmatureSurface } from "../../src/react";
import { FakeRoot } from "../helpers/fake-dom";
import { FakeEnv } from "../helpers/fake-env";
import { acme } from "../helpers/other-flavor";
import { FakeElement, FakeRoot as FakeScrollRoot, FakeScrollEnv } from "../helpers/fake-scroll-env";

// The generic React layer takes a flavor and has no default. Node has no DOM, so effects are collected and run by hand,
// as the other React tests do.
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

const rect = { left: 0, top: 0, width: 100, height: 40 };

describe("ArmatureProvider", () => {
  it("renders its children and nothing else", () => {
    const html = renderToStaticMarkup(<ArmatureProvider flavor={acme}><button data-acme="">Go</button></ArmatureProvider>);
    expect(html).toBe('<button data-acme="">Go</button>');
  });

  it("delegates the flavor's attribute, writes the flavor's variables, and removes its listeners on cleanup", () => {
    const root = new FakeRoot();
    const env = new FakeEnv();
    ArmatureProvider({ root, env, flavor: acme });
    const cleanups = commit();
    expect(root.listenerCount).toBe(5);
    const button = { closest: (selector: string) => (selector === "[data-acme]" ? button : null), getBoundingClientRect: () => rect, getAttribute: () => null };
    root.fire("pointerdown", button);
    env.settle();
    expect(env.read(button, "--acme-squeeze")).toBe("0.9");
    expect(env.writes.some((write) => write.name.includes("lqg"))).toBe(false);
    for (const cleanup of cleanups) cleanup();
    expect(root.listenerCount).toBe(0);
  });

  it("sets no mode attribute: that belongs to the glass wrapper", () => {
    const env = new FakeEnv();
    ArmatureProvider({ root: new FakeRoot(), env, flavor: acme });
    commit();
    expect(env.attrs.size).toBe(0);
  });
});

describe("the generic hooks", () => {
  it("useArmatureSurface attaches a surface for the flavor", () => {
    const target = Object.assign(new FakeRoot(), { getBoundingClientRect: () => rect });
    const env = new FakeEnv();
    const surface = useArmatureSurface({ current: target as unknown as HTMLElement }, { env, flavor: acme });
    commit();
    expect(surface.current).not.toBeNull();
    target.fire("pointerdown", target);
    env.settle();
    expect(env.read(target, "--acme-squeeze")).toBe("0.9");
  });

  it("useArmatureLens drives a lens for the flavor", () => {
    const target = {};
    const env = new FakeEnv();
    const handle = useArmatureLens({ current: target as unknown as HTMLElement }, { measure: () => ({ x: 20, y: 2, w: 60, h: 30 }), env, flavor: acme });
    commit();
    handle.update();
    expect(env.read(target, "--acme-bar-x")).toBe("20px");
  });

  it("useArmatureReveal arms the reveal for the flavor", () => {
    const env = new FakeScrollEnv();
    const host = Object.assign(new FakeScrollRoot(), { classList: { add: () => undefined, remove: () => undefined } });
    const card = new FakeElement({ "data-acme-enter": "float" }, { top: 1600, left: 0, width: 10, height: 10 });
    host.members.push(card);
    useArmatureReveal({ current: host as unknown as HTMLElement }, { env, flavor: acme });
    commit();
    expect(env.style(card, "opacity")).toBe("0");
    expect(env.rootMargin).toBe("0px 0px -20% 0px");
  });

  it("ArmatureRevealProvider renders one div with its class and children", () => {
    const html = renderToStaticMarkup(<ArmatureRevealProvider flavor={acme} className="page"><p data-acme-enter="float">Hi</p></ArmatureRevealProvider>);
    expect(html).toBe('<div class="page"><p data-acme-enter="float">Hi</p></div>');
  });
});

describe("a call with no flavor", () => {
  const MISSING = /Expected a flavor object, got undefined/;

  it("useArmatureSurface logs the failure with the engine's own label and does not throw", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const target = Object.assign(new FakeRoot(), { getBoundingClientRect: () => rect });
    const surface = useArmatureSurface({ current: target as unknown as HTMLElement }, { env: new FakeEnv() } as never);
    expect(() => commit()).not.toThrow();
    expect(surface.current).toBeNull();
    expect(target.listenerCount).toBe(0);
    expect(spy.mock.calls[0]?.[0]).toBe("[armature] armature surface failed to start and was skipped.");
    expect(String(spy.mock.calls[0]?.[1])).toMatch(MISSING);
  });

  it("useArmatureSurface with no options object logs and skips, and does not throw", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const target = Object.assign(new FakeRoot(), { getBoundingClientRect: () => rect });
    const surface = (useArmatureSurface as (ref: unknown) => ReturnType<typeof useArmatureSurface>)({ current: target });
    expect(() => commit()).not.toThrow();
    expect(surface.current).toBeNull();
    expect(target.listenerCount).toBe(0);
    expect(spy.mock.calls[0]?.[0]).toBe("[armature] armature surface failed to start and was skipped.");
    expect(String(spy.mock.calls[0]?.[1])).toMatch(MISSING);
  });

  it("useArmatureLens with no options object logs and skips, and its handle does nothing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handle = (useArmatureLens as (ref: unknown) => ReturnType<typeof useArmatureLens>)({ current: {} });
    expect(() => commit()).not.toThrow();
    expect(() => { handle.update(); handle.jump(); handle.refit(); }).not.toThrow();
    expect(spy.mock.calls[0]?.[0]).toBe("[armature] armature lens failed to start and was skipped.");
    expect(String(spy.mock.calls[0]?.[1])).toMatch(MISSING);
  });

  it("useArmatureReveal with no options object logs and skips, and shows every element", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const host = Object.assign(new FakeScrollRoot(), { classList: { add: () => undefined, remove: () => undefined } });
    (useArmatureReveal as (ref: unknown) => void)({ current: host });
    expect(() => commit()).not.toThrow();
    expect(spy.mock.calls[0]?.[0]).toBe("[armature] scroll reveal failed to start; every element is shown instead.");
    // Node has no window, so the browser environment fails before the flavor is read. The error is still logged and not thrown.
    expect(spy.mock.calls[0]?.[1]).toBeInstanceOf(Error);
  });

  it("ArmatureProvider logs the failure and does not throw", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    ArmatureProvider({ root: new FakeRoot(), env: new FakeEnv() } as never);
    expect(() => commit()).not.toThrow();
    expect(spy.mock.calls[0]?.[0]).toBe("[armature] armature delegation failed to start and was skipped.");
    expect(String(spy.mock.calls[0]?.[1])).toMatch(MISSING);
  });
});
