import { cssVar, logTag, requireFollower, springOf, type Flavor } from "../engine/flavor";
import { createBrowserEnvironment, prefersReducedMotion, type ArmatureEnvironment, type ArmatureTarget } from "../engine/env";
import { createSpring, isAtRest, MAX_FRAME, reconfigure, retarget, stepSpring, type SpringConfig, type SpringState } from "../engine/spring";

export interface FollowerOptions {
  /** The names, springs, and rest limits to use. Required. It needs a follower part with the named follower. */
  flavor: Flavor;
  /** The name of the follower in the flavor's follower part. */
  name: string;
  /** The value to start on, written once when the follower is made. Default 0. A value that is not finite throws a TypeError. */
  initial?: number;
  /** Replaces the flavor's spring for this follower. The rest limits of the flavor still apply under it. */
  spring?: SpringConfig;
  /** Defaults to the real browser. A test passes a fake. */
  env?: ArmatureEnvironment;
}

export interface FollowerState {
  destroyed: boolean;
  /** The value to draw. */
  value: number;
  /** The velocity, in units per second. */
  velocity: number;
  target: number;
  /** True while the spring is still travelling. */
  moving: boolean;
}

/** What one move of a follower can set. */
export interface FollowerMove {
  /**
   * A key into `Flavor.springs`. The follower switches to that spring for this move and for the moves after it that name none.
   * Position, velocity, and target stay. A key that does not exist throws the `TypeError` of `springOf`, and the follower changes nothing.
   * The rest limits of the follower still apply under the spring.
   */
  springKey?: string;
}

export interface Follower {
  /**
   * Springs toward a new target. Position and velocity stay, so a turn in flight keeps its momentum.
   * A target that is not finite is ignored. The first one of each follower is logged. Under reduced motion the follower snaps to the target at once.
   * A move can name its own spring with `springKey`, so one follower can enter on one spring and leave on another.
   */
  setTarget(target: number, move?: FollowerMove): void;
  /** Jumps to a value (default: the current target) with no travel and no velocity, and stops the frame loop. A value that is not finite is ignored and logged like a bad target. */
  snap(value?: number): void;
  getState(): FollowerState;
  /** Cancels the frame and ignores every later call. The last value stays written. Safe to call twice. */
  destroy(): void;
}

const text = (value: number) => String(Number(value.toFixed(4)));

/**
 * Springs one number toward a target and writes it as a CSS variable, named by the flavor, for a stylesheet to use.
 * The value is a bare number. The stylesheet decides the unit and what the number moves.
 *
 * It runs one frame loop, and only while the spring moves. It steps in the engine's fixed slices, so a 30, 60, or
 * 144 Hz screen lands in the same place. It writes the start value once when it is made.
 */
export function createFollower(target: ArmatureTarget, options: FollowerOptions): Follower {
  const env = options.env ?? createBrowserEnvironment();
  const flavor = options.flavor;
  const spec = requireFollower(flavor, options.name);
  const who = `The follower ${JSON.stringify(options.name)} of the flavor "${flavor.name}"`;
  if ((typeof target !== "object" && typeof target !== "function") || target === null) throw new TypeError(`${who} needs an element to write to.`);
  if (options.initial !== undefined && !Number.isFinite(options.initial)) throw new TypeError(`${who} got an initial value that is not a finite number.`);
  const name = cssVar(flavor, spec.var);
  // The rest limits of the flavor sit under the spring. A key set to undefined does not erase them.
  const withRest = (spring: SpringConfig): SpringConfig =>
    ({ restDelta: spec.rest.restDelta, restSpeed: spec.rest.restSpeed, ...Object.fromEntries(Object.entries(spring).filter(([, value]) => value !== undefined)) }) as SpringConfig;
  let config = withRest(options.spring ?? springOf(flavor, spec.springKey));

  let spring: SpringState = createSpring(config, options.initial);
  // A boolean says whether a frame is waiting. An id can be 0, and an environment can run the callback before it returns the id.
  let scheduled = false;
  let frameId = 0;
  let last = 0;
  let destroyed = false;
  let written = "";
  let logged = false;
  let warned = false;

  /** A value that is not a finite number is ignored. The first one is logged, and the rest are silent. */
  const ignore = (): void => {
    if (warned) return;
    warned = true;
    console.error(`${logTag(flavor)} The follower ${JSON.stringify(options.name)} ignored a value that is not a finite number.`);
  };

  /**
   * Writes the value. When the write throws, it logs once and returns false. The text counts as written only after the write works,
   * so a later write of the same text still goes through.
   */
  const write = (): boolean => {
    const next = text(spring.value);
    if (next === written) return true;
    try {
      env.setCSSVariable(target, name, next);
    } catch (error) {
      if (!logged) {
        logged = true;
        console.error(`${logTag(flavor)} The follower ${JSON.stringify(options.name)} could not write ${name} and stopped.`, error);
      }
      return false;
    }
    written = next;
    return true;
  };

  /** After a failed write: stop the frame loop and rest on the target, so the follower is not moving. */
  const giveUp = () => {
    stopFrame();
    spring = createSpring(config, spring.target);
  };

  const stopFrame = () => {
    if (scheduled) {
      scheduled = false;
      env.cancelFrame(frameId);
    }
  };

  const requestNext = () => {
    scheduled = true;
    const id = env.requestFrame(tick);
    // A callback that ran inside requestFrame has already cleared the flag, and its id is stale.
    if (scheduled) frameId = id;
  };

  const tick = (time: number) => {
    scheduled = false;
    if (destroyed) return;
    // The reader may have asked for less motion while the spring was moving.
    if (prefersReducedMotion(env)) {
      jumpTo(spring.target);
      return;
    }
    const dt = Math.min(MAX_FRAME, Math.max(0, (time - last) / 1000));
    last = time;
    spring = stepSpring(spring, spring.target, dt);
    if (!write()) {
      giveUp();
      return;
    }
    if (!isAtRest(spring)) continueChain();
  };

  /** Start a chain from idle. The first step is measured from now. */
  function schedule() {
    if (scheduled || destroyed) return;
    last = env.now();
    requestNext();
  }
  /** Ask for the next frame from inside a frame. `last` stays at the frame time `tick` took, so no time is lost between frames. */
  function continueChain() {
    if (scheduled || destroyed) return;
    requestNext();
  }

  const jumpTo = (value: number) => {
    stopFrame();
    spring = createSpring(config, value);
    if (!write()) giveUp();
  };

  if (!write()) giveUp();

  return {
    setTarget(next, move) {
      if (destroyed) return;
      // Look the key up first, so a bad key throws before anything changes.
      const chosen = move?.springKey === undefined ? undefined : withRest(springOf(flavor, move.springKey));
      if (!Number.isFinite(next)) {
        ignore();
        return;
      }
      if (chosen) config = chosen;
      if (prefersReducedMotion(env)) {
        jumpTo(next);
        return;
      }
      spring = retarget(chosen ? reconfigure(spring, config) : spring, next);
      if (isAtRest(spring)) {
        // Already there, or so close that it looks still: finish without a frame.
        if (spring.value !== next || spring.velocity !== 0) jumpTo(next);
        return;
      }
      schedule();
    },
    snap(value) {
      if (destroyed) return;
      const next = value ?? spring.target;
      if (!Number.isFinite(next)) {
        ignore();
        return;
      }
      jumpTo(next);
    },
    getState() {
      return {
        destroyed,
        value: spring.value,
        velocity: spring.velocity,
        target: spring.target,
        moving: !isAtRest(spring),
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopFrame();
    },
  };
}
