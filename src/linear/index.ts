// The `linear()` exporter, the feature check for `linear()`, and the fallback to a fitted cubic-bezier.
// It imports the engine's spring solver and the curves code, and no browser code.
import type { Curve, Easing } from "../curves/bezier";
import { fitBezier } from "../curves/fit";
import type { SpringConfig } from "../engine/spring";
import { supportsLinear, type SupportsProbe } from "./detect";
import { checkTolerance, linearFrom, sampleSource, type LinearOptions } from "./linear";

export { fitLinear, toLinear } from "./linear";
export type { LinearFit, LinearOptions } from "./linear";
export { supportsLinear } from "./detect";
export type { SupportsProbe } from "./detect";

export interface EasingOptions extends LinearOptions {
  /** The feature probe. Defaults to `CSS.supports` on the global object. A test passes its own. */
  supports?: SupportsProbe;
}

export interface EasingResult {
  /** A `linear(...)` string when the browser supports it, and a `cubic-bezier(...)` string when it does not. */
  css: string;
  /** Seconds. */
  duration: number;
  kind: "linear" | "cubic-bezier";
  /** The largest gap between the written curve and the solver's samples. It is 0 for a source that is already a bezier. */
  error: number;
}

const isBezier = (source: unknown): source is Easing => typeof (source as Easing).css === "string" && (source as Easing).css.startsWith("cubic-bezier(");

/**
 * The CSS timing function of a spring or a curve, for the browser that runs it. With `linear()` support, it writes `linear()` within the
 * tolerance. Without it, it fits one cubic-bezier to the same samples and reports the error, which can be large for a spring that overshoots
 * and settles. A curve that is already a bezier is returned as its own `cubic-bezier(...)` with no error, because CSS reads that natively.
 */
export function toEasing(source: SpringConfig | Curve, options: EasingOptions = {}): EasingResult {
  const tolerance = checkTolerance(options.tolerance);
  const samples = sampleSource(source, options.duration);
  if (isBezier(source)) return { css: source.css, duration: samples.duration, kind: "cubic-bezier", error: 0 };
  if (supportsLinear(options.supports)) {
    const fit = linearFrom(samples, tolerance);
    return { css: fit.css, duration: fit.duration, kind: "linear", error: fit.error };
  }
  const fit = fitBezier(samples.ys);
  return { css: fit.css, duration: samples.duration, kind: "cubic-bezier", error: fit.error };
}
