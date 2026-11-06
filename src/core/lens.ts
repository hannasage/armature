import { cssVar, dataAttr, requireLens, springOf, type Flavor } from "../engine/flavor";
import { glassFlavor } from "../glass/flavor";
import { createBrowserEnvironment, prefersReducedMotion, type LqgEnvironment, type LqgTarget } from "../engine/env";
import { createSpring, isAtRest, MAX_FRAME, retarget, stepSpring, type SpringConfig, type SpringState } from "../engine/spring";

/** A box in the container's own coordinates, like `offsetLeft`, `offsetTop`, `offsetWidth`, and `offsetHeight`. */
export interface LensBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LensJumpRules {
  /** Take the first place at once instead of growing in. Default true. */
  first?: boolean;
  /** Jump when the reader prefers reduced motion. Default true. */
  reducedMotion?: boolean;
  /** Jump when `update({ keyboard: true })` says a key caused the change. Default true. */
  keyboard?: boolean;
}

export interface LensOptions {
  /** Receives the lens variables and the lens attribute (`--lqg-lens-*` and `data-lqg-lens` for glass). */
  container: LqgTarget;
  /** Measures the current item. Return null when there is none or it cannot be measured (hidden, or no size). */
  measure(): LensBox | null;
  /** Defaults to the real browser. A test passes a fake. */
  env?: LqgEnvironment;
  /** The names, springs, and numbers to use. Default: the glass flavor. It needs a lens part. */
  flavor?: Flavor;
  jumpRules?: LensJumpRules;
  /** Springs for the position and the width. Defaults: the flavor's two lens springs (`lensX` and `lensWidth` for glass), with pixel rest thresholds. */
  springs?: { x?: SpringConfig; width?: SpringConfig };
  /** Speed, in pixels per second, that adds 100 percent of stretch. Default 10000 for glass, so 1200 px/s reaches the 12 percent cap. */
  stretchVelocity?: number;
  /** The most the lens stretches along x, as a fraction. Default 0.12 for glass. 0 turns stretch off. */
  maxStretch?: number;
}

export interface LensState {
  /** True while the lens has a box and is showing. */
  ready: boolean;
  destroyed: boolean;
  /** True while a spring is still travelling. */
  moving: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Velocity of x and of the width, in pixels per second. */
  vx: number;
  vw: number;
  /** Stretch along x, 1 to 1 + maxStretch. */
  sx: number;
  /** The inverse of `sx`, so the area stays the same. */
  sy: number;
  target: LensBox | null;
}

export interface Lens {
  /** The current item may have changed. Measure it and travel there, or jump if a jump rule says so. */
  update(change?: { keyboard?: boolean }): void;
  /** Measure and move there at once, with no travel and no leftover velocity. */
  jump(): void;
  /** The container may have been resized. Jumps if the box moved. A running travel to the same box is left alone. */
  refit(): void;
  getState(): LensState;
  /** Cancels the frame, stops watching, and ignores every later call. Safe to call twice. */
  destroy(): void;
}

const finiteBox = (box: LensBox | null | undefined): box is LensBox =>
  !!box && [box.x, box.y, box.w, box.h].every(Number.isFinite) && box.w > 0 && box.h > 0;

const sameBox = (a: LensBox | null, b: LensBox) => !!a && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

const pixels = (value: number) => `${Number(value.toFixed(2))}px`;
const ratio = (value: number) => String(Number(value.toFixed(4)));

/**
 * A travelling indicator under the current item of a row. It springs x and width on separate curves, stretches
 * a little with speed, and writes CSS variables for a stylesheet to draw. It runs one frame loop, and only
 * while something moves.
 */
export function createLens(options: LensOptions): Lens {
  const env = options.env ?? createBrowserEnvironment();
  const flavor = options.flavor ?? glassFlavor;
  const config = requireLens(flavor);
  const varNames = {
    x: cssVar(flavor, config.vars.x),
    y: cssVar(flavor, config.vars.y),
    w: cssVar(flavor, config.vars.w),
    h: cssVar(flavor, config.vars.h),
    sx: cssVar(flavor, config.vars.sx),
    sy: cssVar(flavor, config.vars.sy),
  };
  const readyAttribute = dataAttr(flavor, config.readyAttribute);
  // Pixels need only to look still. For glass: a twentieth of a pixel and a pixel a second.
  const withPixelRest = (spring: SpringConfig): SpringConfig => ({ restDelta: config.pixelRest.restDelta, restSpeed: config.pixelRest.restSpeed, ...spring });
  const rules = { first: true, reducedMotion: true, keyboard: true, ...options.jumpRules };
  const xConfig = withPixelRest(options.springs?.x ?? springOf(flavor, config.springKeys.x));
  const wConfig = withPixelRest(options.springs?.width ?? springOf(flavor, config.springKeys.width));
  const stretchVelocity = Number.isFinite(options.stretchVelocity) && options.stretchVelocity! > 0 ? options.stretchVelocity! : config.stretchVelocity;
  const maxStretch = Number.isFinite(options.maxStretch) && options.maxStretch! >= 0 ? options.maxStretch! : config.maxStretch;

  let xs: SpringState | null = null;
  let ws: SpringState | null = null;
  let y = 0;
  let h = 0;
  let target: LensBox | null = null;
  let frame = 0;
  let last = 0;
  let destroyed = false;
  let written: Record<string, string> = {};

  const read = (): LensBox | null => {
    const box = options.measure();
    return finiteBox(box) ? box : null;
  };

  const stretch = () => {
    const speed = xs ? Math.abs(xs.velocity) : 0;
    const sx = 1 + Math.min(speed / stretchVelocity, maxStretch);
    return { sx, sy: 1 / sx };
  };

  const set = (name: string, value: string) => {
    if (written[name] === value) return;
    written[name] = value;
    env.setCSSVariable(options.container, name, value);
  };

  const write = () => {
    if (!xs || !ws) return;
    const { sx, sy } = stretch();
    set(varNames.x, pixels(xs.value));
    set(varNames.y, pixels(y));
    set(varNames.w, pixels(ws.value));
    set(varNames.h, pixels(h));
    set(varNames.sx, ratio(sx));
    set(varNames.sy, ratio(sy));
  };

  const stopFrame = () => {
    if (frame) {
      env.cancelFrame(frame);
      frame = 0;
    }
  };

  const atRest = () => !xs || !ws || (isAtRest(xs) && isAtRest(ws));

  const tick = (time: number) => {
    frame = 0;
    if (destroyed || !xs || !ws || !target) return;
    const dt = Math.min(MAX_FRAME, Math.max(0, (time - last) / 1000));
    last = time;
    xs = stepSpring(xs, target.x, dt);
    ws = stepSpring(ws, target.w, dt);
    write();
    if (!atRest()) continueChain();
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

  const hide = () => {
    stopFrame();
    xs = null;
    ws = null;
    target = null;
    written = {};
    env.setAttribute(options.container, readyAttribute, null);
  };

  const jumpTo = (box: LensBox) => {
    stopFrame();
    xs = createSpring(xConfig, box.x);
    ws = createSpring(wConfig, box.w);
    y = box.y;
    h = box.h;
    target = box;
    write();
    env.setAttribute(options.container, readyAttribute, config.readyValue);
  };

  const place = (box: LensBox, keyboard: boolean) => {
    const first = !xs || !ws;
    if (first && !rules.first && !prefersReducedMotion(env)) {
      // Grow in: start at the right place with no width, and spring the width open.
      jumpTo(box);
      ws = retarget(createSpring(wConfig, 0), box.w);
      write();
      schedule();
      return;
    }
    if (first || (rules.reducedMotion && prefersReducedMotion(env)) || (rules.keyboard && keyboard)) {
      jumpTo(box);
      return;
    }
    if (sameBox(target, box)) return;
    xs = retarget(xs!, box.x);
    ws = retarget(ws!, box.w);
    y = box.y;
    h = box.h;
    target = box;
    if (atRest()) {
      jumpTo(box);
      return;
    }
    write();
    schedule();
  };

  const update = (change: { keyboard?: boolean } = {}) => {
    if (destroyed) return;
    const box = read();
    if (!box) {
      if (xs) hide();
      return;
    }
    place(box, change.keyboard === true);
  };

  const jump = () => {
    if (destroyed) return;
    const box = read();
    if (!box) {
      if (xs) hide();
      return;
    }
    jumpTo(box);
  };

  const refit = () => {
    if (destroyed) return;
    const box = read();
    if (!box) {
      if (xs) hide();
      return;
    }
    if (!xs) place(box, false);
    else if (!sameBox(target, box)) jumpTo(box);
  };

  const watcher = env.observeResize?.(options.container, refit);

  return {
    update,
    jump,
    refit,
    getState() {
      const { sx, sy } = stretch();
      return {
        ready: xs !== null,
        destroyed,
        moving: !atRest(),
        x: xs?.value ?? 0,
        y,
        w: ws?.value ?? 0,
        h,
        vx: xs?.velocity ?? 0,
        vw: ws?.velocity ?? 0,
        sx,
        sy,
        target,
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopFrame();
      watcher?.disconnect();
    },
  };
}
