import { createSpring, FIXED_STEP, retarget, stepSpring, type SpringConfig } from "../../src/engine/spring";

// The figures of the documentation: each curve is drawn as a smooth bezier path through its own samples, as the stamped visual language asks.
// The samples come from the code (the bezier evaluator, or the spring solver in its fixed slices), so no point of a figure is typed by hand.
// A test renders each figure and compares it with the file in docs/figures, so a change in the code shows as a change in the figure.

export interface Panel {
  title: string;
  /** The points of the curve, x from 0 to 1 and y in the units of the value. */
  points: ReadonlyArray<readonly [number, number]>;
}

const fixed = (n: number) => (Object.is(Math.round(n * 100) / 100, -0) ? "0" : String(Math.round(n * 100) / 100));

/** A smooth path through the points: each span is a cubic bezier with Catmull-Rom tangents, so the path passes through every sample. */
export function smoothPath(points: ReadonlyArray<readonly [number, number]>): string {
  if (points.length === 0) return "";
  const parts = [`M ${fixed(points[0][0])} ${fixed(points[0][1])}`];
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [points[Math.max(0, i - 1)], points[i], points[i + 1], points[Math.min(points.length - 1, i + 2)]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    parts.push(`C ${fixed(c1[0])} ${fixed(c1[1])} ${fixed(c2[0])} ${fixed(c2[1])} ${fixed(p2[0])} ${fixed(p2[1])}`);
  }
  return parts.join(" ");
}

/**
 * A row of panels. Each panel has a frame, a dashed line at the target (y = 1), and the curve. The y range of every panel is the same,
 * from `low` to `high`, so the panels compare. The text is the title only. The colors are plain greys and one ink, for a light page.
 */
export function figure(panels: readonly Panel[], low = -0.1, high = 1.3): string {
  const [w, h, pad, gap] = [200, 160, 20, 16];
  const width = panels.length * w + (panels.length + 1) * gap;
  const height = h + 2 * pad + 24;
  const body = panels.map((panel, i) => {
    const left = gap + i * (w + gap);
    const top = pad + 24;
    const sx = (x: number) => left + x * w;
    const sy = (y: number) => top + h - ((y - low) / (high - low)) * h;
    const curve = smoothPath(panel.points.map(([x, y]) => [sx(x), sy(y)] as const));
    return [
      `  <g>`,
      `    <text x="${fixed(left)}" y="${fixed(pad + 12)}" font-family="ui-monospace, monospace" font-size="12" fill="#333">${panel.title}</text>`,
      `    <rect x="${fixed(left)}" y="${fixed(top)}" width="${w}" height="${h}" fill="none" stroke="#ccc"/>`,
      `    <line x1="${fixed(left)}" y1="${fixed(sy(1))}" x2="${fixed(left + w)}" y2="${fixed(sy(1))}" stroke="#999" stroke-dasharray="4 4"/>`,
      `    <line x1="${fixed(left)}" y1="${fixed(sy(0))}" x2="${fixed(left + w)}" y2="${fixed(sy(0))}" stroke="#ccc"/>`,
      `    <path d="${curve}" fill="none" stroke="#1a1a1a" stroke-width="2"/>`,
      `  </g>`,
    ].join("\n");
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`,
    `  <rect width="${width}" height="${height}" fill="#fff"/>`,
    ...body,
    `</svg>`,
    ``,
  ].join("\n");
}

/** Samples a curve at `count` + 1 evenly spaced points of progress. */
export const sampleCurve = (curve: (progress: number) => number, count = 48): Array<[number, number]> =>
  Array.from({ length: count + 1 }, (_, i) => [i / count, curve(i / count)]);

/** Steps a spring from 0 to 1 with the real solver for `seconds`, and keeps every `every`-th slice, as points with x from 0 to 1. */
export function sampleSpring(config: SpringConfig, seconds: number, every = 6): Array<[number, number]> {
  let state = retarget(createSpring({ ...config, restDelta: 1e-9, restSpeed: 1e-9 }, 0), 1);
  const steps = Math.round(seconds / FIXED_STEP);
  const points: Array<[number, number]> = [[0, 0]];
  for (let i = 1; i <= steps; i++) {
    state = stepSpring(state, 1, FIXED_STEP);
    if (i % every === 0 || i === steps) points.push([i / steps, state.value]);
  }
  return points;
}
