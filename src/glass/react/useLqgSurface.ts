"use client";

import type { RefObject } from "react";
import type { Flavor } from "../../engine/flavor";
import type { Surface, SurfaceOptions } from "../../dom/surface";
import { useArmatureSurface } from "../../react/useArmatureSurface";
import { glassFlavor } from "../flavor";

export type UseLqgSurfaceOptions = Omit<SurfaceOptions, "flavor"> & { flavor?: Flavor };

/**
 * `useArmatureSurface` bound to the glass flavor. Gives one element the surface behaviour, and removes it on unmount. Returns a ref to
 * the live surface, for `addNeighbor`. Options are read once, when the element mounts. Pass `flavor` in the options to use another flavor.
 *
 * Use this or `LqgProvider` with `data-lqg` for an element, not both.
 */
export function useLqgSurface(ref: RefObject<HTMLElement | null>, options: UseLqgSurfaceOptions = {}): RefObject<Surface | null> {
  return useArmatureSurface(ref, { ...options, flavor: options.flavor ?? glassFlavor });
}
