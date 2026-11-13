// The Svelte adapter: one action for each DOM controller, for the `use:` directive. Each takes the options of the controller, flavor included, makes
// the controller when the node mounts, and destroys it when the node leaves. It holds no motion logic, and it imports nothing from Svelte.
// It imports the engine and the controllers it wraps, and no glass, React, or CSS-output code.
import { attachSurface, type Surface, type SurfaceOptions } from "../dom/surface";
import { createFollower, type Follower, type FollowerOptions } from "../dom/follower";
import { createDrag, type Drag, type DragOptions } from "../gesture/drag";
import { createLayout, type Layout, type LayoutOptions } from "../layout/layout";
import { act, type ActionHooks, type ActionResult } from "./action";

export type { ActionHooks, ActionResult } from "./action";
export type { Surface, SurfaceOptions } from "../dom/surface";
export type { Follower, FollowerMove, FollowerOptions, FollowerState } from "../dom/follower";
export type { Drag, DragOptions, DragState } from "../gesture/drag";
export type { Layout, LayoutOptions, LayoutState } from "../layout/layout";

/** `attachSurface` as an action: the press, the glint, and the glow. The options must name a flavor with a `surface` part. */
export function surface(node: HTMLElement, options: SurfaceOptions & ActionHooks<Surface>): ActionResult {
  return act(node, "surface", options, (element) => attachSurface(element, options));
}

/** `createFollower` as an action. The options must name a flavor with a `followers` part and the name of a follower. Take the follower from `onReady`. */
export function follow(node: HTMLElement, options: FollowerOptions & ActionHooks<Follower>): ActionResult {
  return act(node, "follower", options, (element) => createFollower(element, options));
}

/** `createDrag` as an action. The options must name a flavor with a `gesture` part. */
export function drag(node: HTMLElement, options: DragOptions & ActionHooks<Drag>): ActionResult {
  return act(node, "drag", options, (element) => createDrag(element, options));
}

/** `createLayout` as an action. The options must name a flavor with a `layout` part. */
export function layout(node: HTMLElement, options: LayoutOptions & ActionHooks<Layout>): ActionResult {
  return act(node, "layout", options, (element) => createLayout(element, options));
}
