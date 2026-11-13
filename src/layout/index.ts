// Layout: FLIP layout animation, shared elements, and presence. An element is measured before and after a change, put back where it was with
// `translate` and `scale` (never `transform`), and sprung to zero. A change in flight starts from where the element is now and keeps its speed.
// It runs on the shared frame scheduler and reads the browser through an injected environment, so a server render touches no `window`.
// It imports the engine and the frame scheduler. The spring-only entry reaches none of it.
export { createLayout } from "./layout";
export type { Layout, LayoutOptions, LayoutState } from "./layout";
export { createPresence } from "./presence";
export type { ExitPose, Presence, PresenceOptions, PresenceState } from "./presence";
export { createShared } from "./shared";
export type { Shared, SharedOptions, SharedState } from "./shared";
export { createBrowserLayoutEnvironment } from "./env";
export type { Box, LayoutEnvironment } from "./env";
export { requireLayout } from "./flavor";
export type { LayoutFlavor } from "./flavor";
