"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { guardedSetup } from "../engine/guard";
import { createLens, type Lens, type LensOptions } from "../dom/lens";
import { contextOf } from "./label";

export interface LensHandle {
  /** The current item may have changed. Call it from an effect that depends on the active item. */
  update(change?: { keyboard?: boolean }): void;
  jump(): void;
  refit(): void;
}

/**
 * A travelling lens inside the element `ref` points at. The handle is stable and does nothing until the
 * element mounts. `measure` is read fresh on every call, so it can close over current props. The options must name a flavor.
 */
export function useArmatureLens(ref: RefObject<HTMLElement | null>, options: Omit<LensOptions, "container">): LensHandle {
  const lens = useRef<Lens | null>(null);
  const latest = useRef(options);

  useEffect(() => {
    latest.current = options;
  });

  const handle = useMemo<LensHandle>(
    () => ({
      update: (change) => lens.current?.update(change),
      jump: () => lens.current?.jump(),
      refit: () => lens.current?.refit(),
    }),
    [],
  );

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    // A failed start (for example a flavor with no lens part) is logged and skipped, so it cannot reach React's error boundary.
    return guardedSetup(contextOf(latest.current.flavor, "lens"), () => {
      const created = createLens({ ...latest.current, container, measure: () => latest.current.measure() });
      lens.current = created;
      return () => {
        created.destroy();
        lens.current = null;
      };
    }, undefined, latest.current.flavor);
  }, [ref]);

  return handle;
}
