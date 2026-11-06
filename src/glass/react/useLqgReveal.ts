"use client";

import type { RefObject } from "react";
import type { Flavor } from "../../engine/flavor";
import type { MountScrollRevealOptions } from "../../dom/reveal-mount";
import { useArmatureReveal } from "../../react/useArmatureReveal";
import { glassFlavor } from "../flavor";

export type UseLqgRevealOptions = Omit<MountScrollRevealOptions, "flavor"> & { flavor?: Flavor };

/**
 * `useArmatureReveal` bound to the glass flavor. Gives one element the spring scroll reveal and drag, and removes it on unmount. It
 * watches every `data-lqg-reveal` and `data-lqg-drag` element under the host, and picks up ones added later (a streamed section).
 * Options are read once, when the host mounts. Nothing is hidden before this effect runs, so the server markup and a page with no
 * script show everything. If arming fails, every element is shown and the error is logged. Pass `flavor` in the options to use another flavor.
 */
export function useLqgReveal(ref: RefObject<HTMLElement | null>, options: UseLqgRevealOptions = {}): void {
  useArmatureReveal(ref, { ...options, flavor: options.flavor ?? glassFlavor });
}
