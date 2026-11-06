import { cssVar, requireFollower, springOf, type Flavor } from "../engine/flavor";
import { createBrowserEnvironment, prefersReducedMotion, type ArmatureEnvironment, type ArmatureTarget } from "../engine/env";
import { createSpring, isAtRest, MAX_FRAME, retarget, stepSpring, type SpringConfig, type SpringState } from "../engine/spring";

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

export interface Follower {
  /**
   * Springs toward a new target. Position and velocity stay, so a turn in flight keeps its momentum.
   * A target that is not finite is ignored. Under reduced motion the follower snaps to the target at once.
   */
  setTarget(target: number): void;
  /** Jumps to a value (default: the current target) with no travel and no velocity, and stops the frame loop. A value that is not finite is ignored. */
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
  // A key set to undefined does not erase the flavor's rest limits.
  const given = Object.fromEntries(Object.entries(options.spring ?? springOf(flavor, spec.springKey)).filter(([, value]) => value !== undefined));
  const config = { restDelta: spec.rest.restDelta, restSpeed: spec.rest.restSpeed, ...given } as SpringConfig;

  let spring: SpringState = createSpring(config, options.initial);
  let frame = 0;
  let last = 0;
  let destroyed = false;
  let written = "";

  const write = () => {
    const next = text(spring.value);
    if (next === written) return;
    written = next;
    env.setCSSVariable(target, name, next);
  };

  const stopFrame = () => {
    if (frame) {
      env.cancelFrame(frame);
      frame = 0;
    }
  };

  const tick = (time: number) => {
    frame = 0;
    if (destroyed) return;
    // The reader may have asked for less motion while the spring was moving.
    if (prefersReducedMotion(env)) {
      jumpTo(spring.target);
      return;
    }
    const dt = Math.min(MAX_FRAME, Math.max(0, (time - last) / 1000));
    last = time;
    spring = stepSpring(spring, spring.target, dt);
    write();
    if (!isAtRest(spring)) continueChain();
  };

  /** Start a chain from idle. The first step is measured from now. */
  function schedule() {
    if (frame || destroyed) return;
    last = env.now();
    frame = env.requestFrame(tick);
  }
  /** Ask for the next frame from inside a frame. `last` stays at the frame time `tick` took, so no time is lost between frames. */
  function continueChain() {
    if (frame || destroyed) return;
    frame = env.requestFrame(tick);
  }

  const jumpTo = (value: number) => {
    stopFrame();
    spring = createSpring(config, value);
    write();
  };

  write();

  return {
    setTarget(next) {
      if (destroyed || !Number.isFinite(next)) return;
      if (prefersReducedMotion(env)) {
        jumpTo(next);
        return;
      }
      spring = retarget(spring, next);
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
      if (!Number.isFinite(next)) return;
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
