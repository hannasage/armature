"use client";

import { useRef, type ReactNode } from "react";
import { useLqgReveal, type UseLqgRevealOptions } from "./useLqgReveal";

export interface LqgRevealProviderProps extends UseLqgRevealOptions {
  className?: string;
  children?: ReactNode;
}

/**
 * Wraps content in one div and runs the spring scroll reveal over it. It renders that div on the server with every element
 * visible. After hydration it arms. Put `data-lqg-reveal="drop|mask|slide|fade"` on what should reveal, `data-lqg-reveal-group` on a
 * parent whose children should stagger, and `data-lqg-drag` with `data-lqg-depth` on what should trail the scroll.
 */
export function LqgRevealProvider({ className, children, ...options }: LqgRevealProviderProps) {
  const host = useRef<HTMLDivElement>(null);
  useLqgReveal(host, options);
  return <div ref={host} className={className}>{children}</div>;
}
