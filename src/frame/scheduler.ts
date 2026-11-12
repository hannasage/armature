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
  /** Optional. Without it the scheduler never pauses. */
  tabHidden?(): boolean;
  /** Optional. Returns the function that removes the listener. */
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
  /** Runs `seconds` of time by hand, clamped to `MAX_FRAME`. Zero, negative, and non-finite time does nothing. For tests. */
  advance(seconds: number): void;
  /** The number of tasks waiting. */
  readonly size: number;
  /** Cancels the frame, drops every task, and ignores every later call. Safe to call twice. */
  destroy(): void;
}

/** Float sums of frame times can fall a hair short of a whole slice. This many seconds of slack count as a whole slice. */
const SLACK = 1e-9;

export function createScheduler(env: FrameEnvironment): Scheduler {
  const tasks = new Set<FrameTask>();
  let carry = 0;
  let last = 0;
  let frameId = 0;
  let scheduled = false;
  let destroyed = false;
  let unwatch: (() => void) | undefined;
  /** The tasks that get a frame call at the end of the run that is going on. */
  let due: Set<FrameTask> | null = null;

  const hidden = () => {
    try {
      return env.tabHidden?.() === true;
    } catch {
      return false;
    }
  };

  const drop = (task: FrameTask) => {
    tasks.delete(task);
    due?.delete(task);
  };

  const fail = (task: FrameTask, error: unknown) => {
    console.error("[armature] A frame task threw and was removed.", error);
    drop(task);
  };

  const run = (seconds: number) => {
    carry += Math.min(MAX_FRAME, seconds);
    const waiting = new Set(tasks);
    due = waiting;
    while (carry >= FIXED_STEP - SLACK && tasks.size > 0) {
      carry -= FIXED_STEP;
      for (const task of [...tasks]) {
        if (!tasks.has(task)) continue;
        waiting.add(task);
        try {
          if (task.step(FIXED_STEP) === false) tasks.delete(task);
        } catch (error) {
          fail(task, error);
        }
      }
    }
    carry = tasks.size === 0 ? 0 : Math.max(0, carry);
    for (const task of [...waiting]) {
      if (!waiting.has(task)) continue;
      try {
        task.frame?.();
      } catch (error) {
        fail(task, error);
      }
    }
    due = null;
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
    const id = env.requestFrame((time) => {
      inline = true;
      tick(time);
    });
    // A callback that ran inside requestFrame has asked for its own next frame, and this id is stale.
    if (!inline) frameId = id;
  };

  const tick = (time: number) => {
    scheduled = false;
    if (destroyed) return;
    const seconds = Math.max(0, (time - last) / 1000);
    last = time;
    run(Number.isFinite(seconds) ? seconds : 0);
    if (tasks.size === 0) stopAll();
    else if (!scheduled && !hidden()) requestNext();
  };

  const start = () => {
    if (scheduled || destroyed || hidden()) return;
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
        tasks.add(task);
        if (tasks.size === 1 && unwatch === undefined) unwatch = env.onVisibilityChange?.(onVisibility) ?? (() => undefined);
      }
      start();
      return () => {
        drop(task);
        if (tasks.size === 0) stopAll();
      };
    },
    advance(seconds) {
      if (destroyed || !(seconds > 0) || !Number.isFinite(seconds)) return;
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
      due = null;
      stopAll();
    },
  };
}
