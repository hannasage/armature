/**
 * The numbers and pure functions of the scroll reveal (GI-70). No DOM, no clock. `createScrollReveal` calls these, and the tests
 * pin them.
 *
 * One spring per moving piece runs a progress `p` from 0 to 1. The pose is a function of `p` and a start pose: at `p = 0` the piece
 * is at its start, at `p = 1` it is exactly at rest (translate 0, scale 1, rotate 0, opacity 1), and a `p` past 1 is the overshoot.
 * The start pose and the spring depend on how fast the page is scrolling: slow starts near and settles gently, fast starts far away
 * and rings more.
 */
import type { SpringConfig } from "./spring";

export type RevealPersonality = "drop" | "mask" | "slide" | "fade";
export const REVEAL_PERSONALITIES: readonly RevealPersonality[] = ["drop", "mask", "slide", "fade"];

/** At or below this speed (px per second) a scroll is slow. */
export const SLOW_VELOCITY = 400;
/** At or above this speed a scroll is fast. In between, the start pose and the spring are blended. */
export const FAST_VELOCITY = 3200;

/** How far a `drop` starts from its place, in px: slow scroll, fast scroll. */
export const OFFSET_SLOW = 28;
export const OFFSET_FAST = 110;
/** How far a `slide` starts to the side, in px. */
export const SLIDE_SLOW = 40;
export const SLIDE_FAST = 120;
/** How far a `fade` rises. It does not depend on speed. */
export const FADE_RISE = 12;
/** The scale a `drop` starts from. */
export const DROP_SCALE = 0.94;
/** The most a `drop` tilts at the start, in degrees. A slow scroll tilts less. `data-lqg-tilt` can raise it, to `TILT_LIMIT`. */
export const TILT_SLOW = 0.6;
export const TILT_FAST = 1.5;
export const TILT_LIMIT = 4;
/** A `mask` line rises through its clip by this fraction of its own height, slow and fast. */
export const MASK_RISE_SLOW = 0.6;
export const MASK_RISE_FAST = 1;

/**
 * The spring of a slow reveal and of a fast one, on the progress `p` (travel 1). The slow one is the library's `gentle` (120)
 * with a little more damping, and the fast one is `lensWidth`'s wobble (180) with a little more damping. With the presets as
 * they are, the overshoot would be 7.3 percent and 20.8 percent of the travel. These two give 3.5 and 12.0 percent, which is
 * what the reveal is meant to feel like.
 */
export const revealSlow: SpringConfig = Object.freeze({ stiffness: 120, damping: 16, mass: 1, restSpeed: 0.02, restDelta: 0.002 });
export const revealFast: SpringConfig = Object.freeze({ stiffness: 180, damping: 15, mass: 1, restSpeed: 0.02, restDelta: 0.002 });
/** The spring of a `fade`: nearly critically damped, so a form field never overshoots. */
export const revealCalm: SpringConfig = Object.freeze({ stiffness: 170, damping: 28, mass: 1, restSpeed: 0.02, restDelta: 0.002 });

/** The stagger between siblings that arrive together, in ms, and the step at which it stops growing. */
export const REVEAL_STAGGER_MS = 60;
export const REVEAL_MAX_STEPS = 6;
export const REVEAL_MAX_DELAY_MS = 2000;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;

/** 0 for a slow scroll and 1 for a fast one, from a signed velocity. A non-finite velocity is slow. */
export function velocityBlend(velocity: number): number {
  if (!Number.isFinite(velocity)) return 0;
  return clamp((Math.abs(velocity) - SLOW_VELOCITY) / (FAST_VELOCITY - SLOW_VELOCITY), 0, 1);
}

/** +1 while the page scrolls down (or is still), -1 while it scrolls up. Content arrives from below going down and from above going up. */
export function scrollDirection(velocity: number): 1 | -1 {
  return Number.isFinite(velocity) && velocity < 0 ? -1 : 1;
}

/** The spring for a given scroll speed: the slow one at rest, the fast one at speed, blended between. */
export function revealSpring(velocity: number): SpringConfig {
  const t = velocityBlend(velocity);
  return {
    stiffness: lerp(revealSlow.stiffness, revealFast.stiffness, t),
    damping: lerp(revealSlow.damping, revealFast.damping, t),
    mass: 1,
    restSpeed: revealSlow.restSpeed,
    restDelta: revealSlow.restDelta,
  };
}

/** Reads a personality. Anything unknown is `drop`. */
export function parsePersonality(value: string | null | undefined): RevealPersonality {
  return value === "mask" || value === "slide" || value === "fade" ? value : "drop";
}

/** The delay of step `index` of a group: 60 ms a step, capped at 6 steps. A step that is not a finite number of 0 or more is 0. */
export function staggerDelay(index: number): number {
  if (!Number.isFinite(index) || index <= 0) return 0;
  return Math.min(Math.floor(index), REVEAL_MAX_STEPS) * REVEAL_STAGGER_MS;
}

/** Whole milliseconds from an attribute. Anything that is not a finite number of 0 or more is 0, and 2 s is the most. */
export function parseDelay(value: string | null | undefined): number {
  if (value === null || value === undefined || value.trim() === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(Math.floor(parsed), REVEAL_MAX_DELAY_MS);
}

/** The start pose of one piece. All the numbers are at `p = 0`. */
export interface RevealStart {
  /** Pixels. */
  x: number;
  y: number;
  scale: number;
  /** Degrees. */
  rotate: number;
}

export interface StartInput {
  personality: RevealPersonality;
  velocity: number;
  /** The element's place among its group, from 0. A `slide` from an even index starts on the left, unless `side` says otherwise. */
  index?: number;
  /** Which side a `slide` comes from, -1 for the left and 1 for the right. Beats the parity of `index`. */
  side?: -1 | 1;
  /** The most a `drop` tilts, in degrees. */
  tilt?: number;
  /** The height of a `mask` line, in px. */
  height?: number;
}

export function revealStart(input: StartInput): RevealStart {
  const t = velocityBlend(input.velocity);
  const direction = scrollDirection(input.velocity);
  switch (input.personality) {
    case "slide": {
      const side = input.side ?? ((input.index ?? 0) % 2 === 0 ? -1 : 1);
      return { x: side * lerp(SLIDE_SLOW, SLIDE_FAST, t), y: direction * lerp(8, 24, t), scale: 1, rotate: 0 };
    }
    case "fade":
      return { x: 0, y: direction * FADE_RISE, scale: 1, rotate: 0 };
    case "mask": {
      const height = Number.isFinite(input.height) && input.height! > 0 ? Math.min(input.height!, 96) : 24;
      return { x: 0, y: direction * height * lerp(MASK_RISE_SLOW, MASK_RISE_FAST, t), scale: 1, rotate: 0 };
    }
    default: {
      const limit = Number.isFinite(input.tilt) && input.tilt! > 0 ? Math.min(input.tilt!, TILT_LIMIT) : TILT_FAST;
      // The tilt grows with speed up to the limit. Its sign follows the scroll: down tilts one way, up the other.
      const tilt = lerp(Math.min(TILT_SLOW, limit), limit, t);
      return { x: 0, y: direction * lerp(OFFSET_SLOW, OFFSET_FAST, t), scale: DROP_SCALE, rotate: direction * tilt };
    }
  }
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

/** Opacity reaches 1 when the progress reaches this, so a piece is solid before it finishes moving. */
const OPACITY_DONE = 0.6;

/** The pose at progress `p`. `p` past 1 is the overshoot. At exactly 1 the pose is exactly the rest pose. */
export function revealPose(start: RevealStart, p: number): RevealPose {
  if (p === 1) return { ...REST_POSE };
  const rest = 1 - p;
  return {
    x: start.x * rest,
    y: start.y * rest,
    scale: start.scale + (1 - start.scale) * p,
    rotate: start.rotate * rest,
    opacity: clamp(p / OPACITY_DONE, 0, 1),
    clipTop: Math.min(100, rest * 100),
  };
}

/** The drag of a revealed element while the page scrolls (GI-70). */
export const DRAG_SHIFT_MAX = 6;
export const DRAG_ROTATE_MAX = 0.8;
/** At this speed (px per second) the drag is at its full size. */
export const DRAG_FULL_VELOCITY = 1600;
export const DEPTH_MIN = 0.4;
export const DEPTH_MAX = 1;
/** The depth of an element with no `data-lqg-depth`, or one that is not a number. */
export const DEPTH_DEFAULT = 0.7;

/** Reads a depth factor and clamps it to 0.4 to 1. */
export function parseDepth(value: string | null | undefined): number {
  if (value === null || value === undefined || value.trim() === "") return DEPTH_DEFAULT;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(parsed, DEPTH_MIN, DEPTH_MAX) : DEPTH_DEFAULT;
}

/**
 * Where an element at `depth` is pulled to by a scroll at `velocity`: the shift in px and the turn in degrees. Both are
 * proportional to the speed, clamped at `DRAG_FULL_VELOCITY`, scaled by depth, and signed with the scroll: the element trails
 * the content, so it shifts the way the page is scrolling (down while scrolling down) and turns clockwise for that.
 */
export function dragTarget(velocity: number, depth: number): { shift: number; turn: number } {
  if (!Number.isFinite(velocity)) return { shift: 0, turn: 0 };
  const share = clamp(velocity / DRAG_FULL_VELOCITY, -1, 1) * clamp(depth, DEPTH_MIN, DEPTH_MAX);
  return { shift: share * DRAG_SHIFT_MAX, turn: share * DRAG_ROTATE_MAX };
}

/**
 * The spring that pulls a dragged element after its target and back to 0. Slightly under critical, so it settles in about 0.5 s. It rests
 * under 0.02 px (or 0.02 degrees) and 0.1 per second, far below what the eye sees, so the frame loop ends soon after the scroll does.
 */
export const dragSpring: SpringConfig = Object.freeze({ stiffness: 170, damping: 22, mass: 1, restSpeed: 0.1, restDelta: 0.02 });
