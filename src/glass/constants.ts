/**
 * The glass flavor's names and numbers, as named constants. Each one is read from `glassFlavor`, so the values live in one place.
 * The attribute and variable names keep the `lqg` prefix.
 */
import { cssVar, dataAttr, type FeelOptions } from "../engine/flavor";
import { glassFlavor } from "./flavor";
import { revealRootMargin } from "../dom/reveal";
import { staggerDelayFor } from "../dom/reveal-motion";

const surface = glassFlavor.surface;
const reveal = glassFlavor.reveal;

/** The prefix on every CSS class, custom property, and data attribute the glass flavor ships. */
export const LQG_PREFIX = "lqg";

// ---- surface ----

/** The attribute that marks an element as a glass surface. */
export const SURFACE_ATTRIBUTE = dataAttr(glassFlavor, surface.attributes.surface);
/** Elements in one group light each other. The value is a name of letters, digits, `-` and `_`. */
export const GROUP_ATTRIBUTE = dataAttr(glassFlavor, surface.attributes.group);
/** Names a quieter or livelier way for one element to move. The value is a key of `FEELS`; an unknown name is ignored. */
export const FEEL_ATTRIBUTE = dataAttr(glassFlavor, surface.attributes.feel);

/**
 * Named motion settings for one element, so a page can calm a few surfaces and leave the rest as they are.
 * `calm` is a lighter press (0.985), a release that overshoots less, and a glow that reaches a neighbour at half strength.
 */
export const FEELS: Readonly<Record<string, FeelOptions>> = surface.feels;

// ---- reveal ----

export const REVEAL_ATTRIBUTE = dataAttr(glassFlavor, reveal.attributes.reveal);
export const REVEAL_GROUP_ATTRIBUTE = dataAttr(glassFlavor, reveal.attributes.group);
export const REVEAL_DELAY_ATTRIBUTE = dataAttr(glassFlavor, reveal.attributes.delay);
/** Set on an element when it has been decided: `now` when it was shown at once, `true` when it was sprung in. */
export const REVEALED_ATTRIBUTE = dataAttr(glassFlavor, reveal.attributes.revealed);
export const DRAG_ATTRIBUTE = dataAttr(glassFlavor, reveal.attributes.drag);
export const DEPTH_ATTRIBUTE = dataAttr(glassFlavor, reveal.attributes.depth);
/** The most a `drop` tilts, in degrees. */
export const TILT_ATTRIBUTE = dataAttr(glassFlavor, reveal.attributes.tilt);
/** `left` or `right`: which side a `slide` comes from. Without it, a slide alternates by its index in the group. */
export const SIDE_ATTRIBUTE = dataAttr(glassFlavor, reveal.attributes.side);
/** Marks a line of a `mask` heading. The lines rise one after another through the clip of the heading. */
export const LINE_ATTRIBUTE = dataAttr(glassFlavor, reveal.attributes.line);
/** Written on a revealed element: the stagger it started with, as a record. */
export const REVEAL_DELAY_PROPERTY = cssVar(glassFlavor, reveal.delayProperty);

export const SAFETY_MS = reveal.safetyMs;
/** An element whose top is in the lowest 8 percent of the viewport still waits, so a reveal is seen and not spent at the screen edge. */
export const FOLD_PERCENT = reveal.foldPercent;
/** The root margin of the intersection observer: the fold, as a negative bottom margin. */
export const ROOT_MARGIN = revealRootMargin(glassFlavor);

/** At or below this speed (px per second) a scroll is slow. */
export const SLOW_VELOCITY = reveal.velocity.slow;
/** At or above this speed a scroll is fast. In between, the start pose and the spring are blended. */
export const FAST_VELOCITY = reveal.velocity.fast;

/** The stagger between siblings that arrive together, in ms, and the step at which it stops growing. */
export const REVEAL_STAGGER_MS = reveal.stagger.stepMs;
export const REVEAL_MAX_STEPS = reveal.stagger.maxSteps;
export const REVEAL_MAX_DELAY_MS = reveal.stagger.maxDelayMs;

/**
 * The glass stagger: 60 ms a step, capped at 6 steps. It takes the index alone, so it can be passed to `map`.
 */
export const staggerDelay = (index: number): number => staggerDelayFor(index, glassFlavor);

/** The drag of a revealed element while the page scrolls (GI-70). */
export const DRAG_SHIFT_MAX = reveal.drag.shiftMax;
export const DRAG_ROTATE_MAX = reveal.drag.rotateMax;
/** At this speed (px per second) the drag is at its full size. */
export const DRAG_FULL_VELOCITY = reveal.drag.fullVelocity;
export const DEPTH_MIN = reveal.drag.depth.min;
export const DEPTH_MAX = reveal.drag.depth.max;
/** The depth of an element with no depth attribute, or one that is not a number. */
export const DEPTH_DEFAULT = reveal.drag.depth.fallback;
