/**
 * A spring over a vector: one scalar spring per component, all with the same constants. Every function runs the scalar function of
 * the engine on each component, so a vector spring matches the scalar spring component by component. Rest means every component rests.
 * A state is frozen and is never changed after it is made.
 */
import { createSpring, isAtRest, reconfigure, retarget, stepSpring, type ResolvedSpringConfig, type SpringConfig, type SpringState } from "../engine/spring";

export interface VectorSpringState {
  /** The scalar spring of each component. */
  readonly parts: readonly SpringState[];
  /** The values to draw, one per component. */
  readonly value: readonly number[];
  readonly velocity: readonly number[];
  readonly target: readonly number[];
}

const pack = (parts: SpringState[]): VectorSpringState =>
  Object.freeze({
    parts: Object.freeze(parts),
    value: Object.freeze(parts.map((part) => part.value)),
    velocity: Object.freeze(parts.map((part) => part.velocity)),
    target: Object.freeze(parts.map((part) => part.target)),
  });

/** Checks a target against the spring. A wrong length is a mistake of the caller, so it throws. */
function fit(state: VectorSpringState, target: readonly number[]): void {
  if (!Array.isArray(target)) throw new TypeError("A vector target must be an array.");
  if (target.length !== state.parts.length) throw new TypeError(`A vector target has ${target.length} components, and the spring has ${state.parts.length}.`);
}

/** A vector spring at rest on `initial`. */
export function createVectorSpring(config: SpringConfig, initial: readonly number[]): VectorSpringState {
  if (!Array.isArray(initial)) throw new TypeError("A vector spring needs an array of numbers.");
  return pack(initial.map((value) => createSpring(config, value)));
}

/** Advances every component by `dt` seconds toward its target. A component target that is not finite is ignored. */
export function stepVectorSpring(state: VectorSpringState, target: readonly number[], dt: number): VectorSpringState {
  fit(state, target);
  return pack(state.parts.map((part, i) => stepSpring(part, target[i], dt)));
}

/** Points every component at a new target. Position and velocity stay. */
export function retargetVector(state: VectorSpringState, target: readonly number[]): VectorSpringState {
  fit(state, target);
  return pack(state.parts.map((part, i) => retarget(part, target[i])));
}

/** The same motion with new constants on every component. */
export function reconfigureVector(state: VectorSpringState, config: SpringConfig): VectorSpringState {
  return pack(state.parts.map((part) => reconfigure(part, config)));
}

/** True when every component is slow and close enough to stop. The config defaults to each component's own. */
export function isVectorAtRest(state: VectorSpringState, config?: SpringConfig | ResolvedSpringConfig): boolean {
  return state.parts.every((part) => isAtRest(part, config));
}
