/**
 * A cubic-bezier easing: the curve from (0, 0) to (1, 1) with two control points, as in CSS `cubic-bezier(x1, y1, x2, y2)`.
 * The x axis is progress and the y axis is the eased value. A progress goes in, and the y of the curve at that x comes out.
 * It reads no environment and holds no state.
 */

/** A function from progress to a value. Progress 0 to 1 is the whole move. */
export type Curve = (progress: number) => number;

export type BezierPoints = readonly [x1: number, y1: number, x2: number, y2: number];

/** A curve that also knows its control points and its CSS text. */
export interface Easing extends Curve {
  /** The CSS timing function, such as `cubic-bezier(0.22, 1, 0.36, 1)`. */
  readonly css: string;
  readonly points: BezierPoints;
}

/** How close, on the x axis, the solver gets before it stops. A curve with x1 of 0 and a large y1 is steep near the start, so a loose bound would show as a large error in y. */
const EPSILON = 1e-12;

/** The y of the curve at the point where its x is `progress`. No checks: the caller passes a progress inside 0..1 and valid points. */
export function evaluator(x1: number, y1: number, x2: number, y2: number): Curve {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = (t: number) => ((ax * t + bx) * t + cx) * t;
  const slope = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (progress) => {
    if (!(progress > 0)) return 0;
    if (progress >= 1) return 1;
    // Newton's method is fast. Where the slope is flat it can stall, so bisection takes over.
    let t = progress;
    for (let i = 0; i < 8; i += 1) {
      const error = x(t) - progress;
      if (Math.abs(error) < EPSILON) return ((ay * t + by) * t + cy) * t;
      const d = slope(t);
      if (Math.abs(d) < 1e-6) break;
      t -= error / d;
    }
    let low = 0;
    let high = 1;
    t = progress;
    for (let i = 0; i < 60 && Math.abs(x(t) - progress) >= EPSILON; i += 1) {
      if (x(t) < progress) low = t;
      else high = t;
      t = (low + high) / 2;
    }
    return ((ay * t + by) * t + cy) * t;
  };
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * Builds an easing from control points. CSS needs x1 and x2 inside 0..1, so a value outside it throws a TypeError, and so does a value that
 * is not a finite number. y1 and y2 may be any finite number, so a curve can overshoot. Progress below 0 gives 0, and 1 or more gives 1.
 */
export function bezier(x1: number, y1: number, x2: number, y2: number): Easing {
  if (![x1, y1, x2, y2].every(finite)) throw new TypeError("A bezier needs four finite numbers.");
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) throw new TypeError("A bezier needs x1 and x2 between 0 and 1.");
  const points = Object.freeze<BezierPoints>([x1, y1, x2, y2]);
  return Object.assign(evaluator(x1, y1, x2, y2), { css: `cubic-bezier(${points.join(", ")})`, points });
}
