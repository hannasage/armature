// The generic React layer. Every hook and provider takes a flavor and names no flavor itself.
// The glass-bound wrappers are in `@hannasage/armature/glass/react`. They carry the "use client" lines.
export { ArmatureProvider, type ArmatureProviderProps } from "./ArmatureProvider";
export { useArmatureSurface } from "./useArmatureSurface";
export { useArmatureLens, type LensHandle } from "./useArmatureLens";
export { useArmatureReveal, type UseArmatureRevealOptions } from "./useArmatureReveal";
export { ArmatureRevealProvider, type ArmatureRevealProviderProps } from "./ArmatureRevealProvider";
