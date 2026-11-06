import { useEffect, useRef, type ReactNode } from "react";
import { installDelegation, type DelegateOptions, type DelegateRoot } from "../dom/delegate";
import { createBrowserEnvironment, type ArmatureEnvironment } from "../engine/env";
import type { Flavor } from "../engine/flavor";
import { guardedSetup } from "../engine/guard";
import { contextOf } from "./label";

export interface ArmatureDelegationOptions {
  /** The attribute names and feels for delegation. Required. It needs a surface part. */
  flavor: Flavor;
  /** Options for every surface the flavor's attribute marks. The flavor is set by the `flavor` option, not here. */
  surface?: DelegateOptions["surface"];
  /** For tests and unusual hosts. Defaults to the real browser. */
  env?: ArmatureEnvironment;
  /** Where the listeners go. Defaults to `document`. */
  root?: DelegateRoot;
}

/**
 * Installs delegation once, on mount: one set of listeners on the document for every element that carries the surface attribute
 * of the flavor. Options are read once, when the component mounts. A failed start is logged and skipped, so it cannot reach React's
 * error boundary.
 */
export function useArmatureDelegation(options: ArmatureDelegationOptions): void {
  const initial = useRef(options);

  useEffect(() => guardedSetup(contextOf(initial.current.flavor, "delegation"), () => {
    const { env: given, root: givenRoot, surface, flavor } = initial.current;
    const root = givenRoot ?? (typeof document === "undefined" ? undefined : (document as unknown as DelegateRoot));
    if (!root) return;
    const delegate = installDelegation(root, { env: given ?? createBrowserEnvironment(), surface, flavor });
    return () => delegate.destroy();
  }, undefined, initial.current.flavor), []);
}

export interface ArmatureProviderProps extends ArmatureDelegationOptions {
  children?: ReactNode;
}

/**
 * Install once, near the top of the app. It listens once on the document for every element that carries the surface attribute of the
 * flavor, so a server component can render the markup with no client wrapper around it. Without script the markup simply stays still.
 */
export function ArmatureProvider(props: ArmatureProviderProps) {
  useArmatureDelegation(props);
  return <>{props.children}</>;
}
