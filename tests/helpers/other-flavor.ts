import type { Flavor, PersonalitySpec, RevealFlavor, StartContext, StartInput } from "../../src/engine/flavor";

/**
 * A second flavor, with a different prefix, different names, and different numbers for everything.
 * The tests use it to prove that the engine reads the flavor and not a glass constant.
 */
const pop: PersonalitySpec = {
  spring: "speed",
  clips: false,
  scaleRotate: true,
  hiddenTranslate: false,
  start: (input: StartInput, { t, direction }: StartContext) => ({ x: 0, y: direction * (10 + 50 * t), scale: 0.5, rotate: direction * 3 }),
};
const wipe: PersonalitySpec = {
  spring: "speed",
  clips: true,
  scaleRotate: false,
  hiddenTranslate: false,
  start: (input: StartInput, { direction }: StartContext) => ({ x: 0, y: direction * (input.height ?? 20), scale: 1, rotate: 0 }),
};
const float: PersonalitySpec = {
  spring: "calm",
  clips: false,
  scaleRotate: false,
  hiddenTranslate: true,
  start: (input: StartInput, { direction }: StartContext) => ({ x: 0, y: direction * 7, scale: 1, rotate: 0 }),
};

export type AcmePersonality = "pop" | "wipe" | "float";

const reveal: RevealFlavor<AcmePersonality> = {
  attributes: { reveal: "enter", group: "enter-group", delay: "enter-delay", revealed: "entered", drag: "pull", depth: "weight", tilt: "lean", side: "from", line: "row" },
  delayProperty: "enter-delay",
  personalities: { pop, wipe, float },
  fallback: "float",
  velocity: { slow: 100, fast: 1000 },
  springs: {
    slow: { stiffness: 100, damping: 20, mass: 1, restSpeed: 0.03, restDelta: 0.003 },
    fast: { stiffness: 200, damping: 10, mass: 1, restSpeed: 0.03, restDelta: 0.003 },
    calm: { stiffness: 150, damping: 30, mass: 1, restSpeed: 0.03, restDelta: 0.003 },
  },
  stagger: { stepMs: 100, maxSteps: 3, maxDelayMs: 500 },
  foldPercent: 20,
  safetyMs: 1000,
  tiltLimit: 10,
  opacityDone: 0.5,
  clipSide: "-2px",
  hints: { move: "translate, opacity", clip: "clip", drag: "translate" },
  drag: { shiftMax: 12, rotateMax: 2, fullVelocity: 800, depth: { min: 0.2, max: 2, fallback: 1 }, spring: { stiffness: 140, damping: 18, mass: 1, restSpeed: 0.2, restDelta: 0.04 } },
};

export const acme: Flavor<AcmePersonality> & { surface: NonNullable<Flavor["surface"]>; lens: NonNullable<Flavor["lens"]>; reveal: RevealFlavor<AcmePersonality> } = {
  name: "acme",
  prefix: "acme",
  logLabel: "acme-motion",
  springs: {
    tap: { stiffness: 250, damping: 30, mass: 1 },
    letgo: { stiffness: 400, damping: 12, mass: 1 },
    slideX: { stiffness: 260, damping: 24, mass: 1 },
    slideW: { stiffness: 220, damping: 14, mass: 1 },
  },
  surface: {
    vars: { press: "squeeze", flex: "bend", specX: "shine-x", specY: "shine-y", glow: "halo" },
    attributes: { surface: "", group: "set", feel: "mood" },
    springKeys: { press: "tap", release: "letgo" },
    rest: { restDelta: 0.001, restSpeed: 0.02 },
    defaults: { pressScale: 0.9, flex: 0.25, glowFalloff: 80, neighborShare: 0.4, specularRest: { x: 20, y: 80 } },
    specularTauMs: 45,
    glowTauMs: 70,
    hoverGlow: 0.3,
    feels: { soft: { pressScale: 0.95 } },
  },
  lens: {
    vars: { x: "bar-x", y: "bar-y", w: "bar-w", h: "bar-h", sx: "bar-sx", sy: "bar-sy" },
    readyAttribute: "bar",
    readyValue: "on",
    springKeys: { x: "slideX", width: "slideW" },
    pixelRest: { restDelta: 0.1, restSpeed: 2 },
    stretchVelocity: 2000,
    maxStretch: 0.3,
  },
  reveal,
};
