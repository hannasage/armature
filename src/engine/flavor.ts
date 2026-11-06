/**
 * A flavor is the data that makes the engine feel like one product. The engine holds the physics and the
 * browser plumbing. A flavor holds the names, the numbers, and the spring presets.
 *
 * Every name in a flavor is a suffix. The flavor has one prefix, and two helpers build the full names:
 * `cssVar(flavor, "press")` gives `--lqg-press` for a flavor with the prefix `lqg`, and
 * `dataAttr(flavor, "group")` gives `data-lqg-group`.
 *
 * This file holds types and small pure helpers only.
 */
import type { SpringConfig } from "../core/spring";
import type { SurfaceOptions } from "../core/surface";
import type { RevealStart } from "../core/scroll-motion";

/** The options one named feel sets for a surface. */
export type FeelOptions = Omit<SurfaceOptions, "env" | "neighbors" | "flavor">;

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
}

export interface SurfaceFlavor {
  /** Suffixes of the CSS variables the surface writes. */
  readonly vars: { readonly press: string; readonly flex: string; readonly specX: string; readonly specY: string; readonly glow: string };
  /** Suffixes of the data attributes that mark a surface, a group, and a feel. An empty suffix is the bare `data-<prefix>`. */
  readonly attributes: { readonly surface: string; readonly group: string; readonly feel: string };
  /** Keys into `Flavor.springs`. */
  readonly springKeys: { readonly press: string; readonly release: string };
  /** The rest thresholds merged under every surface spring. */
  readonly rest: { readonly restDelta: number; readonly restSpeed: number };
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
  readonly pixelRest: { readonly restDelta: number; readonly restSpeed: number };
  /** Speed, in pixels per second, that adds 100 percent of stretch. */
  readonly stretchVelocity: number;
  /** The most the lens stretches along x, as a fraction. */
  readonly maxStretch: number;
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

/** The label that starts a logged error: `[<logLabel>]`. */
export function logTag(flavor: Pick<Flavor, "logLabel">): string {
  return `[${flavor.logLabel}]`;
}

function missing(flavor: Flavor, part: string): never {
  throw new TypeError(`The flavor "${flavor.name}" has no ${part} part.`);
}

/** The surface part of a flavor. Throws a clear error when the flavor has none. */
export function requireSurface(flavor: Flavor): SurfaceFlavor {
  return flavor.surface ?? missing(flavor, "surface");
}

/** The lens part of a flavor. Throws a clear error when the flavor has none. */
export function requireLens(flavor: Flavor): LensFlavor {
  return flavor.lens ?? missing(flavor, "lens");
}

/** The reveal part of a flavor. Throws a clear error when the flavor has none. */
export function requireReveal<P extends string>(flavor: Flavor<P>): RevealFlavor<P> {
  return flavor.reveal ?? missing(flavor, "reveal");
}

/** A named spring from a flavor. Throws a clear error when the flavor has no spring with that key. */
export function springOf(flavor: Flavor, key: string): Readonly<SpringConfig> {
  if (!Object.prototype.hasOwnProperty.call(flavor.springs, key)) {
    throw new TypeError(`The flavor "${flavor.name}" has no spring named "${key}".`);
  }
  return flavor.springs[key];
}

/** The spec of a personality. A name the flavor does not know gets the fallback. */
export function personalityOf<P extends string>(reveal: RevealFlavor<P>, name: string): PersonalitySpec {
  const known = Object.prototype.hasOwnProperty.call(reveal.personalities, name);
  return reveal.personalities[(known ? name : reveal.fallback) as P];
}
