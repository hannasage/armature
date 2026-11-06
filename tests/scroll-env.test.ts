import { describe, expect, it, vi } from "vitest";
import { createBrowserScrollEnvironment } from "../src/core/scroll-env";

/** A window with only what the adapter reads. The decisions live in the controllers and are tested there. */
function fakeWindow(options: { reduced?: boolean; observer?: boolean; hidden?: boolean } = {}) {
  const mediaListeners: Array<(event: { matches: boolean }) => void> = [];
  const documentListeners: Array<() => void> = [];
  const windowListeners: Array<{ name: string; handler: () => void; options: unknown }> = [];
  const intersections: Array<{ callback: (entries: unknown[]) => void; init: unknown }> = [];
  const mutations: Array<{ callback: (records: unknown[]) => void; options: unknown; disconnected: boolean }> = [];
  const rootListeners: Array<{ name: string; handler: (event: { target: unknown }) => void }> = [];
  const document = {
    visibilityState: options.hidden ? "hidden" : "visible",
    addEventListener: (_name: string, handler: () => void) => documentListeners.push(handler),
    removeEventListener: (_name: string, handler: () => void) => { documentListeners.splice(documentListeners.indexOf(handler), 1); },
  };
  const frames: Array<(time: number) => void> = [];
  const win = {
    innerHeight: 777,
    scrollY: 123,
    document,
    performance: { now: () => 4242 },
    requestAnimationFrame: (callback: (time: number) => void) => frames.push(callback),
    cancelAnimationFrame: vi.fn(),
    addEventListener: (name: string, handler: () => void, init: unknown) => windowListeners.push({ name, handler, options: init }),
    removeEventListener: (name: string, handler: () => void) => { const at = windowListeners.findIndex(item => item.name === name && item.handler === handler); if (at >= 0) windowListeners.splice(at, 1); },
    matchMedia: vi.fn((query: string) => ({
      matches: Boolean(options.reduced) && query === "(prefers-reduced-motion: reduce)",
      addEventListener: (_name: string, handler: (event: { matches: boolean }) => void) => mediaListeners.push(handler),
      removeEventListener: (_name: string, handler: (event: { matches: boolean }) => void) => { mediaListeners.splice(mediaListeners.indexOf(handler), 1); },
    })),
    IntersectionObserver: options.observer === false ? undefined : class { constructor(callback: (entries: unknown[]) => void, init: unknown) { intersections.push({ callback, init }); } },
    MutationObserver: class {
      record: (typeof mutations)[number];
      constructor(callback: (records: unknown[]) => void) { this.record = { callback, options: undefined, disconnected: false }; mutations.push(this.record); }
      observe(_root: unknown, init: unknown) { this.record.options = init; }
      disconnect() { this.record.disconnected = true; }
    },
    Element: class { constructor(readonly focusVisible = true) {} matches(selector: string) { if (selector !== ":focus-visible") throw new Error("unsupported"); return this.focusVisible; } },
    setTimeout: (run: () => void, ms: number) => { void run; void ms; return 7; },
    clearTimeout: vi.fn(),
  };
  return { win: win as unknown as Window & typeof globalThis, raw: win, mediaListeners, documentListeners, windowListeners, intersections, mutations, rootListeners, frames, Element: win.Element };
}

describe("createBrowserScrollEnvironment", () => {
  it("reads the scroll position, the viewport height, the clock, and the tab state", () => {
    const env = createBrowserScrollEnvironment(fakeWindow().win);
    expect(env.scrollY()).toBe(123);
    expect(env.viewportHeight()).toBe(777);
    expect(env.now()).toBe(4242);
    expect(env.tabHidden()).toBe(false);
    expect(createBrowserScrollEnvironment(fakeWindow({ hidden: true }).win).tabHidden()).toBe(true);
    expect(env.matchMedia?.("(prefers-reduced-motion: reduce)").matches).toBe(false);
    expect(createBrowserScrollEnvironment(fakeWindow({ reduced: true }).win).matchMedia?.("(prefers-reduced-motion: reduce)").matches).toBe(true);
  });

  it("throws when the browser has no matchMedia, so a guard can show everything", () => {
    const f = fakeWindow();
    delete (f.raw as { matchMedia?: unknown }).matchMedia;
    expect(() => createBrowserScrollEnvironment(f.win)).toThrow();
  });

  it("offers no IntersectionObserver when the browser has none", () => {
    expect(createBrowserScrollEnvironment(fakeWindow({ observer: false }).win).createIntersectionObserver).toBeUndefined();
  });

  it("listens to window scroll with a passive listener and removes it", () => {
    const f = fakeWindow();
    const heard = vi.fn();
    const off = createBrowserScrollEnvironment(f.win).onScroll(heard);
    expect(f.windowListeners).toHaveLength(1);
    expect(f.windowListeners[0].name).toBe("scroll");
    expect(f.windowListeners[0].options).toEqual({ passive: true });
    f.windowListeners[0].handler();
    expect(heard).toHaveBeenCalledTimes(1);
    off();
    expect(f.windowListeners).toHaveLength(0);
  });

  it("makes one IntersectionObserver with the bottom margin and a zero threshold", () => {
    const f = fakeWindow();
    const deliver = vi.fn();
    createBrowserScrollEnvironment(f.win).createIntersectionObserver!(deliver, "0px 0px -8% 0px");
    expect(f.intersections).toHaveLength(1);
    expect(f.intersections[0].init).toEqual({ rootMargin: "0px 0px -8% 0px", threshold: 0 });
    f.intersections[0].callback([{ marker: 1 }]);
    expect(deliver).toHaveBeenCalledWith([{ marker: 1 }]);
  });

  it("watches the root for added nodes only, and ignores removals", () => {
    const f = fakeWindow();
    const onChange = vi.fn();
    const watcher = createBrowserScrollEnvironment(f.win).watch!({} as never, onChange);
    expect(f.mutations[0].options).toEqual({ childList: true, subtree: true });
    f.mutations[0].callback([{ addedNodes: { length: 0 } }]);
    expect(onChange).not.toHaveBeenCalled();
    f.mutations[0].callback([{ addedNodes: { length: 0 } }, { addedNodes: { length: 2 } }]);
    expect(onChange).toHaveBeenCalledTimes(1);
    watcher.disconnect();
    expect(f.mutations[0].disconnected).toBe(true);
  });

  it("reports tab visibility and reduced motion changes, and removes its listeners", () => {
    const f = fakeWindow();
    const env = createBrowserScrollEnvironment(f.win);
    const visibility = vi.fn();
    const reduced = vi.fn();
    const offVisibility = env.onVisibilityChange(visibility);
    const offReduced = env.onReducedMotionChange!(reduced);
    (f.win.document as unknown as { visibilityState: string }).visibilityState = "hidden";
    f.documentListeners[0]();
    expect(visibility).toHaveBeenCalledWith(true);
    f.mediaListeners[0]({ matches: true });
    expect(reduced).toHaveBeenCalledWith(true);
    offVisibility();
    offReduced();
    expect(f.documentListeners).toHaveLength(0);
    expect(f.mediaListeners).toHaveLength(0);
  });

  it("reports keyboard focus under the root, with the element or null, and removes its listener", () => {
    const f = fakeWindow();
    const env = createBrowserScrollEnvironment(f.win);
    const root = {
      addEventListener: (name: string, handler: (event: { target: unknown }) => void) => f.rootListeners.push({ name, handler }),
      removeEventListener: (name: string, handler: unknown) => { const at = f.rootListeners.findIndex(item => item.name === name && item.handler === handler); if (at >= 0) f.rootListeners.splice(at, 1); },
    };
    const heard = vi.fn();
    const off = env.onFocusIn!(root as never, heard);
    expect(f.rootListeners.map(item => item.name)).toEqual(["focusin"]);
    const element = new f.Element();
    const pointerFocus = new f.Element(false);
    f.rootListeners[0].handler({ target: element });
    f.rootListeners[0].handler({ target: pointerFocus });
    f.rootListeners[0].handler({ target: {} });
    expect(heard.mock.calls).toEqual([[element], [null], [null]]);
    off();
    expect(f.rootListeners).toHaveLength(0);
  });

  it("writes and removes inline style properties and attributes", () => {
    const calls: string[] = [];
    const element = {
      style: { setProperty: (name: string, value: string) => calls.push(`set ${name} ${value}`), removeProperty: (name: string) => calls.push(`remove ${name}`) },
      setAttribute: (name: string, value: string) => calls.push(`attr ${name} ${value}`),
      removeAttribute: (name: string) => calls.push(`unattr ${name}`),
    };
    const env = createBrowserScrollEnvironment(fakeWindow().win);
    env.setStyle(element as never, "translate", "0px 4px");
    env.setStyle(element as never, "translate", null);
    env.setAttribute(element as never, "data-x", "1");
    env.setAttribute(element as never, "data-x", null);
    expect(calls).toEqual(["set translate 0px 4px", "remove translate", "attr data-x 1", "unattr data-x"]);
  });

  it("passes frames and timers through", () => {
    const f = fakeWindow();
    const env = createBrowserScrollEnvironment(f.win);
    expect(env.requestFrame(() => undefined)).toBe(1);
    env.cancelFrame(1);
    expect(f.raw.cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(env.setTimeout(() => undefined, 10)).toBe(7);
    env.clearTimeout(7);
    expect(f.raw.clearTimeout).toHaveBeenCalledWith(7);
  });
});
