/**
 * Drag: an element follows a pointer on one or two axes, with optional bounds. It writes the individual CSS property `translate`, never `transform`.
 *
 * Past a bound the element shows a rubber band: the overshoot d of the pointer shows as d / (1 + d / reach). On release the motion depends on
 * the options. With snap points, a spring carries the element to the nearest one, and the release velocity goes into the spring. Without them
 * the element keeps its velocity and slows by friction, v' = -c v, and the decay stops when its speed is below the rest speed. An element
 * out of the bounds, or one that decay carries past a bound, springs back to the bound on a band spring that is stiffer the farther it is.
 * A release with enough speed and distance also fires a swipe. Under reduced motion a release has no inertia: the element goes straight to its end point.
 *
 * One frame loop runs, and only while something moves. The decay steps in the engine's fixed slices and the springs use the solver's own slices,
 * so a 30, 60, or 144 Hz screen lands in the same place. Every read of the browser goes through the injected environment.
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
  /** The position the pointer would give with no band, and the pointer coordinate, both at the press. */
  raw0: number;
  p0: number;
}

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const pair = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && finite(value[0]) && finite(value[1]);
const text = (n: number) => String(Number(n.toFixed(3)));
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
      points.push(single ? (axis === "x" ? [item as number, 0] : [0, item as number]) : (item as number[]));
    }
  }

  const env = options.env ?? createBrowserPointerEnvironment();
  const { friction, rubberBand, swipe, rest } = gesture;
  const decayFactor = Math.exp(-friction * FIXED_STEP);
  const snapSpring: SpringConfig = { ...rest, ...springOf(flavor, gesture.springKeys.snap) };
  const bandSpring = (distance: number): SpringConfig => {
    const stiffness = rubberBand.stiffness * (1 + distance / rubberBand.reach);
    return { stiffness, damping: criticalDamping(stiffness), ...rest };
  };

  const axes: Axis[] = [0, 1].map((i) => ({
    on: single ? axis === (i === 0 ? "x" : "y") : true,
    lo: ranges[i]?.[0] ?? -Infinity, hi: ranges[i]?.[1] ?? Infinity,
    p: 0, v: 0, mode: "rest", spring: undefined, band: false, raw0: 0, p0: 0,
  }));
  const coord = (s: PointerSample, i: number) => (i === 0 ? s.x : s.y);
  /** The overshoot of a position past the bounds, signed. 0 inside. */
  const over = (a: Axis, p: number) => (p < a.lo ? p - a.lo : p > a.hi ? p - a.hi : 0);
  /** The position inside the bounds that is nearest to `p`. */
  const edge = (a: Axis, p: number) => Math.min(a.hi, Math.max(a.lo, p));
  /** The position shown for a position the pointer would give. */
  const shown = (a: Axis, raw: number) => {
    const o = over(a, raw);
    return o === 0 ? raw : raw - o + Math.sign(o) * (Math.abs(o) / (1 + Math.abs(o) / rubberBand.reach));
  };
  /** The position the pointer would give for a position shown. The inverse of `shown`. */
  const unshown = (a: Axis, p: number) => {
    const o = over(a, p);
    const d = Math.min(Math.abs(o), rubberBand.reach * 0.99);
    return o === 0 ? p : p - o + Math.sign(o) * (d / (1 - d / rubberBand.reach));
  };

  const velocity = createPointerVelocity();
  const listeners = new Set<(direction: SwipeDirection) => void>();
  let active: number | null = null;
  let destroyed = false;
  let scheduled = false;
  let frameId = 0;
  let last = 0;
  let carry = 0;
  let written = "";
  let warned = false;
  let off: () => void = () => undefined;

  const translate = () => `${text(axes[0].p)}px ${text(axes[1].p)}px`;
  const stopFrame = () => {
    if (scheduled) {
      scheduled = false;
      env.cancelFrame(frameId);
    }
  };
  const shutdown = () => {
    destroyed = true;
    active = null;
    stopFrame();
    off();
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
      shutdown();
      return false;
    }
    written = next;
    return true;
  };

  /** Starts a spring from where the axis is, with the velocity it has. */
  const launch = (a: Axis, target: number, config: SpringConfig, band: boolean) => {
    a.spring = { ...retarget(createSpring(config, a.p), target), velocity: a.v, settledVelocity: a.v };
    [a.band, a.mode] = [band, "spring"];
    if (isAtRest(a.spring)) [a.p, a.v, a.mode] = [target, 0, "rest"];
  };
  const advance = (a: Axis, dt: number) => {
    let spring = a.spring!;
    if (a.band) spring = reconfigure(spring, bandSpring(Math.abs(spring.value - spring.target)));
    spring = stepSpring(spring, spring.target, dt);
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
        if (a.mode === "spring") advance(a, (steps - i - 1) * FIXED_STEP + carry);
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
      else if (a.mode === "spring") advance(a, dt);
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
      if (a.on && finite(coord(s, i))) a.p = shown(a, a.raw0 + coord(s, i) - a.p0);
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
      if (o !== 0) a.v /= (1 + Math.abs(over(a, unshown(a, a.p))) / rubberBand.reach) ** 2;
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
          if (!warned) console.error(`${logTag(flavor)} A swipe listener threw.`, error);
          warned = true;
        }
      }
    }
  };

  env.setStyle(element, "touch-action", axis === "x" ? "pan-y" : axis === "y" ? "pan-x" : "none");
  off = env.onPointer(element, {
    down(s) {
      if (destroyed || active !== null) return;
      stopFrame();
      active = s.id;
      velocity.reset();
      axes.forEach((a, i) => {
        [a.mode, a.v, a.raw0, a.p0] = ["rest", 0, unshown(a, a.p), coord(s, i)];
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
  });

  return {
    onSwipe(listener) {
      if (typeof listener !== "function") throw new TypeError("onSwipe needs a function.");
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getState: () => ({
      x: axes[0].p, y: axes[1].p, vx: axes[0].v, vy: axes[1].v,
      dragging: active !== null, moving: moving(), destroyed,
    }),
    destroy() {
      if (destroyed) return;
      shutdown();
      for (const a of axes) if (over(a, a.p) !== 0) a.p = edge(a, a.p);
      try {
        const next = translate();
        if (next !== written) env.setStyle(element, "translate", next);
        env.setStyle(element, "touch-action", null);
      } catch {
        // A destroy logs nothing.
      }
    },
  };
}
