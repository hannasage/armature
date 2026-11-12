/**
 * The shared frame scheduler. One frame loop serves every task. It steps the tasks in fixed slices of `FIXED_STEP` seconds,
 * so a 30, 60, or 144 Hz screen runs the same slices. A frame longer than `MAX_FRAME` counts as `MAX_FRAME` long, and the loop
 * stops while the tab is hidden. `advance` runs the same code by hand, so a Node test pins every frame with no environment.
 */
import { FIXED_STEP, MAX_FRAME } from "../engine/spring";

/** What the scheduler takes from the browser. A scroll environment fits, and so does a plain environment with the first three. */
export interface FrameEnvironment {
  requestFrame(callback: (time: number) => void): number;
  cancelFrame(id: number): void;
  /** Milliseconds, on the same clock as the time `requestFrame` passes to its callback. */
  now(): number;
  /**
   * Optional, and it pairs with `onVisibilityChange`: give both or neither, or `createScheduler` throws a TypeError.
   * Without the pair the scheduler never pauses.
   */
  tabHidden?(): boolean;
  /** Optional, and it pairs with `tabHidden`. Returns the function that removes the listener. */
  onVisibilityChange?(listener: (hidden: boolean) => void): () => void;
}

/** One thing the scheduler runs. A spring controller is one. A tween is another. */
export interface FrameTask {
  /** Called once per slice. `dt` is always `FIXED_STEP`. Return `false` to leave the scheduler after this slice. */
  step(dt: number): boolean | void;
  /** Called once per frame, after the slices, for every task that was waiting at the start of the frame, even when no slice ran. Optional. */
  frame?(): void;
}

export interface Scheduler {
  /** Adds a task and starts the frame loop if it is idle. Returns the function that removes the task. Adding the same task twice adds it once. */
  add(task: FrameTask): () => void;
  /**
   * Runs `seconds` of time by hand, clamped to `MAX_FRAME`. Zero, negative, and non-finite time does nothing. For tests.
   * A call from inside a task step or frame hook is ignored and logged once, because the outer run is still going.
   */
  advance(seconds: number): void;
  /** The number of tasks waiting. */
  readonly size: number;
  /** Cancels the frame, drops every task, and ignores every later call. Safe to call twice. */
  destroy(): void;
}

/** Float sums of frame times can fall a hair short of a whole slice. This many seconds of slack count as a whole slice. */
const SLACK = 1e-9;

/**
 * `requestFrame` must call its callback later, as a browser does. A callback that runs before `requestFrame` returns is for test
 * environments only, and the scheduler copes with it so that a fake can be simple.
 */
export function createScheduler(env: FrameEnvironment): Scheduler {
  if ((env.tabHidden === undefined) !== (env.onVisibilityChange === undefined)) {
    throw new TypeError("tabHidden pairs with onVisibilityChange.");
  }
  const tasks = new Set<FrameTask>();
  let carry = 0;
  let last = 0;
  let frameId = 0;
  let scheduled = false;
  let destroyed = false;
  let running = false;
  const warned = new Set<string>();
  /** Logs each kind of environment failure once per scheduler, so one kind cannot silence another. */
  const warn = (text: string, error?: unknown) => {
    if (!warned.has(text)) console.error(`[armature] ${text}`, error);
    warned.add(text);
  };
  let unwatch: (() => void) | undefined;
  /** The tasks that get a frame call at the end of the run that is going on. */
  let waiting = new Set<FrameTask>();

  const hidden = () => {
    try {
      return env.tabHidden?.() === true;
    } catch (error) {
      warn("tabHidden threw", error);
      return false;
    }
  };

  const drop = (task: FrameTask) => {
    tasks.delete(task);
    waiting.delete(task);
  };

  /** Runs one call of a task. A throw is logged, and the task is removed. */
  const call = (task: FrameTask, fn: () => unknown) => {
    try {
      fn();
    } catch (error) {
      console.error("[armature] A task threw.", error);
      drop(task);
    }
  };

  const run = (seconds: number) => {
    running = true;
    try {
      step(seconds);
    } finally {
      running = false;
    }
  };

  const step = (seconds: number) => {
    carry += Math.min(MAX_FRAME, seconds);
    waiting = new Set(tasks);
    // The slack lets `carry` end a hair below zero, down to -SLACK. That is harmless: the next frame adds to it.
    while (carry >= FIXED_STEP - SLACK && tasks.size > 0) {
      carry -= FIXED_STEP;
      for (const task of [...tasks]) {
        if (!tasks.has(task)) continue;
        waiting.add(task);
        call(task, () => task.step(FIXED_STEP) === false && tasks.delete(task));
      }
    }
    for (const task of [...waiting]) if (waiting.has(task)) call(task, () => task.frame?.());
  };

  const stopFrame = () => {
    if (scheduled) {
      scheduled = false;
      env.cancelFrame(frameId);
    }
  };

  const requestNext = () => {
    scheduled = true;
    let inline = false;
    try {
      const id = env.requestFrame((time) => {
        inline = true;
        tick(time);
      });
      // A callback that ran inside requestFrame has asked for its own next frame, and this id is stale.
      if (!inline) frameId = id;
    } catch (error) {
      // No frame is pending, so the next add or the next visibility change starts the loop again.
      scheduled = false;
      warn("requestFrame threw", error);
    }
  };

  const tick = (time: number) => {
    scheduled = false;
    if (destroyed) return;
    let seconds = 0;
    if (Number.isFinite(time)) {
      seconds = Math.max(0, (time - last) / 1000);
      last = time;
    }
    run(seconds);
    if (tasks.size === 0) stopAll();
    else if (!scheduled && !hidden()) requestNext();
  };

  const start = () => {
    // Inside a run the tick asks for its own next frame, so a start here would reset `last` and add a frame.
    if (scheduled || running || destroyed || hidden()) return;
    last = env.now();
    requestNext();
  };

  const onVisibility = (isHidden: boolean) => {
    if (isHidden) stopFrame();
    else if (tasks.size > 0) start();
  };

  function stopAll() {
    stopFrame();
    unwatch?.();
    unwatch = undefined;
    carry = 0;
  }

  return {
    add(task) {
      if (destroyed) return () => undefined;
      if (!tasks.has(task)) {
        // Subscribe before the task joins. A throw from onVisibilityChange reaches the caller and leaves no task behind.
        if (tasks.size === 0 && unwatch === undefined) unwatch = env.onVisibilityChange?.(onVisibility);
        tasks.add(task);
      }
      start();
      return () => {
        drop(task);
        if (tasks.size === 0) stopAll();
      };
    },
    advance(seconds) {
      if (destroyed || !(seconds > 0 && seconds < Infinity)) return;
      if (running) {
        warn("advance inside a task ignored");
        return;
      }
      run(seconds);
      if (tasks.size === 0) stopAll();
    },
    get size() {
      return tasks.size;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      tasks.clear();
      waiting.clear();
      stopAll();
    },
  };
}
