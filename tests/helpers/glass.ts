/**
 * Glass-bound factories for the tests. The engine and DOM functions take a flavor as a required argument. These wrappers pass the
 * glass flavor, so a test that checks the glass behavior keeps the call shape it always had.
 */
import { glassFlavor, type RevealPersonality } from "../../src/glass/flavor";
import {
  attachSurface as attachSurfaceWith,
  createSurface as createSurfaceWith,
  type Surface,
  type SurfaceController,
  type SurfaceElement,
  type SurfaceOptions as FlavoredSurfaceOptions,
} from "../../src/dom/surface";
import { createLens as createLensWith, type Lens, type LensOptions as FlavoredLensOptions } from "../../src/dom/lens";
import { installDelegation as installDelegationWith, type Delegate, type DelegateOptions as FlavoredDelegateOptions, type DelegateRoot } from "../../src/dom/delegate";
import {
  belowFold as belowFoldWith,
  createScrollReveal as createScrollRevealWith,
  revealRootMargin as revealRootMarginWith,
  startScrollReveal as startScrollRevealWith,
  type GuardedStartOptions as FlavoredGuardedStartOptions,
  type ScrollRevealController,
  type ScrollRevealOptions as FlavoredScrollRevealOptions,
} from "../../src/dom/reveal";
import {
  dragTarget as dragTargetWith,
  parseDelay as parseDelayWith,
  parseDepth as parseDepthWith,
  parsePersonality as parsePersonalityWith,
  revealPose as revealPoseWith,
  revealSpring as revealSpringWith,
  revealStart as revealStartWith,
  velocityBlend as velocityBlendWith,
  type RevealPose,
  type RevealStart,
  type StartInput,
} from "../../src/dom/reveal-motion";
import { mountScrollReveal as mountScrollRevealWith, type MountScrollRevealOptions as FlavoredMountScrollRevealOptions, type RevealHost } from "../../src/dom/reveal-mount";
import { guardedSetup as guardedSetupWith } from "../../src/engine/guard";
import type { SpringConfig } from "../../src/engine/spring";

export type SurfaceOptions = Omit<FlavoredSurfaceOptions, "flavor">;
export type LensOptions = Omit<FlavoredLensOptions, "flavor">;
export type DelegateOptions = Omit<FlavoredDelegateOptions, "flavor">;
export type ScrollRevealOptions = Omit<FlavoredScrollRevealOptions, "flavor">;
export type GuardedStartOptions = Omit<FlavoredGuardedStartOptions, "flavor">;
export type MountScrollRevealOptions = Omit<FlavoredMountScrollRevealOptions, "flavor">;

// ---- surface, lens, delegation ----

export const createSurface = (element: Pick<SurfaceElement, "getBoundingClientRect">, options: SurfaceOptions = {}): SurfaceController =>
  createSurfaceWith(element, { ...options, flavor: glassFlavor });

export const attachSurface = (element: SurfaceElement, options: SurfaceOptions = {}): Surface => attachSurfaceWith(element, { ...options, flavor: glassFlavor });

export const createLens = (options: LensOptions): Lens => createLensWith({ ...options, flavor: glassFlavor });

export const installDelegation = (root: DelegateRoot, options: DelegateOptions = {}): Delegate => installDelegationWith(root, { ...options, flavor: glassFlavor });

// ---- scroll reveal ----

export const createScrollReveal = (options: ScrollRevealOptions): ScrollRevealController => createScrollRevealWith({ ...options, flavor: glassFlavor });

export const startScrollReveal = (create: () => ScrollRevealController, options: GuardedStartOptions = {}): ScrollRevealController | null =>
  startScrollRevealWith(create, { ...options, flavor: glassFlavor });

export const mountScrollReveal = (host: RevealHost, options: MountScrollRevealOptions = {}): (() => void) => mountScrollRevealWith(host, { ...options, flavor: glassFlavor });

export const revealRootMargin = (): string => revealRootMarginWith(glassFlavor);

export const belowFold = (top: number, viewportHeight: number): boolean => belowFoldWith(top, viewportHeight, glassFlavor);

// ---- scroll reveal numbers ----

export const velocityBlend = (velocity: number): number => velocityBlendWith(velocity, glassFlavor);

export const revealSpring = (velocity: number): SpringConfig => revealSpringWith(velocity, glassFlavor);

export const parsePersonality = (value: string | null | undefined): RevealPersonality => parsePersonalityWith(value, glassFlavor);

export const parseDelay = (value: string | null | undefined): number => parseDelayWith(value, glassFlavor);

export const revealStart = (input: StartInput<RevealPersonality>): RevealStart => revealStartWith(input, glassFlavor);

export const revealPose = (start: RevealStart, p: number): RevealPose => revealPoseWith(start, p, glassFlavor);

export const parseDepth = (value: string | null | undefined): number => parseDepthWith(value, glassFlavor);

export const dragTarget = (velocity: number, depth: number): { shift: number; turn: number } => dragTargetWith(velocity, depth, glassFlavor);

// ---- guard ----

export const guardedSetup = (context: string, setup: () => (() => void) | void, report?: (error: unknown, context: string) => void): (() => void) =>
  guardedSetupWith(context, setup, report, glassFlavor);
