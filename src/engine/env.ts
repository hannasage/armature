/**
 * Everything a controller takes from the browser. Controllers never touch `window` or `document` themselves,
 * so a test passes a fake and every path can be forced in Node.
 */

/** Whatever your environment writes variables to. An `HTMLElement` for the browser environment. */
export type ArmatureTarget = object;

export interface ArmatureEnvironment {
  requestFrame(callback: (time: number) => void): number;
  cancelFrame(id: number): void;
  /** Milliseconds, on the same clock as the time `requestFrame` passes to its callback. */
  now(): number;
  matchMedia?(query: string): { matches: boolean };
  setCSSVariable(target: ArmatureTarget, name: string, value: string): void;
  /** Sets an attribute, or removes it when `value` is null. */
  setAttribute(target: ArmatureTarget, name: string, value: string | null): void;
  /** Calls back when the target changes size. Optional; without it the controller refits only on `refit()`. */
  observeResize?(target: ArmatureTarget, callback: () => void): { disconnect(): void };
  /**
   * The box of the target as it shows now, in pixels from the top left of the viewport, with any `translate` and `scale` applied.
   * Optional. The layout entry, `@hannasage/armature/layout`, needs it, and its own browser environment has it.
   */
  measure?(target: ArmatureTarget): { x: number; y: number; width: number; height: number };
}

/** The real browser. Safe to import on the server: nothing runs until a method is called. */
export function createBrowserEnvironment(): ArmatureEnvironment {
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
export function prefersReducedMotion(env: Pick<ArmatureEnvironment, "matchMedia">): boolean {
  try {
    return env.matchMedia?.(REDUCED_MOTION_QUERY)?.matches === true;
  } catch {
    return false;
  }
}
