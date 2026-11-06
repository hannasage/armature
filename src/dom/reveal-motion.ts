/**
 * The numbers and pure functions of the scroll reveal (GI-70). No DOM, no clock. `createScrollReveal` calls these, and the tests
 * pin them.
 *
 * One spring per moving piece runs a progress `p` from 0 to 1. The pose is a function of `p` and a start pose: at `p = 0` the piece
 * is at its start, at `p = 1` it is exactly at rest (translate 0, scale 1, rotate 0, opacity 1), and a `p` past 1 is the overshoot.
 * The start pose and the spring depend on how fast the page is scrolling: slow starts near and settles gently, fast starts far away
 * and rings more.
 *
 * Every function that reads a name or a number takes the flavor as its last argument. The glass values live in `glass/constants.ts`.
 */
import { personalityOf, requireReveal, type Flavor, type RevealStart, type StartInput as FlavorStartInput } from "../engine/flavor";
import { clamp, lerp } from "../engine/math";
import type { SpringConfig } from "../engine/spring";

export type { RevealStart } from "../engine/flavor";

/** 0 for a slow scroll and 1 for a fast one, from a signed velocity. A non-finite velocity is slow. */
export function velocityBlend(velocity: number, flavor: Flavor): number {
  if (!Number.isFinite(velocity)) return 0;
  const { slow, fast } = requireReveal(flavor).velocity;
  return clamp((Math.abs(velocity) - slow) / (fast - slow), 0, 1);
}

/** +1 while the page scrolls down (or is still), -1 while it scrolls up. Content arrives from below going down and from above going up. */
export function scrollDirection(velocity: number): 1 | -1 {
  return Number.isFinite(velocity) && velocity < 0 ? -1 : 1;
}

/** The spring for a given scroll speed: the slow one at rest, the fast one at speed, blended between. */
export function revealSpring(velocity: number, flavor: Flavor): SpringConfig {
  const t = velocityBlend(velocity, flavor);
  const { slow, fast } = requireReveal(flavor).springs;
  return {
    stiffness: lerp(slow.stiffness, fast.stiffness, t),
    damping: lerp(slow.damping, fast.damping, t),
    mass: 1,
    restSpeed: slow.restSpeed,
    restDelta: slow.restDelta,
  };
}

/** Reads a personality. A name the flavor does not know gives the flavor's fallback. */
export function parsePersonality<P extends string>(value: string | null | undefined, flavor: Flavor<P>): P;
export function parsePersonality(value: string | null | undefined, flavor: Flavor): string {
  const { personalities, fallback } = requireReveal(flavor);
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(personalities, value) ? value : fallback;
}

/**
 * The delay of step `index` of a group in a flavor: `stepMs` a step, capped at `maxSteps` steps. A step that is not a finite number
 * of 0 or more is 0.
 */
export function staggerDelayFor(index: number, flavor: Flavor): number {
  if (!Number.isFinite(index) || index <= 0) return 0;
  const { stepMs, maxSteps } = requireReveal(flavor).stagger;
  return Math.min(Math.floor(index), maxSteps) * stepMs;
}

/** Whole milliseconds from an attribute. Anything that is not a finite number of 0 or more is 0, and 2 s is the most. */
export function parseDelay(value: string | null | undefined, flavor: Flavor): number {
  if (value === null || value === undefined || value.trim() === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(Math.floor(parsed), requireReveal(flavor).stagger.maxDelayMs);
}

export type StartInput<P extends string = string> = FlavorStartInput<P>;

/** The start pose of one piece. The personality decides the shape of it. A name the flavor does not know gets the fallback personality. */
export function revealStart<P extends string>(input: StartInput<P>, flavor: Flavor<P>): RevealStart;
export function revealStart(input: StartInput<string>, flavor: Flavor): RevealStart {
  const t = velocityBlend(input.velocity, flavor);
  const direction = scrollDirection(input.velocity);
  return personalityOf(requireReveal(flavor), input.personality).start(input, { t, direction });
}

export interface RevealPose {
  x: number;
  y: number;
  scale: number;
  rotate: number;
  opacity: number;
  /** The share of the box still cut off at the top, in percent, for a `mask`. 0 and below shows the whole box. */
  clipTop: number;
}

/** The pose at rest. */
export const REST_POSE: Readonly<RevealPose> = Object.freeze({ x: 0, y: 0, scale: 1, rotate: 0, opacity: 1, clipTop: 0 });

/** The pose at progress `p`. `p` past 1 is the overshoot. At exactly 1 the pose is exactly the rest pose. */
export function revealPose(start: RevealStart, p: number, flavor: Flavor): RevealPose {
  if (p === 1) return { ...REST_POSE };
  const rest = 1 - p;
  return {
    x: start.x * rest,
    y: start.y * rest,
    scale: start.scale + (1 - start.scale) * p,
    rotate: start.rotate * rest,
    // Opacity reaches 1 when the progress reaches `opacityDone`, so a piece is solid before it finishes moving.
    opacity: clamp(p / requireReveal(flavor).opacityDone, 0, 1),
    clipTop: Math.min(100, rest * 100),
  };
}

/** Reads a depth factor and clamps it to the flavor's range. */
export function parseDepth(value: string | null | undefined, flavor: Flavor): number {
  const { min, max, fallback } = requireReveal(flavor).drag.depth;
  if (value === null || value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
}

/**
 * Where an element at `depth` is pulled to by a scroll at `velocity`: the shift in px and the turn in degrees. Both are
 * proportional to the speed, clamped at the full velocity, scaled by depth, and signed with the scroll: the element trails
 * the content, so it shifts the way the page is scrolling (down while scrolling down) and turns clockwise for that.
 */
export function dragTarget(velocity: number, depth: number, flavor: Flavor): { shift: number; turn: number } {
  if (!Number.isFinite(velocity)) return { shift: 0, turn: 0 };
  const drag = requireReveal(flavor).drag;
  const share = clamp(velocity / drag.fullVelocity, -1, 1) * clamp(depth, drag.depth.min, drag.depth.max);
  return { shift: share * drag.shiftMax, turn: share * drag.rotateMax };
}
