"use client";

import { useEffect, useRef, type RefObject } from "react";
import { guardedSetup } from "../engine/guard";
import type { Flavor } from "../engine/flavor";
import { glassFlavor } from "../glass/flavor";
import { attachSurface, type Surface, type SurfaceOptions } from "../dom/surface";

/**
 * Gives one element the surface behaviour from `attachSurface`, and removes it on unmount. Returns a ref to the
 * live surface, for `addNeighbor`. Options are read once, when the element mounts. Pass `flavor` in the options to use another flavor.
 *
 * Use this or `LqgProvider` with `data-lqg` for an element, not both.
 */
export type UseLqgSurfaceOptions = Omit<SurfaceOptions, "flavor"> & { flavor?: Flavor };

export function useLqgSurface(ref: RefObject<HTMLElement | null>, options: UseLqgSurfaceOptions = {}): RefObject<Surface | null> {
  const surface = useRef<Surface | null>(null);
  const initial = useRef(options);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // A failed start (for example a flavor with no surface part) is logged and skipped, so it cannot reach React's error boundary.
    const flavor = initial.current.flavor ?? glassFlavor;
    return guardedSetup("glass surface", () => {
      const attached = attachSurface(element, { ...initial.current, flavor });
      surface.current = attached;
      return () => {
        attached.destroy();
        surface.current = null;
      };
    }, undefined, flavor);
  }, [ref]);

  return surface;
}
