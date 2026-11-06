/**
 * The numbers and pure functions of the scroll reveal (GI-70). No DOM, no clock. `createScrollReveal` calls these, and the tests
 * pin them.
 *
 * One spring per moving piece runs a progress `p` from 0 to 1. The pose is a function of `p` and a start pose: at `p = 0` the piece
 * is at its start, at `p = 1` it is exactly at rest (translate 0, scale 1, rotate 0, opacity 1), and a `p` past 1 is the overshoot.
 * The start pose and the spring depend on how fast the page is scrolling: slow starts near and settles gently, fast starts far away
 * and rings more.
 *
 * Every function takes an optional flavor as its last argument. Without one it uses the glass flavor. The constants below are the
 * glass values, kept as exports so old call sites keep working.
 */
import { personalityOf, requireReveal, type Flavor, type RevealStart, type StartInput as FlavorStartInput } from "../engine/flavor";
import { clamp, lerp } from "../engine/math";
import { glassFlavor } from "../glass/flavor";
import type { SpringConfig } from "./spring";

export type { RevealStart } from "../engine/flavor";
export {
  DROP_SCALE, FADE_RISE, MASK_RISE_FAST, MASK_RISE_SLOW, OFFSET_FAST, OFFSET_SLOW, SLIDE_FAST, SLIDE_SLOW, TILT_FAST, TILT_LIMIT, TILT_SLOW,
} from "../glass/flavor";

export type RevealPersonality = "drop" | "mask" | "slide" | "fade";
export const REVEAL_PERSONALITIES: readonly RevealPersonality[] = ["drop", "mask", "slide", "fade"];

const glass = glassFlavor.reveal;

/** At or below this speed (px per second) a scroll is slow. */
export const SLOW_VELOCITY = glass.velocity.slow;
/** At or above this speed a scroll is fast. In between, the start pose and the spring are blended. */
export const FAST_VELOCITY = glass.velocity.fast;

/**
 * The spring of a slow reveal and of a fast one, on the progress `p` (travel 1). The slow one is the library's `gentle` (120)
 * with a little more damping, and the fast one is `lensWidth`'s wobble (180) with a little more damping. With the presets as
 * they are, the overshoot would be 7.3 percent and 20.8 percent of the travel. These two give 3.5 and 12.0 percent, which is
 * what the reveal is meant to feel like.
 */
export const revealSlow: SpringConfig = glass.springs.slow;
export const revealFast: SpringConfig = glass.springs.fast;
/** The spring of a `fade`: nearly critically damped, so a form field never overshoots. */
export const revealCalm: SpringConfig = glass.springs.calm;

/** The stagger between siblings that arrive together, in ms, and the step at which it stops growing. */
export const REVEAL_STAGGER_MS = glass.stagger.stepMs;
export const REVEAL_MAX_STEPS = glass.stagger.maxSteps;
export const REVEAL_MAX_DELAY_MS = glass.stagger.maxDelayMs;

/** 0 for a slow scroll and 1 for a fast one, from a signed velocity. A non-finite velocity is slow. */
export function velocityBlend(velocity: number, flavor: Flavor = glassFlavor): number {
  if (!Number.isFinite(velocity)) return 0;
  const { slow, fast } = requireReveal(flavor).velocity;
  return clamp((Math.abs(velocity) - slow) / (fast - slow), 0, 1);
}

/** +1 while the page scrolls down (or is still), -1 while it scrolls up. Content arrives from below going down and from above going up. */
export function scrollDirection(velocity: number): 1 | -1 {
  return Number.isFinite(velocity) && velocity < 0 ? -1 : 1;
}

/** The spring for a given scroll speed: the slow one at rest, the fast one at speed, blended between. */
export function revealSpring(velocity: number, flavor: Flavor = glassFlavor): SpringConfig {
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

/** Reads a personality. A name the flavor does not know gives the flavor's fallback (`drop` for glass). */
export function parsePersonality(value: string | null | undefined): RevealPersonality;
export function parsePersonality<P extends string>(value: string | null | undefined, flavor: Flavor<P>): P;
export function parsePersonality(value: string | null | undefined, flavor: Flavor = glassFlavor): string {
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

/**
 * The glass stagger: 60 ms a step, capped at 6 steps. It takes the index alone, so it can be passed to `map`.
 * Use `staggerDelayFor` for another flavor.
 */
export const staggerDelay = (index: number): number => staggerDelayFor(index, glassFlavor);

/** Whole milliseconds from an attribute. Anything that is not a finite number of 0 or more is 0, and 2 s is the most. */
export function parseDelay(value: string | null | undefined, flavor: Flavor = glassFlavor): number {
  if (value === null || value === undefined || value.trim() === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(Math.floor(parsed), requireReveal(flavor).stagger.maxDelayMs);
}

export type StartInput<P extends string = RevealPersonality> = FlavorStartInput<P>;

/** The start pose of one piece. The personality decides the shape of it. A name the flavor does not know gets the fallback personality. */
export function revealStart(input: StartInput): RevealStart;
export function revealStart<P extends string>(input: StartInput<P>, flavor: Flavor<P>): RevealStart;
export function revealStart(input: StartInput<string>, flavor: Flavor = glassFlavor): RevealStart {
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
export function revealPose(start: RevealStart, p: number, flavor: Flavor = glassFlavor): RevealPose {
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

/** The drag of a revealed element while the page scrolls (GI-70). */
export const DRAG_SHIFT_MAX = glass.drag.shiftMax;
export const DRAG_ROTATE_MAX = glass.drag.rotateMax;
/** At this speed (px per second) the drag is at its full size. */
export const DRAG_FULL_VELOCITY = glass.drag.fullVelocity;
export const DEPTH_MIN = glass.drag.depth.min;
export const DEPTH_MAX = glass.drag.depth.max;
/** The depth of an element with no depth attribute, or one that is not a number. */
export const DEPTH_DEFAULT = glass.drag.depth.fallback;

/** Reads a depth factor and clamps it to the flavor's range (0.4 to 1 for glass). */
export function parseDepth(value: string | null | undefined, flavor: Flavor = glassFlavor): number {
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
export function dragTarget(velocity: number, depth: number, flavor: Flavor = glassFlavor): { shift: number; turn: number } {
  if (!Number.isFinite(velocity)) return { shift: 0, turn: 0 };
  const drag = requireReveal(flavor).drag;
  const share = clamp(velocity / drag.fullVelocity, -1, 1) * clamp(depth, drag.depth.min, drag.depth.max);
  return { shift: share * drag.shiftMax, turn: share * drag.rotateMax };
}

/**
 * The spring that pulls a dragged element after its target and back to 0. Slightly under critical, so it settles in about 0.5 s. It rests
 * under 0.02 px (or 0.02 degrees) and 0.1 per second, far below what the eye sees, so the frame loop ends soon after the scroll does.
 */
export const dragSpring: SpringConfig = glass.drag.spring;
