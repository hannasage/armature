import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Flavor } from "../src/engine/flavor";
import { LqgProvider, MODE_ATTRIBUTE, useLqgLens, useLqgReveal, useLqgSurface } from "../src/react";
import { FakeRoot } from "./helpers/fake-dom";
import { FakeEnv } from "./helpers/fake-env";
import { acme } from "./helpers/other-flavor";
import { FakeElement, FakeRoot as FakeScrollRoot, FakeScrollEnv } from "./helpers/fake-scroll-env";

// Same stand-ins as react.test.tsx: Node has no DOM, so effects are collected and run by hand.
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
const CHROME = { navigator: { userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" } };

/** A button that carries the acme surface attribute, as `closest` sees it. */
const acmeButton = () => {
  const button = { closest: (selector: string) => (selector === "[data-acme]" ? button : null), getBoundingClientRect: () => rect, getAttribute: () => null };
  return button;
};

describe("LqgProvider with another flavor", () => {
  it("delegates the flavor's attribute and writes the flavor's variables", () => {
    const root = new FakeRoot();
    const env = new FakeEnv();
    LqgProvider({ root, env, rootElement: {}, detection: CHROME, flavor: acme });
    commit();
    const button = acmeButton();
    root.fire("pointerdown", button);
    env.settle();
    expect(env.read(button, "--acme-squeeze")).toBe("0.9");
    expect(env.writes.some((write) => write.name.includes("lqg"))).toBe(false);
  });

  it("ignores the glass attribute when it has another flavor", () => {
    const root = new FakeRoot();
    const env = new FakeEnv();
    LqgProvider({ root, env, rootElement: {}, detection: CHROME, flavor: acme });
    commit();
    const glassButton = { closest: (selector: string) => (selector === "[data-lqg]" ? glassButton : null), getBoundingClientRect: () => rect, getAttribute: () => null };
    root.fire("pointerdown", glassButton);
    expect(env.writes).toEqual([]);
  });

  it("reads the flavor once, from the first render", () => {
    const root = new FakeRoot();
    const env = new FakeEnv();
    LqgProvider({ root, env, rootElement: {}, detection: CHROME, flavor: acme });
    harness.cursor = 0;
    harness.effects = [];
    LqgProvider({ root, env, rootElement: {}, detection: CHROME });
    commit();
    const button = acmeButton();
    root.fire("pointerdown", button);
    env.settle();
    expect(env.read(button, "--acme-squeeze")).toBe("0.9");
  });

  it("still sets the glass mode attribute", () => {
    const rootElement = {};
    const env = new FakeEnv();
    LqgProvider({ root: new FakeRoot(), env, rootElement, detection: CHROME, flavor: acme });
    commit();
    expect(env.attrs.get(rootElement)?.[MODE_ATTRIBUTE]).toBe("refract");
  });

  it("logs a failed start with the flavor's label, and with the glass label without one", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = { addEventListener: () => { throw new Error("boom"); }, removeEventListener: () => undefined };
    LqgProvider({ root: broken, env: new FakeEnv(), rootElement: {}, detection: CHROME, flavor: acme });
    commit();
    harness.cells = [];
    harness.cursor = 0;
    harness.effects = [];
    LqgProvider({ root: broken, env: new FakeEnv(), rootElement: {}, detection: CHROME });
    commit();
    expect(spy.mock.calls.map((call) => call[0])).toEqual([
      "[acme-motion] glass delegation failed to start and was skipped.",
      "[liquid-glass] glass delegation failed to start and was skipped.",
    ]);
    spy.mockRestore();
  });
});

describe("the hooks with another flavor", () => {
  it("useLqgSurface passes the flavor to the surface", () => {
    const target = Object.assign(new FakeRoot(), { getBoundingClientRect: () => rect });
    const env = new FakeEnv();
    useLqgSurface({ current: target as unknown as HTMLElement }, { env, flavor: acme });
    commit();
    target.fire("pointerdown", target);
    env.settle();
    expect(env.read(target, "--acme-squeeze")).toBe("0.9");
  });

  it("useLqgLens passes the flavor to the lens", () => {
    const target = {};
    const env = new FakeEnv();
    const handle = useLqgLens({ current: target as unknown as HTMLElement }, { measure: () => ({ x: 20, y: 2, w: 60, h: 30 }), env, flavor: acme });
    commit();
    handle.update();
    expect(env.read(target, "--acme-bar-x")).toBe("20px");
    expect(env.attrs.get(target)).toEqual({ "data-acme-bar": "on" });
  });

  it("useLqgReveal passes the flavor to the reveal", () => {
    const env = new FakeScrollEnv();
    const host = Object.assign(new FakeScrollRoot(), { classList: { add: () => undefined, remove: () => undefined } });
    const card = new FakeElement({ "data-acme-enter": "float" }, { top: 1600, left: 0, width: 10, height: 10 });
    host.members.push(card);
    useLqgReveal({ current: host as unknown as HTMLElement }, { env, flavor: acme });
    commit();
    expect(env.style(card, "opacity")).toBe("0");
    expect(env.style(card, "translate")).toBe("0px 7px");
    expect(env.rootMargin).toBe("0px 0px -20% 0px");
  });
});

describe("the hooks with a flavor that lacks the part they need", () => {
  const bare: Flavor = { name: "bare", prefix: "zz", logLabel: "bare-lib", springs: {} };

  it("useLqgSurface logs with the flavor's label, skips the start, and does not throw", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const target = Object.assign(new FakeRoot(), { getBoundingClientRect: () => rect });
    const surface = useLqgSurface({ current: target as unknown as HTMLElement }, { env: new FakeEnv(), flavor: bare });
    let cleanups: Array<() => void> = [];
    expect(() => { cleanups = commit(); }).not.toThrow();
    expect(surface.current).toBeNull();
    expect(target.listenerCount).toBe(0);
    expect(spy.mock.calls[0]?.[0]).toBe("[bare-lib] glass surface failed to start and was skipped.");
    expect(() => cleanups.forEach((cleanup) => cleanup())).not.toThrow();
  });

  it("useLqgLens logs with the flavor's label, skips the start, and its handle does nothing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = new FakeEnv();
    const handle = useLqgLens({ current: {} as unknown as HTMLElement }, { measure: () => ({ x: 1, y: 1, w: 10, h: 10 }), env, flavor: bare });
    let cleanups: Array<() => void> = [];
    expect(() => { cleanups = commit(); }).not.toThrow();
    expect(() => { handle.update(); handle.jump(); handle.refit(); }).not.toThrow();
    expect(env.writes).toEqual([]);
    expect(spy.mock.calls[0]?.[0]).toBe("[bare-lib] glass lens failed to start and was skipped.");
    expect(() => cleanups.forEach((cleanup) => cleanup())).not.toThrow();
  });
});
