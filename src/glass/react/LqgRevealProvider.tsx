"use client";

import type { ReactNode } from "react";
import { ArmatureRevealProvider } from "../../react/ArmatureRevealProvider";
import { glassFlavor } from "../flavor";
import type { UseLqgRevealOptions } from "./useLqgReveal";

export interface LqgRevealProviderProps extends UseLqgRevealOptions {
  className?: string;
  children?: ReactNode;
}

/**
 * `ArmatureRevealProvider` bound to the glass flavor. Wraps content in one div and runs the spring scroll reveal over it. It renders
 * that div on the server with every element visible. After hydration it arms. Put `data-lqg-reveal="drop|mask|slide|fade"` on what
 * should reveal, `data-lqg-reveal-group` on a parent whose children should stagger, and `data-lqg-drag` with `data-lqg-depth` on what
 * should trail the scroll.
 */
export function LqgRevealProvider({ flavor, ...props }: LqgRevealProviderProps) {
  return <ArmatureRevealProvider {...props} flavor={flavor ?? glassFlavor} />;
}
