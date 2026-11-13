import { describe, expect, it } from "vitest";
import { bezier, easings, type EasingName } from "../../src/curves";
import { tide } from "../../examples/tide/flavor";
import { figure, sampleCurve, sampleSpring } from "../helpers/doc-svg";

// A smooth path bends between its samples. These tests check that every point of each drawn path, the control points too, stays inside the
// frame of its panel, so no curve is drawn past its frame or shows a swing that the samples do not have.

/** The frames and the path points of a figure, in order: one frame and one path per panel. */
function panels(svg: string) {
  const frames = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="(\d+)" height="(\d+)" fill="none"/g)].map((m) => m.slice(1).map(Number));
  const paths = [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => {
    const numbers = m[1].replace(/[MC]/g, " ").trim().split(/\s+/).map(Number);
    return numbers.flatMap((n, i) => (i % 2 === 0 ? [[n, numbers[i + 1]]] : []));
  });
  return frames.map((frame, i) => ({ frame, points: paths[i] }));
}

const figures = {
  "easings.svg": figure((Object.keys(easings) as EasingName[]).map((name) => ({ title: name, points: sampleCurve(bezier(...easings[name])) }))),
  "tide-springs.svg": figure(Object.entries(tide.springs).map(([name, config]) => ({ title: name, points: sampleSpring(config, 1) }))),
};

describe("the figures of the docs", () => {
  it.each(Object.entries(figures))("keep every point of every path in %s inside its frame", (_name, svg) => {
    const list = panels(svg);
    expect(list.length).toBeGreaterThan(0);
    for (const { frame, points } of list) {
      const [x, y, width, height] = frame;
      expect(points.length).toBeGreaterThan(10);
      for (const [px, py] of points) {
        expect(px).toBeGreaterThanOrEqual(x);
        expect(px).toBeLessThanOrEqual(x + width);
        expect(py).toBeGreaterThanOrEqual(y);
        expect(py).toBeLessThanOrEqual(y + height);
      }
    }
  });
});
