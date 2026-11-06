/**
 * Attribute helpers for server markup (GI-70). A server component spreads these onto an element, so the markup names its own
 * personality, delay, and drag depth. They are plain objects and need no browser.
 *
 * Each helper takes the flavor as its last argument. The glass flavor binds them in `glass/reveal-attrs.ts`.
 */
import { dataAttr, requireReveal, type Flavor } from "../engine/flavor";
import { clamp } from "../engine/math";

export type ArmatureRevealAttributes = Record<string, string>;

export interface RevealAttributeOptions {
  delayMs?: number;
  tilt?: number;
  side?: "left" | "right";
}

/**
 * The reveal attribute, with an optional extra delay in ms (up to the flavor's limit), for a tilting personality a larger tilt in degrees
 * (up to the flavor's limit), and for a sliding one the side it comes from (`left` or `right`, otherwise it alternates by its index in
 * the group). The names and limits come from the flavor.
 */
export function revealAttributes<P extends string>(personality: P, options: RevealAttributeOptions | undefined, flavor: Flavor<P>): ArmatureRevealAttributes;
export function revealAttributes(personality: string, options: RevealAttributeOptions | undefined, flavor: Flavor): ArmatureRevealAttributes {
  const config = requireReveal(flavor);
  const { delayMs, tilt, side } = options ?? {};
  const attributes: ArmatureRevealAttributes = { [dataAttr(flavor, config.attributes.reveal)]: personality };
  const delay = Number.isFinite(delayMs) ? Math.min(Math.max(Math.floor(delayMs!), 0), config.stagger.maxDelayMs) : 0;
  if (delay > 0) attributes[dataAttr(flavor, config.attributes.delay)] = String(delay);
  if (Number.isFinite(tilt) && tilt! > 0) attributes[dataAttr(flavor, config.attributes.tilt)] = String(Math.min(tilt!, config.tiltLimit));
  if (side === "left" || side === "right") attributes[dataAttr(flavor, config.attributes.side)] = side;
  return attributes;
}

/** The drag attribute with a depth factor inside the flavor's range. The names and the range come from the flavor. */
export function dragAttributes(depth: number, flavor: Flavor): ArmatureRevealAttributes {
  const config = requireReveal(flavor);
  const { min, max } = config.drag.depth;
  const clamped = Number.isFinite(depth) ? clamp(depth, min, max) : min;
  return { [dataAttr(flavor, config.attributes.drag)]: "", [dataAttr(flavor, config.attributes.depth)]: String(clamped) };
}

/** The attributes to put on a parent so the targets that arrive together stagger, for a flavor. */
export function revealGroupAttributes(flavor: Flavor): ArmatureRevealAttributes {
  return Object.freeze({ [dataAttr(flavor, requireReveal(flavor).attributes.group)]: "" });
}

/** The attributes to put on each line of a `mask` heading so the lines rise one after another, for a flavor. */
export function revealLineAttributes(flavor: Flavor): ArmatureRevealAttributes {
  return Object.freeze({ [dataAttr(flavor, requireReveal(flavor).attributes.line)]: "" });
}
