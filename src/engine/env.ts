/**
 * Everything a controller takes from the browser. Controllers never touch `window` or `document` themselves,
 * so a test passes a fake and every path can be forced in Node.
 */

/** Whatever your environment writes variables to. An `HTMLElement` for the browser environment. */
export type LqgTarget = object;

export interface LqgEnvironment {
  requestFrame(callback: (time: number) => void): number;
  cancelFrame(id: number): void;
  /** Milliseconds, on the same clock as the time `requestFrame` passes to its callback. */
  now(): number;
  matchMedia?(query: string): { matches: boolean };
  setCSSVariable(target: LqgTarget, name: string, value: string): void;
  /** Sets an attribute, or removes it when `value` is null. */
  setAttribute(target: LqgTarget, name: string, value: string | null): void;
  /** Calls back when the target changes size. Optional; without it the controller refits only on `refit()`. */
  observeResize?(target: LqgTarget, callback: () => void): { disconnect(): void };
}

/** The real browser. Safe to import on the server: nothing runs until a method is called. */
export function createBrowserEnvironment(): LqgEnvironment {
  return {
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (id) => cancelAnimationFrame(id),
    now: () => performance.now(),
    matchMedia: (query) => window.matchMedia(query),
    setCSSVariable: (target, name, value) => (target as HTMLElement).style.setProperty(name, value),
    setAttribute: (target, name, value) => {
      const element = target as HTMLElement;
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    },
    observeResize: (target, callback) => {
      const observer = new ResizeObserver(() => callback());
      observer.observe(target as Element);
      return { disconnect: () => observer.disconnect() };
    },
  };
}

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** True when the reader asked for less motion. False when the environment cannot say. */
export function prefersReducedMotion(env: Pick<LqgEnvironment, "matchMedia">): boolean {
  try {
    return env.matchMedia?.(REDUCED_MOTION_QUERY)?.matches === true;
  } catch {
    return false;
  }
}
