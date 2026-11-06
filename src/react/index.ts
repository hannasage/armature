// The generic React layer. Every hook and provider takes a flavor and names no flavor itself.
// Each file that uses a hook carries its own "use client". The glass-bound wrappers are in `@hannasage/armature/glass/react`.
export { ArmatureProvider, type ArmatureProviderProps } from "./ArmatureProvider";
export { useArmatureSurface } from "./useArmatureSurface";
export { useArmatureLens, type LensHandle } from "./useArmatureLens";
export { useArmatureReveal, type UseArmatureRevealOptions } from "./useArmatureReveal";
export { ArmatureRevealProvider, type ArmatureRevealProviderProps } from "./ArmatureRevealProvider";
