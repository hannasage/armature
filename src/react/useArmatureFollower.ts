"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { guardedSetup } from "../engine/guard";
import { createFollower, type Follower, type FollowerMove, type FollowerOptions, type FollowerState } from "../dom/follower";
import { contextOf } from "./label";

/** The handle of a follower hook. It has no `destroy`, because the hook owns the lifetime of the follower. */
export interface FollowerHandle {
  /** Springs toward a new target. A move can name its own spring with `springKey`. Does nothing until the element mounts. */
  setTarget(target: number, move?: FollowerMove): void;
  /** Jumps to a value (default: the current target). Does nothing until the element mounts. */
  snap(value?: number): void;
  /** The state of the follower. Before the element mounts, and on the server, it is the initial state: at rest on `initial` (default 0). */
  getState(): FollowerState;
}

const idle = (options: Partial<FollowerOptions>): FollowerState => {
  const value = Number.isFinite(options.initial) ? (options.initial as number) : 0;
  return { destroyed: false, value, velocity: 0, target: value, moving: false };
};

/**
 * A follower for the element `ref` points at: one number that springs toward a target and is written as a CSS variable.
 * It makes the follower when the element mounts and destroys it on unmount. The handle is stable and does nothing until the element mounts.
 * The options are read once, when the element mounts, so a render does not make a second follower. To change the flavor or the name,
 * remount the component with a new `key`. The options must name a flavor with a `followers` part.
 * After unmount the handle does nothing, and `getState` gives the idle state: at rest on `initial` (default 0).
 */
export function useArmatureFollower(ref: RefObject<HTMLElement | null>, options: FollowerOptions): FollowerHandle {
  const follower = useRef<Follower | null>(null);
  // A call with no options object is treated as a call with no flavor: the guard logs it and skips the start.
  const given = options ?? ({} as FollowerOptions);
  const latest = useRef(given);

  useEffect(() => {
    latest.current = given;
  });

  const handle = useMemo<FollowerHandle>(
    () => ({
      setTarget: (target, move) => follower.current?.setTarget(target, move),
      snap: (value) => follower.current?.snap(value),
      getState: () => follower.current?.getState() ?? idle(latest.current),
    }),
    [],
  );

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // A failed start (for example a flavor with no followers part) is logged and skipped, so it cannot reach React's error boundary.
    return guardedSetup(contextOf(latest.current.flavor, "follower"), () => {
      const created = createFollower(element, latest.current);
      follower.current = created;
      return () => {
        created.destroy();
        follower.current = null;
      };
    }, undefined, latest.current.flavor);
  }, [ref]);

  return handle;
}
