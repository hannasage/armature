/**
 * What the layout controllers take from the browser: the frame loop of the scheduler, the reduced-motion query, one style write, the box of an
 * element, and the removal of an element. Controllers never touch `window` or `document` themselves, so a test passes a fake and scripts the boxes.
 */
import type { ArmatureTarget } from "../engine/env";
import type { FrameEnvironment } from "../frame/scheduler";

/** A box in pixels, from the top left of the viewport. `width` and `height` are 0 or more. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LayoutEnvironment extends FrameEnvironment {
  matchMedia?(query: string): { matches: boolean };
  /** Writes one inline style property, or removes it when `value` is null. */
  setStyle(target: ArmatureTarget, property: string, value: string | null): void;
  /** The box of the target as it shows now, with any `translate` and `scale` applied about its center. */
  measure(target: ArmatureTarget): Box;
  /** Takes `target` out of `container`. Needed by `createPresence`, unless its options give an `unmount`. */
  unmount?(container: ArmatureTarget, target: ArmatureTarget): void;
}

/** `transform`, and the same name with a vendor prefix. The layout controllers write individual properties only, and the browser environment holds the line. */
const TRANSFORM = /^(-[a-z]+-)?transform$/i;

/**
 * The real browser. Safe to import on the server: nothing runs, and `window` is not read, until a method is called.
 * `setStyle` throws a TypeError for `transform` and its vendor names: Armature writes `translate` and `scale`, which compose with the page's own transform.
 * A box is in viewport coordinates, so measure before and after a change at the same scroll position.
 */
export function createBrowserLayoutEnvironment(win?: Window & typeof globalThis): LayoutEnvironment {
  const w = () => win ?? window;
  return {
    requestFrame: (callback) => w().requestAnimationFrame(callback),
    cancelFrame: (id) => w().cancelAnimationFrame(id),
    now: () => w().performance.now(),
    matchMedia: (query) => w().matchMedia(query),
    setStyle: (target, property, value) => {
      if (TRANSFORM.test(property)) throw new TypeError(`Armature writes individual properties such as translate and scale, and never ${property}.`);
      const style = (target as HTMLElement).style;
      if (value === null) style.removeProperty(property);
      else style.setProperty(property, value);
    },
    measure: (target) => {
      const r = (target as Element).getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    },
    unmount: (container, target) => {
      if ((target as Node).parentNode === container) (container as Node).removeChild(target as Node);
    },
  };
}
