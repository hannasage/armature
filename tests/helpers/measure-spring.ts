import { createSpring, FIXED_STEP, retarget, stepSpring, type SpringConfig } from "../../src/engine/spring";

export interface SpringMeasure {
  /** The largest value minus 1, as a fraction of the travel. Never below 0. */
  overshoot: number;
  /** The time, in seconds, after which the value stays inside 2 percent of the target to the end of the run. Found by linear interpolation between two solver slices. */
  settleSeconds: number;
  /** The time, in seconds, of the largest value. */
  peakSeconds: number;
}

/** The band of the settle time: the value stays within this share of the travel from the target. */
export const SETTLE_BAND = 0.02;

/** The damping ratio: c / (2 sqrt(k m)). Below 1 the spring overshoots, at 1 it is critical, above 1 it is overdamped. */
export const dampingRatio = (config: SpringConfig): number => config.damping / (2 * Math.sqrt(config.stiffness * (config.mass ?? 1)));

/** The overshoot of an underdamped spring from the closed-form solution: exp(-pi z / sqrt(1 - z^2)). Zero when the spring is not underdamped. */
export function analyticOvershoot(config: SpringConfig): number {
  const z = dampingRatio(config);
  return z >= 1 ? 0 : Math.exp((-Math.PI * z) / Math.sqrt(1 - z * z));
}

/** The position at time t of an underdamped or critical spring that starts at 0, rests at 1, and starts with no velocity. */
function closedForm(config: SpringConfig, t: number): number {
  const w0 = Math.sqrt(config.stiffness / (config.mass ?? 1));
  const z = dampingRatio(config);
  if (z >= 1) return 1 - (1 + w0 * t) * Math.exp(-w0 * t);
  const wd = w0 * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
}

/** The 2 percent settle time of the closed-form solution, in seconds, found by a scan every 10 microseconds. Valid for a damping ratio of 1 or less. */
export function analyticSettle(config: SpringConfig, seconds = 5): number {
  let last = 0;
  for (let t = 0; t < seconds; t += 1e-5) if (Math.abs(closedForm(config, t) - 1) > SETTLE_BAND) last = t;
  return last;
}

/**
 * Steps the real solver from 0 to 1 in whole fixed slices and measures the curve.
 * It throws when the curve never moves, and when it is not inside the band at the end of the run.
 * The rest thresholds are tiny, so the solver does not snap to rest and cut the curve short.
 */
export function measureSpring(config: SpringConfig, seconds = 5): SpringMeasure {
  let state = retarget(createSpring({ ...config, restDelta: 1e-9, restSpeed: 1e-9 }, 0), 1);
  const steps = Math.round(seconds / FIXED_STEP);
  const band = SETTLE_BAND;
  let peak = 0;
  let peakAt = 0;
  let settleAt: number | null = null;
  let before = 1;
  for (let i = 1; i <= steps; i++) {
    state = stepSpring(state, 1, FIXED_STEP);
    const time = i * FIXED_STEP;
    const miss = Math.abs(state.value - 1);
    if (state.value > peak) {
      peak = state.value;
      peakAt = time;
    }
    // The curve settles when it enters the band and never leaves it again. Leaving the band cancels an earlier entry.
    // The entry time is the point on the line between the two slices.
    if (miss > band) settleAt = null;
    else if (settleAt === null) settleAt = time - FIXED_STEP + (FIXED_STEP * (before - band)) / (before - miss);
    before = miss;
  }
  if (peak === 0) throw new Error("The curve never moves.");
  if (settleAt === null) throw new Error(`The curve never settles inside ${seconds} seconds.`);
  return { overshoot: Math.max(0, peak - 1), settleSeconds: settleAt, peakSeconds: peakAt };
}
