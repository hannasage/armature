/**
 * The tween value controller: a tween over a kind, run by the shared frame scheduler. It is the fixed-time partner of `createValue` in
 * `@hannasage/armature/values`. It takes the scheduler and the kind as arguments, so this file imports only their types.
 * It reads no environment. The caller hands it a reduced-motion check if the value needs one.
 */
import type { FrameTask, Scheduler } from "../frame/scheduler";
import type { Kind } from "../values/kind";
import type { Curve } from "./bezier";
import { createTween, isTweenDone, stepTween, type TweenState } from "./tween";

export interface TweenValueOptions<T> {
  /** Seconds. */
  duration: number;
  /** The curve of every move that names none. Defaults to a straight line. */
  curve?: Curve;
  /** Called once per frame in which the value changed, with the value to draw. */
  onChange?(value: T): void;
  /** When it returns true, `to` jumps to the target with no travel. */
  reducedMotion?(): boolean;
}

export interface TweenMove {
  /** Seconds, for this move only. */
  duration?: number;
  /** For this move only. */
  curve?: Curve;
}

export interface TweenValueState<T> {
  /** The value to draw. */
  value: T;
  target: T;
  /** True while the tween is still travelling. */
  moving: boolean;
}

export interface TweenValue<T> {
  get(): T;
  /** Tweens toward a target, from the value on screen. A target the kind cannot parse, or a duration that is not usable, throws a TypeError and changes nothing. */
  to(target: T, move?: TweenMove): void;
  /** Jumps to a value with no travel, and stops the frame. */
  set(value: T): void;
  getState(): TweenValueState<T>;
  /** Leaves the scheduler and ignores every later call. The last value stays, and `moving` turns false. Safe to call twice. */
  destroy(): void;
}

const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((n, i) => n === b[i]);

export function createTweenValue<T>(scheduler: Pick<Scheduler, "add">, kind: Kind<T>, initial: T, options: TweenValueOptions<T>): TweenValue<T> {
  // The progress runs from 0 to 1, and the kind blends the two ends. Checking the duration here fails early, before any move.
  createTween(0, 1, options.duration);
  let from = kind.parse(initial);
  let target = from;
  let current = from;
  let progress: TweenState = createTween(0, 1, 0);
  let emitted = kind.toArray(current);
  let remove: (() => void) | undefined;
  let destroyed = false;

  const stop = () => {
    remove?.();
    remove = undefined;
  };

  const emit = () => {
    const shown = kind.toArray(current);
    if (same(shown, emitted)) return;
    options.onChange?.(kind.fromArray(shown));
    // A throw above leaves `emitted` as it was. The retry happens on the next `to()` or `set()`, not by itself.
    emitted = shown;
  };

  const rest = (value: T) => {
    from = target = current = value;
    progress = createTween(0, 1, 0);
  };

  const task: FrameTask = {
    step(dt) {
      try {
        progress = stepTween(progress, dt);
        if (!Number.isFinite(progress.value)) throw new TypeError("A tween curve returned a value that is not finite.");
        const done = isTweenDone(progress);
        // Landing is exact: the target itself, and not a blend that float error could leave a hair short.
        current = done ? target : kind.interpolate(from, target, progress.value);
        // The scheduler drops a task that returns false, so the handle is stale.
        if (done) remove = undefined;
        return !done;
      } catch (error) {
        // The scheduler logs the error and drops the task, so the handle is stale. The value rests on its target, as it does when a frame fails.
        remove = undefined;
        rest(target);
        throw error;
      }
    },
    frame() {
      try {
        emit();
      } catch (error) {
        // The scheduler logs the error and drops the task. The value rests where it was going.
        remove = undefined;
        rest(target);
        throw error;
      }
    },
  };

  return {
    get: () => current,
    to(next, move) {
      if (destroyed) return;
      const parsed = kind.parse(next);
      const tween = createTween(0, 1, move?.duration ?? options.duration, move?.curve ?? options.curve);
      if (options.reducedMotion?.() === true || isTweenDone(tween) || same(kind.toArray(current), kind.toArray(parsed))) {
        stop();
        rest(parsed);
        emit();
        return;
      }
      from = current;
      target = parsed;
      progress = tween;
      remove = scheduler.add(task);
    },
    set(value) {
      if (destroyed) return;
      const parsed = kind.parse(value);
      stop();
      rest(parsed);
      emit();
    },
    getState: () => ({ value: current, target, moving: !isTweenDone(progress) }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      // The last value stays, and nothing moves any more.
      rest(current);
    },
  };
}
