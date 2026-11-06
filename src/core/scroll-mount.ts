/**
 * Mounts a scroll reveal on an element and hands back the function that unmounts it (GI-70). The React hook calls this, and so can
 * any other host. It never throws: a failure to arm shows every element, removes the armed class, and logs with context
 * (`startScrollReveal`).
 */
import { logTag } from "../engine/flavor";
import { glassFlavor } from "../glass/flavor";
import { createScrollReveal, startScrollReveal, type GuardedStartOptions, type ScrollRevealOptions } from "./scroll-reveal";
import type { ScrollRoot } from "../engine/scroll-env";

/** The element the reveal watches. An `HTMLElement` fits. */
export interface RevealHost extends ScrollRoot {
  readonly classList?: { add(...tokens: string[]): void; remove(...tokens: string[]): void };
}

export interface MountScrollRevealOptions extends Omit<ScrollRevealOptions, "root">, GuardedStartOptions {
  /** A class the host element wears while the reveal is armed, and loses when it stops or fails. Lets a stylesheet key on it. */
  armedClass?: string;
}

export function mountScrollReveal(host: RevealHost, options: MountScrollRevealOptions = {}): () => void {
  const { armedClass, context, report, onArm, onDisarm, flavor = glassFlavor, ...rest } = options;
  const complain = report ?? ((error: unknown, where: string) => console.error(`${logTag(flavor)} ${where} failed; every element is shown instead.`, error));
  const controller = startScrollReveal(
    () => createScrollReveal({
      ...rest,
      flavor,
      ...(report ? { report } : {}),
      root: host,
      onArm: () => { if (armedClass) host.classList?.add(armedClass); onArm?.(); },
      onDisarm: () => { if (armedClass) host.classList?.remove(armedClass); onDisarm?.(); },
    }),
    { context, report, flavor },
  );
  return () => {
    try {
      controller?.stop();
    } catch (error) {
      complain(error, `${context ?? "scroll reveal"} (while stopping)`);
    }
  };
}
