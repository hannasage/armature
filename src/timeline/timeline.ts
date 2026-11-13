/**
 * A timeline: tracks that animate one value each along keyframes. It is time-driven, so the value of a track at any time is a pure function of
 * that time. A spring or a decay step is run through at build, slice by slice, on the fixed step of the engine, and the timeline reads the
 * samples. So a seek gives the value that playing would give, and a reverse retraces.
 *
 * A key is `[time, value, step?]`, in milliseconds. A segment runs from the previous key to this key, and the step is how it gets there:
 * - a curve, or no step, makes a tween that ends on this key at this time;
 * - a spring starts at the time of the previous key, from where the track is and with the speed it has, and aims at the value. A key after it
 *   cuts it at its time, and the next step takes over with the position and the speed of the spring. As the last key it runs until it rests;
 * - a decay starts the same way, keeps its speed, and slows by friction until the speed is under the rest speed. Its value is null.
 *
 * The timeline runs on the shared frame scheduler, in whole slices of `FIXED_STEP`. It writes individual CSS properties through the injected
 * environment, and never `transform`. It reads no `window`. The frame hook writes each frame, and a write that fails stops the timeline.
 */
import { bezier, type Curve } from "../curves/bezier";
import { prefersReducedMotion, type ArmatureTarget } from "../engine/env";
import type { Flavor, RestLimits } from "../engine/flavor";
import { createSpring, FIXED_STEP, isAtRest, retarget, stepSpring, type SpringConfig } from "../engine/spring";
import { createScheduler, type FrameEnvironment, type FrameTask, type Scheduler } from "../frame/scheduler";
import { checkTimelineFlavor } from "./flavor";
import { finite, has, mapKeys } from "./util";

/** What a timeline takes from the browser: the frame loop of the scheduler, the reduced-motion query, and one style write. */
export interface TimelineEnvironment extends FrameEnvironment {
  matchMedia?(query: string): { matches: boolean };
  /** Writes one inline style property, or removes it when `value` is null. */
  setStyle(target: ArmatureTarget, property: string, value: string | null): void;
}

/** A decay step: the speed in units per second (the speed the step before it ends with, when left out), the friction c of v' = -c v, and the rest speed. */
export interface DecayStep {
  readonly decay: { readonly velocity?: number; readonly friction: number; readonly rest: Pick<RestLimits, "restSpeed"> };
}

/** A curve from `/curves`, a spring, a decay, or the name of a curve or a spring in the flavor. */
export type TimelineStep = Curve | SpringConfig | DecayStep | string;

/** `[time in ms, value, step?]`. A decay key holds null in place of the value. */
export type Keyframe = readonly [time: number, value: number | null, step?: TimelineStep];

export interface TrackSpec {
  /** What the environment writes to. An `HTMLElement` for the browser environment. */
  target: ArmatureTarget;
  /** The individual CSS property to write, such as `opacity`, `translate`, `scale`, `rotate`, or a custom property. Never `transform`. */
  value: string;
  keys?: readonly Keyframe[];
  /** The name of a sequence in the flavor, in place of `keys`. */
  sequence?: string;
  /** Milliseconds added to every key time of this track. Default 0. */
  offset?: number;
  /** Written after the number. Default none. */
  unit?: string;
  /** Replaces the number and the unit. It gets the value, cut to 1,000,000,000 at most, and returns the text to write. */
  format?(value: number): string;
}

export interface TimelineOptions {
  tracks: readonly TrackSpec[];
  /** `"together"` (default): every track starts at 0 plus its place in the stagger. `"sequence"`: each track starts when the one before ends. */
  place?: "together" | "sequence";
  /** Milliseconds from the start of one track to the start of the next, or the gap after the end of one in a sequence. Default 0. */
  stagger?: number;
  /** For named sequences, named curves and springs, the default curve, and the label of a logged error. */
  flavor?: Flavor;
  /** Shared by several timelines. Default: one of its own, which `destroy` also destroys. */
  scheduler?: Pick<Scheduler, "add">;
}

export interface TimelineState {
  /** Milliseconds, from 0 to `duration`. */
  time: number;
  duration: number;
  playing: boolean;
  /** True when the direction is backward. */
  reversed: boolean;
  destroyed: boolean;
  /** The value of each track at `time`, in the order of the tracks. A copy. */
  values: number[];
  /** True when a spring or a decay was cut at 10 seconds without resting: a spring snapped to its target, and a decay stopped where it was. */
  capped: boolean;
  /** How many times a listener threw. Each listener is logged once. */
  listenerErrors: number;
  /** Set when the timeline stopped because a write failed, and not because of `destroy`. It holds the error. */
  failed?: Error;
}

export interface Timeline {
  /** Plays in the current direction. At the end of its travel it starts again from the other end. Writes the pose first. */
  play(): void;
  pause(): void;
  /** Turns the direction round and plays. At the end of the new direction it only completes. */
  reverse(): void;
  /** Moves to a time in milliseconds, cut to the length of the timeline, and writes the pose. It keeps playing when it was playing. A time of Infinity or -Infinity goes to the end or the start. NaN, and a value that is not a number, throw a TypeError. */
  seek(ms: number): void;
  /** Pauses, and moves to a share of the length from 0 to 1. For a slider or a scroll. A share outside 0 to 1 is cut, and NaN throws a TypeError. */
  scrub(progress: number): void;
  /** `update` gets the time after each write. `complete` fires when a play reaches the end of its travel. Returns the unsubscribe. */
  on(event: "update" | "complete", listener: (time: number) => void): () => void;
  getState(): TimelineState;
  /** Stops every motion and ignores every later call. The values stay where they are. It logs nothing. Safe to call twice. */
  destroy(): void;
}

const STEP_MS = FIXED_STEP * 1000;
/** Milliseconds of slack when a float time is compared with a key time. */
const EPS = 1e-6;
/** The longest a spring or a decay is run through, in slices (10 s). One that has not rested by then stops there. */
const LIMIT = 1200;
/** The largest number written. A larger one is cut to it, so no number is ever written as exponent text. */
const MAX = 1e9;
const PROPERTY = /^(--[\w-]+|-?[a-zA-Z][\w-]*)$/;

const bad = (message: string): never => {
  throw new TypeError(message);
};
const asTime = (value: unknown): number => (typeof value === "number" && !Number.isNaN(value) ? value : bad("A time is a number, and not NaN."));

/** A step with its kind settled: 0 a tween, 1 a spring, 2 a decay. */
interface Step {
  kind: 0 | 1 | 2;
  curve?: Curve;
  spring?: SpringConfig;
  decay?: DecayStep["decay"];
}
interface Key { t: number; v: number | null; step: Step }
/** A piece of a track from `s` to `e`: a tween from `a` to `b`, or the samples `p` and `w` (position and speed) of a spring or a decay, one per slice from `s`. */
interface Seg { s: number; e: number; a: number; b: number; c?: Curve; p?: number[]; w?: number[]; capped?: boolean }
interface Track { segs: Seg[]; first: number; end: number; capped: boolean }

const slice = (seg: Seg, t: number) => Math.min(seg.p!.length - 1, Math.max(0, Math.floor((t - seg.s) / STEP_MS + EPS)));

/** The last piece that has started at `t`. A later piece wins over an earlier one that starts at the same time. */
function pick(track: Track, t: number): Seg | undefined {
  for (let i = track.segs.length; i--; ) if (track.segs[i].s <= t + EPS) return track.segs[i];
  return undefined;
}

function valueAt(track: Track, t: number): number {
  const seg = pick(track, t);
  if (!seg) return track.first;
  const value = seg.p ? seg.p[slice(seg, t)] : t >= seg.e - EPS ? seg.b : seg.a + (seg.b - seg.a) * seg.c!((t - seg.s) / (seg.e - seg.s));
  if (!Number.isFinite(value)) throw new TypeError("A timeline value is not finite.");
  return value;
}

/** The slope of a curve where it ends, at progress 1. A bezier knows it. Another curve gets a difference with the first error term removed. */
function endSlope(curve: Curve): number {
  const points = (curve as { points?: readonly number[] }).points;
  if (points?.length === 4) {
    // With x2 below 1 the slope has a closed form. With x2 of 1 and y2 not 1 the tangent is vertical, and no speed is handed over.
    if (points[2] < 1) return (1 - points[3]) / (1 - points[2]);
    if (points[3] !== 1) return 0;
  }
  const f = (h: number) => (curve(1) - curve(1 - h)) / h;
  const slope = 2 * f(1e-4) - f(2e-4);
  return Number.isFinite(slope) ? slope : 0;
}

/** The position and the speed (per second) of a track at `t`. With `speed` set, a tween that has ended gives the speed of its curve at the end. A sample holds until the next slice. */
function stateAt(track: Track, t: number, speed = false): { p: number; v: number } {
  const seg = pick(track, t);
  if (seg?.p) return { p: seg.p[slice(seg, t)], v: seg.w![slice(seg, t)] };
  const ended = seg !== undefined && seg.e > seg.s && t >= seg.e - EPS;
  const v = speed && ended ? ((seg.b - seg.a) * endSlope(seg.c!) * 1000) / (seg.e - seg.s) : 0;
  // The speed is cut to the span of the tween in one slice, so a steep curve cannot spike.
  const most = Math.abs(seg ? seg.b - seg.a : 0) / FIXED_STEP;
  return { p: valueAt(track, t), v: Number.isFinite(v) ? Math.max(-most, Math.min(most, v)) : 0 };
}

/** Runs a spring or a decay slice by slice from `s`, to the time `cut` or until it rests. Every step is a whole `FIXED_STEP`. */
function simulate(step: Step, from: { p: number; v: number }, s: number, cut: number, target: number | null): Seg {
  const room = Math.floor((cut - s) / STEP_MS + EPS);
  const p = [from.p];
  const w = [from.v];
  const push = (position: number, speed: number) => {
    if (!Number.isFinite(position) || !Number.isFinite(speed)) throw new TypeError("A spring or decay step ran to a value that is not finite.");
    p.push(position);
    w.push(speed);
  };
  let rested: boolean;
  if (step.kind === 1) {
    const goal = target as number;
    let state = { ...retarget(createSpring(step.spring!, from.p), goal), velocity: from.v, settledVelocity: from.v };
    for (let k = 0; k < Math.min(room, LIMIT) && !isAtRest(state); k++) {
      state = stepSpring(state, goal, FIXED_STEP);
      push(state.value, state.velocity);
    }
    rested = isAtRest(state);
    // A spring that is already close enough lands on its target.
    if (rested && (state.value !== goal || state.velocity !== 0)) [p[p.length - 1], w[w.length - 1]] = [goal, 0];
  } else {
    const { friction, rest } = step.decay!;
    const factor = Math.exp(-friction * FIXED_STEP);
    let position = from.p;
    let speed = step.decay!.velocity ?? from.v;
    rested = Math.abs(speed) < rest.restSpeed;
    w[0] = rested ? 0 : speed;
    for (let k = 0; k < Math.min(room, LIMIT) && !rested; k++) {
      speed *= factor;
      position += speed * FIXED_STEP;
      rested = Math.abs(speed) < rest.restSpeed;
      push(position, rested ? 0 : speed);
    }
  }
  // Not at rest after the limit, with the next key further off: a spring snaps to its target, and a decay stops where it is.
  const capped = !rested && room > LIMIT;
  if (capped) {
    if (step.kind === 1) push(target as number, 0);
    else w[w.length - 1] = 0;
  }
  return { s, e: s + (p.length - 1) * STEP_MS, a: from.p, b: p[p.length - 1], p, w, capped };
}

function compile(keys: Key[], offset: number): Track {
  const track: Track = { segs: [], first: keys[0].v as number, end: keys[0].t + offset, capped: false };
  for (let i = 1; i < keys.length; i++) {
    const s = keys[i - 1].t + offset;
    const e = keys[i].t + offset;
    const { step, v } = keys[i];
    const from = stateAt(track, s, step.kind !== 0);
    const seg: Seg = step.kind === 0 ? { s, e, a: from.p, b: v as number, c: step.curve } : simulate(step, from, s, i === keys.length - 1 ? Infinity : e, v);
    track.segs.push(seg);
    track.capped ||= seg.capped === true;
    track.end = Math.max(track.end, e, seg.p ? seg.e : 0);
  }
  return track;
}

const clamp = (n: number) => Math.max(-MAX, Math.min(MAX, n));
const text = (n: number) => String(Number(clamp(n).toFixed(4)));

export function createTimeline(env: TimelineEnvironment, options: TimelineOptions): Timeline {
  if (typeof options !== "object" || options === null) bad("A timeline needs an options object.");
  if (typeof env !== "object" || env === null || typeof env.setStyle !== "function") bad("A timeline needs an environment that can write a style.");
  const { tracks, place = "together", stagger = 0, flavor } = options;
  if (!Array.isArray(tracks)) bad("The tracks of a timeline are a list.");
  if (place !== "together" && place !== "sequence") bad('The place of the tracks is "together" or "sequence".');
  if (!finite(stagger) || stagger < 0) bad("The stagger of a timeline is a finite number of milliseconds, 0 or more.");
  if (options.scheduler !== undefined && typeof options.scheduler?.add !== "function") bad("The scheduler of a timeline needs an add function.");
  if (options.scheduler === undefined && !(["requestFrame", "cancelFrame", "now"] as const).every((name) => typeof env[name] === "function")) {
    bad("A timeline with no scheduler needs an environment with requestFrame, cancelFrame, and now.");
  }
  const label = `The flavor "${flavor?.name}"`;
  if (flavor !== undefined) {
    if (typeof flavor !== "object" || flavor === null) bad("The flavor of a timeline is an object.");
    checkTimelineFlavor(flavor, label);
  }
  const part = flavor?.timeline;
  const straight: Curve = (progress) => progress;
  const positive = (n: unknown) => finite(n) && n > 0;
  const springStep = (spring: SpringConfig): Step => {
    if (!positive(spring?.stiffness) || !finite(spring.damping) || spring.damping < 0 || [spring.mass, spring.restSpeed, spring.restDelta].some((n) => n !== undefined && !positive(n))) {
      bad("A spring step needs a stiffness above 0 and a damping of 0 or more, finite, and a mass, rest speed, and rest delta above 0 when it has them.");
    }
    return { kind: 1, spring: { ...spring } };
  };
  const named = new Map<string, Step>();
  const lookup = (name: string): Step => {
    let step = named.get(name);
    if (step === undefined) {
      if (!flavor) bad("A step that is a name needs a flavor.");
      if (has(part?.curves, name)) step = { kind: 0, curve: bezier(...part!.curves![name]) };
      else if (has(flavor!.springs, name)) step = springStep(flavor!.springs[name]);
      else bad(`${label} has no curve or spring named ${JSON.stringify(name)}.`);
      named.set(name, step!);
    }
    return step!;
  };
  const fallback: Step = { kind: 0, curve: part?.defaultCurve === undefined ? straight : lookup(part.defaultCurve).curve };

  const stepOf = (step: unknown): Step => {
    if (step === undefined) return fallback;
    if (typeof step === "function") return { kind: 0, curve: step as Curve };
    if (typeof step === "string") return lookup(step);
    if (typeof step !== "object" || step === null) return bad("A step is a curve, a spring, a decay, or the name of a curve or a spring.");
    if (has(step, "decay")) {
      const d = (step as DecayStep).decay;
      if (typeof d !== "object" || d === null || !positive(d.friction) || !positive(d.rest?.restSpeed) || (d.velocity !== undefined && !finite(d.velocity))) {
        bad("A decay step needs a friction and a rest speed that are finite numbers above 0, and a speed that is a finite number when it has one.");
      }
      return { kind: 2, decay: d };
    }
    return springStep(step as SpringConfig);
  };

  const specs = (tracks as unknown[]).map((raw): { spec: TrackSpec; keys: Key[] } => {
    if (typeof raw !== "object" || raw === null) return bad("A track is an object.");
    const spec = raw as TrackSpec;
    if ((typeof spec.target !== "object" && typeof spec.target !== "function") || spec.target === null) bad("A track needs a target to write to.");
    if (typeof spec.value !== "string" || !PROPERTY.test(spec.value)) bad("A track needs the name of a CSS property to write.");
    if (/^(-[a-z]+-)?transform$/i.test(spec.value)) bad("A timeline writes individual properties, such as translate, scale, and rotate, and never transform.");
    if (spec.offset !== undefined && (!finite(spec.offset) || spec.offset < 0)) bad("The offset of a track is a finite number of milliseconds, 0 or more.");
    if (spec.unit !== undefined && typeof spec.unit !== "string") bad("The unit of a track is text.");
    if (spec.format !== undefined && typeof spec.format !== "function") bad("The format of a track is a function.");
    if (spec.keys !== undefined && spec.sequence !== undefined) bad("A track takes keys or a sequence, not both.");
    let source: unknown = spec.keys;
    if (spec.sequence !== undefined) {
      if (typeof spec.sequence !== "string") bad("The sequence of a track is a name.");
      if (!part) bad(flavor ? `${label} has no timeline part.` : "A sequence name needs a flavor with a timeline part.");
      if (!has(part!.sequences, spec.sequence)) bad(`${label} has no sequence named ${JSON.stringify(spec.sequence)}.`);
      source = part!.sequences![spec.sequence].keys;
    }
    const keys = mapKeys(source, (problem) => bad(`A track has ${problem}.`), (v, given, i, t): Key => {
      const step = stepOf(given);
      // The step of the first key has nothing to run from, so its value is a number whatever the step is.
      if (i > 0 && step.kind === 2 ? v !== null : !finite(v)) {
        bad(i > 0 && step.kind === 2 ? "A decay key holds null in place of the value." : "The value of a key is a finite number.");
      }
      return { t, v: v as number | null, step };
    });
    return { spec, keys };
  });

  // Place the tracks. The start of a track is added to every key time of it.
  const compiled: Track[] = [];
  specs.forEach(({ spec, keys }, i) => {
    const start = (i === 0 ? 0 : place === "sequence" ? compiled[i - 1].end + stagger : i * stagger) + (spec.offset ?? 0);
    if (!Number.isFinite(start + keys[keys.length - 1].t)) bad("The start of a track, or the end of its keys, is too large to be a number.");
    compiled.push(compile(keys, start));
    if (!Number.isFinite(compiled[i].end)) bad("The end of a track is too large to be a number.");
  });
  const duration = compiled.reduce((most, track) => Math.max(most, track.end), 0);
  // Read once, so a change of the caller's track objects after this call does nothing.
  const writers = specs.map(({ spec }) => ({ target: spec.target, property: spec.value, unit: spec.unit ?? "", format: spec.format }));
  const capped = compiled.some((track) => track.capped);
  const written: Array<string | undefined> = writers.map(() => undefined);
  const values = compiled.map((track) => track.first);
  const tag = `[${flavor?.logLabel ?? "armature"}]`;

  const own = options.scheduler === undefined;
  const scheduler: Pick<Scheduler, "add"> = options.scheduler ?? createScheduler(env);
  const listeners = { update: new Set<(time: number) => void>(), complete: new Set<(time: number) => void>() };
  const threw = new WeakSet<object>();
  let time = 0;
  let listenerErrors = 0;
  let direction: 1 | -1 = 1;
  let playing = false;
  let destroyed = false;
  let failure: Error | undefined;
  let remove: (() => void) | undefined;
  let dirty = false;
  let ended = false;

  const stop = () => {
    playing = false;
    ended = false;
    remove?.();
    remove = undefined;
  };
  const fail = (error: unknown) => {
    if (failure) return;
    failure = error instanceof Error ? error : new Error(String(error));
    console.error(`${tag} The timeline could not write and stopped.`, error);
    stop();
  };
  const emit = (event: "update" | "complete") => {
    for (const listener of [...listeners[event]]) {
      try {
        listener(time);
      } catch (error) {
        listenerErrors += 1;
        if (!threw.has(listener)) console.error(`${tag} A timeline listener threw.`, error);
        threw.add(listener);
      }
    }
  };
  /** Reads every track at the time, and writes the ones whose text changed. A failure stops the timeline. */
  const flush = (): boolean => {
    dirty = false;
    try {
      compiled.forEach((track, i) => {
        const value = valueAt(track, time);
        values[i] = value;
        const { unit, format, target, property } = writers[i];
        const next = format ? String(format(clamp(value))) : text(value) + unit;
        if (next !== written[i]) {
          env.setStyle(target, property, next);
          written[i] = next;
        }
      });
    } catch (error) {
      fail(error);
      return false;
    }
    return true;
  };
  const apply = () => {
    if (flush()) emit("update");
  };
  const atEnd = () => (direction > 0 ? time >= duration - EPS : time <= EPS);
  const finish = () => {
    stop();
    time = direction > 0 ? duration : 0;
    apply();
    if (!failure) emit("complete");
  };

  const task: FrameTask = {
    step() {
      if (destroyed || !playing) return false;
      const next = time + direction * STEP_MS;
      dirty = true;
      if (direction > 0 ? next >= duration - EPS : next <= EPS) {
        time = direction > 0 ? duration : 0;
        playing = false;
        remove = undefined;
        ended = true;
        return false;
      }
      time = next;
      return true;
    },
    frame() {
      if (destroyed || failure) return;
      if (playing && prefersReducedMotion(env)) {
        stop();
        time = direction > 0 ? duration : 0;
        dirty = ended = true;
      }
      if (!dirty) return;
      const done = ended;
      ended = false;
      if (flush()) {
        emit("update");
        if (done) emit("complete");
      }
    },
  };

  const go = (wrap: boolean) => {
    if (destroyed || failure) return;
    if (wrap && atEnd()) time = direction > 0 ? 0 : duration;
    if (atEnd() || prefersReducedMotion(env)) {
      finish();
      return;
    }
    playing = true;
    ended = false;
    apply();
    // A listener can pause or destroy during the write. Then nothing is added, so no frame loop is left.
    if (destroyed || !playing || failure) return;
    remove = scheduler.add(task);
  };

  return {
    play: () => go(true),
    pause() {
      if (!destroyed) stop();
    },
    reverse() {
      if (destroyed || failure) return;
      direction = direction > 0 ? -1 : 1;
      go(false);
    },
    seek(ms) {
      if (destroyed) return;
      const target = asTime(ms);
      if (failure) return;
      ended = false;
      time = Math.max(0, Math.min(duration, target));
      apply();
    },
    scrub(progress) {
      if (destroyed) return;
      const share = asTime(progress);
      if (failure) return;
      stop();
      time = Math.max(0, Math.min(1, share)) * duration;
      apply();
    },
    on(event, listener) {
      if (event !== "update" && event !== "complete") bad('A timeline event is "update" or "complete".');
      if (typeof listener !== "function") bad("A timeline listener is a function.");
      if (destroyed) return () => undefined;
      listeners[event].add(listener);
      return () => {
        listeners[event].delete(listener);
      };
    },
    getState: () => ({ time, duration, playing, reversed: direction < 0, destroyed, values: [...values], capped, listenerErrors, failed: failure }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      listeners.update.clear();
      listeners.complete.clear();
      if (own) (scheduler as Scheduler).destroy();
    },
  };
}

/**
 * The real browser. Safe to import on the server: nothing runs, and `window` is not read, until a method is called.
 * A style is written with `setProperty`, so a custom property and an individual property such as `translate` both work.
 */
export function createBrowserTimelineEnvironment(win?: Window & typeof globalThis): TimelineEnvironment {
  const w = () => win ?? window;
  return {
    requestFrame: (callback) => w().requestAnimationFrame(callback),
    cancelFrame: (id) => w().cancelAnimationFrame(id),
    now: () => w().performance.now(),
    matchMedia: (query) => w().matchMedia(query),
    setStyle: (target, property, value) => {
      const style = (target as HTMLElement).style;
      if (value === null) style.removeProperty(property);
      else style.setProperty(property, value);
    },
  };
}
