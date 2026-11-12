/**
 * Drag: an element follows a pointer on one or two axes, with optional bounds. It writes the individual CSS property `translate`, never `transform`.
 *
 * Past a bound the element shows a rubber band: the overshoot d of the pointer shows as d / (1 + d / reach). On release the motion depends on
 * the options. With snap points, a spring carries the element to the nearest one, and the release velocity goes into the spring. Without them
 * the element keeps its velocity and slows by friction, v' = -c v, and the decay stops when its speed is below the rest speed. An element
 * out of the bounds, or one that decay carries past a bound, springs back to the bound on a band spring that is stiffer the farther it is.
 * The shown overshoot stays below `reach` in every case: under the pointer, in a decay, and on a spring.
 * A release with enough speed and distance also fires a swipe. Under reduced motion a release has no inertia: the element goes straight to its end point.
 *
 * One frame loop runs, and only while something moves. The decay and the band spring step in the engine's fixed slices, and the snap spring uses
 * the solver's own slices, so a 30, 60, or 144 Hz screen lands in the same place. Every read of the browser goes through the injected environment.
 */
import { prefersReducedMotion, type ArmatureTarget } from "../engine/env";
import { logTag, springOf, type Flavor } from "../engine/flavor";
import { createSpring, criticalDamping, FIXED_STEP, isAtRest, MAX_FRAME, reconfigure, retarget, stepSpring, type SpringConfig, type SpringState } from "../engine/spring";
import { requireGesture } from "./flavor";
import { createBrowserPointerEnvironment, type ArmaturePointerEnvironment, type PointerSample } from "./pointer-env";
import { createPointerVelocity } from "./pointer-velocity";

/** A lowest and a highest position, in pixels. */
export type DragBounds = readonly [number, number];
export type SwipeDirection = "left" | "right" | "up" | "down";

export interface DragOptions {
  /** The numbers to use. Required. It needs a gesture part. */
  flavor: Flavor;
  /** Which axes follow the pointer. Default "both". */
  axis?: "x" | "y" | "both";
  /** For one axis, a pair `[min, max]`. For "both", `{ x?, y? }`. Past a bound the element rubber-bands. Default: no bounds. */
  bounds?: DragBounds | { x?: DragBounds; y?: DragBounds };
  /** For one axis, a list of positions. For "both", a list of `[x, y]` points. A release springs to the nearest one. An empty list means no snap. */
  snap?: readonly number[] | ReadonlyArray<readonly [number, number]>;
  /** Defaults to the real browser. A test passes a fake. */
  env?: ArmaturePointerEnvironment;
}

export interface DragState {
  /** The position to draw, in pixels from where the element sits with no `translate`. */
  x: number;
  y: number;
  /** The velocity, in pixels per second. */
  vx: number;
  vy: number;
  /** True while a pointer holds the element. */
  dragging: boolean;
  /** True while the element still travels after a release. */
  moving: boolean;
  destroyed: boolean;
  /** Set when the drag stopped because a write failed, and not because of `destroy`. It holds the error of the write. */
  failed?: Error;
}

export interface Drag {
  /** Calls `listener` with a direction when a release has the speed and the distance the flavor asks for. Returns the unsubscribe. */
  onSwipe(listener: (direction: SwipeDirection) => void): () => void;
  getState(): DragState;
  /**
   * Stops every motion, removes the listeners, and ignores every later call. The element stays where it is, except that an element out of the
   * bounds goes to the bound. It logs nothing. Safe to call twice.
   */
  destroy(): void;
}

interface Axis {
  on: boolean;
  lo: number;
  hi: number;
  /** The position shown. */
  p: number;
  v: number;
  mode: "rest" | "decay" | "spring";
  spring: SpringState | undefined;
  /** True while the spring is a rubber band spring, whose stiffness follows the distance. */
  band: boolean;
  /** The position at the press, and the pointer coordinate at the press. */
  raw0: number;
  p0: number;
  /**
   * A press on an element that is out of the bounds starts from the overshoot it shows. `dir` is the side (-1 or 1, 0 for none), `bound` the bound,
   * and `s0` the overshoot at the press. The pointer then moves the element one to one inward, and against the band outward.
   */
  dir: number;
  bound: number;
  s0: number;
  /** The slope of the band at the pointer, from 0 to 1. The release speed is scaled by it. */
  slope: number;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const pair = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && finite(value[0]) && finite(value[1]);
/** The largest position written, in pixels. A larger number is cut to it, so no number is ever written as exponent text. */
const MAX_PX = 1e9;
const text = (n: number) => String(Number(Math.max(-MAX_PX, Math.min(MAX_PX, n)).toFixed(3)));
/** Float sums of frame times can fall a hair short of a whole slice. This many seconds of slack count as a whole slice. */
const SLACK = 1e-9;

export function createDrag(element: ArmatureTarget, options: DragOptions): Drag {
  if ((typeof element !== "object" && typeof element !== "function") || element === null) throw new TypeError("A drag needs an element to move.");
  const flavor = options.flavor;
  const gesture = requireGesture(flavor);
  const axis = options.axis ?? "both";
  if (axis !== "x" && axis !== "y" && axis !== "both") throw new TypeError(`A drag needs an axis of "x", "y", or "both", and got ${JSON.stringify(axis)}.`);
  const single = axis !== "both";

  // Bounds: a pair for one axis, an object of pairs for both.
  const ranges: Array<[number, number] | undefined> = [undefined, undefined];
  if (options.bounds !== undefined) {
    const given = options.bounds as unknown;
    const bad = new TypeError(`The drag bounds are ${single ? "a pair [min, max] of finite numbers, lowest first" : "an object { x?, y? } of such pairs"}.`);
    if (single !== Array.isArray(given) || (!single && (typeof given !== "object" || given === null))) throw bad;
    const list = single ? [given] : [(given as { x?: unknown }).x, (given as { y?: unknown }).y];
    list.forEach((range, i) => {
      if (range === undefined) return;
      if (!pair(range) || range[0] > range[1]) throw bad;
      ranges[single ? (axis === "x" ? 0 : 1) : i] = range;
    });
  }

  // Snap points are stored as [x, y]. The axis that does not move holds 0.
  const points: number[][] = [];
  if (options.snap !== undefined) {
    const bad = new TypeError(`The drag snap is a list of ${single ? "finite numbers" : "[x, y] points of finite numbers"}.`);
    if (!Array.isArray(options.snap)) throw bad;
    for (const item of options.snap as unknown[]) {
      if (single ? !finite(item) : !pair(item)) throw bad;
      const point = single ? (axis === "x" ? [item as number, 0] : [0, item as number]) : [...(item as number[])];
      // A snap point outside the bounds would send the element to rest outside them.
      if (point.some((n, i) => (single ? i === (axis === "x" ? 0 : 1) : true) && ranges[i] !== undefined && (n < ranges[i]![0] || n > ranges[i]![1]))) {
        throw new TypeError("A drag snap point lies outside the bounds.");
      }
      points.push(point);
    }
  }

  const env = options.env ?? createBrowserPointerEnvironment();
  const { friction, rubberBand, swipe, rest } = gesture;
  /** The shown overshoot never reaches `reach`. A hair under it keeps the band slope above 0. */
  const limit = rubberBand.reach * 0.999;
  const decayFactor = Math.exp(-friction * FIXED_STEP);
  const snapSpring: SpringConfig = { ...rest, ...springOf(flavor, gesture.springKeys.snap) };
  const bandSpring = (distance: number): SpringConfig => {
    const stiffness = rubberBand.stiffness * (1 + distance / rubberBand.reach);
    return { stiffness, damping: criticalDamping(stiffness), ...rest };
  };

  const axes: Axis[] = [0, 1].map((i) => ({
    on: single ? axis === (i === 0 ? "x" : "y") : true,
    lo: ranges[i]?.[0] ?? -Infinity, hi: ranges[i]?.[1] ?? Infinity,
    p: 0, v: 0, mode: "rest", spring: undefined, band: false, raw0: 0, p0: 0, dir: 0, bound: 0, s0: 0, slope: 1,
  }));
  const coord = (s: PointerSample, i: number) => (i === 0 ? s.x : s.y);
  /** The overshoot of a position past the bounds, signed. 0 inside. */
  const over = (a: Axis, p: number) => (p < a.lo ? p - a.lo : p > a.hi ? p - a.hi : 0);
  /** The position inside the bounds that is nearest to `p`. */
  const edge = (a: Axis, p: number) => Math.min(a.hi, Math.max(a.lo, p));
  /** The position shown for a position the pointer would give. */
  const shown = (a: Axis, raw: number) => {
    const o = over(a, raw);
    return o === 0 ? raw : raw - o + Math.sign(o) * Math.min(limit, Math.abs(o) / (1 + Math.abs(o) / rubberBand.reach));
  };
  /** The slope of the band at a pointer overshoot d: 1 at the bound, falling toward 0. */
  const slopeAt = (d: number) => 1 / (1 + d / rubberBand.reach) ** 2;
  /** The fastest a spring leaves a bound without its peak overshoot reaching `limit`: a critically damped spring peaks at v / (omega e). */
  const bandSpeed = 0.8 * limit * Math.sqrt(rubberBand.stiffness) * Math.E;

  const velocity = createPointerVelocity();
  const listeners = new Set<(direction: SwipeDirection) => void>();
  let active: number | null = null;
  let destroyed = false;
  let scheduled = false;
  let frameId = 0;
  let last = 0;
  let carry = 0;
  let written = "";
  const threw = new WeakSet<object>();
  let warned = false;
  let off: () => void = () => undefined;
  let failure: Error | undefined;
  let before: string | null = null;
  try {
    before = env.getStyle?.(element, "touch-action") ?? null;
  } catch {
    // An environment that cannot read a style leaves the property to be removed.
  }

  const translate = () => `${text(axes[0].p)}px ${text(axes[1].p)}px`;
  const stopFrame = () => {
    if (scheduled) {
      scheduled = false;
      env.cancelFrame(frameId);
    }
  };
  /** Removes the listeners, and gives touch-action back. Each step stands alone, so one that throws does not stop the other. */
  const cleanup = () => {
    try {
      off();
    } catch {
      // The listeners are dropped with the element.
    }
    off = () => undefined;
    try {
      env.setStyle(element, "touch-action", before);
    } catch {
      // Best effort: the page keeps the value it has.
    }
  };
  const shutdown = () => {
    destroyed = true;
    active = null;
    stopFrame();
    cleanup();
    for (const a of axes) [a.mode, a.v] = ["rest", 0];
  };
  /** Writes the position. A write that throws is logged once, and the drag stops. */
  const write = (): boolean => {
    const next = translate();
    if (next === written) return true;
    try {
      env.setStyle(element, "translate", next);
    } catch (error) {
      console.error(`${logTag(flavor)} The drag could not write translate and stopped.`, error);
      failure = error instanceof Error ? error : new Error(String(error));
      shutdown();
      return false;
    }
    written = next;
    return true;
  };

  /** Starts a spring from where the axis is, with the velocity it has. */
  const launch = (a: Axis, target: number, config: SpringConfig, band: boolean) => {
    // A flick that meets the bound is slowed by the band, so the clamp at the reach is a backstop that rarely binds.
    if (band) a.v = Math.max(-bandSpeed, Math.min(bandSpeed, a.v));
    a.spring = { ...retarget(createSpring(config, a.p), target), velocity: a.v, settledVelocity: a.v };
    [a.band, a.mode] = [band, "spring"];
    if (isAtRest(a.spring)) [a.p, a.v, a.mode] = [target, 0, "rest"];
  };
  /**
   * Steps a spring. A band spring steps in whole slices of `FIXED_STEP` and takes its stiffness again at each one, so the pace does not
   * depend on the frame rate. A snap spring has a fixed stiffness, and the solver slices it itself. A spring never shows more than `limit` past a bound.
   */
  const advance = (a: Axis, steps: number, dt: number) => {
    let spring = a.spring!;
    if (a.band) {
      for (let i = 0; i < steps && !isAtRest(spring); i++) {
        spring = reconfigure(spring, bandSpring(Math.abs(spring.value - spring.target)));
        spring = stepSpring(spring, spring.target, FIXED_STEP);
      }
    } else {
      spring = stepSpring(spring, spring.target, dt);
    }
    const o = over(a, spring.value);
    if (Math.abs(o) > limit) {
      const value = edge(a, spring.value) + Math.sign(o) * limit;
      spring = { ...spring, value, settledValue: value, velocity: 0, settledVelocity: 0, carry: 0 };
    }
    [a.spring, a.p, a.v] = [spring, spring.value, spring.velocity];
    if (isAtRest(spring)) a.mode = "rest";
  };
  const decay = (a: Axis, steps: number) => {
    for (let i = 0; i < steps; i++) {
      a.v *= decayFactor;
      a.p += a.v * FIXED_STEP;
      if (over(a, a.p) !== 0) {
        // The element crossed a bound: the band takes it, with the rest of this frame.
        launch(a, edge(a, a.p), bandSpring(Math.abs(over(a, a.p))), true);
        if (a.mode === "spring") advance(a, steps - i - 1, 0);
        return;
      }
      if (Math.abs(a.v) < rest.restSpeed) {
        [a.v, a.mode] = [0, "rest"];
        return;
      }
    }
  };

  const moving = () => axes.some((a) => a.mode !== "rest");
  const requestNext = () => {
    scheduled = true;
    const id = env.requestFrame(tick);
    // A callback that ran inside requestFrame has already cleared the flag, and its id is stale.
    if (scheduled) frameId = id;
  };
  function tick(time: number) {
    scheduled = false;
    if (destroyed) return;
    if (prefersReducedMotion(env)) {
      for (const a of axes) if (a.mode !== "rest") [a.p, a.v, a.mode] = [a.mode === "spring" ? a.spring!.target : edge(a, a.p), 0, "rest"];
      write();
      return;
    }
    const dt = Math.min(MAX_FRAME, Math.max(0, (time - last) / 1000));
    last = time;
    carry += dt;
    let steps = 0;
    while (carry >= FIXED_STEP - SLACK) {
      carry -= FIXED_STEP;
      steps += 1;
    }
    for (const a of axes) {
      if (a.mode === "decay") decay(a, steps);
      else if (a.mode === "spring") advance(a, steps, dt);
    }
    if (write() && moving()) requestNext();
  }

  /** The nearest snap point to where the axes are, or undefined with no snap points. */
  const nearest = () => {
    let best: number[] | undefined;
    let bestDistance = Infinity;
    for (const point of points) {
      const distance = axes.reduce((sum, a, i) => sum + (a.on ? (a.p - point[i]) ** 2 : 0), 0);
      if (distance < bestDistance) [best, bestDistance] = [point, distance];
    }
    return best;
  };

  /** Moves the axes to where the pointer says, and feeds the velocity tracker. Returns false when the write failed. */
  const follow = (s: PointerSample) => {
    axes.forEach((a, i) => {
      const c = coord(s, i);
      if (!a.on || !finite(c)) return;
      if (a.dir === 0) {
        const raw = a.raw0 + c - a.p0;
        a.p = shown(a, raw);
        a.slope = over(a, raw) === 0 ? 1 : slopeAt(Math.abs(over(a, raw)));
        return;
      }
      // Pressed out of the bounds: outward the band resists from the overshoot shown at the press, inward the element follows one to one.
      const u = a.dir * (c - a.p0);
      const o = u > 0 ? Math.min(limit, a.s0 + u / (1 + u / rubberBand.reach)) : a.s0 + u;
      const p = a.bound + a.dir * o;
      a.p = over(a, p) * a.dir < 0 ? shown(a, p) : p;
      a.slope = u > 0 ? slopeAt(u) : 1;
    });
    velocity.add(s.x, s.y, s.time);
    return write();
  };

  const release = (s: PointerSample | null) => {
    active = null;
    const v = s ? velocity.read(s.time) : { x: 0, y: 0 };
    // A swipe reads the speed of the pointer and the distance it travelled on each axis. The faster axis wins.
    let direction: SwipeDirection | undefined;
    let fastest = 0;
    if (s) {
      axes.forEach((a, i) => {
        const speed = i === 0 ? v.x : v.y;
        if (a.on && Math.abs(speed) >= swipe.velocity && Math.abs(coord(s, i) - a.p0) >= swipe.distance && Math.abs(speed) > fastest) {
          fastest = Math.abs(speed);
          direction = i === 0 ? (speed > 0 ? "right" : "left") : speed > 0 ? "down" : "up";
        }
      });
    }
    const reduced = prefersReducedMotion(env);
    const point = nearest();
    axes.forEach((a, i) => {
      if (!a.on) return;
      const o = over(a, a.p);
      a.v = i === 0 ? v.x : v.y;
      // Out of the bounds, the element is slower than the pointer by the slope of the band.
      if (o !== 0) a.v *= a.slope;
      if (reduced) [a.p, a.v, a.mode] = [point ? point[i] : o === 0 ? a.p : edge(a, a.p), 0, "rest"];
      else if (point) launch(a, point[i], snapSpring, false);
      else if (o !== 0) launch(a, edge(a, a.p), bandSpring(Math.abs(o)), true);
      else if (Math.abs(a.v) >= rest.restSpeed) a.mode = "decay";
      else [a.v, a.mode] = [0, "rest"];
    });
    if (!write()) return;
    if (moving()) {
      last = env.now();
      carry = 0;
      requestNext();
    }
    if (direction !== undefined) {
      for (const listener of [...listeners]) {
        try {
          listener(direction);
        } catch (error) {
          if (!threw.has(listener)) console.error(`${logTag(flavor)} A swipe listener threw.`, error);
          threw.add(listener);
        }
      }
    }
  };

  env.setStyle(element, "touch-action", axis === "x" ? "pan-y" : axis === "y" ? "pan-x" : "none");
  off = env.onPointer(element, {
    down(s) {
      if (destroyed || s.id === active || !finite(s.x) || !finite(s.y)) return;
      // A press of another pointer while one is held means the end of the first never arrived. The new press takes over from where the element is.
      stopFrame();
      active = s.id;
      velocity.reset();
      axes.forEach((a, i) => {
        const o = over(a, a.p);
        [a.mode, a.v, a.raw0, a.p0, a.slope] = ["rest", 0, a.p, coord(s, i), 1];
        [a.dir, a.bound, a.s0] = [Math.sign(o), o === 0 ? 0 : edge(a, a.p), Math.abs(o)];
      });
      velocity.add(s.x, s.y, s.time);
    },
    move(s) {
      if (!destroyed && s.id === active) follow(s);
    },
    up(s) {
      if (!destroyed && s.id === active && follow(s)) release(s);
    },
    cancel(s) {
      if (!destroyed && s.id === active) release(null);
    },
    fault(error) {
      if (!destroyed && !warned) console.warn(`${logTag(flavor)} A pointer could not be captured. A release outside the element can be missed.`, error);
      warned = true;
    },
  });

  return {
    onSwipe(listener) {
      if (typeof listener !== "function") throw new TypeError("onSwipe needs a function.");
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getState: () => ({
      x: axes[0].p, y: axes[1].p, vx: axes[0].v, vy: axes[1].v,
      dragging: active !== null, moving: moving(), destroyed, failed: failure,
    }),
    destroy() {
      if (destroyed) return;
      shutdown();
      for (const a of axes) if (over(a, a.p) !== 0) a.p = edge(a, a.p);
      try {
        const next = translate();
        if (next !== written) env.setStyle(element, "translate", next);
      } catch {
        // A destroy logs nothing. touch-action is already given back.
      }
    },
  };
}
