"use client";

import type { RefObject } from "react";
import type { Flavor } from "../../engine/flavor";
import type { LensOptions } from "../../dom/lens";
import { useArmatureLens, type LensHandle } from "../../react/useArmatureLens";
import { glassFlavor } from "../flavor";

export type { LensHandle } from "../../react/useArmatureLens";

export type UseLqgLensOptions = Omit<LensOptions, "container" | "flavor"> & { flavor?: Flavor };

/**
 * `useArmatureLens` bound to the glass flavor. A travelling lens inside the element `ref` points at. The handle is stable and does
 * nothing until the element mounts. `measure` is read fresh on every call, so it can close over current props. Pass `flavor` in the
 * options to use another flavor.
 */
export function useLqgLens(ref: RefObject<HTMLElement | null>, options: UseLqgLensOptions): LensHandle {
  return useArmatureLens(ref, { ...options, flavor: options.flavor ?? glassFlavor });
}
