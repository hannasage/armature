/**
 * Everything the drag takes from the browser. The drag never touches `window` or `document`, so a test passes a fake and forces every path in Node.
 * It is the pointer counterpart of the scroll environment.
 */
import type { ArmatureTarget } from "../engine/env";

/** One pointer event, reduced to what a drag reads. `time` is in milliseconds on the engine clock, the clock of `now()` and of the frame time. */
export interface PointerSample {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly time: number;
}

export interface PointerHandlers {
  down(sample: PointerSample): void;
  move(sample: PointerSample): void;
  up(sample: PointerSample): void;
  cancel(sample: PointerSample): void;
}

export interface ArmaturePointerEnvironment {
  requestFrame(callback: (time: number) => void): number;
  cancelFrame(id: number): void;
  /** Milliseconds, on the same clock as the time `requestFrame` passes to its callback and as the `time` of a pointer sample. */
  now(): number;
  matchMedia?(query: string): { matches: boolean };
  /** Writes one inline style property, or removes it when `value` is null. */
  setStyle(target: ArmatureTarget, property: string, value: string | null): void;
  /** Calls the handlers for the pointer events of the target. Returns the function that removes them. */
  onPointer(target: ArmatureTarget, handlers: PointerHandlers): () => void;
}

/**
 * The real browser. Safe to import on the server: nothing runs, and `window` is not read, until a method is called.
 * A press captures its pointer, so the move and the release arrive at the element even when the pointer leaves it.
 */
export function createBrowserPointerEnvironment(win?: Window & typeof globalThis): ArmaturePointerEnvironment {
  const w = () => win ?? window;
  return {
    requestFrame: (callback) => w().requestAnimationFrame(callback),
    cancelFrame: (id) => w().cancelAnimationFrame(id),
    now: () => w().performance.now(),
    matchMedia: (query) => w().matchMedia(query),
    setStyle: (target, property, value) => {
      const style = (target as HTMLElement).style;
      if (value === null) style.removeProperty(property);
      else style.setProperty(property, value);
    },
    onPointer: (target, handlers) => {
      const element = target as HTMLElement;
      const sample = (event: PointerEvent): PointerSample => ({ id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp });
      const listeners: Record<string, (event: PointerEvent) => void> = {
        pointerdown: (event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          try { element.setPointerCapture(event.pointerId); } catch { /* the pointer is already gone */ }
          handlers.down(sample(event));
        },
        pointermove: (event) => handlers.move(sample(event)),
        pointerup: (event) => handlers.up(sample(event)),
        pointercancel: (event) => handlers.cancel(sample(event)),
      };
      for (const [type, listener] of Object.entries(listeners)) element.addEventListener(type, listener as EventListener);
      return () => { for (const [type, listener] of Object.entries(listeners)) element.removeEventListener(type, listener as EventListener); };
    },
  };
}
