/**
 * A flavor is the data that makes the engine feel like one product. The engine holds the physics and the
 * browser plumbing. A flavor holds the names, the numbers, and the spring presets.
 *
 * Every name in a flavor is a suffix. The flavor has one prefix, and two helpers build the full names:
 * `cssVar(flavor, "press")` gives `--<prefix>-press`, and
 * `dataAttr(flavor, "group")` gives `data-<prefix>-group`.
 *
 * This file holds types and small pure helpers only.
 */
import type { SpringConfig } from "./spring";

/**
 * The options one named feel sets for a surface. A surface takes these on top of the flavor, and each one beats the flavor's default.
 * `SurfaceOptions` extends this interface.
 */
export interface FeelOptions {
  /** The scale while pressed. The default comes from the flavor. */
  pressScale?: number;
  /** How much the surface squashes while pressed. 0 turns it off. The default comes from the flavor. */
  flex?: number;
  /** Distance in pixels at which a neighbour's glow falls to 1/e. The default comes from the flavor. */
  glowFalloff?: number;
  /** The share of its own glow a neighbour gets, from 0 to 1. The default comes from the flavor. A quiet surface lights its neighbours less. */
  neighborShare?: number;
  /** Where the specular rests, in percent of the element. The default comes from the flavor. */
  specularRest?: { x: number; y: number };
  springs?: { press?: SpringConfig; release?: SpringConfig };
}

/** Two thresholds that say when a spring has stopped. Both are finite numbers above 0. Every part of a flavor that rests uses this one shape. */
export interface RestLimits {
  /** The spring rests when its distance from the target is below this. */
  readonly restDelta: number;
  /** The spring rests when its speed is below this. */
  readonly restSpeed: number;
}

export interface Flavor<P extends string = string> {
  /** A short name for the flavor, for messages and tests. */
  readonly name: string;
  /** The prefix of every CSS variable, data attribute, and class the flavor writes. Letters, digits, and hyphens. */
  readonly prefix: string;
  /** The label in front of a logged error, without brackets. The engine adds the brackets. */
  readonly logLabel: string;
  /** Named spring presets. The surface and lens flavors refer to these by key. */
  readonly springs: Readonly<Record<string, Readonly<SpringConfig>>>;
  readonly surface?: SurfaceFlavor;
  readonly lens?: LensFlavor;
  readonly reveal?: RevealFlavor<P>;
  /** Named followers: one number that springs toward a target and is written as a CSS variable. */
  readonly followers?: FollowerFlavor;
  /** Drag, decay, snap, and swipe: the numbers `createDrag` from `@hannasage/armature/gesture` reads. */
  readonly gesture?: GestureFlavor;
  /** Named sequences and default curves: the names `createTimeline` from `@hannasage/armature/timeline` reads. */
  readonly timeline?: TimelineFlavor;
  readonly layout?: { readonly springKeys: { readonly move: string; readonly exit?: string }; readonly rest: RestLimits };
}

/** One named sequence of a timeline: keys that name their curve or spring by a key of `TimelineFlavor.curves` or of `Flavor.springs`. */
export interface TimelineSequence {
  /** `[time in ms, value, step?]`. The times do not go back. A step is a name, and a key with no step takes the default curve. */
  readonly keys: ReadonlyArray<readonly [time: number, value: number, step?: string]>;
}

/**
 * The timeline part of a flavor. Every piece is optional, and the empty part is valid. A name is lowercase letters, digits, and hyphens, and starts
 * with a letter. A curve name must not be the key of a spring, because a step names one or the other.
 */
export interface TimelineFlavor {
  /** Named cubic-bezier curves, as `[x1, y1, x2, y2]` control points, with x1 and x2 from 0 to 1. */
  readonly curves?: Readonly<Record<string, readonly [x1: number, y1: number, x2: number, y2: number]>>;
  /** A key in `curves`. A key of a track that names no step takes this curve. */
  readonly defaultCurve?: string;
  readonly sequences?: Readonly<Record<string, TimelineSequence>>;
}

/** The gesture part of a flavor. A drag writes the individual CSS property `translate`, so the part names no variable and no attribute. */
export interface GestureFlavor {
  /** The friction constant c of the decay v' = -c v, per second. Finite and above 0. */
  readonly friction: number;
  /**
   * The band past the bounds. `stiffness` is the stiffness of the pull back at the bound. A band at distance d is `1 + d / reach` times as stiff,
   * and `reach` is also the most overshoot a pointer can show, in pixels.
   */
  readonly rubberBand: { readonly stiffness: number; readonly reach: number };
  /** A release fires a swipe when its speed (px per second) and its distance (px) both reach these. */
  readonly swipe: { readonly velocity: number; readonly distance: number };
  /** Keys into `Flavor.springs`. `snap` is the spring a release springs on to the nearest snap point. */
  readonly springKeys: { readonly snap: string };
  /** The decay stops when its speed (px per second) is below `restSpeed`. A spring uses both limits, under any it sets itself. */
  readonly rest: RestLimits;
}

/** One follower. The name is the key in the `followers` record. */
export interface FollowerSpec {
  /** The suffix of the CSS variable the follower writes. The value is a bare number. */
  readonly var: string;
  /** A key into `Flavor.springs`. */
  readonly springKey: string;
  /** The rest thresholds merged under the spring. A spring that sets its own thresholds keeps them. */
  readonly rest: RestLimits;
}

/** The follower part of a flavor: a record from a follower name to its spec. */
export type FollowerFlavor = Readonly<Record<string, FollowerSpec>>;

export interface SurfaceFlavor {
  /**
   * False turns the specular glint off. The surface then writes no glint variable, follows no pointer position, and asks for no frame
   * on a pointer move. Default true. The variable names in `vars` are still required and are never written.
   */
  readonly specular?: boolean;
  /**
   * False turns the glow off, for the surface and for its neighbors. The surface then writes no glow variable, measures no neighbor,
   * and asks for no frame because of a hover or a press. Default true.
   */
  readonly glow?: boolean;
  /** Suffixes of the CSS variables the surface writes. */
  readonly vars: { readonly press: string; readonly flex: string; readonly specX: string; readonly specY: string; readonly glow: string };
  /** Suffixes of the data attributes that mark a surface, a group, and a feel. An empty suffix is the bare `data-<prefix>`. */
  readonly attributes: { readonly surface: string; readonly group: string; readonly feel: string };
  /** Keys into `Flavor.springs`. */
  readonly springKeys: { readonly press: string; readonly release: string };
  /** The rest thresholds merged under every surface spring. */
  readonly rest: RestLimits;
  readonly defaults: {
    readonly pressScale: number;
    readonly flex: number;
    readonly glowFalloff: number;
    readonly neighborShare: number;
    readonly specularRest: { readonly x: number; readonly y: number };
  };
  /** Time constants, in milliseconds, of the exponential follow of the specular glint and the glow. */
  readonly specularTauMs: number;
  readonly glowTauMs: number;
  /** The glow level while the pointer hovers. */
  readonly hoverGlow: number;
  /** Named feels. The value of the feel attribute picks one. */
  readonly feels: Readonly<Record<string, FeelOptions>>;
}

export interface LensFlavor {
  /** Suffixes of the CSS variables the lens writes. */
  readonly vars: { readonly x: string; readonly y: string; readonly w: string; readonly h: string; readonly sx: string; readonly sy: string };
  /** The suffix of the attribute that says the lens is showing, and the value it takes. */
  readonly readyAttribute: string;
  readonly readyValue: string;
  /** Keys into `Flavor.springs`. */
  readonly springKeys: { readonly x: string; readonly width: string };
  /** The rest thresholds merged under the lens springs. Pixels need only look still. */
  readonly rest: RestLimits;
  /** Speed, in pixels per second, that adds 100 percent of stretch. */
  readonly stretchVelocity: number;
  /** The most the lens stretches along x, as a fraction. */
  readonly maxStretch: number;
}

/** The start pose of one piece. All the numbers are at progress 0. */
export interface RevealStart {
  /** Pixels. */
  x: number;
  y: number;
  scale: number;
  /** Degrees. */
  rotate: number;
}

/** What a personality is told about the scroll when it computes its start pose. */
export interface StartContext {
  /** 0 for a slow scroll and 1 for a fast one. */
  readonly t: number;
  /** +1 while the page scrolls down or is still, -1 while it scrolls up. */
  readonly direction: 1 | -1;
}

export interface StartInput<P extends string = string> {
  personality: P;
  velocity: number;
  /** The element's place among its group, from 0. */
  index?: number;
  /** Which side a sliding piece comes from, -1 for the left and 1 for the right. Beats the parity of `index`. */
  side?: -1 | 1;
  /** The most a tilting piece tilts, in degrees. */
  tilt?: number;
  /** The height of a clipped line, in px. */
  height?: number;
}

/**
 * One way of arriving. The engine never asks for a name. It asks the traits below, so a flavor can add a
 * personality without a change in the engine.
 */
export interface PersonalitySpec {
  /** The start pose at progress 0. `context` carries the speed blend and the scroll direction. */
  start(input: StartInput, context: StartContext): RevealStart;
  /** `speed` picks the spring that follows the scroll speed. `calm` always uses the calm spring. */
  readonly spring: "speed" | "calm";
  /** True when the piece is revealed through a clip. Its box hides and its lines (if any) move. */
  readonly clips: boolean;
  /** True when the piece writes `scale` and `rotate` along with `translate`. */
  readonly scaleRotate: boolean;
  /** True when a waiting piece is hidden with its start offset as well as with zero opacity. */
  readonly hiddenTranslate: boolean;
}

export interface RevealFlavor<P extends string = string> {
  /** Suffixes of the data attributes the reveal reads and writes. */
  readonly attributes: {
    readonly reveal: string;
    readonly group: string;
    readonly delay: string;
    readonly revealed: string;
    readonly drag: string;
    readonly depth: string;
    readonly tilt: string;
    readonly side: string;
    readonly line: string;
  };
  /** The suffix of the CSS variable that records the stagger a piece started with. */
  readonly delayProperty: string;
  readonly personalities: Readonly<Record<P, PersonalitySpec>>;
  /** The personality used for a name the flavor does not know. */
  readonly fallback: P;
  /** At or below `slow` (px per second) a scroll is slow. At or above `fast` it is fast. */
  readonly velocity: { readonly slow: number; readonly fast: number };
  readonly springs: { readonly slow: SpringConfig; readonly fast: SpringConfig; readonly calm: SpringConfig };
  readonly stagger: { readonly stepMs: number; readonly maxSteps: number; readonly maxDelayMs: number };
  /** A target whose top sits in the lowest part of the viewport (in percent) still waits. */
  readonly foldPercent: number;
  /** A timer shows anything still hidden and in view this many milliseconds after arming. */
  readonly safetyMs: number;
  /** The largest tilt a markup attribute may ask for, in degrees. */
  readonly tiltLimit: number;
  /** Opacity reaches 1 when the progress reaches this. */
  readonly opacityDone: number;
  /** How far the clip extends past the box on each side, as a CSS length. */
  readonly clipSide: string;
  /** The `will-change` values while a piece moves. */
  readonly hints: { readonly move: string; readonly clip: string; readonly drag: string };
  readonly drag: {
    readonly shiftMax: number;
    readonly rotateMax: number;
    /** At this speed (px per second) the drag is at its full size. */
    readonly fullVelocity: number;
    readonly depth: { readonly min: number; readonly max: number; readonly fallback: number };
    readonly spring: SpringConfig;
  };
}

/** `--<prefix>-<suffix>`. */
export function cssVar(flavor: Pick<Flavor, "prefix">, suffix: string): string {
  return `--${flavor.prefix}-${suffix}`;
}

/** `data-<prefix>-<suffix>`, or the bare `data-<prefix>` when the suffix is empty. */
export function dataAttr(flavor: Pick<Flavor, "prefix">, suffix = ""): string {
  return suffix === "" ? `data-${flavor.prefix}` : `data-${flavor.prefix}-${suffix}`;
}

/**
 * The label that starts a logged error: `[<logLabel>]`. A missing flavor gives `[armature]`, so a call that forgot the flavor
 * can still log its own failure and does not throw while it reports one.
 */
export function logTag(flavor: Pick<Flavor, "logLabel"> | undefined): string {
  return `[${flavor?.logLabel ?? "armature"}]`;
}

function missing(flavor: Flavor, part: string): never {
  throw new TypeError(`The flavor "${flavor.name}" has no ${part} part.`);
}

const hasOwn = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);

function missingSpring(flavor: Flavor, key: string): never {
  throw new TypeError(`The flavor "${flavor.name}" has no spring named "${key}".`);
}

const PREFIX = /^[a-z][a-z0-9-]*$/;
const VARIABLE = PREFIX;
const checked = new WeakSet<object>();

/**
 * Checks that a flavor holds together, and throws a TypeError that names the flavor when it does not:
 * the prefix is lowercase letters, digits, and hyphens and starts with a letter, the log label is not empty,
 * the reveal fallback is one of the reveal personalities, every spring key names a spring in `springs`,
 * every surface switch is a boolean when it is set, and every follower has a unique variable name that no other part uses,
 * rest limits, and a spring key that names a spring in `springs`. A gesture part has a friction, a rubber band, swipe thresholds, rest limits,
 * and a snap spring key. Every spring and every rest limit holds finite numbers in range. The timeline part is not checked here, because the spring-only entry has no room for it:
 * `createTimeline` and `requireTimeline` from `@hannasage/armature/timeline` check it.
 * The require helpers call it, and a flavor that passes is not checked again.
 */
export function validateFlavor(flavor: Flavor): void {
  assertFlavor(flavor);
  if (checked.has(flavor)) return;
  const label = `The flavor "${flavor.name}"`;
  // The old names of the beta window get a clear error that says the new name.
  if ("follower" in flavor) throw new TypeError(`${label} has a "follower" part. Use "followers" instead.`);
  if (flavor.lens && "pixelRest" in flavor.lens) throw new TypeError(`${label} has a lens part with "pixelRest". Use "rest" instead.`);
  if (typeof flavor.prefix !== "string" || !PREFIX.test(flavor.prefix)) {
    throw new TypeError(`${label} has the prefix ${JSON.stringify(flavor.prefix)}. A prefix is lowercase letters, digits, and hyphens, and starts with a letter.`);
  }
  if (typeof flavor.logLabel !== "string" || flavor.logLabel === "") throw new TypeError(`${label} has an empty log label.`);
  if (typeof flavor.springs !== "object" || flavor.springs === null) throw new TypeError(`${label} has no springs object.`);
  for (const [key, spring] of Object.entries(flavor.springs)) checkSpring(label, key, spring);
  checkRest(label, "a surface rest", flavor.surface?.rest);
  checkRest(label, "a lens rest", flavor.lens?.rest);
  const reveal = flavor.reveal;
  if (reveal && !hasOwn(reveal.personalities, reveal.fallback)) {
    throw new TypeError(`${label} has the reveal fallback "${reveal.fallback}", which is not one of its personalities.`);
  }
  const keys = [...Object.values(flavor.surface?.springKeys ?? {}), ...Object.values(flavor.lens?.springKeys ?? {})];
  for (const key of keys) if (!hasOwn(flavor.springs, key)) missingSpring(flavor, key);
  for (const key of ["specular", "glow"] as const) {
    const value = flavor.surface?.[key];
    if (value !== undefined && typeof value !== "boolean") throw new TypeError(`${label} has a surface switch "${key}" that is not a boolean.`);
  }
  if (flavor.followers !== undefined) {
    if (typeof flavor.followers !== "object" || flavor.followers === null) throw new TypeError(`${label} has a follower part that is not an object.`);
    const taken = new Map<string, string>();
    const reserved: Array<[string, string[]]> = [
      ["surface", Object.values(flavor.surface?.vars ?? {})],
      ["lens", Object.values(flavor.lens?.vars ?? {})],
      ["reveal", flavor.reveal ? [flavor.reveal.delayProperty] : []],
    ];
    for (const [name, spec] of Object.entries(flavor.followers)) {
      if (typeof spec !== "object" || spec === null || typeof spec.var !== "string" || spec.var === "") {
        throw new TypeError(`${label} has a follower ${JSON.stringify(name)} with no variable name.`);
      }
      if (typeof spec.rest !== "object" || spec.rest === null) throw new TypeError(`${label} has a follower ${JSON.stringify(name)} with no rest limits.`);
      checkRest(label, `a follower ${JSON.stringify(name)} with a rest`, spec.rest);
      if (!VARIABLE.test(spec.var)) {
        throw new TypeError(`${label} has a follower ${JSON.stringify(name)} with the variable name ${JSON.stringify(spec.var)}. A variable name is lowercase letters, digits, and hyphens, and starts with a letter.`);
      }
      const owner = taken.get(spec.var);
      if (owner !== undefined) throw new TypeError(`${label} has the followers ${JSON.stringify(owner)} and ${JSON.stringify(name)} with the same variable name ${JSON.stringify(spec.var)}.`);
      taken.set(spec.var, name);
      for (const [part, names] of reserved) {
        if (names.includes(spec.var)) throw new TypeError(`${label} has a follower ${JSON.stringify(name)} with the variable name ${JSON.stringify(spec.var)}, which the ${part} already uses.`);
      }
      if (!hasOwn(flavor.springs, spec.springKey)) missingSpring(flavor, spec.springKey);
    }
  }
  if (flavor.gesture !== undefined) {
    const gesture = flavor.gesture as Partial<GestureFlavor> | null;
    if (typeof gesture !== "object" || gesture === null) throw new TypeError(`${label} has a gesture part that is not an object.`);
    const positive = (...numbers: unknown[]) => numbers.every((n) => isNumber(n) && n > 0);
    if (!positive(gesture.friction)) throw new TypeError(`${label} has a gesture part with a friction that is not a finite number above 0.`);
    if (!positive(gesture.rubberBand?.stiffness, gesture.rubberBand?.reach)) throw new TypeError(`${label} has a gesture part with a rubber band whose stiffness and reach are not both finite numbers above 0.`);
    if (!positive(gesture.swipe?.velocity, gesture.swipe?.distance)) throw new TypeError(`${label} has a gesture part whose swipe velocity and distance are not both finite numbers above 0.`);
    checkRest(label, "a gesture rest", gesture.rest ?? null);
    if (!hasOwn(flavor.springs, gesture.springKeys?.snap as string)) missingSpring(flavor, gesture.springKeys?.snap as string);
  }
  checked.add(flavor);
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** A spring needs a finite stiffness above 0, a finite damping of 0 or more, and a finite mass above 0 when it has one. */
function checkSpring(label: string, key: string, spring: unknown): void {
  const name = JSON.stringify(key);
  if (typeof spring !== "object" || spring === null) throw new TypeError(`${label} has a spring ${name} that is not an object.`);
  const { stiffness, damping, mass } = spring as Partial<SpringConfig>;
  if (!isNumber(stiffness) || stiffness <= 0) throw new TypeError(`${label} has a spring ${name} with a stiffness that is not a finite number above 0.`);
  if (!isNumber(damping) || damping < 0) throw new TypeError(`${label} has a spring ${name} with a damping that is not a finite number of 0 or more.`);
  if (mass !== undefined && (!isNumber(mass) || mass <= 0)) throw new TypeError(`${label} has a spring ${name} with a mass that is not a finite number above 0.`);
}

/** Rest limits are two finite numbers above 0. A part with no rest is left alone: the caller decides whether the part is needed. */
function checkRest(label: string, what: string, rest: unknown): void {
  if (rest === undefined) return;
  const { restDelta, restSpeed } = (typeof rest === "object" && rest !== null ? rest : {}) as { restDelta?: unknown; restSpeed?: unknown };
  if (!isNumber(restDelta) || restDelta <= 0 || !isNumber(restSpeed) || restSpeed <= 0) {
    throw new TypeError(`${label} has ${what} whose restDelta and restSpeed are not both finite numbers above 0.`);
  }
}

function deepFreeze(value: unknown, seen: Set<object>): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  for (const item of Object.values(value)) deepFreeze(item, seen);
  Object.freeze(value);
}

/**
 * Validates a flavor, freezes it at every level, and returns it. Use it to make a flavor.
 * A flavor is checked once, and the check is remembered, so a later change would go unseen. A frozen flavor cannot change.
 * A function in the flavor, such as the `start` of a personality, is left as it is. Nothing is frozen if the flavor does not hold together.
 */
export function defineFlavor<F extends Flavor>(flavor: F): F {
  validateFlavor(flavor);
  deepFreeze(flavor, new Set());
  return flavor;
}

/** Throws a clear TypeError when the argument is not an object. A number here usually means a function that takes a flavor was passed to `map`. */
function assertFlavor(flavor: unknown): asserts flavor is Flavor {
  if (typeof flavor !== "object" || flavor === null) {
    throw new TypeError(`Expected a flavor object, got ${flavor === null ? "null" : typeof flavor}. Check that a function that takes a flavor was not passed straight to map.`);
  }
}

/** The surface part of a flavor. Throws a clear error when the flavor has none or does not hold together. */
export function requireSurface(flavor: Flavor): SurfaceFlavor {
  validateFlavor(flavor);
  return flavor.surface ?? missing(flavor, "surface");
}

/** The lens part of a flavor. Throws a clear error when the flavor has none or does not hold together. */
export function requireLens(flavor: Flavor): LensFlavor {
  validateFlavor(flavor);
  return flavor.lens ?? missing(flavor, "lens");
}

/** The reveal part of a flavor. Throws a clear error when the flavor has none or does not hold together. */
export function requireReveal<P extends string>(flavor: Flavor<P>): RevealFlavor<P> {
  validateFlavor(flavor);
  return flavor.reveal ?? missing(flavor, "reveal");
}

/** One named follower of a flavor. Throws a clear error when the flavor has no followers part, no follower with that name, or does not hold together. */
export function requireFollower(flavor: Flavor, name: string): FollowerSpec {
  validateFlavor(flavor);
  if (flavor.followers === undefined) missing(flavor, "followers");
  if (!hasOwn(flavor.followers, name)) throw new TypeError(`The flavor "${flavor.name}" has no follower named "${name}".`);
  return flavor.followers[name];
}

/** A named spring from a flavor. Throws a clear error when the flavor has no spring with that key. */
export function springOf(flavor: Flavor, key: string): Readonly<SpringConfig> {
  assertFlavor(flavor);
  if (!hasOwn(flavor.springs, key)) missingSpring(flavor, key);
  return flavor.springs[key];
}

/** The spec of a personality. A name the flavor does not know gets the fallback. */
export function personalityOf<P extends string>(reveal: RevealFlavor<P>, name: string): PersonalitySpec {
  const known = Object.prototype.hasOwnProperty.call(reveal.personalities, name);
  return reveal.personalities[(known ? name : reveal.fallback) as P];
}
