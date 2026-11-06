"use client";

import { useEffect, useRef } from "react";
import { createBrowserEnvironment } from "../../engine/env";
import type { Flavor } from "../../engine/flavor";
import { guardedSetup } from "../../engine/guard";
import { useArmatureDelegation, type ArmatureProviderProps } from "../../react/ArmatureProvider";
import { browserDetectionEnvironment, detectRefraction, type DetectionEnvironment, type RefractionSetting } from "../detect";
import { glassFlavor } from "../flavor";

/** Set on the root element: `refract` when this browser draws SVG backdrop refraction, `blur` when it does not. */
export const MODE_ATTRIBUTE = "data-lqg-mode";

export interface LqgProviderProps extends Omit<ArmatureProviderProps, "flavor"> {
  /** Force refraction `"on"` or `"off"`, or `"auto"` (default) to detect. Beats the `data-lqg-refraction` attribute. */
  refraction?: RefractionSetting;
  /** The attribute names and feels for delegation. Defaults to the glass flavor. The mode attribute below stays glass. */
  flavor?: Flavor;
  /** The element that gets `data-lqg-mode`. Defaults to `document.documentElement`. */
  rootElement?: object;
  /** What detection reads. Defaults to the real browser. */
  detection?: DetectionEnvironment;
}

/**
 * `ArmatureProvider` bound to the glass flavor, plus the glass mode. Install once, near the top of the app. It listens once on the
 * document for every element that carries `data-lqg`, so a server component can render `<button data-lqg>` with no client wrapper.
 * Without script the markup simply stays still. It also sets `data-lqg-mode="refract|blur"` on the root, so a stylesheet can
 * pick the SVG filter or plain blur.
 *
 * Delegation is the same code as `ArmatureProvider` (the shared hook `useArmatureDelegation`). It is called here, not rendered as a
 * child, so a test can call this function and run its effects.
 */
export function LqgProvider(props: LqgProviderProps) {
  const initial = useRef(props);
  useArmatureDelegation({ env: props.env, root: props.root, surface: props.surface, flavor: props.flavor ?? glassFlavor });

  const { refraction } = props;
  useEffect(() => guardedSetup("glass mode", () => {
    const { env: given, rootElement, detection } = initial.current;
    const element = rootElement ?? (typeof document === "undefined" ? undefined : document.documentElement);
    if (!element) return;
    const env = given ?? createBrowserEnvironment();
    const refracts = detectRefraction(detection ?? browserDetectionEnvironment(), { refraction });
    env.setAttribute(element, MODE_ATTRIBUTE, refracts ? "refract" : "blur");
    return () => env.setAttribute(element, MODE_ATTRIBUTE, null);
  }, undefined, glassFlavor), [refraction]);

  return <>{props.children}</>;
}
