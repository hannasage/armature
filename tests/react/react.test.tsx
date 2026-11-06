import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGlassFilter } from "../../src/glass/filter";
import { LqgFilter, LqgProvider, MODE_ATTRIBUTE, useLqgLens, useLqgSurface } from "../../src/glass/react";
import { FakeRoot } from "../helpers/fake-dom";
import { FakeEnv } from "../helpers/fake-env";

// Vitest here is Node only, with no DOM, so React's own hook runtime cannot run effects. These stand-ins keep
// each hook's state in a table and collect its effects, and the tests run them by hand, as React would after
// a commit. They exercise the real hook bodies, not a copy.
const harness = vi.hoisted(() => ({
  cells: [] as unknown[],
  cursor: 0,
  effects: [] as Array<() => unknown>,
}));

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
    useEffect: (effect: () => unknown) => {
      harness.effects.push(effect);
    },
  };
});

const CHROME = { navigator: { userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" } };
const SAFARI = { navigator: { userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15" } };

/** Starts a render: a fresh state table. */
function begin() {
  harness.cells = [];
  harness.cursor = 0;
  harness.effects = [];
}

/** Starts another render of the same component: the state stays, the effects are collected again. */
function again() {
  harness.cursor = 0;
  harness.effects = [];
}

/** Runs the effects of the last render, and returns their cleanups. */
function commit() {
  return harness.effects.map((effect) => effect()).filter((cleanup): cleanup is () => void => typeof cleanup === "function");
}

beforeEach(begin);

describe("LqgProvider", () => {
  it("renders its children and nothing else, so server markup is unchanged", () => {
    const html = renderToStaticMarkup(
      <LqgProvider>
        <button data-lqg="">Go</button>
      </LqgProvider>,
    );
    expect(html).toBe('<button data-lqg="">Go</button>');
  });

  it("installs one delegated listener set on the root, and removes it on cleanup", () => {
    const root = new FakeRoot();
    const env = new FakeEnv();
    LqgProvider({ root, env, rootElement: {}, detection: CHROME });
    const cleanups = commit();
    expect(root.listenerCount).toBe(5);
    for (const cleanup of cleanups) cleanup();
    expect(root.listenerCount).toBe(0);
  });

  it("sets data-lqg-mode to refract on Chromium and blur on Safari, and clears it on cleanup", () => {
    for (const [detection, mode] of [[CHROME, "refract"], [SAFARI, "blur"]] as const) {
      begin();
      const rootElement = {};
      const env = new FakeEnv();
      LqgProvider({ root: new FakeRoot(), env, rootElement, detection });
      const cleanups = commit();
      expect(env.attrs.get(rootElement)?.[MODE_ATTRIBUTE]).toBe(mode);
      for (const cleanup of cleanups) cleanup();
      expect(env.attrs.get(rootElement)?.[MODE_ATTRIBUTE]).toBeUndefined();
    }
  });

  it("lets the refraction prop beat detection", () => {
    for (const [refraction, mode] of [["on", "refract"], ["off", "blur"]] as const) {
      begin();
      const rootElement = {};
      const env = new FakeEnv();
      LqgProvider({ root: new FakeRoot(), env, rootElement, detection: refraction === "on" ? SAFARI : CHROME, refraction });
      commit();
      expect(env.attrs.get(rootElement)?.[MODE_ATTRIBUTE]).toBe(mode);
    }
  });

  it("lets the data-lqg-refraction attribute on the root beat the browser", () => {
    const rootElement = {};
    const env = new FakeEnv();
    const detection = { ...SAFARI, root: { getAttribute: (name: string) => (name === "data-lqg-refraction" ? "on" : null) } };
    LqgProvider({ root: new FakeRoot(), env, rootElement, detection });
    commit();
    expect(env.attrs.get(rootElement)?.[MODE_ATTRIBUTE]).toBe("refract");
  });

  it("does nothing, and does not throw, where there is no document", () => {
    expect(typeof document).toBe("undefined");
    LqgProvider({});
    expect(() => commit()).not.toThrow();
  });

  it("delegates real pointer handling to elements with data-lqg", () => {
    const root = new FakeRoot();
    const env = new FakeEnv();
    LqgProvider({ root, env, rootElement: {}, detection: CHROME });
    commit();
    const button = { closest: (selector: string) => (selector === "[data-lqg]" ? button : null), getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 40 }), getAttribute: () => null };
    root.fire("pointerdown", button);
    env.settle();
    expect(env.read(button, "--lqg-press")).toBe("0.97");
  });
});

describe("useLqgSurface", () => {
  const rect = { left: 0, top: 0, width: 100, height: 40 };
  const element = () => Object.assign(new FakeRoot(), { getBoundingClientRect: () => rect });

  it("attaches to the element in the ref and returns a ref to the live surface", () => {
    const target = element();
    const ref = { current: target as unknown as HTMLElement };
    const surface = useLqgSurface(ref, { env: new FakeEnv() });
    expect(surface.current).toBeNull();
    const cleanups = commit();
    expect(target.listenerCount).toBe(5);
    expect(surface.current).not.toBeNull();
    for (const cleanup of cleanups) cleanup();
    expect(target.listenerCount).toBe(0);
    expect(surface.current).toBeNull();
  });

  it("does nothing while the ref is empty", () => {
    const ref = { current: null };
    useLqgSurface(ref, { env: new FakeEnv() });
    expect(commit()).toEqual([]);
  });

  it("reads its options once, from the first render", () => {
    const target = element();
    const env = new FakeEnv();
    const ref = { current: target as unknown as HTMLElement };
    useLqgSurface(ref, { env, pressScale: 0.9 });
    again();
    useLqgSurface(ref, { env, pressScale: 0.5 });
    commit();
    target.fire("pointerdown", target);
    env.settle();
    expect(env.read(target, "--lqg-press")).toBe("0.9");
  });
});

describe("useLqgLens", () => {
  const container = () => ({ id: "row" });

  it("returns a stable handle that does nothing before mount", () => {
    const ref = { current: container() as unknown as HTMLElement };
    const env = new FakeEnv();
    const handle = useLqgLens(ref, { measure: () => ({ x: 1, y: 1, w: 10, h: 10 }), env });
    expect(() => { handle.update(); handle.jump(); handle.refit(); }).not.toThrow();
    expect(env.writes).toHaveLength(0);
    again();
    expect(useLqgLens(ref, { measure: () => null, env })).toBe(handle);
  });

  it("creates the lens on mount, and the handle then drives it", () => {
    const target = container();
    const env = new FakeEnv();
    const ref = { current: target as unknown as HTMLElement };
    const handle = useLqgLens(ref, { measure: () => ({ x: 20, y: 2, w: 60, h: 30 }), env });
    commit();
    handle.update();
    expect(env.read(target, "--lqg-lens-x")).toBe("20px");
    expect(env.read(target, "--lqg-lens-w")).toBe("60px");
  });

  it("calls the newest measure function, so it can close over current props", () => {
    const target = container();
    const env = new FakeEnv();
    const ref = { current: target as unknown as HTMLElement };
    const handle = useLqgLens(ref, { measure: () => ({ x: 20, y: 2, w: 60, h: 30 }), env });
    commit();
    again();
    useLqgLens(ref, { measure: () => ({ x: 90, y: 2, w: 60, h: 30 }), env });
    commit();
    handle.update();
    expect(env.read(target, "--lqg-lens-x")).toBe("90px");
  });

  it("destroys the lens on cleanup and the handle goes quiet", () => {
    const target = container();
    const env = new FakeEnv();
    const ref = { current: target as unknown as HTMLElement };
    const handle = useLqgLens(ref, { measure: () => ({ x: 20, y: 2, w: 60, h: 30 }), env });
    const cleanups = commit();
    for (const cleanup of cleanups) cleanup();
    expect(env.disconnected).toBe(1);
    const writes = env.writes.length;
    handle.update();
    expect(env.writes.length).toBe(writes);
  });

  it("does nothing while the ref is empty", () => {
    useLqgLens({ current: null }, { measure: () => null, env: new FakeEnv() });
    expect(commit().filter((cleanup) => cleanup)).toEqual([]);
  });
});

describe("LqgFilter", () => {
  it("renders the filter's hidden svg, once, for server markup", () => {
    const filter = createGlassFilter({ width: 120, height: 48, radius: 24, id: "lqg-test" });
    const html = renderToStaticMarkup(<LqgFilter filter={filter} />);
    expect(html).toContain(filter.markup);
    expect(html.match(/<filter /g)).toHaveLength(1);
    expect(html).toContain('id="lqg-test"');
  });
});
