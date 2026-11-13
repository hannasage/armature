import { afterEach, describe, expect, it, vi } from "vitest";

// A server render touches no `window`. The globals a browser has are made to throw and to record, and the whole entry is imported and every
// controller is made and destroyed with the default environment.

const TRAPS = ["window", "document", "requestAnimationFrame", "cancelAnimationFrame", "ResizeObserver", "getComputedStyle", "matchMedia"];
const hits: string[] = [];

function trap() {
  for (const name of TRAPS) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        hits.push(name);
        throw new ReferenceError(`${name} is not defined on the server`);
      },
    });
  }
}
afterEach(() => {
  for (const name of TRAPS) delete (globalThis as Record<string, unknown>)[name];
  hits.length = 0;
  vi.resetModules();
});

describe("a server render", () => {
  it("has none of the browser globals in this test, so the trap is meaningful", () => {
    for (const name of TRAPS) expect(name in globalThis, name).toBe(false);
  });

  it("imports the entry, and makes and destroys every controller with the default environment, and reads no browser global", async () => {
    trap();
    const { createLayout, createPresence, createShared, createBrowserLayoutEnvironment, requireLayout } = await import("../../src/layout");
    const { lofty } = await import("../helpers/layout-flavor");
    const element = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }) };
    expect(() => createBrowserLayoutEnvironment()).not.toThrow();
    requireLayout(lofty);
    const layout = createLayout(element, { flavor: lofty });
    const present = createPresence(element, { flavor: lofty });
    const shared = createShared({ flavor: lofty });
    layout.on("update", () => undefined);
    present.on("exit", () => undefined);
    expect(layout.getState().moving).toBe(false);
    expect(present.getState().exiting).toBe(0);
    expect(shared.getState().pending).toBe(0);
    layout.destroy();
    present.destroy();
    shared.destroy();
    expect(hits).toEqual([]);
  });

  it("does not read a global at import, in any file of the entry", async () => {
    trap();
    await import("../../src/layout/index");
    expect(hits).toEqual([]);
  });
});
