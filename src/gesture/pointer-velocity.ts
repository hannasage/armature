/**
 * Smoothed pointer velocity, in pixels per second, signed, on two axes. It is the pointer twin of the scroll velocity tracker, with the same
 * time constant and the same ceiling: an exponential that moves the smoothed speed toward the raw one (`VELOCITY_SMOOTHING_MS`, so the
 * result is the same at any event rate), and a ceiling of `VELOCITY_MAX`.
 *
 * Unlike the scroll tracker, the first speed it reads is taken as it is, so a short flick reads its real speed. A pointer that stops
 * decays on the same exponential, so a read later than the last sample is the speed times `exp(-idle / tau)`.
 */
import { VELOCITY_MAX, VELOCITY_SMOOTHING_MS } from "../engine/scroll-velocity";

/** Two samples closer than this are one sample, so two events in the same millisecond never read as a huge speed. */
const MIN_SAMPLE_MS = 4;

export interface PointerVelocityOptions {
  /** The smoothing time constant in milliseconds. Default 70. */
  smoothingMs?: number;
}

export interface PointerVelocity {
  /** Takes a sample. A sample that is not finite, or not at least 4 ms after the last one, is ignored. */
  add(x: number, y: number, time: number): void;
  /** The smoothed velocity at `time`, in px per second. 0 before two samples. */
  read(time: number): { x: number; y: number };
  /** Forgets every sample. */
  reset(): void;
}

export function createPointerVelocity(options: PointerVelocityOptions = {}): PointerVelocity {
  const tau = Number.isFinite(options.smoothingMs) && options.smoothingMs! > 0 ? options.smoothingMs! : VELOCITY_SMOOTHING_MS;
  let lastX = 0;
  let lastY = 0;
  let lastTime: number | null = null;
  let vx = 0;
  let vy = 0;
  let seeded = false;
  const limit = (v: number) => Math.max(-VELOCITY_MAX, Math.min(VELOCITY_MAX, v));
  return {
    add(x, y, time) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(time)) return;
      if (lastTime === null) {
        [lastX, lastY, lastTime] = [x, y, time];
        return;
      }
      const elapsed = time - lastTime;
      if (elapsed < MIN_SAMPLE_MS) return;
      const weight = seeded ? 1 - Math.exp(-elapsed / tau) : 1;
      vx = limit(vx + (((x - lastX) / elapsed) * 1000 - vx) * weight);
      vy = limit(vy + (((y - lastY) / elapsed) * 1000 - vy) * weight);
      [lastX, lastY, lastTime, seeded] = [x, y, time, true];
    },
    read(time) {
      if (lastTime === null) return { x: 0, y: 0 };
      const fade = Math.exp(-(time > lastTime ? time - lastTime : 0) / tau);
      return { x: vx * fade, y: vy * fade };
    },
    reset() {
      [lastTime, vx, vy, seeded] = [null, 0, 0, false];
    },
  };
}
