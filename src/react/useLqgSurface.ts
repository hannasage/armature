"use client";

import { useEffect, useRef, type RefObject } from "react";
import { attachSurface, type Surface, type SurfaceOptions } from "../core/surface";

/**
 * Gives one element the surface behaviour from `attachSurface`, and removes it on unmount. Returns a ref to the
 * live surface, for `addNeighbor`. Options are read once, when the element mounts. Pass `flavor` in the options to use another flavor.
 *
 * Use this or `LqgProvider` with `data-lqg` for an element, not both.
 */
export function useLqgSurface(ref: RefObject<HTMLElement | null>, options: SurfaceOptions = {}): RefObject<Surface | null> {
  const surface = useRef<Surface | null>(null);
  const initial = useRef(options);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const attached = attachSurface(element, initial.current);
    surface.current = attached;
    return () => {
      attached.destroy();
      surface.current = null;
    };
  }, [ref]);

  return surface;
}
