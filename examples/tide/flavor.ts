/**
 * The Tide flavor: the movement language of a bottom sheet. It is the third Armature flavor.
 *
 * A sheet rises from the bottom of the screen, the page behind it dims, and its rows rise one after another. A finger drags
 * the sheet between three resting heights, and a flick down closes it. Rows that change order glide to their new places, and
 * a row can open into a full card.
 *
 * This file imports only from the public Armature entries, as a flavor in another repository would.
 * The prefix is `tide`, so every variable it writes starts with `--tide-`.
 */
import { criticalDamping, defineFlavor, type Flavor, type FollowerFlavor, type GestureFlavor, type TimelineFlavor } from "@hannasage/armature";
import type { LayoutFlavor } from "@hannasage/armature/layout";

// ---- springs ----

/** The sheet coming to rest on a height. A little overshoot, so the sheet lands with weight. */
const swell = Object.freeze({ stiffness: 380, damping: 30, mass: 1 });
/** The dim and every exit. Critically damped, so nothing bounces on the way out. */
const ebb = Object.freeze({ stiffness: 260, damping: criticalDamping(260, 1), mass: 1 });
/** A row that moves to a new place. Close to critical, so a list that changes order does not wobble. */
const drift = Object.freeze({ stiffness: 220, damping: 25, mass: 1 });
/** A row that rises into place. Loose, so the list ripples as it arrives. */
const ripple = Object.freeze({ stiffness: 140, damping: 11, mass: 1 });

// ---- followers ----

/** `dim`: how dark the page behind the sheet is, from 0 to 1. */
const followers: FollowerFlavor = {
  dim: { var: "dim", springKey: "ebb", rest: { restDelta: 0.001, restSpeed: 0.01 } },
};

// ---- gesture ----

/** The sheet under a finger. A flick of 900 px per second over 48 px is a swipe. */
const gesture: GestureFlavor = {
  friction: 6,
  rubberBand: { stiffness: 420, reach: 72 },
  swipe: { velocity: 900, distance: 48 },
  springKeys: { snap: "swell" },
  rest: { restDelta: 0.5, restSpeed: 6 },
};

// ---- timeline ----

/**
 * `rise`: the opacity of a row coming in. `settle-in`: the offset in pixels of the same row, which springs up on `ripple`.
 * `fade-out`: the opacity of a row going out.
 */
const timeline: TimelineFlavor = {
  curves: { "tide-out": [0.16, 1, 0.3, 1], "tide-in": [0.7, 0, 0.84, 0] },
  defaultCurve: "tide-out",
  sequences: {
    rise: { keys: [[0, 0], [220, 1]] },
    "settle-in": { keys: [[0, 24], [480, 0, "ripple"]] },
    "fade-out": { keys: [[0, 1], [160, 0, "tide-in"]] },
  },
};

// ---- layout ----

/** Rows move on `drift`, and the sheet leaves on `ebb`. A move rests within a quarter of a pixel. */
const layout: LayoutFlavor = {
  springKeys: { move: "drift", exit: "ebb" },
  rest: { restDelta: 0.25, restSpeed: 4 },
};

/** There is no surface, lens, or reveal part. A sheet has no press glint, no travelling indicator, and no scroll reveal. */
export const tide = defineFlavor<Flavor & { followers: FollowerFlavor; gesture: GestureFlavor; timeline: TimelineFlavor; layout: LayoutFlavor }>({
  name: "tide",
  prefix: "tide",
  logLabel: "tide-motion",
  springs: { swell, ebb, drift, ripple },
  followers,
  gesture,
  timeline,
  layout,
});
