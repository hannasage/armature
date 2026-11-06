/**
 * A damped spring: a = (-k (x - target) - c v) / m.
 *
 * The solver steps in fixed slices of 1/120 s (semi-implicit Euler) and keeps the leftover time in an
 * accumulator, so a 30, 60, or 144 Hz screen lands in the same place. The value it shows is the committed
 * state advanced by the leftover time, so the picture does not jump when a frame holds no whole slice.
 *
 * Every function is pure. A state is never changed after it is made.
 */

import { glassFlavor } from "../glass/flavor";

/** The fixed slice, in seconds. */
export const FIXED_STEP = 1 / 120;
/**
 * A frame longer than this is treated as this long, in seconds. It stops a stalled tab from fast-forwarding the spring.
 * Every frame loop in the package clamps its frame time to this one value.
 */
export const MAX_FRAME = 0.1;
/** The smallest slice the solver will use, so a huge stiffness cannot hang a frame. */
const MIN_STEP = 1 / 20_000;

const DEFAULT_REST_SPEED = 0.01;
const DEFAULT_REST_DELTA = 0.01;
const DEFAULT_STIFFNESS = 170;
const DEFAULT_DAMPING = 26;

export interface SpringConfig {
  /** k, in 1/s^2 per unit mass. Higher is snappier. */
  stiffness: number;
  /** c. Compare with `criticalDamping(stiffness, mass)`. */
  damping: number;
  /** m. Defaults to 1. */
  mass?: number;
  /** The spring rests when |velocity| is below this. Defaults to 0.01. */
  restSpeed?: number;
  /** The spring rests when |value - target| is below this. Defaults to 0.01. */
  restDelta?: number;
}

export interface ResolvedSpringConfig {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
  readonly restSpeed: number;
  readonly restDelta: number;
  /** The slice this spring steps with: 1/120 s, or smaller for an extreme spring so it stays stable. */
  readonly step: number;
}

export interface SpringState {
  /** The value to draw. */
  readonly value: number;
  /** The velocity to draw, in units per second. */
  readonly velocity: number;
  readonly target: number;
  readonly config: ResolvedSpringConfig;
  /** The value at the last whole slice. Internal. */
  readonly settledValue: number;
  /** The velocity at the last whole slice. Internal. */
  readonly settledVelocity: number;
  /** Time left over after the last whole slice, in seconds. Internal. */
  readonly carry: number;
}

// The presets belong to the glass flavor. They stay exported here as the glass-bound values, so old call sites keep working.
const presets = glassFlavor.springs;

/** The lens position. A little overshoot, so it feels like liquid. */
export const lensX = presets.lensX;
/** The lens width. Looser than position, so the lens breathes as it travels. */
export const lensWidth = presets.lensWidth;
/** A press. Almost critically damped, so it settles without a visible bounce. */
export const press = presets.press;
/** Letting go of a press. Underdamped on purpose, so the surface springs a little past its rest size. */
export const release = presets.release;
/** A soft follow. */
export const gentle = presets.gentle;
/** A firm follow. */
export const stiff = presets.stiff;

/** The damping at which a spring returns fastest without overshoot: 2 sqrt(k m). */
export function criticalDamping(stiffness: number, mass = 1): number {
  return 2 * Math.sqrt(stiffness * mass);
}

const positive = (value: number | undefined, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
const nonNegative = (value: number | undefined, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;

function resolve(config: SpringConfig): ResolvedSpringConfig {
  const stiffness = positive(config.stiffness, DEFAULT_STIFFNESS);
  const damping = nonNegative(config.damping, DEFAULT_DAMPING);
  const mass = positive(config.mass, 1);
  const rate = Math.max(Math.sqrt(stiffness / mass), damping / mass);
  const step = Math.min(FIXED_STEP, Math.max(MIN_STEP, 1 / rate));
  return Object.freeze({
    stiffness,
    damping,
    mass,
    restSpeed: positive(config.restSpeed, DEFAULT_REST_SPEED),
    restDelta: positive(config.restDelta, DEFAULT_REST_DELTA),
    step,
  });
}

/** A spring at rest on `initial` (default 0). A broken config falls back to safe numbers and never throws. */
export function createSpring(config: SpringConfig, initial = 0): SpringState {
  const start = Number.isFinite(initial) ? initial : 0;
  return {
    value: start,
    velocity: 0,
    target: start,
    config: resolve(config),
    settledValue: start,
    settledVelocity: 0,
    carry: 0,
  };
}

/** The same motion with new constants: position, velocity, and target stay. Use it to switch from a press to a release feel. */
export function reconfigure(state: SpringState, config: SpringConfig): SpringState {
  return { ...state, config: resolve(config) };
}

/** Points the spring at a new target. Position and velocity stay, so a mid-flight turn keeps its momentum. */
export function retarget(state: SpringState, newTarget: number): SpringState {
  return { ...state, target: Number.isFinite(newTarget) ? newTarget : state.target };
}

/** True when the spring is slow and close enough to stop. The config defaults to the state's own. */
export function isAtRest(state: SpringState, config: SpringConfig | ResolvedSpringConfig = state.config): boolean {
  if (!Number.isFinite(state.value) || !Number.isFinite(state.velocity) || !Number.isFinite(state.target)) return false;
  const restSpeed = positive(config.restSpeed, DEFAULT_REST_SPEED);
  const restDelta = positive(config.restDelta, DEFAULT_REST_DELTA);
  return Math.abs(state.velocity) < restSpeed && Math.abs(state.value - state.target) < restDelta;
}

function settled(state: SpringState): SpringState {
  return { ...state, value: state.target, velocity: 0, settledValue: state.target, settledVelocity: 0, carry: 0 };
}

/**
 * Advances the spring by `dt` seconds toward `target`. A zero, negative, or non-finite `dt` changes nothing.
 * A non-finite `target` is ignored. The result is at rest on the target once it is slow and close enough.
 */
export function stepSpring(state: SpringState, target: number, dt: number): SpringState {
  const current = target === state.target ? state : retarget(state, target);
  if (!(dt > 0) || !Number.isFinite(dt)) return current;

  const { stiffness, damping, mass, step } = current.config;
  const goal = current.target;
  let x = current.settledValue;
  let v = current.settledVelocity;
  let carry = current.carry + Math.min(dt, MAX_FRAME);
  while (carry >= step) {
    v += ((-stiffness * (x - goal) - damping * v) / mass) * step;
    x += v * step;
    carry -= step;
  }
  const acceleration = (-stiffness * (x - goal) - damping * v) / mass;
  const shownVelocity = v + acceleration * carry;
  const shown = x + shownVelocity * carry;

  if (!Number.isFinite(shown) || !Number.isFinite(shownVelocity) || !Number.isFinite(x) || !Number.isFinite(v)) {
    return settled(current);
  }
  const next: SpringState = { ...current, value: shown, velocity: shownVelocity, settledValue: x, settledVelocity: v, carry };
  return isAtRest(next) ? settled(next) : next;
}
