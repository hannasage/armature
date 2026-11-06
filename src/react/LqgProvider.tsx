"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { installDelegation, type DelegateOptions, type DelegateRoot } from "../core/delegate";
import { browserDetectionEnvironment, detectRefraction, type DetectionEnvironment, type RefractionSetting } from "../core/detect";
import { createBrowserEnvironment, type LqgEnvironment } from "../core/env";
import { guardedSetup } from "../core/guard";

/** Set on the root element: `refract` when this browser draws SVG backdrop refraction, `blur` when it does not. */
export const MODE_ATTRIBUTE = "data-lqg-mode";

export interface LqgProviderProps {
  children?: ReactNode;
  /** Force refraction `"on"` or `"off"`, or `"auto"` (default) to detect. Beats the `data-lqg-refraction` attribute. */
  refraction?: RefractionSetting;
  /** Options for every `data-lqg` surface. */
  surface?: DelegateOptions["surface"];
  /** For tests and unusual hosts. Defaults to the real browser. */
  env?: LqgEnvironment;
  /** Where the listeners go. Defaults to `document`. */
  root?: DelegateRoot;
  /** The element that gets `data-lqg-mode`. Defaults to `document.documentElement`. */
  rootElement?: object;
  /** What detection reads. Defaults to the real browser. */
  detection?: DetectionEnvironment;
}

/**
 * Install once, near the top of the app. It listens once on the document for every element that carries
 * `data-lqg`, so a server component can render `<button data-lqg>` with no client wrapper. Without script
 * the markup simply stays still. It also sets `data-lqg-mode="refract|blur"` on the root, so a stylesheet can
 * pick the SVG filter or plain blur.
 */
export function LqgProvider(props: LqgProviderProps) {
  const initial = useRef(props);

  useEffect(() => guardedSetup("glass delegation", () => {
    const { env: given, root: givenRoot, surface } = initial.current;
    const root = givenRoot ?? (typeof document === "undefined" ? undefined : (document as unknown as DelegateRoot));
    if (!root) return;
    const delegate = installDelegation(root, { env: given ?? createBrowserEnvironment(), surface });
    return () => delegate.destroy();
  }), []);

  const { refraction } = props;
  useEffect(() => guardedSetup("glass mode", () => {
    const { env: given, rootElement, detection } = initial.current;
    const element = rootElement ?? (typeof document === "undefined" ? undefined : document.documentElement);
    if (!element) return;
    const env = given ?? createBrowserEnvironment();
    const refracts = detectRefraction(detection ?? browserDetectionEnvironment(), { refraction });
    env.setAttribute(element, MODE_ATTRIBUTE, refracts ? "refract" : "blur");
    return () => env.setAttribute(element, MODE_ATTRIBUTE, null);
  }), [refraction]);

  return <>{props.children}</>;
}
