import { afterEach, describe, expect, it, vi } from "vitest";
import { createScheduler, type FrameEnvironment, type FrameTask } from "../../src/frame";
import { createSpring, FIXED_STEP, MAX_FRAME, stepSpring, type SpringState } from "../../src/engine/spring";
import { FakeEnv } from "../helpers/fake-env";

// The shared frame scheduler: a fixed step, a clamped frame time, a pause while the tab is hidden, and a manual advance for tests.

class PageEnv extends FakeEnv implements FrameEnvironment {
  hidden = false;
  listeners = new Set<(hidden: boolean) => void>();
  tabHidden = () => this.hidden;
  onVisibilityChange = (listener: (hidden: boolean) => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    for (const listener of [...this.listeners]) listener(hidden);
  }
}

/** A task that counts its slices and frames. */
function counter() {
  const task = { steps: 0, frames: 0, step: (dt: number) => { task.steps += 1; task.dts.push(dt); }, frame: () => { task.frames += 1; }, dts: [] as number[] };
  return task;
}

/** A task that springs toward 1 and records the committed value after every slice. */
function springTask() {
  let state: SpringState = createSpring({ stiffness: 170, damping: 14 });
  const values: number[] = [];
  const task: FrameTask & { values: number[] } = {
    values,
    step(dt) {
      state = stepSpring(state, 1, dt);
      values.push(state.value);
    },
  };
  return task;
}

/** Runs `frames` frames of `ms` each and returns how many slices each frame ran. */
function slicesPerFrame(ms: number, frames: number) {
  const env = new PageEnv();
  const scheduler = createScheduler(env);
  const task = counter();
  scheduler.add(task);
  const seen: number[] = [];
  for (let i = 0; i < frames; i += 1) {
    const before = task.steps;
    env.tick(ms);
    seen.push(task.steps - before);
  }
  return seen;
}

afterEach(() => vi.restoreAllMocks());

describe("the fixed step", () => {
  it("runs the same slices at 30, 60, and 144 Hz: one second is 120 slices, whatever the frame rate", () => {
    const runs = [30, 60, 144].map((hz) => {
      const env = new PageEnv();
      const scheduler = createScheduler(env);
      const task = springTask();
      scheduler.add(task);
      for (let i = 0; i < hz; i += 1) env.tick(1000 / hz);
      return task.values;
    });
    for (const values of runs) expect(values).toHaveLength(120);
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
  });

  it("gives every slice the same dt, which is FIXED_STEP", () => {
    const env = new PageEnv();
    const scheduler = createScheduler(env);
    const task = counter();
    scheduler.add(task);
    for (let i = 0; i < 30; i += 1) env.tick(1000 / 30);
    expect(task.dts).toHaveLength(30 * 4);
    expect(new Set(task.dts)).toEqual(new Set([FIXED_STEP]));
  });

  it("pins the slices of each frame at 30, 60, and 144 Hz", () => {
    expect(slicesPerFrame(1000 / 30, 6)).toEqual([4, 4, 4, 4, 4, 4]);
    expect(slicesPerFrame(1000 / 60, 6)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(slicesPerFrame(1000 / 144, 12)).toEqual([0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1]);
  });

  it("pins the first committed values of a spring on the scheduler", () => {
    const env = new PageEnv();
    const scheduler = createScheduler(env);
    const task = springTask();
    scheduler.add(task);
    for (let i = 0; i < 3; i += 1) env.tick(1000 / 60);
    expect(task.values.slice(0, 6).map((v) => Number(v.toFixed(6)))).toEqual(PINNED_SPRING);
  });

  it("carries the leftover time to the next frame", () => {
    const env = new PageEnv();
    const scheduler = createScheduler(env);
    const task = counter();
    scheduler.add(task);
    env.tick(5);
    expect(task.steps).toBe(0);
    env.tick(5);
    expect(task.steps).toBe(1);
  });
});

describe("the clamp", () => {
  it("treats a stalled frame as MAX_FRAME long", () => {
    const env = new PageEnv();
    const scheduler = createScheduler(env);
    const task = counter();
    scheduler.add(task);
    env.tick(5000);
    expect(task.steps).toBe(Math.round(MAX_FRAME / FIXED_STEP));
    expect(task.steps).toBe(12);
  });
});

describe("the frame hook", () => {
  it("runs once per frame after the slices, including a frame that ran no slice", () => {
    const env = new PageEnv();
    const scheduler = createScheduler(env);
    const task = counter();
    scheduler.add(task);
    env.tick(1000 / 144);
    expect(task).toMatchObject({ steps: 0, frames: 1 });
    env.tick(1000 / 30);
    expect(task.frames).toBe(2);
  });

  it("runs after the last step of a task that finishes", () => {
    const env = new PageEnv();
    const scheduler = createScheduler(env);
    const order: string[] = [];
    scheduler.add({ step: () => { order.push("step"); return false; }, frame: () => order.push("frame") });
    env.tick(1000 / 60);
    expect(order).toEqual(["step", "frame"]);
  });
});

describe("tasks", () => {
  it("starts a frame loop when a task is added, and stops it when the last task leaves", () => {
    const env = new PageEnv();
    const scheduler = createScheduler(env);
    expect(env.pending).toBe(0);
    const remove = scheduler.add(counter());
    expect(env.pending).toBe(1);
    expect(scheduler.size).toBe(1);
    remove();
    expect(env.pending).toBe(0);
    expect(scheduler.size).toBe(0);
    expect(env.cancelled).toHaveLength(1);
  });

  it("removes a task that returns false and stops the loop when none is left", () => {
    const env = new PageEnv();
    const scheduler = createScheduler(env);
    let left = 3;
    const task = { steps: 0, step: () => { task.steps += 1; left -= 1; return left > 0; } };
    scheduler.add(task);
    env.settle(1000 / 60);
    expect(task.steps).toBe(3);
    expect(scheduler.size).toBe(0);
    expect(env.pending).toBe(0);
  });

  it("does not change the frames of one task when another is added or removed", () => {
    const alone = new PageEnv();
    const one = createScheduler(alone);
    const solo = springTask();
    one.add(solo);
    for (let i = 0; i < 20; i += 1) alone.tick(1000 / 60);

    const shared = new PageEnv();
    const two = createScheduler(shared);
    const first = springTask();
    const second = springTask();
    two.add(first);
    const removeSecond = two.add(second);
    for (let i = 0; i < 10; i += 1) shared.tick(1000 / 60);
    removeSecond();
    for (let i = 0; i < 10; i += 1) shared.tick(1000 / 60);
    expect(first.values).toEqual(solo.values);
    expect(second.values).toEqual(solo.values.slice(0, 20));
  });

  it("starts a task added in a slice on the next slice, and lets a task remove itself", () => {
    const env = new PageEnv();
    const scheduler = createScheduler(env);
    const late = counter();
    let remove: () => void = () => undefined;
    const early = { steps: 0, step: () => { early.steps += 1; if (early.steps === 1) scheduler.add(late); if (early.steps === 2) remove(); } };
    remove = scheduler.add(early);
    env.tick(1000 / 30);
    expect(early.steps).toBe(2);
    expect(late.steps).toBe(3);
    expect(late.frames).toBe(1);
    expect(scheduler.size).toBe(1);
  });

  it("adds the same task once", () => {
    const env = new PageEnv();
    const scheduler = createScheduler(env);
    const task = counter();
    scheduler.add(task);
    scheduler.add(task);
    expect(scheduler.size).toBe(1);
    env.tick(1000 / 120);
    expect(task.steps).toBe(1);
  });

  it("logs a task that throws once, removes it, and keeps the others running", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = new PageEnv();
    const scheduler = createScheduler(env);
    const good = counter();
    scheduler.add({ step: () => { throw new Error("boom"); } });
    scheduler.add(good);
    env.tick(1000 / 30);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toBe("[armature] A frame task threw and was removed.");
    expect(good.steps).toBe(4);
    expect(scheduler.size).toBe(1);
  });

  it("removes a task whose frame hook throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = new PageEnv();
    const scheduler = createScheduler(env);
    scheduler.add({ step: () => undefined, frame: () => { throw new Error("boom"); } });
    env.tick(1000 / 60);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(scheduler.size).toBe(0);
    expect(env.pending).toBe(0);
  });
});

describe("a hidden tab", () => {
  it("asks for no frame while the tab is hidden, and starts when it shows", () => {
    const env = new PageEnv();
    env.hidden = true;
    const scheduler = createScheduler(env);
    const task = counter();
    scheduler.add(task);
    expect(env.pending).toBe(0);
    env.setHidden(false);
    expect(env.pending).toBe(1);
    env.tick(1000 / 60);
    expect(task.steps).toBe(2);
  });

  it("cancels the pending frame when the tab hides, and does not catch up when it shows", () => {
    const env = new PageEnv();
    const scheduler = createScheduler(env);
    const task = counter();
    scheduler.add(task);
    env.tick(1000 / 60);
    expect(task.steps).toBe(2);
    env.setHidden(true);
    expect(env.pending).toBe(0);
    env.time += 60_000;
    env.setHidden(false);
    expect(env.pending).toBe(1);
    env.tick(1000 / 60);
    expect(task.steps).toBe(4);
  });

  it("listens for visibility only while a task is waiting", () => {
    const env = new PageEnv();
    const scheduler = createScheduler(env);
    expect(env.listeners.size).toBe(0);
    const remove = scheduler.add(counter());
    expect(env.listeners.size).toBe(1);
    remove();
    expect(env.listeners.size).toBe(0);
    scheduler.add(counter());
    scheduler.destroy();
    expect(env.listeners.size).toBe(0);
  });

  it("works with an environment that cannot say whether the tab is hidden", () => {
    const env = new FakeEnv();
    const scheduler = createScheduler(env);
    const task = counter();
    scheduler.add(task);
    env.tick(1000 / 60);
    expect(task.steps).toBe(2);
  });
});

describe("advance", () => {
  it("runs the same slices as a frame of that length, with no environment call", () => {
    const env = new PageEnv();
    const scheduler = createScheduler(env);
    const task = counter();
    scheduler.add(task);
    env.cancelFrame(1);
    const requested = env.requested;
    scheduler.advance(1 / 60);
    expect(task).toMatchObject({ steps: 2, frames: 1 });
    expect(env.requested).toBe(requested);
  });

  it("clamps a long advance to MAX_FRAME and ignores zero, negative, and non-finite time", () => {
    const env = new PageEnv();
    const scheduler = createScheduler(env);
    const task = counter();
    scheduler.add(task);
    scheduler.advance(10);
    expect(task.steps).toBe(12);
    for (const bad of [0, -1, NaN, Infinity, -Infinity]) scheduler.advance(bad);
    expect(task.steps).toBe(12);
  });

  it("gives a manual run the same values as a run on frames", () => {
    const framed = new PageEnv();
    const a = createScheduler(framed);
    const taskA = springTask();
    a.add(taskA);
    for (let i = 0; i < 30; i += 1) framed.tick(1000 / 60);

    const manual = new PageEnv();
    const b = createScheduler(manual);
    const taskB = springTask();
    b.add(taskB);
    for (let i = 0; i < 30; i += 1) b.advance(1 / 60);
    expect(taskB.values).toEqual(taskA.values);
  });

  it("stops the loop when a manual run finishes the last task", () => {
    const env = new PageEnv();
    const scheduler = createScheduler(env);
    scheduler.add({ step: () => false });
    scheduler.advance(1 / 60);
    expect(scheduler.size).toBe(0);
    expect(env.pending).toBe(0);
  });
});

describe("destroy", () => {
  it("cancels the frame, drops every task, and ignores later calls", () => {
    const env = new PageEnv();
    const scheduler = createScheduler(env);
    const task = counter();
    scheduler.add(task);
    scheduler.destroy();
    expect(env.pending).toBe(0);
    expect(scheduler.size).toBe(0);
    const remove = scheduler.add(counter());
    expect(env.pending).toBe(0);
    expect(() => remove()).not.toThrow();
    expect(() => scheduler.advance(1)).not.toThrow();
    expect(() => scheduler.destroy()).not.toThrow();
    expect(task.steps).toBe(0);
  });

  it("is safe when a task destroys the scheduler inside a slice", () => {
    const env = new PageEnv();
    const scheduler = createScheduler(env);
    const task = { steps: 0, step: () => { task.steps += 1; scheduler.destroy(); } };
    scheduler.add(task);
    env.tick(1000 / 30);
    expect(task.steps).toBe(1);
    expect(env.pending).toBe(0);
  });
});

describe("an environment with unusual frame ids", () => {
  it("handles an id of 0 and a callback that runs before requestFrame returns", () => {
    const env = new PageEnv();
    let inline = true;
    env.requestFrame = (callback) => {
      env.requested += 1;
      if (inline) {
        inline = false;
        callback(env.time + 1000 / 60);
        return 0;
      }
      const id = env.nextId++;
      env.frames.set(id, callback);
      return id;
    };
    const scheduler = createScheduler(env);
    const task = counter();
    scheduler.add(task);
    expect(task.steps).toBe(2);
    expect(env.pending).toBe(1);
    scheduler.destroy();
    expect(env.pending).toBe(0);
  });
});

const PINNED_SPRING = [0.011806, 0.0339, 0.064822, 0.103177, 0.147644, 0.196987];
