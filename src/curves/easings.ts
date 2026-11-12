import { bezier, type BezierPoints, type Easing } from "./bezier";

const freeze = (points: BezierPoints): BezierPoints => Object.freeze(points) as BezierPoints;

/**
 * Named control points, as data. The CSS keywords have their standard points. `projection` is the curve that Projection UI uses
 * for its glow reveal: a fast start and a long soft end.
 */
export const easings = Object.freeze({
  linear: freeze([0, 0, 1, 1]),
  ease: freeze([0.25, 0.1, 0.25, 1]),
  "ease-in": freeze([0.42, 0, 1, 1]),
  "ease-out": freeze([0, 0, 0.58, 1]),
  "ease-in-out": freeze([0.42, 0, 0.58, 1]),
  projection: freeze([0.22, 1, 0.36, 1]),
});

export type EasingName = keyof typeof easings;

/** The easing with a name from `easings`. An unknown name throws a TypeError that lists the names. */
export function easing(name: EasingName): Easing {
  if (!Object.hasOwn(easings, name)) throw new TypeError(`Unknown easing "${String(name)}". The names are ${Object.keys(easings).join(", ")}.`);
  return bezier(...easings[name]);
}
