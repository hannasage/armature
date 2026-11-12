/**
 * The `linear()` exporter. It samples a spring or a curve, keeps the fewest stops that stay within a tolerance of the samples,
 * and writes them as a CSS `linear()` string. A spring is sampled with the solver's own step, so the samples are what the solver draws.
 * It runs with no DOM and no environment.
 */
import type { Curve } from "../curves/bezier";
import { createSpring, retarget, stepSpring, type SpringConfig } from "../engine/spring";

export interface LinearOptions {
  /** The largest gap, in the units of the value, between the stops and the samples. Defaults to 0.005. The smallest allowed is 0.0005. */
  tolerance?: number;
  /** Seconds. For a curve only: a spring has its own duration. Defaults to 1. */
  duration?: number;
}

export interface LinearFit {
  /** The `linear(...)` string. The first and last stop have no percent, and the stops between have one. */
  css: string;
  /** Seconds. For a spring, the time to rest from the solver's steps. */
  duration: number;
  /** The number of stops. */
  count: number;
  /** The largest gap between the written stops, after rounding, and any sample. It is never above the tolerance. */
  error: number;
}

/** What the samples of a source are. `ys[i]` is the value at progress `i / (ys.length - 1)`. */
export interface Samples {
  ys: number[];
  duration: number;
}

/** A spring is sampled for no longer than this many seconds, so a spring with no damping gives a finite string. */
const MAX_SECONDS = 10;
const MAX_SAMPLES = 20_000;
/** A curve is sampled in this many equal steps. */
const CURVE_STEPS = 1000;
const DEFAULT_TOLERANCE = 0.005;
/** The stops are written with 4 decimals, so a smaller tolerance could not be kept. */
const MIN_TOLERANCE = 0.0005;

const isSpring = (source: unknown): source is SpringConfig =>
  typeof source === "object" && source !== null && typeof (source as SpringConfig).stiffness === "number" && typeof (source as SpringConfig).damping === "number";

export function checkTolerance(tolerance: number | undefined): number {
  const value = tolerance ?? DEFAULT_TOLERANCE;
  if (!Number.isFinite(value) || value < MIN_TOLERANCE) throw new RangeError(`The tolerance must be a number of ${MIN_TOLERANCE} or more.`);
  return value;
}

/** Samples a spring from 0 to 1 with the solver's own step, from the first step to the step where the spring rests. */
export function sampleSource(source: SpringConfig | Curve, duration?: number): Samples {
  if (typeof source === "function") {
    if (duration !== undefined && !(Number.isFinite(duration) && duration > 0)) throw new TypeError("A duration must be a positive number of seconds.");
    const ys = Array.from({ length: CURVE_STEPS + 1 }, (_, i) => source(i / CURVE_STEPS));
    if (!ys.every(Number.isFinite)) throw new TypeError("A curve must return a finite number for every progress.");
    return { ys, duration: duration ?? 1 };
  }
  if (!isSpring(source)) throw new TypeError("A source must be a spring config or a function from progress to value.");
  let state = retarget(createSpring(source, 0), 1);
  const { step } = state.config;
  const ys = [0];
  while (ys.length <= MAX_SAMPLES && ys.length * step <= MAX_SECONDS) {
    state = stepSpring(state, 1, step);
    ys.push(state.value);
    if (state.value === 1 && state.velocity === 0) break;
  }
  return { ys, duration: (ys.length - 1) * step };
}

/** The indices of the samples to keep: the ends, and every sample that is further than `tolerance` from the line between its kept neighbours. */
function simplify(ys: readonly number[], tolerance: number): number[] {
  const last = ys.length - 1;
  const keep = new Set([0, last]);
  const spans: Array<[number, number]> = [[0, last]];
  for (let span = spans.pop(); span; span = spans.pop()) {
    const [a, b] = span;
    let worst = tolerance;
    let at = -1;
    for (let i = a + 1; i < b; i += 1) {
      const gap = Math.abs(ys[i] - (ys[a] + ((ys[b] - ys[a]) * (i - a)) / (b - a)));
      if (gap > worst) {
        worst = gap;
        at = i;
      }
    }
    if (at >= 0) {
      keep.add(at);
      spans.push([a, at], [at, b]);
    }
  }
  return [...keep].sort((p, q) => p - q);
}

/** Writes the fewest stops that keep every sample within the tolerance, measured on the stops as they are written. */
export function linearFrom({ ys, duration }: Samples, tolerance: number): LinearFit {
  const last = ys.length - 1;
  let tight = tolerance;
  // Rounding the stops adds a little error. When it tips a fit over the tolerance, the search runs again with a tighter bound.
  for (let attempt = 0; attempt < 8; attempt += 1, tight /= 2) {
    const stops = simplify(ys, tight).map((i) => ({ at: Number(((i / last) * 100).toFixed(4)), value: Number(ys[i].toFixed(4)) }));
    let error = 0;
    let s = 0;
    for (let i = 0; i <= last; i += 1) {
      const progress = i / last;
      while (s < stops.length - 2 && progress * 100 > stops[s + 1].at) s += 1;
      const [p, q] = [stops[s], stops[s + 1]];
      const shown = q.at === p.at ? q.value : p.value + ((q.value - p.value) * Math.min(1, Math.max(0, (progress * 100 - p.at) / (q.at - p.at)))) ;
      error = Math.max(error, Math.abs(shown - ys[i]));
    }
    if (error <= tolerance) {
      const text = stops.map((stop, i) => (i === 0 || i === stops.length - 1 ? `${stop.value}` : `${stop.value} ${stop.at}%`));
      return { css: `linear(${text.join(", ")})`, duration, count: stops.length, error };
    }
  }
  throw new RangeError("The tolerance is too small for the output precision.");
}

/** The stops of `source` as a fit: the CSS, the duration, the number of stops, and the error. */
export function fitLinear(source: SpringConfig | Curve, options: LinearOptions = {}): LinearFit {
  const tolerance = checkTolerance(options.tolerance);
  return linearFrom(sampleSource(source, options.duration), tolerance);
}

/** The `linear()` string of a spring or a curve, within `tolerance` of the solver's own samples. */
export function toLinear(source: SpringConfig | Curve, options: LinearOptions = {}): string {
  return fitLinear(source, options).css;
}
