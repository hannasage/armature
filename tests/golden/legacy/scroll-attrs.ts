/**
 * Attribute helpers for server markup (GI-70). A server component spreads these onto an element, so the markup names its own
 * personality, delay, and drag depth. They are plain objects and need no browser.
 */
import { DEPTH_ATTRIBUTE, DRAG_ATTRIBUTE, REVEAL_ATTRIBUTE, REVEAL_DELAY_ATTRIBUTE, REVEAL_GROUP_ATTRIBUTE, SIDE_ATTRIBUTE, TILT_ATTRIBUTE, LINE_ATTRIBUTE } from "./scroll-reveal";
import { DEPTH_MAX, DEPTH_MIN, REVEAL_MAX_DELAY_MS, TILT_LIMIT, type RevealPersonality } from "./scroll-motion";

export type LqgRevealAttributes = Record<string, string>;

/**
 * `data-lqg-reveal`, with an optional extra delay in ms (0 to 2000), for a `drop` a larger tilt in degrees (up to 4), and for a `slide`
 * the side it comes from (`left` or `right`, otherwise it alternates by its index in the group).
 */
export function lqgReveal(personality: RevealPersonality, options: { delayMs?: number; tilt?: number; side?: "left" | "right" } = {}): LqgRevealAttributes {
  const attributes: LqgRevealAttributes = { [REVEAL_ATTRIBUTE]: personality };
  const delay = Number.isFinite(options.delayMs) ? Math.min(Math.max(Math.floor(options.delayMs!), 0), REVEAL_MAX_DELAY_MS) : 0;
  if (delay > 0) attributes[REVEAL_DELAY_ATTRIBUTE] = String(delay);
  if (Number.isFinite(options.tilt) && options.tilt! > 0) attributes[TILT_ATTRIBUTE] = String(Math.min(options.tilt!, TILT_LIMIT));
  if (options.side === "left" || options.side === "right") attributes[SIDE_ATTRIBUTE] = options.side;
  return attributes;
}

/** `data-lqg-drag` with a depth factor from 0.4 to 1. */
export function lqgDrag(depth: number): LqgRevealAttributes {
  const clamped = Number.isFinite(depth) ? Math.min(Math.max(depth, DEPTH_MIN), DEPTH_MAX) : DEPTH_MIN;
  return { [DRAG_ATTRIBUTE]: "", [DEPTH_ATTRIBUTE]: String(clamped) };
}

/** Put on a parent so the targets that arrive together stagger. */
export const LQG_REVEAL_GROUP: LqgRevealAttributes = Object.freeze({ [REVEAL_GROUP_ATTRIBUTE]: "" });

/** Put on each line of a `mask` heading so the lines rise one after another. Give the line `display: block` (or inline-block). */
export const LQG_LINE: LqgRevealAttributes = Object.freeze({ [LINE_ATTRIBUTE]: "" });
