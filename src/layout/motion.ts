/**
 * The parts that the layout controllers share, so a layout, an exit, and a shared element all move the same way.
 *
 * A pose is four numbers in pixels: the shift of the center (x, y) and the difference in size (width, height) from the box the element has with
 * no offset. Each one is a spring. A layout springs the pose to zero, and an exit springs it to the exit pose. Pixels need only look still, so
 * one rest threshold in pixels serves all four. The pose is written as the individual properties `translate` and `scale`, which are about
 * the center of the element, as a browser applies them. The element's own `transform-origin` must be the default.
 */
import { prefersReducedMotion, type ArmatureTarget } from "../engine/env";
import type { Flavor } from "../engine/flavor";
import { createSpring, FIXED_STEP, isAtRest, retarget, stepSpring, type SpringConfig, type SpringState } from "../engine/spring";
import { createScheduler, type FrameTask, type Scheduler } from "../frame/scheduler";
import { createBrowserLayoutEnvironment, type Box, type LayoutEnvironment } from "./env";
import { requireLayout, type LayoutFlavor } from "./flavor";
import { finite, plain } from "./util";

/** The shift in x and y, and the difference in width and height, all in pixels. */
export type Pose = [number, number, number, number];

export interface SetupOptions {
  flavor: Flavor;
  env?: LayoutEnvironment;
  scheduler?: Pick<Scheduler, "add">;
}

/** The largest number written. A larger one is cut to it, so no number is ever written as exponent text. */
const MAX = 1e9;
const num = (n: number, places: number, low = -MAX) => String(Number(Math.max(low, Math.min(MAX, n)).toFixed(places)));

export const zero = (): Pose => [0, 0, 0, 0];

/** A box of all zeros is what a detached or hidden element measures. It has no layout to move from or to. */
export const empty = (b: Box) => b.x === 0 && b.y === 0 && b.width === 0 && b.height === 0;
/** The one line logged, once, for an element with no layout box. */
export const noBox = (tag: string, skipped: string) => console.error(`${tag} An element has no layout box (detached or hidden), so ${skipped} was skipped.`);

/** The `translate` that other code (a drag, a reveal) left on the element: its text, and the pixels in it. Text it cannot read counts as 0. */
export interface Base {
  text: string | null;
  x: number;
  y: number;
}
const PX = /^(-?[\d.]+(?:e[+-]?\d+)?)px(?:\s+(-?[\d.]+(?:e[+-]?\d+)?)px)?$/i;
export function readBase(env: LayoutEnvironment, el: ArmatureTarget, from?: readonly [number, number]): Base {
  let text: string | null = null;
  try {
    text = env.getStyle?.(el, "translate") || null;
  } catch {
    // An environment that cannot read leaves no base.
  }
  const m = text ? PX.exec(text.trim()) : null;
  return { text, x: from?.[0] ?? (m ? parseFloat(m[1]) || 0 : 0), y: from?.[1] ?? (m ? parseFloat(m[2] ?? "0") || 0 : 0) };
}

/** Adds and removes a task on a scheduler. A stop always forgets the remove function, even when it throws. */
export function runner(scheduler: Pick<Scheduler, "add">, task: FrameTask) {
  let remove: (() => void) | undefined;
  return {
    start() {
      remove ??= scheduler.add(task);
    },
    stop() {
      const r = remove;
      remove = undefined;
      try {
        r?.();
      } catch {
        // The scheduler drops its own task. A remove that throws leaves nothing to undo here.
      }
    },
    /** The scheduler dropped the task by itself. */
    done() {
      remove = undefined;
    },
  };
}

/** The most a child is scaled up, so a parent that nearly vanishes does not send a child to 1e9. */
const COUNTER_MAX = 1000;

/** A box of finite numbers, with a width and a height of 0 or more. Throws a TypeError. */
export function checkBox(value: unknown): Box {
  const b = value as Box;
  if (!plain(b) || !finite(b.x) || !finite(b.y) || !finite(b.width) || !finite(b.height) || b.width < 0 || b.height < 0) {
    throw new TypeError("A box is { x, y, width, height }, with finite numbers and a width and a height of 0 or more.");
  }
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}

/** The speed of a pose: four finite numbers, in pixels per second. Throws a TypeError. */
export function checkPose(value: unknown): Pose {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(finite)) throw new TypeError("A velocity is four finite numbers: x, y, width, height, in pixels per second.");
  return [value[0], value[1], value[2], value[3]];
}

/** What every controller starts with: the flavor part, the environment, the scheduler, and the label of a logged error. */
export function setup(options: SetupOptions | undefined, noun: string) {
  if (!plain(options)) throw new TypeError(`A ${noun} needs options with a flavor.`);
  const flavor = options.flavor;
  const part: LayoutFlavor = requireLayout(flavor);
  const env = options.env ?? createBrowserLayoutEnvironment();
  if (typeof env.measure !== "function") throw new TypeError(`A ${noun} needs an environment with a measure method.`);
  const own = options.scheduler === undefined;
  const spring = (key: string): SpringConfig => ({ ...part.rest, ...flavor.springs[key] });
  return {
    env,
    own,
    scheduler: (options.scheduler ?? createScheduler(env)) as Pick<Scheduler, "add">,
    tag: `[${flavor.logLabel ?? "armature"}]`,
    move: spring(part.springKeys.move),
    exit: spring(part.springKeys.exit ?? part.springKeys.move),
  };
}

export const measure = (env: LayoutEnvironment, target: ArmatureTarget): Box => checkBox(env.measure(target));
export const reduced = (env: LayoutEnvironment) => prefersReducedMotion(env);

/** The pose that puts an element with the natural box `last` on the box `first`. A natural size of 0 has no scale. */
export function invert(first: Box, last: Box): Pose {
  return [
    first.x + first.width / 2 - (last.x + last.width / 2),
    first.y + first.height / 2 - (last.y + last.height / 2),
    last.width > 0 ? first.width - last.width : 0,
    last.height > 0 ? first.height - last.height : 0,
  ];
}

/** Listeners by event. A throw is counted, and logged once for that listener. */
export function createEmitter(tag: string, noun: string, events: readonly string[], gone: () => boolean) {
  const lists = new Map(events.map((name) => [name, new Set<(...args: never[]) => void>()]));
  const threw = new WeakSet<object>();
  let errors = 0;
  return {
    on(event: string, listener: (...args: never[]) => void) {
      if (!lists.has(event)) throw new TypeError(`A ${noun} event is ${events.map((name) => `"${name}"`).join(" or ")}.`);
      if (typeof listener !== "function") throw new TypeError(`A ${noun} listener is a function.`);
      if (gone()) return () => undefined;
      lists.get(event)!.add(listener);
      return () => {
        lists.get(event)!.delete(listener);
      };
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of [...lists.get(event)!]) {
        try {
          (listener as (...rest: unknown[]) => void)(...args);
        } catch (error) {
          errors += 1;
          if (!threw.has(listener)) console.error(`${tag} A ${noun} listener threw.`, error);
          threw.add(listener);
        }
      }
    },
    clear: () => lists.forEach((list) => list.clear()),
    errors: () => errors,
  };
}

/** One element in motion: four springs, and the writes of their pose. */
export interface Mover {
  /** Steps every spring one fixed slice. Returns true while any of them still moves. */
  step(): boolean;
  moving(): boolean;
  /** Writes the pose when its text changed. A write that throws reaches the caller. */
  write(): void;
  /** Removes every style it wrote. */
  clear(): void;
  pose(): Pose;
  speed(): Pose;
  scale(): [number, number];
}

export function createMover(env: LayoutEnvironment, el: ArmatureTarget, natural: Box, from: Pose, speed: Pose, goal: Pose, config: SpringConfig, kids: readonly ArmatureTarget[], base: Base = { text: null, x: 0, y: 0 }): Mover {
  let springs: SpringState[] = from.map((value, i) => ({ ...retarget(createSpring(config, value), goal[i]), velocity: speed[i], settledVelocity: speed[i] }));
  let live = springs.some((s) => !isAtRest(s));
  let translated: string | null = null;
  const scaled = new Map<ArmatureTarget, string | null>();
  const ratio = (size: number, difference: number) => (size > 0 ? Math.max(0, (size + difference) / size) : 1);
  const scale = (): [number, number] => [ratio(natural.width, springs[2].value), ratio(natural.height, springs[3].value)];
  const put = (target: ArmatureTarget, value: string | null) => {
    if ((scaled.get(target) ?? null) === value) return;
    env.setStyle(target, "scale", value);
    scaled.set(target, value);
  };
  return {
    step() {
      live = false;
      springs = springs.map((s) => {
        if (isAtRest(s)) return s;
        const next = stepSpring(s, s.target, FIXED_STEP);
        if (!isAtRest(next)) live = true;
        return next;
      });
      return live;
    },
    moving: () => live,
    write() {
      const [sx, sy] = scale();
      // A shift of nothing is not written, so a scale alone, or a pose that rests, leaves `translate` alone.
      const text = `${num(base.x + springs[0].value, 3)}px ${num(base.y + springs[1].value, 3)}px`;
      const shift = text === "0px 0px" && base.text === null ? null : text;
      if (shift !== translated) {
        env.setStyle(el, "translate", shift);
        translated = shift;
      }
      const same = sx === 1 && sy === 1;
      put(el, same ? null : `${num(sx, 5, 0)} ${num(sy, 5, 0)}`);
      // A child gets the inverse of the scale of its parent, so it keeps its own shape.
      for (const kid of kids) put(kid, same ? null : `${num(Math.min(COUNTER_MAX, 1 / Math.max(sx, 1e-3)), 5, 0)} ${num(Math.min(COUNTER_MAX, 1 / Math.max(sy, 1e-3)), 5, 0)}`);
    },
    clear() {
      // Each write stands alone. A state changes only after its write worked, so a later clear tries again what failed.
      let failure: { error: unknown } | undefined;
      const attempt = (write: () => void) => {
        try {
          write();
        } catch (error) {
          failure ??= { error };
        }
      };
      if (translated !== null) {
        attempt(() => {
          env.setStyle(el, "translate", base.text);
          translated = null;
        });
      }
      for (const [target, value] of [...scaled]) {
        if (value === null) scaled.delete(target);
        else {
          attempt(() => {
            env.setStyle(target, "scale", null);
            scaled.delete(target);
          });
        }
      }
      if (failure) throw failure.error;
    },
    pose: () => springs.map((s) => s.value) as Pose,
    speed: () => springs.map((s) => s.velocity) as Pose,
    scale,
  };
}

