/**
 * The bezier fitting aid. It fits one cubic-bezier to a sampled curve and reports how far the fit is from the samples.
 * It is a search with no random numbers, so the same samples always give the same answer. There is no visual editor.
 */
import { bezier, evaluator, type BezierPoints } from "./bezier";

export interface BezierFit {
  /** The control points, rounded to 4 decimals. x1 and x2 are inside 0..1, so the CSS is valid. */
  points: BezierPoints;
  /** The CSS timing function. */
  css: string;
  /** The largest gap between the fitted curve and any sample, in the units of the samples. */
  error: number;
}

/** The search looks at no more than this many samples, spread over the curve. The error is still measured on all of them. */
const SEARCH_SAMPLES = 48;
/** The coarse grid that the search starts from: five x values for each end and five y values for each end. */
const GRID_X = [0.05, 0.25, 0.5, 0.75, 0.95];
const GRID_Y = [-0.5, 0, 0.5, 1, 1.5];
/** The size of the step for the Jacobian. The solver is exact to about 1e-9, so a smaller step would measure noise. */
const STEP = 1e-4;
/** How many of the best grid points the search refines. */
const REFINED = 3;
/** Every step in the grid {-1, 0, 1} on four axes, except standing still. */
const DIRECTIONS = Array.from({ length: 81 }, (_, n) => [n % 3, Math.floor(n / 3) % 3, Math.floor(n / 9) % 3, Math.floor(n / 27)].map((d) => d - 1)).filter((d) => d.some(Boolean));

const clampPoint = (point: readonly number[]): BezierPoints =>
  [Math.min(1, Math.max(0, point[0])), Math.min(3, Math.max(-2, point[1])), Math.min(1, Math.max(0, point[2])), Math.min(3, Math.max(-2, point[3]))] as const;

/** How far a curve is from each sample: the curve minus the sample, with the samples at progress `xs`. */
const residuals = (point: BezierPoints, ys: readonly number[], xs: readonly number[]): number[] => {
  const ease = evaluator(...point);
  return ys.map((y, i) => ease(xs[i]) - y);
};
const widestOf = (gaps: readonly number[]) => gaps.reduce((worst, gap) => Math.max(worst, Math.abs(gap)), 0);

/**
 * Fits a bezier from (0, 0) to (1, 1) to the samples, which are the values of a curve at evenly spaced progress from 0 to 1.
 * Fewer than two samples, or a sample that is not a finite number, throws a TypeError.
 */
export function fitBezier(samples: readonly number[]): BezierFit {
  if (!Array.isArray(samples) || samples.length < 2 || !samples.every((y) => typeof y === "number" && Number.isFinite(y))) {
    throw new TypeError("A bezier fit needs an array of at least two finite samples.");
  }
  const last = samples.length - 1;
  const count = Math.min(samples.length, SEARCH_SAMPLES);
  // The positions of the samples that the search looks at, and their values.
  const at = Array.from({ length: count }, (_, i) => Math.round((i * last) / (count - 1)));
  const sparse = at.map((i) => samples[i]);
  const xs = at.map((i) => i / last);
  const squares = (point: BezierPoints) => residuals(point, sparse, xs).reduce((sum, gap) => sum + gap * gap, 0);
  const widest = (point: BezierPoints) => widestOf(residuals(point, sparse, xs));

  /** Levenberg-Marquardt on the squares: a Gauss-Newton step with a damping term that grows when a step fails. */
  const refine = (start: BezierPoints): BezierPoints => {
    let point = clampPoint(start);
    let score = squares(point);
    let damping = 1e-3;
    for (let round = 0; round < 80 && damping < 1e9; round += 1) {
      const residual = residuals(point, sparse, xs);
      // The Jacobian by forward differences, one column per control value.
      const columns = point.map((_, k) =>
        residuals(point.map((v, i) => (i === k ? v + STEP : v)) as unknown as BezierPoints, sparse, xs).map((moved, i) => (moved - residual[i]) / STEP),
      );
      const matrix = columns.map((a, r) => [...columns.map((b) => a.reduce((sum, v, i) => sum + v * b[i], 0)), -a.reduce((sum, v, i) => sum + v * residual[i], 0)].map((v, c) => (c === r ? v * (1 + damping) + 1e-12 : v)));
      // Gaussian elimination with the largest pivot, on the 4 by 5 matrix.
      for (let c = 0; c < 4; c += 1) {
        const pivot = matrix.reduce((best, _row, r) => (r >= c && Math.abs(matrix[r][c]) > Math.abs(matrix[best][c]) ? r : best), c);
        [matrix[c], matrix[pivot]] = [matrix[pivot], matrix[c]];
        for (let r = c + 1; r < 4; r += 1) {
          const f = matrix[r][c] / matrix[c][c];
          for (let k = c; k < 5; k += 1) matrix[r][k] -= f * matrix[c][k];
        }
      }
      const delta = [0, 0, 0, 0];
      for (let r = 3; r >= 0; r -= 1) delta[r] = (matrix[r][4] - matrix[r].slice(r + 1, 4).reduce((sum, v, k) => sum + v * delta[r + 1 + k], 0)) / matrix[r][r];
      const next = clampPoint(point.map((v, i) => v + delta[i]));
      const nextScore = squares(next);
      if (nextScore < score) {
        const done = score - nextScore < 1e-14;
        point = next;
        score = nextScore;
        damping /= 3;
        if (done) break;
      } else damping *= 4;
    }
    return point;
  };

  // A coarse grid finds the valleys, and a least-squares fit refines the best few. The widest gap is what the fit reports, so a short pattern
  // search on it has the last word.
  const grid = GRID_X.flatMap((x1) => GRID_Y.flatMap((y1) => GRID_X.flatMap((x2) => GRID_Y.map((y2): BezierPoints => [x1, y1, x2, y2]))));
  const starts = grid.map((point) => [point, squares(point)] as const).sort((p, q) => p[1] - q[1]).slice(0, REFINED);
  const valley = starts.map(([start]) => refine(start)).reduce((p, q) => (squares(q) < squares(p) ? q : p));
  let best = valley;
  let widestNow = widest(best);
  for (let size = 0.01; size > 1e-5; ) {
    const found = DIRECTIONS.some((direction) => {
      const next = clampPoint(best.map((v, i) => v + direction[i] * size));
      const nextWidest = widest(next);
      if (nextWidest >= widestNow) return false;
      best = next;
      widestNow = nextWidest;
      return true;
    });
    if (!found) size /= 2;
  }

  const rounded = best.map((v) => Number(v.toFixed(4))) as unknown as BezierPoints;
  const all = Array.from({ length: samples.length }, (_, i) => i / last);
  return { points: rounded, css: bezier(...rounded).css, error: widestOf(residuals(rounded, samples, all)) };
}
