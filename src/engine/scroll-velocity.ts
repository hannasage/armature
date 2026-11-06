/**
 * Smoothed page scroll velocity (GI-70), in pixels per second, signed: positive while the page scrolls down.
 *
 * A scroll event wakes the tracker. Then one animation frame at a time it reads the scroll position, turns the distance since the last
 * sample into a raw speed, and moves the smoothed speed toward it (an exponential, time constant `VELOCITY_SMOOTHING_MS`, so the result
 * is the same at any frame rate). When the page stops, the raw speed is 0 and the smoothed speed decays; below `VELOCITY_REST` it is
 * set to exactly 0 and the frames stop. So a frame runs only while the velocity is non-zero.
 *
 * Handles window scroll only. `createScrollReveal` runs it in driven mode: the host owns the one frame loop and calls `sample(time)`.
 */
import type { ArmatureScrollEnvironment } from "./scroll-env";

/** How fast the smoothed velocity follows the raw one. About 70 ms: quick enough to catch a flick, slow enough to hide wheel steps. */
export const VELOCITY_SMOOTHING_MS = 70;
/** Below this the smoothed velocity is set to exactly 0, in px per second. */
export const VELOCITY_REST = 12;
/** The largest speed ever read. A jump the browser makes at once, such as a restored scroll position, cannot read higher. */
export const VELOCITY_MAX = 12_000;
/** Two samples closer than this are one sample, so a scroll event and a frame in the same millisecond never read as a huge speed. */
const MIN_SAMPLE_MS = 4;

export type ScrollVelocityEnvironment = Pick<ArmatureScrollEnvironment, "requestFrame" | "cancelFrame" | "now" | "scrollY" | "onScroll">;

export interface ScrollVelocityOptions {
  /** The smoothing time constant in milliseconds. Default 70. */
  smoothingMs?: number;
  /**
   * Driven mode. Given this, the tracker never requests a frame. It calls `onWake` when a scroll event arrives, and the host calls
   * `sample(time)` on each of its own frames until that returns false.
   */
  onWake?: () => void;
}

export interface ScrollVelocity {
  /** The smoothed velocity, px per second. Exactly 0 at rest. */
  read(): number;
  /** Calls `listener` with the velocity on every sample, and once more with 0 when it comes to rest. Returns the unsubscribe. */
  subscribe(listener: (velocity: number) => void): () => void;
  /** Takes one sample at `time` (the frame time). Returns true while the velocity is still non-zero. Driven mode calls this. */
  sample(time: number): boolean;
  /** True while a frame is wanted: the velocity is non-zero or the page just moved. */
  readonly active: boolean;
  /** Removes the listener and cancels the frame. Safe to call twice. */
  destroy(): void;
}

export function createScrollVelocity(env: ScrollVelocityEnvironment, options: ScrollVelocityOptions = {}): ScrollVelocity {
  const tau = Number.isFinite(options.smoothingMs) && options.smoothingMs! > 0 ? options.smoothingMs! : VELOCITY_SMOOTHING_MS;
  const driven = typeof options.onWake === "function";
  const listeners = new Set<(velocity: number) => void>();
  let lastY = env.scrollY();
  let lastTime: number | null = null;
  let smoothed = 0;
  let running = false;
  let frame = 0;
  let destroyed = false;

  const emit = () => { for (const listener of [...listeners]) listener(smoothed); };

  const sample = (time: number): boolean => {
    if (destroyed || !running) return false;
    if (lastTime === null) lastTime = time;
    const elapsed = time - lastTime;
    if (elapsed < MIN_SAMPLE_MS) return running;
    const y = env.scrollY();
    const moved = y - lastY;
    lastY = y;
    lastTime = time;
    const raw = (moved / elapsed) * 1000;
    smoothed += (raw - smoothed) * (1 - Math.exp(-elapsed / tau));
    smoothed = Math.max(-VELOCITY_MAX, Math.min(VELOCITY_MAX, smoothed));
    if (moved === 0 && Math.abs(smoothed) < VELOCITY_REST) {
      smoothed = 0;
      running = false;
      lastTime = null;
    }
    emit();
    return running;
  };

  const tick = (time: number) => {
    frame = 0;
    if (sample(time)) frame = env.requestFrame(tick);
  };

  const wake = () => {
    if (destroyed) return;
    if (env.scrollY() === lastY && !running) return; // the event did not move the page
    if (lastTime === null) lastTime = env.now();
    running = true;
    if (driven) options.onWake!();
    else if (!frame) frame = env.requestFrame(tick);
  };

  const off = env.onScroll(wake);

  return {
    read: () => smoothed,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    sample,
    get active() { return running; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      off();
      if (frame) { env.cancelFrame(frame); frame = 0; }
      listeners.clear();
      smoothed = 0;
      running = false;
    },
  };
}
