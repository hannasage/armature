// Gesture: the pointer environment, the pointer velocity tracker, and drag with decay, snap, and swipe.
// It reads no `window` and holds no flavor of its own. It imports only the engine, and the spring-only entry reaches none of it.
export { createDrag } from "./drag";
export type { Drag, DragBounds, DragOptions, DragState, SwipeDirection } from "./drag";
export { requireGesture } from "./flavor";
export { createBrowserPointerEnvironment } from "./pointer-env";
export type { ArmaturePointerEnvironment, PointerHandlers, PointerSample } from "./pointer-env";
export { createPointerVelocity } from "./pointer-velocity";
export type { PointerVelocity, PointerVelocityOptions } from "./pointer-velocity";
