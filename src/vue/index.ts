// The Vue adapter: one composable for each DOM controller. Each takes a template ref and the options of the controller, flavor included, makes the
// controller when the component mounts, and destroys it when the component unmounts. It holds no motion logic. Vue is an optional peer.
// It imports the engine and the controllers it wraps, and no glass, React, or CSS-output code.
import { attachSurface, type Surface, type SurfaceOptions } from "../dom/surface";
import { createFollower, type Follower, type FollowerOptions } from "../dom/follower";
import { createDrag, type Drag, type DragOptions } from "../gesture/drag";
import { createLayout, type Layout, type LayoutOptions } from "../layout/layout";
import { useController, type ControllerHandle, type ElementRef } from "./mount";

export type { ControllerHandle, ElementRef } from "./mount";
export type { Surface, SurfaceOptions } from "../dom/surface";
export type { Follower, FollowerMove, FollowerOptions, FollowerState } from "../dom/follower";
export type { Drag, DragOptions, DragState } from "../gesture/drag";
export type { Layout, LayoutOptions, LayoutState } from "../layout/layout";

/** `attachSurface` for the element of the ref: the press, the glint, and the glow. The options must name a flavor with a `surface` part. */
export function useArmatureSurface(target: ElementRef, options: SurfaceOptions): ControllerHandle<Surface> {
  return useController(target, "surface", options, (element) => attachSurface(element, options));
}

/** `createFollower` for the element of the ref. The options must name a flavor with a `followers` part and the name of a follower. */
export function useArmatureFollower(target: ElementRef, options: FollowerOptions): ControllerHandle<Follower> {
  return useController(target, "follower", options, (element) => createFollower(element, options));
}

/** `createDrag` for the element of the ref. The options must name a flavor with a `gesture` part. */
export function useArmatureDrag(target: ElementRef, options: DragOptions): ControllerHandle<Drag> {
  return useController(target, "drag", options, (element) => createDrag(element, options));
}

/** `createLayout` for the element of the ref. The options must name a flavor with a `layout` part. */
export function useArmatureLayout(target: ElementRef, options: LayoutOptions): ControllerHandle<Layout> {
  return useController(target, "layout", options, (element) => createLayout(element, options));
}
