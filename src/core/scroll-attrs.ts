/**
 * Attribute helpers for server markup (GI-70). A server component spreads these onto an element, so the markup names its own
 * personality, delay, and drag depth. They are plain objects and need no browser.
 *
 * Each helper takes an optional flavor as its last argument and defaults to glass. The old constants stay as the glass values.
 */
import { dataAttr, requireReveal, type Flavor } from "../engine/flavor";
import { clamp } from "../engine/math";
import { glassFlavor } from "../glass/flavor";
import type { RevealPersonality } from "./scroll-motion";

export type LqgRevealAttributes = Record<string, string>;

/**
 * `data-lqg-reveal`, with an optional extra delay in ms (0 to 2000), for a `drop` a larger tilt in degrees (up to 4), and for a `slide`
 * the side it comes from (`left` or `right`, otherwise it alternates by its index in the group). The names and limits come from the flavor.
 */
export function lqgReveal(personality: RevealPersonality, options?: { delayMs?: number; tilt?: number; side?: "left" | "right" }): LqgRevealAttributes;
export function lqgReveal<P extends string>(personality: P, options: { delayMs?: number; tilt?: number; side?: "left" | "right" } | undefined, flavor: Flavor<P>): LqgRevealAttributes;
export function lqgReveal(personality: string, options: { delayMs?: number; tilt?: number; side?: "left" | "right" } = {}, flavor: Flavor = glassFlavor): LqgRevealAttributes {
  const config = requireReveal(flavor);
  const attributes: LqgRevealAttributes = { [dataAttr(flavor, config.attributes.reveal)]: personality };
  const delay = Number.isFinite(options.delayMs) ? Math.min(Math.max(Math.floor(options.delayMs!), 0), config.stagger.maxDelayMs) : 0;
  if (delay > 0) attributes[dataAttr(flavor, config.attributes.delay)] = String(delay);
  if (Number.isFinite(options.tilt) && options.tilt! > 0) attributes[dataAttr(flavor, config.attributes.tilt)] = String(Math.min(options.tilt!, config.tiltLimit));
  if (options.side === "left" || options.side === "right") attributes[dataAttr(flavor, config.attributes.side)] = options.side;
  return attributes;
}

/** `data-lqg-drag` with a depth factor from 0.4 to 1. The names and the range come from the flavor. */
export function lqgDrag(depth: number, flavor: Flavor = glassFlavor): LqgRevealAttributes {
  const config = requireReveal(flavor);
  const { min, max } = config.drag.depth;
  const clamped = Number.isFinite(depth) ? clamp(depth, min, max) : min;
  return { [dataAttr(flavor, config.attributes.drag)]: "", [dataAttr(flavor, config.attributes.depth)]: String(clamped) };
}

/** The attributes to put on a parent so the targets that arrive together stagger, for a flavor. */
export function revealGroupAttributes(flavor: Flavor = glassFlavor): LqgRevealAttributes {
  return Object.freeze({ [dataAttr(flavor, requireReveal(flavor).attributes.group)]: "" });
}

/** The attributes to put on each line of a `mask` heading so the lines rise one after another, for a flavor. */
export function revealLineAttributes(flavor: Flavor = glassFlavor): LqgRevealAttributes {
  return Object.freeze({ [dataAttr(flavor, requireReveal(flavor).attributes.line)]: "" });
}

/** Put on a parent so the targets that arrive together stagger. */
export const LQG_REVEAL_GROUP: LqgRevealAttributes = revealGroupAttributes(glassFlavor);

/** Put on each line of a `mask` heading so the lines rise one after another. Give the line `display: block` (or inline-block). */
export const LQG_LINE: LqgRevealAttributes = revealLineAttributes(glassFlavor);
