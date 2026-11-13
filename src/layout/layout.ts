/**
 * Layout animation (FLIP). `snapshot()` measures the element (first). The DOM changes. `play()` measures it again (last), writes the offset that
 * puts it back where it was (invert), and springs the offset to zero (play). The offset is the individual properties `translate` and `scale`,
 * and never `transform`. A change in flight starts from where the element is now, and keeps the speed it has.
 *
 * It runs on the shared frame scheduler, in whole slices of `FIXED_STEP`, so a 30, 60, or 144 Hz screen lands in the same place. Every read of
 * the browser goes through the injected environment, and nothing reads `window` until a method runs.
 */
import type { ArmatureTarget } from "../engine/env";
import type { Flavor } from "../engine/flavor";
import { prefersReducedMotion } from "../engine/env";
import type { FrameTask, Scheduler } from "../frame/scheduler";
import type { Box, LayoutEnvironment } from "./env";
import { checkBox, checkPose, createEmitter, createMover, invert, measure, setup, zero, type Mover, type Pose } from "./motion";
import { thing, toError } from "./util";

export interface LayoutOptions {
  /** The numbers to use. Required. It needs a layout part. */
  flavor: Flavor;
  /** Defaults to the real browser. A test passes a fake. */
  env?: LayoutEnvironment;
  /** Shared by several controllers. Default: one of its own, which `destroy` also destroys. */
  scheduler?: Pick<Scheduler, "add">;
  /**
   * Elements that get the inverse of the scale of this one while it moves, so they keep their shape. A list, or a function called at `play`, after the
   * change. Default none. The spring of a size, and the cost of the counter-scale, are in `docs/baseline.md`, section "G6 build".
   */
  children?: readonly ArmatureTarget[] | (() => readonly ArmatureTarget[]);
}

export interface LayoutState {
  /** True while the element moves back to its place. */
  moving: boolean;
  /** The shift of the center, and the difference in size, from the layout the element has now, in pixels. A copy. */
  offset: [x: number, y: number, width: number, height: number];
  /** The speed of each part of the offset, in pixels per second. A copy. */
  velocity: [x: number, y: number, width: number, height: number];
  scaleX: number;
  scaleY: number;
  destroyed: boolean;
  /** How many times a listener threw. Each listener is logged once. */
  listenerErrors: number;
  /** Set when the layout stopped because a measure or a write failed, and not because of `destroy`. It holds the error. */
  failed?: Error;
}

export interface Layout {
  /**
   * Measures the element, or takes `first` as the box it had, and keeps the speed it has now, or `velocity`. A later snapshot replaces an earlier one.
   * A `first` or a `velocity` that is not made of finite numbers throws a TypeError. A box or a speed from the environment that is bad stops the layout.
   */
  snapshot(first?: Box, velocity?: readonly [number, number, number, number]): void;
  /** Measures the element after the change, puts it back on the snapshot, and springs it to its place. Does nothing without a snapshot. */
  play(): void;
  /** `update` after each write, and `rest` when the element has reached its place. Returns the unsubscribe. */
  on(event: "update" | "rest", listener: () => void): () => void;
  getState(): LayoutState;
  /** Stops the motion, removes the offset, and ignores every later call. It logs nothing. Safe to call twice. */
  destroy(): void;
}

export function createLayout(el: ArmatureTarget, options: LayoutOptions): Layout {
  if (!thing(el)) throw new TypeError("A layout needs an element to move.");
  const { env, own, scheduler, tag, move } = setup(options, "layout");
  const children = options.children;
  if (children !== undefined && !Array.isArray(children) && typeof children !== "function") throw new TypeError("The layout children are a list of elements, or a function that returns one.");
  const events = createEmitter(tag, "layout", ["update", "rest"], () => destroyed);
  let mover: Mover | undefined;
  let pending: { box: Box; speed: Pose } | undefined;
  let destroyed = false;
  let failure: Error | undefined;
  let remove: (() => void) | undefined;
  let dirty = false;

  const stop = () => {
    remove?.();
    remove = undefined;
  };
  /** A measure or a write failed: log once, stop, and put the element back as far as the environment allows. */
  const fail = (error: unknown) => {
    if (failure) return;
    failure = toError(error);
    console.error(`${tag} The layout could not measure or write and stopped.`, error);
    pending = undefined;
    stop();
    const m = mover;
    mover = undefined;
    try {
      m?.clear();
    } catch {
      // The environment is what failed. Nothing more can be done.
    }
  };
  /** Takes the pose off the element and tells the listeners it is at rest. */
  const rest = (): boolean => {
    const m = mover;
    mover = undefined;
    dirty = false;
    stop();
    try {
      m?.clear();
    } catch (error) {
      fail(error);
      return false;
    }
    return true;
  };

  const task: FrameTask = {
    step() {
      dirty = true;
      if (!destroyed && mover?.step()) return true;
      remove = undefined;
      return false;
    },
    frame() {
      if (destroyed || failure || !mover) return;
      if (prefersReducedMotion(env)) {
        if (rest()) events.emit("rest");
        return;
      }
      if (!dirty) return;
      dirty = false;
      const m = mover;
      try {
        if (m.moving()) m.write();
        else {
          mover = undefined;
          m.clear();
        }
      } catch (error) {
        fail(error);
        return;
      }
      events.emit("update");
      if (!mover && !destroyed) events.emit("rest");
    },
  };

  return {
    snapshot(first, velocity) {
      if (destroyed || failure) return;
      const given = first === undefined ? undefined : checkBox(first);
      const speed = velocity === undefined ? undefined : checkPose(velocity);
      try {
        pending = { box: given ?? measure(env, el), speed: speed ?? mover?.speed() ?? zero() };
      } catch (error) {
        fail(error);
      }
    },
    play() {
      if (destroyed || failure || !pending) return;
      const { box: first, speed } = pending;
      pending = undefined;
      let next: Mover;
      try {
        if (prefersReducedMotion(env)) {
          if (rest()) events.emit("rest");
          return;
        }
        // The old offset comes off first, so the measure sees the layout and not the pose.
        mover?.clear();
        const last = measure(env, el);
        const kids = typeof children === "function" ? children() : (children ?? []);
        mover = next = createMover(env, el, last, invert(first, last), speed, zero(), move, kids);
        if (next.moving()) next.write();
      } catch (error) {
        fail(error);
        return;
      }
      if (!next.moving()) {
        if (rest()) events.emit("rest");
        return;
      }
      events.emit("update");
      // A listener can destroy the layout, or start another play, during the write.
      if (destroyed || failure || mover !== next) return;
      dirty = false;
      remove ??= scheduler.add(task);
    },
    on: (event, listener) => events.on(event, listener),
    getState: () => ({
      moving: mover !== undefined,
      offset: mover?.pose() ?? zero(),
      velocity: mover?.speed() ?? zero(),
      scaleX: mover?.scale()[0] ?? 1,
      scaleY: mover?.scale()[1] ?? 1,
      destroyed,
      listenerErrors: events.errors(),
      failed: failure,
    }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      pending = undefined;
      stop();
      const m = mover;
      mover = undefined;
      try {
        m?.clear();
      } catch {
        // A destroy logs nothing.
      }
      events.clear();
      if (own) (scheduler as Scheduler).destroy();
    },
  };
}
