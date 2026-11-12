/**
 * A tween: a value that moves from A to B in a set time along a curve. It has the step interface of the spring. A state goes in with a
 * time slice `dt` in seconds, and a new state comes out. Every function is pure, and a state is never changed after it is made.
 * The tween ends exactly on its target, with no float drift from the curve.
 */
import type { Curve } from "./bezier";

export interface TweenState {
  readonly from: number;
  readonly to: number;
  /** Seconds. */
  readonly duration: number;
  /** Seconds, never more than the duration. */
  readonly elapsed: number;
  /** The value to draw. */
  readonly value: number;
  readonly curve: Curve;
}

/** Float sums of slices can fall a hair short of the duration. This many seconds of slack count as the end. */
const SLACK = 1e-9;

const linear: Curve = (progress) => progress;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** A tween at its start. A zero duration, or a `from` equal to `to`, makes a tween that is done. A value or a duration that is not usable throws a TypeError. */
export function createTween(from: number, to: number, duration: number, curve: Curve = linear): TweenState {
  if (!finite(from) || !finite(to)) throw new TypeError("A tween needs a finite start and a finite target.");
  if (!finite(duration) || duration < 0) throw new TypeError("A tween duration must be a finite number of seconds, 0 or more.");
  const done = duration === 0 || from === to;
  return Object.freeze({ from, to, duration, elapsed: done ? duration : 0, value: done ? to : from, curve });
}

export const isTweenDone = (state: TweenState): boolean => state.elapsed >= state.duration;

/** Advances the tween by `dt` seconds. A zero, negative, or non-finite `dt` changes nothing, and neither does a tween that is done. */
export function stepTween(state: TweenState, dt: number): TweenState {
  if (!(dt > 0) || !Number.isFinite(dt) || isTweenDone(state)) return state;
  const elapsed = state.elapsed + dt;
  if (elapsed >= state.duration - SLACK) return Object.freeze({ ...state, elapsed: state.duration, value: state.to });
  return Object.freeze({ ...state, elapsed, value: state.from + (state.to - state.from) * state.curve(elapsed / state.duration) });
}

/** A new tween from the value on screen to a new target. The duration and the curve stay unless the call gives new ones. */
export function retargetTween(state: TweenState, to: number, duration: number = state.duration, curve: Curve = state.curve): TweenState {
  return createTween(state.value, to, duration, curve);
}
