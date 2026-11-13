/**
 * Presence: an element that is removed stays mounted until its exit has come to rest, and then it is unmounted. The exit is the same four springs as a
 * layout move, from where the element is to an exit pose (a shift and a scale). The default pose is scale 0.
 * Under reduced motion an exit unmounts at once. Presence covers the exit of a modal or a toast.
 */
import type { ArmatureTarget } from "../engine/env";
import type { Flavor } from "../engine/flavor";
import { prefersReducedMotion } from "../engine/env";
import type { FrameTask, Scheduler } from "../frame/scheduler";
import type { LayoutEnvironment } from "./env";
import { createEmitter, createMover, measure, setup, zero, type Mover, type Pose } from "./motion";
import { finite, plain, thing, toError } from "./util";

export interface PresenceOptions {
  /** The numbers to use. Required. It needs a layout part. */
  flavor: Flavor;
  /** Defaults to the real browser. A test passes a fake. */
  env?: LayoutEnvironment;
  /** Shared by several controllers. Default: one of its own, which `destroy` also destroys. */
  scheduler?: Pick<Scheduler, "add">;
  /** Takes the element out. Default: the `unmount` of the environment, which removes it from the container. A framework passes its own. */
  unmount?: (element: ArmatureTarget) => void;
}

/** Where an exit ends. Each part is optional: x and y are in pixels, and a scale is 0 or more. The default is `{ scale: 0 }`. */
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
  /** Set when the presence stopped because a measure, a write, or an unmount failed, and not because of `destroy`. It holds the error. */
  failed?: Error;
}

export interface Presence {
  /**
   * Starts the exit of `element`. It stays mounted until the exit rests, and then it is unmounted. A pose with a value that is not finite, or a scale below 0,
   * throws a TypeError. An element that is already exiting is left alone.
   */
  exit(element: ArmatureTarget, options?: { to?: ExitPose }): void;
  /** `exit` fires after an element is unmounted, with the element. Returns the unsubscribe. */
  on(event: "exit", listener: (element: ArmatureTarget) => void): () => void;
  getState(): PresenceState;
  /** Unmounts the elements that are leaving at once, and ignores every later call. It logs nothing and calls no listener. Safe to call twice. */
  destroy(): void;
}

const bad = () => new TypeError("An exit pose is { x?, y?, scale? }: finite numbers, and a scale of 0 or more.");

/** Reads the options of one exit, and throws before anything is measured. */
function goalOf(options: unknown): { x: number; y: number; scale: number } {
  if (options !== undefined && !plain(options)) throw new TypeError("The options of an exit are { to?: { x?, y?, scale? } }.");
  const to = (options as { to?: unknown } | undefined)?.to;
  if (to !== undefined && !plain(to)) throw bad();
  const { x = 0, y = 0, scale = 0 } = (to ?? {}) as Record<string, unknown>;
  if (!finite(x) || !finite(y) || !finite(scale) || scale < 0) throw bad();
  return { x, y, scale };
}

export function createPresence(container: ArmatureTarget, options: PresenceOptions): Presence {
  if (!thing(container)) throw new TypeError("A presence needs a container.");
  const { env, own, scheduler, tag, exit } = setup(options, "presence");
  if (options.unmount !== undefined && typeof options.unmount !== "function") throw new TypeError("The unmount of a presence is a function.");
  if (options.unmount === undefined && typeof env.unmount !== "function") throw new TypeError("A presence needs an environment with an unmount method, or an unmount function in its options.");
  const unmount = options.unmount ?? ((element: ArmatureTarget) => env.unmount!(container, element));
  const events = createEmitter(tag, "presence", ["exit"], () => destroyed);
  const live = new Map<ArmatureTarget, Mover>();
  let destroyed = false;
  let failure: Error | undefined;
  let remove: (() => void) | undefined;

  const stop = () => {
    remove?.();
    remove = undefined;
  };
  /** Unmounts without a word. For a failure and for `destroy`, where one element that cannot go must not keep the others. */
  const drop = (elements: ArmatureTarget[]) => {
    for (const element of elements) {
      try {
        unmount(element);
      } catch {
        // Best effort.
      }
    }
  };
  const fail = (error: unknown, extra?: ArmatureTarget) => {
    if (failure) return;
    failure = toError(error);
    console.error(`${tag} The presence could not measure, write, or unmount, and stopped.`, error);
    const leaving = [...live.keys(), ...(extra ? [extra] : [])];
    live.clear();
    stop();
    drop(leaving);
  };
  /** Unmounts one element, and tells the listeners. */
  const finish = (element: ArmatureTarget) => {
    try {
      unmount(element);
    } catch (error) {
      fail(error);
      return;
    }
    events.emit("exit", element);
  };

  const task: FrameTask = {
    step() {
      let moving = false;
      for (const mover of live.values()) if (mover.step()) moving = true;
      if (moving && !destroyed) return true;
      remove = undefined;
      return false;
    },
    frame() {
      if (destroyed || failure) return;
      const snap = prefersReducedMotion(env);
      for (const [element, mover] of [...live]) {
        if (destroyed || failure) return;
        try {
          if (!snap) mover.write();
        } catch (error) {
          fail(error);
          return;
        }
        if (snap || !mover.moving()) {
          live.delete(element);
          finish(element);
        }
      }
      if (live.size === 0) stop();
    },
  };

  return {
    exit(element, opts) {
      if (destroyed || failure) return;
      if (!thing(element)) throw new TypeError("An exit needs an element.");
      const { x, y, scale } = goalOf(opts);
      if (live.has(element)) return;
      let mover: Mover;
      try {
        if (prefersReducedMotion(env)) {
          finish(element);
          return;
        }
        const natural = measure(env, element);
        const shrink = 1 - scale;
        const goal: Pose = [x, y, natural.width > 0 ? -natural.width * shrink : 0, natural.height > 0 ? -natural.height * shrink : 0];
        mover = createMover(env, element, natural, zero(), zero(), goal, exit, []);
      } catch (error) {
        fail(error, element);
        return;
      }
      if (!mover.moving()) {
        finish(element);
        return;
      }
      live.set(element, mover);
      remove ??= scheduler.add(task);
    },
    on: (event, listener) => events.on(event, listener as (...args: never[]) => void),
    getState: () => ({ exiting: live.size, destroyed, listenerErrors: events.errors(), failed: failure }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      events.clear();
      const leaving = [...live.keys()];
      live.clear();
      stop();
      drop(leaving);
      if (own) (scheduler as Scheduler).destroy();
    },
  };
}
