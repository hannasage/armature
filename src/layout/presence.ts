/**
 * Presence: an element that is removed stays mounted until its exit has come to rest, and then it is unmounted. The exit is the same four springs as a
 * layout move, from where the element is to an exit pose (a shift and a scale). The default pose is scale 0.
 * Under reduced motion an exit unmounts at once. A watchdog unmounts an exit that has not rested after 5 seconds, for a tab whose frames stopped.
 * A failure on one element unmounts that element only, with no `exit` event, and the presence goes on. Presence covers the exit of a modal or a toast.
 */
import type { ArmatureTarget } from "../engine/env";
import type { Flavor } from "../engine/flavor";
import { prefersReducedMotion } from "../engine/env";
import type { FrameTask, Scheduler } from "../frame/scheduler";
import type { LayoutEnvironment } from "./env";
import { createEmitter, createMover, empty, measure, noBox, readBase, runner, setup, zero, type Mover, type Pose } from "./motion";
import { finite, plain, thing, toError } from "./util";

export interface PresenceOptions {
  /** The numbers to use. Required. It needs a layout part. */
  flavor: Flavor;
  /** Defaults to the real browser. A test passes a fake. */
  env?: LayoutEnvironment;
  /** Shared by several controllers. Default: one of its own, which `destroy` also destroys. */
  scheduler?: Pick<Scheduler, "add">;
  /**
   * Takes the element out. Default: the `unmount` of the environment, which removes it from the container. A framework passes its own. It may return false
   * when the element was not removed. After a function of your own, the pose is taken off the element, in case the node stays.
   */
  unmount?: (element: ArmatureTarget) => boolean | void;
}

/** Where an exit ends, as a shift from where the element is now. Each part is optional: x and y are in pixels, and a scale is 0 or more. The default is `{ scale: 0 }`. */
export interface ExitPose {
  x?: number;
  y?: number;
  scale?: number;
}

export interface PresenceState {
  /** How many elements are still mounted while they exit. */
  exiting: number;
  destroyed: boolean;
  /** How many times a listener threw. Each listener is logged once. */
  listenerErrors: number;
  /** The first error of a measure, a write, or an unmount that failed. The presence goes on after it. */
  failed?: Error;
  /** The elements that could not be unmounted, and are still on the page. A later exit of one of them tries again. */
  leftMounted: ArmatureTarget[];
}

export interface Presence {
  /**
   * Starts the exit of `element`. It stays mounted until the exit rests, and then it is unmounted. A pose with a value that is not finite, or a scale below 0,
   * throws a TypeError. `from` is the offset `[x, y]` the element has now, when other code moves it and the environment cannot read its `translate`.
   * An element that is already exiting is left alone, and its pose stays. After `destroy`, the element is unmounted at once.
   */
  exit(element: ArmatureTarget, options?: { to?: ExitPose; from?: readonly [number, number] }): void;
  /** `exit` fires after an element is unmounted by its exit, with the element. It does not fire for a failure or for `destroy`. Returns the unsubscribe. */
  on(event: "exit", listener: (element: ArmatureTarget) => void): () => void;
  getState(): PresenceState;
  /** Unmounts the elements that are leaving at once, and ignores every later call except `exit`. It calls no listener. Safe to call twice. */
  destroy(): void;
}

/** The time, in milliseconds, after which an exit that has not rested is unmounted. */
const WATCHDOG_MS = 5000;

const bad = () => new TypeError("An exit pose is { x?, y?, scale? }: finite numbers, and a scale of 0 or more.");

/** Reads the options of one exit, and throws before anything is measured. */
function goalOf(options: unknown): { x: number; y: number; scale: number; from?: [number, number] } {
  if (options !== undefined && !plain(options)) throw new TypeError("The options of an exit are { to?, from? }.");
  const { to, from } = (options ?? {}) as { to?: unknown; from?: unknown };
  if (to !== undefined && !plain(to)) throw bad();
  const { x = 0, y = 0, scale = 0 } = (to ?? {}) as Record<string, unknown>;
  if (!finite(x) || !finite(y) || !finite(scale) || scale < 0) throw bad();
  if (from !== undefined && !(Array.isArray(from) && from.length === 2 && finite(from[0]) && finite(from[1]))) throw new TypeError("The from of an exit is [x, y], two finite numbers.");
  return { x, y, scale, from: from as [number, number] | undefined };
}

interface Leaving {
  mover: Mover;
  cancel?: () => void;
}

export function createPresence(container: ArmatureTarget, options: PresenceOptions): Presence {
  if (!thing(container)) throw new TypeError("A presence needs a container.");
  const { env, own, scheduler, tag, exit } = setup(options, "presence");
  const custom = options.unmount;
  if (custom !== undefined && typeof custom !== "function") throw new TypeError("The unmount of a presence is a function.");
  if (custom === undefined && typeof env.unmount !== "function") throw new TypeError("A presence needs an environment with an unmount method, or an unmount function in its options.");
  const unmount = custom ?? ((element: ArmatureTarget) => env.unmount!(container, element));
  const events = createEmitter(tag, "presence", ["exit"], () => destroyed);
  const live = new Map<ArmatureTarget, Leaving>();
  const left = new Set<ArmatureTarget>();
  let destroyed = false;
  let failure: Error | undefined;
  let logged = false;
  let warnedEmpty = false;

  /** Keeps the first error, and logs once. */
  const record = (error: unknown) => {
    failure ??= toError(error);
    if (!logged) console.error(`${tag} The presence could not measure, write, or unmount an element.`, error);
    logged = true;
  };
  /** Unmounts one element, and says whether it was removed. A throw leaves the element on the list of those left mounted. */
  const take = (element: ArmatureTarget, mover?: Mover): boolean => {
    let result: boolean | void;
    try {
      result = unmount(element);
      left.delete(element);
    } catch (error) {
      left.add(element);
      record(error);
      return false;
    }
    if (custom) {
      try {
        mover?.clear();
      } catch {
        // The node is the caller's now.
      }
    }
    return result !== false;
  };
  /** Takes an element out of the leaving list, and stops its watchdog. */
  const forget = (element: ArmatureTarget) => {
    live.get(element)?.cancel?.();
    live.delete(element);
  };
  const finish = (element: ArmatureTarget, mover?: Mover) => {
    forget(element);
    if (take(element, mover)) events.emit("exit", element);
  };
  /** One element failed: it is unmounted with no event, and the others go on. */
  const fail = (element: ArmatureTarget, error: unknown) => {
    record(error);
    const mover = live.get(element)?.mover;
    forget(element);
    take(element, mover);
  };

  const task: FrameTask = {
    step() {
      let moving = false;
      for (const { mover } of live.values()) if (mover.step()) moving = true;
      if (moving && !destroyed) return true;
      run.done();
      return false;
    },
    frame() {
      if (destroyed) return;
      const snap = prefersReducedMotion(env);
      for (const [element, { mover }] of [...live]) {
        if (destroyed) return;
        try {
          if (!snap) mover.write();
        } catch (error) {
          fail(element, error);
          continue;
        }
        if (snap || !mover.moving()) finish(element, mover);
      }
      if (live.size === 0) run.stop();
    },
  };
  const run = runner(scheduler, task);

  return {
    exit(element, opts) {
      if (!thing(element)) throw new TypeError("An exit needs an element.");
      const { x, y, scale, from } = goalOf(opts);
      if (destroyed) {
        take(element);
        return;
      }
      if (live.has(element)) return;
      let mover: Mover;
      try {
        if (prefersReducedMotion(env)) {
          finish(element);
          return;
        }
        const base = readBase(env, element, from);
        const natural = measure(env, element);
        if (empty(natural)) {
          if (!warnedEmpty) noBox(tag, "the exit");
          warnedEmpty = true;
          finish(element);
          return;
        }
        const shrink = 1 - scale;
        const goal: Pose = [x, y, natural.width > 0 ? -natural.width * shrink : 0, natural.height > 0 ? -natural.height * shrink : 0];
        mover = createMover(env, element, natural, zero(), zero(), goal, exit, [], base);
      } catch (error) {
        fail(element, error);
        return;
      }
      if (!mover.moving()) {
        finish(element, mover);
        return;
      }
      const cancel = env.after?.(WATCHDOG_MS, () => {
        const entry = live.get(element);
        if (!entry) return;
        finish(element, entry.mover);
        if (live.size === 0) run.stop();
      });
      live.set(element, { mover, cancel });
      run.start();
    },
    on: (event, listener) => events.on(event, listener as (...args: never[]) => void),
    getState: () => ({ exiting: live.size, destroyed, listenerErrors: events.errors(), failed: failure, leftMounted: [...left] }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      events.clear();
      const leaving = [...live];
      run.stop();
      for (const [element, { cancel }] of leaving) {
        cancel?.();
        live.delete(element);
        take(element);
      }
      if (own) (scheduler as Scheduler).destroy();
    },
  };
}
