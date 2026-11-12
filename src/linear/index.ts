// The `linear()` exporter, the feature check for `linear()`, and the fallback to a fitted cubic-bezier.
// It imports the engine's spring solver and the curves code, and no browser code.
import { bezier, type Curve, type Easing } from "../curves/bezier";
import { fitBezier } from "../curves/fit";
import type { SpringConfig } from "../engine/spring";
import { supportsLinear, type SupportsProbe } from "./detect";
import { checkDuration, checkTolerance, linearFrom, sampleSource, type LinearOptions } from "./linear";

export { fitLinear, toLinear } from "./linear";
export type { LinearFit, LinearOptions } from "./linear";
export { supportsLinear } from "./detect";
export type { SupportsProbe } from "./detect";

export interface EasingOptions extends LinearOptions {
  /** The feature probe. Defaults to `CSS.supports` on the global object. A test passes its own. */
  supports?: SupportsProbe;
  /** The largest error the result can have. A result with more error throws a RangeError. Without it, a large error is only reported. */
  maxError?: number;
}

export interface EasingResult {
  /** A `linear(...)` string when the browser supports it, and a `cubic-bezier(...)` string when it does not. */
  css: string;
  /** Seconds. */
  duration: number;
  kind: "linear" | "cubic-bezier";
  /** The largest gap between the written curve and the solver's samples. For a bezier source, the gap to the curve its own points make. */
  error: number;
  /** True when `error` is above the tolerance. The fallback bezier can be this far off for a spring that overshoots. */
  degraded: boolean;
  /** True when a spring did not come to rest within the sampling cap, so the result ends before the spring does. */
  truncated: boolean;
}

const isBezier = (source: unknown): source is Easing =>
  typeof source === "function" && Array.isArray((source as Easing).points) && (source as Easing).points.length === 4 && typeof (source as Easing).css === "string";

/**
 * The CSS timing function of a spring or a curve, for the browser that runs it. With `linear()` support, it writes `linear()` within the
 * tolerance. Without it, it fits one cubic-bezier to the same samples and reports the error, which can be large for a spring that overshoots
 * and settles. Then `degraded` is true, and `maxError` can turn that into a throw. A curve that is already a bezier is rebuilt from its own
 * control points and returned as `cubic-bezier(...)`, because CSS reads that natively. Its error is the gap to the curve the points make.
 * A spring that does not rest within the sampling cap is a flag here (`truncated: true`), while `toLinear` throws a RangeError for it.
 * A result whose error is not finite throws a TypeError.
 */
export function toEasing(source: SpringConfig | Curve, options: EasingOptions = {}): EasingResult {
  const tolerance = checkTolerance(options.tolerance);
  const { maxError } = options;
  if (maxError !== undefined && !(Number.isFinite(maxError) && maxError >= 0)) throw new RangeError("maxError must be 0 or more.");
  let result: EasingResult;
  if (isBezier(source)) {
    const duration = checkDuration(options.duration);
    const own = bezier(...source.points);
    let error = 0;
    for (let i = 0; i <= 100; i += 1) error = Math.max(error, Math.abs(source(i / 100) - own(i / 100)));
    result = { css: own.css, duration, kind: "cubic-bezier", error, degraded: error > tolerance, truncated: false };
  } else {
    const samples = sampleSource(source, options.duration);
    if (supportsLinear(options.supports)) {
      const fit = linearFrom(samples, tolerance);
      result = { css: fit.css, duration: fit.duration, kind: "linear", error: fit.error, degraded: false, truncated: samples.truncated };
    } else {
      const fit = fitBezier(samples.ys);
      result = { css: fit.css, duration: samples.duration, kind: "cubic-bezier", error: fit.error, degraded: fit.error > tolerance, truncated: samples.truncated };
    }
  }
  if (!Number.isFinite(result.error)) throw new TypeError("The error is not finite.");
  if (maxError !== undefined && result.error > maxError) {
    throw new RangeError(`The error ${result.error} is above maxError.`);
  }
  return result;
}
