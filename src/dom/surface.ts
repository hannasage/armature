import { cssVar, requireSurface, springOf, type FeelOptions, type Flavor } from "../engine/flavor";
import { createBrowserEnvironment, prefersReducedMotion, type ArmatureEnvironment } from "../engine/env";
import { createSpring, isAtRest, MAX_FRAME, reconfigure, retarget, stepSpring, type SpringConfig, type SpringState } from "../engine/spring";

export interface SurfaceRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// The event is `any` because `HTMLElement.addEventListener` is declared for DOM event types, and a PointerEvent
// is not assignable to the narrow shape this module reads. The handlers below take `SurfacePointerEvent`.
type DomListener = (event: any) => void;

/** The part of an element a surface needs. An `HTMLElement` fits. */
export interface SurfaceElement {
  addEventListener(type: string, listener: DomListener, options?: { passive?: boolean; capture?: boolean }): void;
  removeEventListener(type: string, listener: DomListener, options?: { passive?: boolean; capture?: boolean }): void;
  getBoundingClientRect(): SurfaceRect;
}

/** A neighbour only needs a rectangle. It receives the glow variable. Its name comes from the flavor. */
export interface SurfaceNeighbor {
  getBoundingClientRect(): SurfaceRect;
}

export interface SurfacePointerEvent {
  clientX: number;
  clientY: number;
  pointerType?: string;
  isPrimary?: boolean;
  button?: number;
}

export interface SurfaceOptions extends FeelOptions {
  /** Defaults to the real browser. A test passes a fake. */
  env?: ArmatureEnvironment;
  /** The names, springs, and default numbers to use. Required. It needs a surface part. */
  flavor: Flavor;
  /** Elements that share this surface's glow. */
  neighbors?: SurfaceNeighbor[];
}

export interface SurfaceState {
  destroyed: boolean;
  pressed: boolean;
  hovered: boolean;
  scale: number;
  flex: number;
  specX: number;
  specY: number;
  glow: number;
  moving: boolean;
}

export interface Surface {
  addNeighbor(neighbor: SurfaceNeighbor): void;
  /** Replaces the neighbour list. Neighbours that left the list have their glow set to 0. */
  setNeighbors(neighbors: Iterable<SurfaceNeighbor>): void;
  /** Stops lighting the neighbour and sets its glow to 0. */
  removeNeighbor(neighbor: SurfaceNeighbor): void;
  getState(): SurfaceState;
  /** Removes every listener, cancels the frame, and leaves the element at its rest values. Safe to call twice. */
  destroy(): void;
}

const LISTENER_OPTIONS = { passive: true } as const;

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));
const number = (value: number, digits: number) => String(Number(value.toFixed(digits)));
const percent = (value: number) => `${number(value, 1)}%`;

/** A surface that is driven by calls instead of its own listeners. A delegated provider drives one per element. */
export interface SurfaceController extends Surface {
  down(event: SurfacePointerEvent): void;
  move(event: SurfacePointerEvent): void;
  up(): void;
  leave(): void;
}

/**
 * The surface without any listeners. `attachSurface` adds them; a provider that listens once on the document
 * calls these methods instead. Everything else is described on `attachSurface`.
 */
export function createSurface(element: Pick<SurfaceElement, "getBoundingClientRect">, options: SurfaceOptions): SurfaceController {
  return build(element, options);
}

/**
 * Makes an element feel like glass under a finger: it presses in with a small squash and springs back past
 * its size, a specular glint follows the pointer, and a glow spreads to neighbouring elements, fading with
 * distance. Everything is written as CSS variables for a stylesheet (`styles.css`) to draw.
 *
 * Under reduced motion the surface does nothing, and it snaps any motion in flight to rest.
 */
export function attachSurface(element: SurfaceElement, options: SurfaceOptions): Surface {
  const controller = build(element, options);
  const handlers: Array<[string, DomListener]> = [
    ["pointerdown", controller.down],
    ["pointermove", controller.move],
    ["pointerup", controller.up],
    ["pointercancel", controller.up],
    ["pointerleave", controller.leave],
  ];
  for (const [type, handler] of handlers) element.addEventListener(type, handler, LISTENER_OPTIONS);
  return {
    addNeighbor: controller.addNeighbor,
    setNeighbors: controller.setNeighbors,
    removeNeighbor: controller.removeNeighbor,
    getState: controller.getState,
    destroy() {
      if (controller.getState().destroyed) return;
      for (const [type, handler] of handlers) element.removeEventListener(type, handler, LISTENER_OPTIONS);
      controller.destroy();
    },
  };
}

function build(element: Pick<SurfaceElement, "getBoundingClientRect">, options: SurfaceOptions): SurfaceController {
  const env = options.env ?? createBrowserEnvironment();
  const flavor = options.flavor;
  const config = requireSurface(flavor);
  const varNames = {
    press: cssVar(flavor, config.vars.press),
    flex: cssVar(flavor, config.vars.flex),
    specX: cssVar(flavor, config.vars.specX),
    specY: cssVar(flavor, config.vars.specY),
    glow: cssVar(flavor, config.vars.glow),
  };
  const withRest = (spring: SpringConfig): SpringConfig => ({ restDelta: config.rest.restDelta, restSpeed: config.rest.restSpeed, ...spring });
  const pressScale = Number.isFinite(options.pressScale) && options.pressScale! > 0 ? options.pressScale! : config.defaults.pressScale;
  const flexAmount = Number.isFinite(options.flex) && options.flex! >= 0 ? options.flex! : config.defaults.flex;
  const falloff = Number.isFinite(options.glowFalloff) && options.glowFalloff! > 0 ? options.glowFalloff! : config.defaults.glowFalloff;
  const share = Number.isFinite(options.neighborShare) ? Math.min(1, Math.max(0, options.neighborShare!)) : config.defaults.neighborShare;
  const rest = {
    x: clampPercent(options.specularRest?.x ?? config.defaults.specularRest.x),
    y: clampPercent(options.specularRest?.y ?? config.defaults.specularRest.y),
  };
  // Both effects are on unless the flavor says false.
  const useSpecular = config.specular !== false;
  const useGlow = config.glow !== false;
  const pressConfig = withRest(options.springs?.press ?? springOf(flavor, config.springKeys.press));
  const releaseConfig = withRest(options.springs?.release ?? springOf(flavor, config.springKeys.release));

  let scale: SpringState = createSpring(pressConfig, 1);
  let pressed = false;
  let hovered = false;
  let specX = rest.x;
  let specY = rest.y;
  let targetX = rest.x;
  let targetY = rest.y;
  let glow = 0;
  let glowTarget = 0;
  let frame = 0;
  let last = 0;
  let destroyed = false;
  // What has been touched, so a surface that was never used writes nothing at all.
  let pressTouched = false;
  let specTouched = false;
  let glowTouched = false;

  const neighbors = new Set<SurfaceNeighbor>(options.neighbors ?? []);
  const distances = new Map<SurfaceNeighbor, number>();
  const written = new WeakMap<object, Record<string, string>>();

  const setVar = (target: object, name: string, value: string) => {
    const seen = written.get(target) ?? {};
    if (seen[name] === value) return;
    written.set(target, { ...seen, [name]: value });
    env.setCSSVariable(target, name, value);
  };

  const flexOf = (value: number) => (1 - value) * flexAmount;
  const glowFor = (neighbor: SurfaceNeighbor, level: number) => {
    const distance = distances.get(neighbor);
    if (distance === undefined) return 0;
    const value = level * share * Math.exp(-distance / falloff);
    return value < 0.01 ? 0 : value;
  };
  const glowText = (value: number) => (value < 0.001 ? "0" : number(value, 3));

  const write = () => {
    if (pressTouched) {
      setVar(element, varNames.press, number(scale.value, 4));
      setVar(element, varNames.flex, number(flexOf(scale.value), 4));
    }
    if (specTouched) {
      setVar(element, varNames.specX, percent(specX));
      setVar(element, varNames.specY, percent(specY));
    }
    if (glowTouched) {
      setVar(element, varNames.glow, glowText(glow));
      for (const neighbor of neighbors) if (neighbor !== (element as unknown)) setVar(neighbor, varNames.glow, glowText(glowFor(neighbor, glow)));
    }
  };

  const stopFrame = () => {
    if (frame) {
      env.cancelFrame(frame);
      frame = 0;
    }
  };

  const busy = () => !isAtRest(scale) || specX !== targetX || specY !== targetY || glow !== glowTarget;

  const tick = (time: number) => {
    frame = 0;
    if (destroyed) return;
    const dt = Math.min(MAX_FRAME, Math.max(0, (time - last) / 1000));
    last = time;
    scale = stepSpring(scale, scale.target, dt);
    const ms = dt * 1000;
    const kSpec = 1 - Math.exp(-ms / config.specularTauMs);
    specX += (targetX - specX) * kSpec;
    specY += (targetY - specY) * kSpec;
    if (Math.abs(targetX - specX) < 0.05) specX = targetX;
    if (Math.abs(targetY - specY) < 0.05) specY = targetY;
    glow += (glowTarget - glow) * (1 - Math.exp(-ms / config.glowTauMs));
    if (Math.abs(glowTarget - glow) < 0.002) glow = glowTarget;
    write();
    if (busy()) continueChain();
  };

  /** Start a chain from idle. The first step is measured from now. */
  function schedule() {
    if (frame || destroyed) return;
    last = env.now();
    frame = env.requestFrame(tick);
  }
  /** Ask for the next frame from inside a frame. `last` stays at the frame time `tick` took, so no time is lost between frames. */
  function continueChain() {
    if (frame || destroyed) return;
    frame = env.requestFrame(tick);
  }

  const measureNeighbors = () => {
    distances.clear();
    if (neighbors.size === 0) return;
    const own = element.getBoundingClientRect();
    const cx = own.left + own.width / 2;
    const cy = own.top + own.height / 2;
    for (const neighbor of neighbors) {
      if (neighbor === (element as unknown)) continue;
      const box = neighbor.getBoundingClientRect();
      distances.set(neighbor, Math.hypot(box.left + box.width / 2 - cx, box.top + box.height / 2 - cy));
    }
  };

  /** Back to rest values, written once, with no animation. */
  const reset = () => {
    stopFrame();
    scale = createSpring(pressConfig, 1);
    pressed = false;
    hovered = false;
    specX = targetX = rest.x;
    specY = targetY = rest.y;
    glow = glowTarget = 0;
    write();
  };

  const touched = () => pressTouched || specTouched || glowTouched;

  /** True when the reader wants no motion. Also settles anything in flight, once. */
  const still = () => {
    if (!prefersReducedMotion(env)) return false;
    if (touched()) {
      reset();
      distances.clear();
    }
    return true;
  };

  const release_ = () => {
    pressed = false;
    scale = retarget(reconfigure(scale, releaseConfig), 1);
    glowTarget = useGlow && hovered ? config.hoverGlow : 0;
    schedule();
  };

  const onDown = (event: SurfacePointerEvent) => {
    if (destroyed || still()) return;
    if ((event.button ?? 0) > 0 || event.isPrimary === false) return;
    pressed = true;
    pressTouched = true;
    if (useGlow) {
      glowTouched = true;
      measureNeighbors();
      glowTarget = 1;
    }
    scale = retarget(reconfigure(scale, pressConfig), pressScale);
    schedule();
  };

  const onUp = () => {
    if (destroyed || still() || !pressed) return;
    release_();
  };

  const onMove = (event: SurfacePointerEvent) => {
    if (destroyed || still() || event.pointerType === "touch") return;
    if (!useSpecular && !useGlow) {
      hovered = true;
      return;
    }
    const box = element.getBoundingClientRect();
    if (!(box.width > 0) || !(box.height > 0)) return;
    if (!hovered) {
      hovered = true;
      if (useGlow) {
        glowTouched = true;
        measureNeighbors();
        if (!pressed) glowTarget = config.hoverGlow;
      }
    }
    if (useSpecular) {
      specTouched = true;
      targetX = clampPercent(((event.clientX - box.left) / box.width) * 100);
      targetY = clampPercent(((event.clientY - box.top) / box.height) * 100);
    }
    schedule();
  };

  const onLeave = () => {
    if (destroyed || still()) return;
    hovered = false;
    targetX = rest.x;
    targetY = rest.y;
    glowTarget = 0;
    if (pressed) release_();
    else if (touched()) schedule();
  };

  const syncNeighbors = (next: Iterable<SurfaceNeighbor>) => {
    const keep = new Set<SurfaceNeighbor>();
    for (const neighbor of next) if (neighbor !== (element as unknown)) keep.add(neighbor);
    for (const old of [...neighbors]) if (!keep.has(old)) removeNeighbor(old);
    for (const neighbor of keep) neighbors.add(neighbor);
    if (useGlow && (hovered || pressed)) {
      measureNeighbors();
      schedule();
    }
  };

  function removeNeighbor(neighbor: SurfaceNeighbor) {
    if (destroyed || !neighbors.delete(neighbor)) return;
    distances.delete(neighbor);
    if (written.has(neighbor)) setVar(neighbor, varNames.glow, "0");
  }

  return {
    down: onDown,
    move: onMove,
    up: onUp,
    leave: onLeave,
    addNeighbor(neighbor) {
      if (destroyed || neighbor === (element as unknown)) return;
      neighbors.add(neighbor);
      if (useGlow && (hovered || pressed)) {
        measureNeighbors();
        schedule();
      }
    },
    setNeighbors(next) {
      if (!destroyed) syncNeighbors(next);
    },
    removeNeighbor,
    getState() {
      return {
        destroyed,
        pressed,
        hovered,
        scale: scale.value,
        flex: flexOf(scale.value),
        specX,
        specY,
        glow,
        moving: busy(),
      };
    },
    destroy() {
      if (destroyed) return;
      if (touched()) reset();
      stopFrame();
      destroyed = true;
    },
  };
}
