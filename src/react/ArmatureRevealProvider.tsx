"use client";

import { useRef, type ReactNode } from "react";
import { useArmatureReveal, type UseArmatureRevealOptions } from "./useArmatureReveal";

export interface ArmatureRevealProviderProps extends UseArmatureRevealOptions {
  className?: string;
  children?: ReactNode;
}

/**
 * Wraps content in one div and runs the spring scroll reveal over it. It renders that div on the server with every element
 * visible. After hydration it arms. The flavor says which attributes mark what should reveal, what should stagger, and what should
 * trail the scroll.
 */
export function ArmatureRevealProvider({ className, children, ...options }: ArmatureRevealProviderProps) {
  const host = useRef<HTMLDivElement>(null);
  useArmatureReveal(host, options);
  return <div ref={host} className={className}>{children}</div>;
}
