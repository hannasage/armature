/**
 * The glass flavor: every name and number that makes the engine feel like liquid glass.
 *
 * The prefix is `lqg`, so every CSS variable, data attribute, and class keeps the name it always had.
 * A value here is a copy of the constant it replaced, and a test pins each one to the frozen legacy code.
 *
 * This file imports types only, apart from `lerp`, so the engine can import it without a cycle.
 */
import type { FeelOptions, Flavor, LensFlavor, PersonalitySpec, RevealFlavor, StartContext, StartInput, SurfaceFlavor } from "../engine/flavor";
import { lerp } from "../engine/math";
import type { SpringConfig } from "../engine/spring";

/** The four ways a glass piece can arrive. */
export type RevealPersonality = "drop" | "mask" | "slide" | "fade";
export const REVEAL_PERSONALITIES: readonly RevealPersonality[] = ["drop", "mask", "slide", "fade"];

const freeze = (config: SpringConfig): Readonly<SpringConfig> => Object.freeze({ ...config });

// ---- springs ----

/** The lens position. A little overshoot, so it feels like liquid. */
const lensX = freeze({ stiffness: 210, damping: 20, mass: 1 });
/** The lens width. Looser than position, so the lens breathes as it travels. */
const lensWidth = freeze({ stiffness: 180, damping: 12, mass: 1 });
/** A press. Almost critically damped, so it settles without a visible bounce. */
const press = freeze({ stiffness: 170, damping: 26, mass: 1 });
/** Letting go of a press. Underdamped on purpose, so the surface springs a little past its rest size. */
const release = freeze({ stiffness: 300, damping: 14, mass: 1 });
/** A soft follow. */
const gentle = freeze({ stiffness: 120, damping: 14, mass: 1 });
/** A firm follow. */
const stiff = freeze({ stiffness: 210, damping: 20, mass: 1 });

/**
 * The spring of a slow reveal and of a fast one, on the progress `p` (travel 1). The slow one is `gentle` with a little more
 * damping, and the fast one is `lensWidth`'s wobble with a little more damping. They give 3.5 and 12.0 percent overshoot.
 */
const revealSlow: SpringConfig = Object.freeze({ stiffness: 120, damping: 16, mass: 1, restSpeed: 0.02, restDelta: 0.002 });
const revealFast: SpringConfig = Object.freeze({ stiffness: 180, damping: 15, mass: 1, restSpeed: 0.02, restDelta: 0.002 });
/** The spring of a `fade`: nearly critically damped, so a form field never overshoots. */
const revealCalm: SpringConfig = Object.freeze({ stiffness: 170, damping: 28, mass: 1, restSpeed: 0.02, restDelta: 0.002 });
/** The spring that pulls a dragged element after its target and back to 0. Slightly under critical. */
const dragSpring: SpringConfig = Object.freeze({ stiffness: 170, damping: 22, mass: 1, restSpeed: 0.1, restDelta: 0.02 });

// ---- surface ----

/**
 * Named motion settings for one element. `calm` is a lighter press (0.985), a release that overshoots less, and a glow that
 * reaches a neighbour at half strength.
 */
const feels: Readonly<Record<string, FeelOptions>> = Object.freeze({
  calm: Object.freeze({ pressScale: 0.985, neighborShare: 0.5, springs: Object.freeze({ release: Object.freeze({ stiffness: 300, damping: 17 }) }) }),
});

const surface: SurfaceFlavor = {
  vars: { press: "press", flex: "flex", specX: "spec-x", specY: "spec-y", glow: "glow" },
  attributes: { surface: "", group: "group", feel: "feel" },
  springKeys: { press: "press", release: "release" },
  rest: { restDelta: 0.0005, restSpeed: 0.01 },
  defaults: { pressScale: 0.97, flex: 0.5, glowFalloff: 160, neighborShare: 1, specularRest: { x: 50, y: 0 } },
  specularTauMs: 90,
  glowTauMs: 140,
  hoverGlow: 0.6,
  feels,
};

// ---- lens ----

const lens: LensFlavor = {
  vars: { x: "lens-x", y: "lens-y", w: "lens-w", h: "lens-h", sx: "lens-sx", sy: "lens-sy" },
  readyAttribute: "lens",
  readyValue: "ready",
  springKeys: { x: "lensX", width: "lensWidth" },
  pixelRest: { restDelta: 0.05, restSpeed: 1 },
  stretchVelocity: 10_000,
  maxStretch: 0.12,
};

// ---- reveal personalities ----

/** How far a `drop` starts from its place, in px: slow scroll, fast scroll. */
export const OFFSET_SLOW = 28;
export const OFFSET_FAST = 110;
/** How far a `slide` starts to the side, in px. */
export const SLIDE_SLOW = 40;
export const SLIDE_FAST = 120;
/** How far a `slide` starts below or above its place, in px: slow scroll, fast scroll. */
export const SLIDE_RISE_SLOW = 8;
export const SLIDE_RISE_FAST = 24;
/** How far a `fade` rises. It does not depend on speed. */
export const FADE_RISE = 12;
/** The scale a `drop` starts from. */
export const DROP_SCALE = 0.94;
/** The most a `drop` tilts at the start, in degrees. A slow scroll tilts less. The tilt attribute can raise it, to `TILT_LIMIT`. */
export const TILT_SLOW = 0.6;
export const TILT_FAST = 1.5;
export const TILT_LIMIT = 4;
/** A `mask` line rises through its clip by this fraction of its own height, slow and fast. */
export const MASK_RISE_SLOW = 0.6;
export const MASK_RISE_FAST = 1;
/** The tallest line height a `mask` counts, in px, and the height it assumes when the line has none. */
export const MASK_HEIGHT_MAX = 96;
export const MASK_HEIGHT_FALLBACK = 24;

const drop: PersonalitySpec = {
  spring: "speed",
  clips: false,
  scaleRotate: true,
  hiddenTranslate: true,
  start(input: StartInput, { t, direction }: StartContext) {
    const limit = Number.isFinite(input.tilt) && input.tilt! > 0 ? Math.min(input.tilt!, TILT_LIMIT) : TILT_FAST;
    // The tilt grows with speed up to the limit. Its sign follows the scroll: down tilts one way, up the other.
    const tilt = lerp(Math.min(TILT_SLOW, limit), limit, t);
    return { x: 0, y: direction * lerp(OFFSET_SLOW, OFFSET_FAST, t), scale: DROP_SCALE, rotate: direction * tilt };
  },
};

const mask: PersonalitySpec = {
  spring: "speed",
  clips: true,
  scaleRotate: false,
  hiddenTranslate: false,
  start(input: StartInput, { t, direction }: StartContext) {
    const height = Number.isFinite(input.height) && input.height! > 0 ? Math.min(input.height!, MASK_HEIGHT_MAX) : MASK_HEIGHT_FALLBACK;
    return { x: 0, y: direction * height * lerp(MASK_RISE_SLOW, MASK_RISE_FAST, t), scale: 1, rotate: 0 };
  },
};

const slide: PersonalitySpec = {
  spring: "speed",
  clips: false,
  scaleRotate: false,
  hiddenTranslate: true,
  start(input: StartInput, { t, direction }: StartContext) {
    const side = input.side ?? ((input.index ?? 0) % 2 === 0 ? -1 : 1);
    return { x: side * lerp(SLIDE_SLOW, SLIDE_FAST, t), y: direction * lerp(SLIDE_RISE_SLOW, SLIDE_RISE_FAST, t), scale: 1, rotate: 0 };
  },
};

const fade: PersonalitySpec = {
  spring: "calm",
  clips: false,
  scaleRotate: false,
  hiddenTranslate: true,
  start(_input: StartInput, { direction }: StartContext) {
    return { x: 0, y: direction * FADE_RISE, scale: 1, rotate: 0 };
  },
};

const reveal: RevealFlavor<RevealPersonality> = {
  attributes: {
    reveal: "reveal",
    group: "reveal-group",
    delay: "reveal-delay",
    revealed: "revealed",
    drag: "drag",
    depth: "depth",
    tilt: "tilt",
    side: "side",
    line: "line",
  },
  delayProperty: "reveal-delay",
  personalities: Object.freeze({ drop, mask, slide, fade }),
  fallback: "drop",
  velocity: { slow: 400, fast: 3200 },
  springs: { slow: revealSlow, fast: revealFast, calm: revealCalm },
  stagger: { stepMs: 60, maxSteps: 6, maxDelayMs: 2000 },
  foldPercent: 8,
  safetyMs: 2500,
  tiltLimit: TILT_LIMIT,
  opacityDone: 0.6,
  clipSide: "-8px",
  hints: { move: "translate, scale, rotate, opacity", clip: "clip-path", drag: "translate, rotate" },
  drag: {
    shiftMax: 6,
    rotateMax: 0.8,
    fullVelocity: 1600,
    depth: { min: 0.4, max: 1, fallback: 0.7 },
    spring: dragSpring,
  },
};

/** The keys of the glass spring presets. */
export type GlassSpringKey = "lensX" | "lensWidth" | "press" | "release" | "gentle" | "stiff";

/**
 * The glass flavor, with the surface, lens, and reveal parts present. Its springs are typed by key, so a misspelt
 * preset name is a compile error. It still fits wherever a `Flavor` is expected.
 */
export type GlassFlavor = Omit<Flavor<RevealPersonality>, "springs" | "surface" | "lens" | "reveal"> & {
  readonly springs: Readonly<Record<GlassSpringKey, Readonly<SpringConfig>>>;
  readonly surface: SurfaceFlavor;
  readonly lens: LensFlavor;
  readonly reveal: RevealFlavor<RevealPersonality>;
};

/** Freezes an object and everything it holds, except functions. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value;
  Object.freeze(value);
  // A nested object may be unfrozen even when its parent was already frozen, so always walk down.
  for (const inner of Object.values(value)) deepFreeze(inner);
  return value;
}

export const glassFlavor: GlassFlavor = deepFreeze({
  name: "glass",
  prefix: "lqg",
  logLabel: "liquid-glass",
  springs: { lensX, lensWidth, press, release, gentle, stiff },
  surface,
  lens,
  reveal,
});
