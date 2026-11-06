/**
 * The glass attribute builders for server markup. A server component spreads these onto an element, so the markup names its own
 * personality, delay, and drag depth. They are the engine's builders bound to the glass flavor, so the names keep the `lqg` prefix.
 */
import { dragAttributes, revealAttributes, revealGroupAttributes, revealLineAttributes, type LqgRevealAttributes, type RevealAttributeOptions } from "../dom/reveal-attrs";
import { glassFlavor, type RevealPersonality } from "./flavor";

/**
 * `data-lqg-reveal`, with an optional extra delay in ms (0 to 2000), for a `drop` a larger tilt in degrees (up to 4), and for a `slide`
 * the side it comes from (`left` or `right`, otherwise it alternates by its index in the group).
 */
export function lqgReveal(personality: RevealPersonality, options?: RevealAttributeOptions): LqgRevealAttributes {
  return revealAttributes(personality, options, glassFlavor);
}

/** `data-lqg-drag` with a depth factor from 0.4 to 1. */
export function lqgDrag(depth: number): LqgRevealAttributes {
  return dragAttributes(depth, glassFlavor);
}

/** Put on a parent so the targets that arrive together stagger. */
export const LQG_REVEAL_GROUP: LqgRevealAttributes = revealGroupAttributes(glassFlavor);

/** Put on each line of a `mask` heading so the lines rise one after another. Give the line `display: block` (or inline-block). */
export const LQG_LINE: LqgRevealAttributes = revealLineAttributes(glassFlavor);
