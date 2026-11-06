"use client";

import { useEffect, useRef, type RefObject } from "react";
import { mountScrollReveal, type MountScrollRevealOptions } from "../dom/reveal-mount";

export type UseLqgRevealOptions = MountScrollRevealOptions;

/**
 * Gives one element the spring scroll reveal and drag from `createScrollReveal`, and removes it on unmount. It watches every
 * `data-lqg-reveal` and `data-lqg-drag` element under the host, and picks up ones added later (a streamed section). Options are read
 * once, when the host mounts. Nothing is hidden before this effect runs, so the server markup and a page with no script show everything.
 * If arming fails, every element is shown and the error is logged. Pass `flavor` in the options to use another flavor.
 */
export function useLqgReveal(ref: RefObject<HTMLElement | null>, options: UseLqgRevealOptions = {}): void {
  const initial = useRef(options);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    return mountScrollReveal(host, initial.current);
  }, [ref]);
}
