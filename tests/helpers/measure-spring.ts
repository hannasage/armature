import { createSpring, FIXED_STEP, retarget, stepSpring, type SpringConfig } from "../../src/engine/spring";

export interface SpringMeasure {
  /** The largest value minus 1, as a fraction of the travel. Never below 0. */
  overshoot: number;
  /** The time, in seconds, after which the value stays inside 2 percent of the target. Found by linear interpolation between two solver slices. */
  settleSeconds: number;
  /** The time, in seconds, of the largest value. */
  peakSeconds: number;
}

/** The damping ratio: c / (2 sqrt(k m)). Below 1 the spring overshoots, at 1 it is critical, above 1 it is overdamped. */
export const dampingRatio = (config: SpringConfig): number => config.damping / (2 * Math.sqrt(config.stiffness * (config.mass ?? 1)));

/** The overshoot of an underdamped spring from the closed-form solution: exp(-pi z / sqrt(1 - z^2)). Zero when the spring is not underdamped. */
export function analyticOvershoot(config: SpringConfig): number {
  const z = dampingRatio(config);
  return z >= 1 ? 0 : Math.exp((-Math.PI * z) / Math.sqrt(1 - z * z));
}

/**
 * Steps the real solver from 0 to 1 in whole fixed slices and measures the curve.
 * The rest thresholds are tiny, so the solver does not snap to rest and cut the curve short.
 */
export function measureSpring(config: SpringConfig, seconds = 5): SpringMeasure {
  let state = retarget(createSpring({ ...config, restDelta: 1e-9, restSpeed: 1e-9 }, 0), 1);
  const steps = Math.round(seconds / FIXED_STEP);
  const band = 0.02;
  let peak = 0;
  let peakAt = 0;
  let settleAt = 0;
  let before = 1;
  for (let i = 1; i <= steps; i++) {
    state = stepSpring(state, 1, FIXED_STEP);
    const time = i * FIXED_STEP;
    const miss = Math.abs(state.value - 1);
    if (state.value > peak) {
      peak = state.value;
      peakAt = time;
    }
    // The last time the curve goes from outside the band to inside it. The exit time is the point on the line between the two slices.
    if (before > band && miss <= band) settleAt = time - FIXED_STEP + (FIXED_STEP * (before - band)) / (before - miss);
    before = miss;
  }
  return { overshoot: Math.max(0, peak - 1), settleSeconds: settleAt, peakSeconds: peakAt };
}
