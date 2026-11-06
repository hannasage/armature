"use client";

import { useEffect, useRef, type RefObject } from "react";
import { mountScrollReveal, type MountScrollRevealOptions } from "../dom/reveal-mount";

export type UseArmatureRevealOptions = MountScrollRevealOptions;

/**
 * Gives one element the spring scroll reveal and drag from `createScrollReveal`, and removes it on unmount. It watches every
 * reveal and drag element of the flavor under the host, and picks up ones added later (a streamed section). Options are read
 * once, when the host mounts. Nothing is hidden before this effect runs, so the server markup and a page with no script show everything.
 * If arming fails, every element is shown and the error is logged. The options must name a flavor.
 */
export function useArmatureReveal(ref: RefObject<HTMLElement | null>, options: UseArmatureRevealOptions): void {
  // A call with no options object is treated as a call with no flavor: the guard logs it and skips the start.
  const initial = useRef(options ?? ({} as UseArmatureRevealOptions));

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    return mountScrollReveal(host, initial.current);
  }, [ref]);
}
