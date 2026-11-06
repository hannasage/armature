import { dataAttr, requireSurface, type Flavor } from "../engine/flavor";
import { glassFlavor } from "../glass/flavor";
import { createBrowserEnvironment, type LqgEnvironment } from "./env";
import { createSurface, type SurfaceController, type SurfaceNeighbor, type SurfaceOptions, type SurfacePointerEvent } from "./surface";

// The names below are the glass values, kept as exports so old call sites keep working.
// A delegate reads its own flavor, which is glass unless `options.flavor` says otherwise.
const glass = glassFlavor.surface;

/** The attribute that marks an element as a glass surface. */
export const SURFACE_ATTRIBUTE = dataAttr(glassFlavor, glass.attributes.surface);
/** Elements in one group light each other. The value is a name of letters, digits, `-` and `_`. */
export const GROUP_ATTRIBUTE = dataAttr(glassFlavor, glass.attributes.group);

/** Names a quieter or livelier way for one element to move. The value is a key of `FEELS`; an unknown name is ignored. */
export const FEEL_ATTRIBUTE = dataAttr(glassFlavor, glass.attributes.feel);

/**
 * Named motion settings for one element, so a page can calm a few surfaces and leave the rest as they are.
 * `calm` is a lighter press (0.985), a release that overshoots less, and a glow that reaches a neighbour at half strength.
 */
export const FEELS: Readonly<Record<string, Omit<SurfaceOptions, "env" | "neighbors">>> = glass.feels;

const GROUP_NAME = /^[\w-]+$/;

type DomListener = (event: DelegatedEvent) => void;

/** The part of a document the delegate needs. A `Document` fits. */
export interface DelegateRoot {
  addEventListener(type: string, listener: DomListener, options?: { passive?: boolean; capture?: boolean }): void;
  removeEventListener(type: string, listener: DomListener, options?: { passive?: boolean; capture?: boolean }): void;
  querySelectorAll?(selector: string): Iterable<SurfaceTarget>;
}

export interface SurfaceTarget extends SurfaceNeighbor {
  closest?(selector: string): SurfaceTarget | null;
  getAttribute?(name: string): string | null;
}

export interface DelegatedEvent extends SurfacePointerEvent {
  target: unknown;
}

export interface DelegateOptions {
  /** Defaults to the real browser. A test passes a fake. */
  env?: LqgEnvironment;
  /** The attribute names and feels to use. Default: the glass flavor. It needs a surface part. Every surface the delegate makes gets it. */
  flavor?: Flavor;
  /** Options for every surface the delegate makes. `neighbors` is ignored: groups pick the neighbours. `flavor` is not allowed here: set it on the delegate. */
  surface?: Omit<SurfaceOptions, "env" | "neighbors" | "flavor">;
}

export interface Delegate {
  /** How many elements hold a live surface right now. Idle ones are dropped. For tests and debugging. */
  readonly surfaceCount: number;
  /** Removes the five listeners, and resets every surface that is still active. Safe to call twice. */
  destroy(): void;
}

const LISTENER_OPTIONS = { passive: true } as const;
const LEAVE_OPTIONS = { passive: true, capture: true } as const;

/**
 * Listens once on the document for every element that carries `data-lqg` (the surface attribute of the flavor), so markup rendered on the server
 * works with no client wrapper around it, and does nothing at all when script is absent. It makes one surface
 * per element the first time the pointer meets it.
 *
 * Release is heard on the document, so a press ends wherever the pointer is let go.
 */
export function installDelegation(root: DelegateRoot, options: DelegateOptions = {}): Delegate {
  const env = options.env ?? createBrowserEnvironment();
  const flavor = options.flavor ?? glassFlavor;
  const config = requireSurface(flavor);
  const surfaceAttribute = dataAttr(flavor, config.attributes.surface);
  const groupAttribute = dataAttr(flavor, config.attributes.group);
  const feelAttribute = dataAttr(flavor, config.attributes.feel);
  const surfaceSelector = `[${surfaceAttribute}]`;
  const surfaces = new Map<SurfaceTarget, SurfaceController>();
  let hovered: SurfaceTarget | null = null;
  let pressed: SurfaceTarget | null = null;
  let destroyed = false;

  const hostOf = (target: unknown): SurfaceTarget | null => {
    const node = target as SurfaceTarget | null | undefined;
    if (!node || typeof node.closest !== "function") return null;
    return node.closest(surfaceSelector);
  };

  const prune = () => {
    for (const [host, surface] of surfaces) {
      if (host === hovered || host === pressed) continue;
      const state = surface.getState();
      if (!state.moving && !state.hovered && !state.pressed) {
        surface.destroy();
        surfaces.delete(host);
      }
    }
  };

  const surfaceFor = (host: SurfaceTarget): SurfaceController => {
    const found = surfaces.get(host);
    if (found) return found;
    prune();
    const name = host.getAttribute?.(feelAttribute);
    const feel = name && Object.prototype.hasOwnProperty.call(config.feels, name) ? config.feels[name] : undefined;
    const created = createSurface(host, { ...options.surface, ...feel, env, flavor });
    surfaces.set(host, created);
    return created;
  };

  const syncGroup = (host: SurfaceTarget, surface: SurfaceController) => {
    const name = host.getAttribute?.(groupAttribute);
    if (!name || !GROUP_NAME.test(name) || !root.querySelectorAll) return;
    const members = root.querySelectorAll(`${surfaceSelector}[${groupAttribute}="${name}"]`);
    surface.setNeighbors(members);
  };

  const leave = (host: SurfaceTarget | null) => {
    if (!host) return;
    surfaces.get(host)?.leave();
  };

  const onDown: DomListener = (event) => {
    if (destroyed) return;
    const host = hostOf(event.target);
    if (!host) return;
    const surface = surfaceFor(host);
    syncGroup(host, surface);
    pressed = host;
    surface.down(event);
  };

  const onMove: DomListener = (event) => {
    if (destroyed) return;
    const host = hostOf(event.target);
    if (host !== hovered) {
      leave(hovered);
      hovered = host;
      if (host) syncGroup(host, surfaceFor(host));
    }
    if (host) surfaceFor(host).move(event);
  };

  const onUp: DomListener = () => {
    if (destroyed || !pressed) return;
    const host = pressed;
    pressed = null;
    surfaces.get(host)?.up();
  };

  const onLeave: DomListener = (event) => {
    // pointerleave does not bubble, and fires on an element only when the pointer leaves it and all its children.
    if (destroyed || event.target !== hovered) return;
    leave(hovered);
    hovered = null;
  };

  root.addEventListener("pointerdown", onDown, LISTENER_OPTIONS);
  root.addEventListener("pointermove", onMove, LISTENER_OPTIONS);
  root.addEventListener("pointerup", onUp, LISTENER_OPTIONS);
  root.addEventListener("pointercancel", onUp, LISTENER_OPTIONS);
  root.addEventListener("pointerleave", onLeave, LEAVE_OPTIONS);

  return {
    get surfaceCount() {
      return surfaces.size;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.removeEventListener("pointerdown", onDown, LISTENER_OPTIONS);
      root.removeEventListener("pointermove", onMove, LISTENER_OPTIONS);
      root.removeEventListener("pointerup", onUp, LISTENER_OPTIONS);
      root.removeEventListener("pointercancel", onUp, LISTENER_OPTIONS);
      root.removeEventListener("pointerleave", onLeave, LEAVE_OPTIONS);
      for (const surface of surfaces.values()) surface.destroy();
      surfaces.clear();
      hovered = null;
      pressed = null;
    },
  };
}
