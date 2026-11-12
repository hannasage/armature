/**
 * The value controller: a spring over a kind. The components spring one by one, and the shared frame scheduler steps them in
 * fixed slices. It reads no environment. The caller hands it a scheduler, and a reduced-motion check if the value needs one.
 */
import type { FrameTask, Scheduler } from "../frame/scheduler";
import type { SpringConfig } from "../engine/spring";
import type { Kind } from "./kind";
import { createVectorSpring, isVectorAtRest, reconfigureVector, retargetVector, stepVectorSpring } from "./vector";

export interface ValueOptions<T> {
  /** The spring the value moves on. */
  spring: SpringConfig;
  /** Called once per frame in which the value changed, with the value to draw. */
  onChange?(value: T): void;
  /** When it returns true, `to` jumps to the target with no travel. */
  reducedMotion?(): boolean;
}

export interface ValueMove {
  /** Replaces the spring for this move, and for the moves after it that name none. Position and velocity stay. */
  spring?: SpringConfig;
}

export interface ValueState<T, S extends boolean = boolean> {
  /** The value to draw. */
  value: T;
  /**
   * The velocity, in units per second. For a kind with the `scalar` flag (the number kind) it is a number. For every other kind it is the
   * raw list of numbers, in the shape of `kind.toArray`, because a velocity is not a color, a path, or a rotation.
   */
  velocity: S extends true ? number : number[];
  target: T;
  /** True while a component is still travelling. */
  moving: boolean;
}

export interface Value<T, S extends boolean = boolean> {
  /** The value to draw. */
  get(): T;
  /** Springs toward a target. A turn in flight keeps its speed. A target the kind cannot parse throws a TypeError and changes nothing. */
  to(target: T, move?: ValueMove): void;
  /** Jumps to a value with no travel and no velocity, and stops the frame. */
  set(value: T): void;
  getState(): ValueState<T, S>;
  /** Leaves the scheduler and ignores every later call. The last value stays. Safe to call twice. */
  destroy(): void;
}

const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((n, i) => n === b[i]);

export function createValue<T, S extends boolean = boolean>(scheduler: Pick<Scheduler, "add">, kind: Kind<T, S>, initial: T, options: ValueOptions<T>): Value<T, S> {
  const parts = (input: unknown) => kind.toArray(kind.parse(input));
  // The rest distance of a spring: its own restDelta, else the explicit one of the base spring, else the default of the kind, else the
  // engine's. A value that is not finite and above 0 counts as unset.
  const usable = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
  const scaled = (spring: SpringConfig): SpringConfig => {
    const rest = [spring.restDelta, options.spring.restDelta, kind.restDelta].find(usable);
    return rest === undefined ? spring : { ...spring, restDelta: rest };
  };
  let config = scaled(options.spring);
  let state = createVectorSpring(config, parts(initial));
  let emitted = state.value;
  let remove: (() => void) | undefined;
  let destroyed = false;

  const stop = () => {
    remove?.();
    remove = undefined;
  };

  const emit = () => {
    if (same(state.value, emitted)) return;
    const shown = state.value;
    options.onChange?.(kind.fromArray(shown));
    // A throw above leaves `emitted` as it was. The retry happens on the next `to()` or `set()`, not by itself.
    emitted = shown;
  };

  const task: FrameTask = {
    step(dt) {
      try {
        state = stepVectorSpring(state, state.target, dt);
        const moving = !isVectorAtRest(state);
        // The scheduler drops a task that returns false, so the handle is stale.
        if (!moving) remove = undefined;
        return moving;
      } catch (error) {
        // The scheduler logs the error and drops the task, so the handle is stale here too.
        remove = undefined;
        throw error;
      }
    },
    frame() {
      try {
        emit();
      } catch (error) {
        // The scheduler logs the error and drops the task. The value rests where it is going.
        remove = undefined;
        state = createVectorSpring(config, state.target);
        throw error;
      }
    },
  };

  const jump = (next: number[]) => {
    stop();
    state = createVectorSpring(config, next);
    emit();
  };

  return {
    get: () => kind.fromArray(state.value),
    to(target, move) {
      if (destroyed) return;
      const next = kind.align ? kind.align(state.value, parts(target)) : parts(target);
      if (move?.spring) config = scaled(move.spring);
      if (options.reducedMotion?.() === true) {
        jump(next);
        return;
      }
      state = retargetVector(move?.spring ? reconfigureVector(state, config) : state, next);
      if (isVectorAtRest(state)) {
        // Already there, or so close that it looks still: finish without a frame.
        if (!same(state.value, next) || state.velocity.some((n) => n !== 0)) jump(next);
        return;
      }
      // Adding is idempotent, and it restarts a frame loop that stopped, for example after a failed requestFrame.
      // If `add` throws, the retargeted state stays, and the next `to()` adds the task again.
      remove = scheduler.add(task);
    },
    set(value) {
      if (destroyed) return;
      jump(parts(value));
    },
    getState: () => ({
      value: kind.fromArray(state.value),
      velocity: (kind.scalar ? kind.fromArray(state.velocity) : [...state.velocity]) as ValueState<T, S>["velocity"],
      target: kind.fromArray(state.target),
      moving: !isVectorAtRest(state),
    }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
    },
  };
}
