import { useEffect, useRef, type RefObject } from "react";
import { guardedSetup } from "../engine/guard";
import { attachSurface, type Surface, type SurfaceOptions } from "../dom/surface";
import { contextOf } from "./label";

/**
 * Gives one element the surface behaviour from `attachSurface`, and removes it on unmount. Returns a ref to the
 * live surface, for `addNeighbor`. Options are read once, when the element mounts. The options must name a flavor.
 *
 * Use this or `ArmatureProvider` with the surface attribute for an element, not both.
 */
export function useArmatureSurface(ref: RefObject<HTMLElement | null>, options: SurfaceOptions): RefObject<Surface | null> {
  const surface = useRef<Surface | null>(null);
  const initial = useRef(options);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // A failed start (for example a flavor with no surface part) is logged and skipped, so it cannot reach React's error boundary.
    return guardedSetup(contextOf(initial.current.flavor, "surface"), () => {
      const attached = attachSurface(element, initial.current);
      surface.current = attached;
      return () => {
        attached.destroy();
        surface.current = null;
      };
    }, undefined, initial.current.flavor);
  }, [ref]);

  return surface;
}
