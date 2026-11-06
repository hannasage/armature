/**
 * The golden harness. It runs one scripted scenario against an implementation and returns a trace.
 * Two implementations that behave the same return traces that are strictly equal, frame by frame.
 *
 * `tests/golden/legacy/` is a frozen copy of the first version of the code, taken before the engine was
 * extracted. Nobody edits it. The harness compares the legacy copy (`legacyPort`) with the current code under
 * `src/` (`newPort`).
 */
import { vi } from "vitest";
import { FakeEnv } from "../helpers/fake-env";
import { FakeElement, FakeRoot, FakeScrollEnv } from "../helpers/fake-scroll-env";
import { guardedSetup } from "./legacy/guard";
import { createLens } from "./legacy/lens";
import { mountScrollReveal } from "./legacy/scroll-mount";
import * as motion from "./legacy/scroll-motion";
import { createScrollReveal, startScrollReveal } from "./legacy/scroll-reveal";
import * as spring from "./legacy/spring";
import { createSurface } from "./legacy/surface";
import { guardedSetup as newGuardedSetup } from "../../src/core/guard";
import { createLens as newCreateLens } from "../../src/core/lens";
import { mountScrollReveal as newMountScrollReveal } from "../../src/core/scroll-mount";
import * as newMotion from "../../src/core/scroll-motion";
import { createScrollReveal as newCreateScrollReveal, startScrollReveal as newStartScrollReveal } from "../../src/core/scroll-reveal";
import * as newSpring from "../../src/core/spring";
import { createSurface as newCreateSurface } from "../../src/core/surface";

/** The pieces of the code the harness drives. The signatures are the ones the code had before the extraction. */
export interface Port {
  createSpring: typeof spring.createSpring;
  stepSpring: typeof spring.stepSpring;
  retarget: typeof spring.retarget;
  /** Every named spring: the six presets, then the reveal slow, fast, and calm springs, then the drag spring. */
  springs: Readonly<Record<string, spring.SpringConfig>>;
  createSurface: typeof createSurface;
  createLens: typeof createLens;
  createScrollReveal: typeof createScrollReveal;
  startScrollReveal: typeof startScrollReveal;
  mountScrollReveal: typeof mountScrollReveal;
  guardedSetup: typeof guardedSetup;
}

export const legacyPort: Port = {
  createSpring: spring.createSpring,
  stepSpring: spring.stepSpring,
  retarget: spring.retarget,
  springs: {
    lensX: spring.lensX,
    lensWidth: spring.lensWidth,
    press: spring.press,
    release: spring.release,
    gentle: spring.gentle,
    stiff: spring.stiff,
    revealSlow: motion.revealSlow,
    revealFast: motion.revealFast,
    revealCalm: motion.revealCalm,
    dragSpring: motion.dragSpring,
  },
  createSurface,
  createLens,
  createScrollReveal,
  startScrollReveal,
  mountScrollReveal,
  guardedSetup,
};

/** The same pieces, taken from the current code under `src/`. */
export const newPort: Port = {
  createSpring: newSpring.createSpring,
  stepSpring: newSpring.stepSpring,
  retarget: newSpring.retarget,
  springs: {
    lensX: newSpring.lensX,
    lensWidth: newSpring.lensWidth,
    press: newSpring.press,
    release: newSpring.release,
    gentle: newSpring.gentle,
    stiff: newSpring.stiff,
    revealSlow: newMotion.revealSlow,
    revealFast: newMotion.revealFast,
    revealCalm: newMotion.revealCalm,
    dragSpring: newMotion.dragSpring,
  },
  createSurface: newCreateSurface,
  createLens: newCreateLens,
  createScrollReveal: newCreateScrollReveal,
  startScrollReveal: newStartScrollReveal,
  mountScrollReveal: newMountScrollReveal,
  guardedSetup: newGuardedSetup,
};

// ---- springs ----

/** A small seeded generator (mulberry32), so the jitter is the same on every run. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SpringStepScript {
  readonly name: string;
  /** One entry per frame: the target to aim at, then the frame time in seconds. */
  readonly steps: ReadonlyArray<readonly [target: number, dt: number]>;
}

const repeat = (count: number, make: (index: number) => readonly [number, number]) => Array.from({ length: count }, (_, i) => make(i));

export function springScripts(): SpringStepScript[] {
  const random = seeded(20261106);
  return [
    { name: "constant 1/60", steps: repeat(300, () => [1, 1 / 60]) },
    { name: "constant 1/30", steps: repeat(300, () => [1, 1 / 30]) },
    { name: "constant 1/144", steps: repeat(600, () => [1, 1 / 144]) },
    { name: "seeded jitter", steps: repeat(400, () => [1, 0.001 + random() * 0.05]) },
    { name: "a frame above the cap", steps: [...repeat(10, () => [1, 1 / 60] as const), [1, 0.5], [1, 5], ...repeat(120, () => [1, 1 / 60] as const)] },
    {
      name: "retarget mid-flight",
      steps: [
        ...repeat(20, () => [1, 1 / 60] as const),
        ...repeat(15, () => [0, 1 / 60] as const),
        ...repeat(10, () => [-0.5, 1 / 30] as const),
        ...repeat(200, () => [2, 1 / 90] as const),
      ],
    },
    { name: "bad frames", steps: [[1, 0], [1, -1], [1, Number.NaN], [1, Infinity], [1, 1 / 60], [Number.NaN, 1 / 60], ...repeat(50, () => [1, 1 / 60] as const)] },
  ];
}

/** The full state after every frame. The state holds its resolved config, so a wrong constant shows up too. */
export function springTrace(port: Port, config: spring.SpringConfig, script: SpringStepScript): spring.SpringState[] {
  let state = port.retarget(port.createSpring(config, 0), 1);
  const trace: spring.SpringState[] = [{ ...state }];
  for (const [target, dt] of script.steps) {
    state = port.stepSpring(state, target, dt);
    trace.push({ ...state });
  }
  return trace;
}

// ---- snapshots ----

type Labels = Map<object, string>;
const label = (labels: Labels, target: object) => labels.get(target) ?? "unlabelled";

function snapshotEnv(env: FakeEnv, labels: Labels) {
  return {
    time: env.time,
    pending: env.pending,
    requested: env.requested,
    cancelled: [...env.cancelled],
    writes: env.writes.map((write) => [label(labels, write.target), write.name, write.value]),
    vars: [...env.vars].map(([target, vars]) => [label(labels, target), vars]),
    attrs: [...env.attrs].map(([target, attrs]) => [label(labels, target), attrs]),
    disconnected: env.disconnected,
    resizeWatchers: env.resizeCallbacks.size,
  };
}

function snapshotScrollEnv(env: FakeScrollEnv, labels: Labels) {
  return {
    time: env.time,
    y: env.y,
    pending: env.pending,
    requested: env.requested,
    cancelled: [...env.cancelled],
    styleWrites: env.styleWrites.map((write) => [label(labels, write.target), write.property, write.value]),
    styles: [...env.styles].map(([target, styles]) => [label(labels, target), styles]),
    attrs: [...env.attrs].map(([target, attrs]) => [label(labels, target), attrs]),
    timers: [...env.timers].map(([id, timer]) => [id, timer.at]),
    observed: [...env.observed].map((target) => label(labels, target)),
    observerCreated: env.observerCreated,
    observerDisconnected: env.observerDisconnected,
    rootMargin: env.rootMargin,
    scrollListeners: env.scrollListeners.size,
    addedScroll: env.addedScroll,
    removedScroll: env.removedScroll,
    visibilityListeners: env.visibilityListeners.size,
    reducedListeners: env.reducedListeners.size,
    focusListeners: env.focusListeners.size,
    changeListeners: env.changeListeners.size,
    resizeListeners: env.resizeListeners.size,
    watchers: env.watchers,
  };
}

// ---- surface ----

export function surfaceTrace(port: Port) {
  const env = new FakeEnv();
  const labels: Labels = new Map();
  const box = (left: number, top: number) => ({ getBoundingClientRect: () => ({ left, top, width: 120, height: 48 }) });
  const element = box(100, 100);
  const near = box(240, 100);
  const far = box(560, 300);
  labels.set(element, "element").set(near, "near").set(far, "far");
  const surface = port.createSurface(element, { env, neighbors: [near, far] });
  const trace: unknown[] = [];
  const snap = (step: string) => trace.push({ step, env: snapshotEnv(env, labels), state: surface.getState() });
  const run = (frames: number, ms = 1000 / 60) => {
    for (let i = 0; i < frames; i++) {
      env.tick(ms);
      snap(`tick ${i}`);
    }
  };

  snap("start");
  surface.move({ clientX: 130, clientY: 120, pointerType: "mouse" });
  snap("move");
  run(6);
  surface.move({ clientX: 190, clientY: 130, pointerType: "mouse" });
  run(4, 1000 / 144);
  surface.down({ clientX: 190, clientY: 130, pointerType: "mouse", isPrimary: true, button: 0 });
  snap("down");
  run(25);
  surface.move({ clientX: 110, clientY: 105, pointerType: "mouse" });
  run(5, 1000 / 30);
  surface.up();
  snap("up");
  run(60);
  surface.leave();
  snap("leave");
  run(80);
  surface.down({ clientX: 150, clientY: 120, pointerType: "touch", isPrimary: true, button: 0 });
  surface.move({ clientX: 150, clientY: 120, pointerType: "touch" });
  run(3, 250);
  surface.up();
  run(40);
  env.reduced = true;
  surface.down({ clientX: 150, clientY: 120, pointerType: "mouse", isPrimary: true, button: 0 });
  snap("down under reduced motion");
  run(5);
  env.reduced = false;
  surface.removeNeighbor(near);
  snap("neighbor removed");
  surface.down({ clientX: 150, clientY: 120, pointerType: "mouse", isPrimary: true, button: 0 });
  run(5);
  surface.destroy();
  snap("destroy");
  run(5);
  return trace;
}

// ---- lens ----

export function lensTrace(port: Port) {
  const env = new FakeEnv();
  const labels: Labels = new Map();
  const container = {};
  labels.set(container, "container");
  let box: { x: number; y: number; w: number; h: number } | null = { x: 10, y: 4, w: 80, h: 32 };
  const lens = port.createLens({ container, env, measure: () => box });
  const trace: unknown[] = [];
  const snap = (step: string) => trace.push({ step, env: snapshotEnv(env, labels), state: lens.getState() });
  const run = (frames: number, ms = 1000 / 60) => {
    for (let i = 0; i < frames; i++) {
      env.tick(ms);
      snap(`tick ${i}`);
    }
  };

  snap("start");
  lens.update();
  snap("first update");
  run(3);
  box = { x: 160, y: 4, w: 120, h: 32 };
  lens.update();
  snap("travel");
  run(40);
  box = { x: 300, y: 6, w: 60, h: 30 };
  lens.update();
  run(8, 1000 / 144);
  box = { x: 40, y: 4, w: 90, h: 32 };
  lens.update({ keyboard: true });
  snap("keyboard jump");
  run(3);
  box = { x: 200, y: 4, w: 100, h: 32 };
  lens.update();
  run(5, 1000 / 30);
  box = { x: 200, y: 4, w: 100, h: 32 };
  lens.refit();
  box = { x: 210, y: 4, w: 100, h: 32 };
  env.resizeCallbacks.get(container)?.();
  snap("refit");
  run(3);
  env.reduced = true;
  box = { x: 20, y: 4, w: 100, h: 32 };
  lens.update();
  snap("reduced motion jump");
  env.reduced = false;
  box = null;
  lens.update();
  snap("hidden");
  box = { x: 70, y: 4, w: 100, h: 32 };
  lens.jump();
  snap("jump");
  lens.update();
  run(2, 400);
  lens.destroy();
  snap("destroy");
  lens.update();
  run(3);
  return trace;
}

// ---- reveal ----

interface RevealScene {
  readonly env: FakeScrollEnv;
  readonly root: FakeRoot;
  readonly labels: Labels;
  readonly elements: FakeElement[];
}

function revealScene(): RevealScene {
  const env = new FakeScrollEnv();
  env.docHeight = 4000;
  const root = new FakeRoot();
  const labels: Labels = new Map();
  const rect = (top: number, left = 0, height = 120) => ({ top, left, width: 300, height });
  const group = new FakeElement({ "data-lqg-reveal-group": "" }, rect(1200));
  const inView = new FakeElement({ "data-lqg-reveal": "drop" }, rect(100));
  const dropBelow = new FakeElement({ "data-lqg-reveal": "drop", "data-lqg-tilt": "3" }, rect(1200), group);
  const slideLeft = new FakeElement({ "data-lqg-reveal": "slide" }, rect(1200, 320), group);
  const slideRight = new FakeElement({ "data-lqg-reveal": "slide", "data-lqg-side": "right" }, rect(1330), group);
  const mask = new FakeElement({ "data-lqg-reveal": "mask" }, rect(1500, 0, 90));
  const lineOne = new FakeElement({ "data-lqg-line": "" }, rect(1500, 0, 40), mask);
  const lineTwo = new FakeElement({ "data-lqg-line": "" }, rect(1545, 0, 40), mask);
  const bareMask = new FakeElement({ "data-lqg-reveal": "mask" }, rect(1800, 0, 70));
  const fade = new FakeElement({ "data-lqg-reveal": "fade", "data-lqg-reveal-delay": "120" }, rect(2000));
  const drag = new FakeElement({ "data-lqg-drag": "", "data-lqg-depth": "0.8" }, rect(300));
  const dragDeep = new FakeElement({ "data-lqg-drag": "", "data-lqg-depth": "1", "data-lqg-reveal": "fade" }, rect(2300));
  const named: Array<[string, FakeElement]> = [
    ["group", group], ["inView", inView], ["dropBelow", dropBelow], ["slideLeft", slideLeft], ["slideRight", slideRight],
    ["mask", mask], ["lineOne", lineOne], ["lineTwo", lineTwo], ["bareMask", bareMask], ["fade", fade], ["drag", drag], ["dragDeep", dragDeep],
  ];
  for (const [name, element] of named) labels.set(element, name);
  root.members = [inView, dropBelow, slideLeft, slideRight, mask, bareMask, fade, drag, dragDeep];
  return { env, root, labels, elements: named.map(([, element]) => element) };
}

export function revealTrace(port: Port) {
  const { env, root, labels, elements } = revealScene();
  const [, inView, dropBelow, slideLeft, slideRight, mask, , , bareMask, fade, drag, dragDeep] = elements;
  const controller = port.createScrollReveal({ root, env });
  const trace: unknown[] = [];
  const snap = (step: string) => trace.push({
    step,
    env: snapshotScrollEnv(env, labels),
    armed: controller.armed,
    velocity: controller.velocity(),
    phases: elements.map((element) => controller.phase(element)),
    poses: elements.map((element) => controller.pose(element)),
  });
  const run = (frames: number, ms = 1000 / 60) => {
    for (let i = 0; i < frames; i++) {
      env.tick(ms);
      snap(`tick ${i}`);
    }
  };

  snap("before start");
  controller.start();
  snap("start");
  run(2);
  for (const y of [40, 90, 150]) {
    env.scrollTo(y);
    run(1);
  }
  env.enter({ target: inView }, { target: drag }, { target: dragDeep, isIntersecting: false });
  run(30);
  for (const y of [400, 1100, 2100, 3300]) {
    env.scrollTo(y);
    run(1, 8);
  }
  env.enter({ target: dropBelow }, { target: slideLeft }, { target: slideRight });
  snap("a group arrives");
  run(70);
  env.scrollTo(3400);
  env.enter({ target: mask }, { target: bareMask }, { target: fade });
  run(10, 1000 / 144);
  env.setHidden(true);
  snap("tab hidden");
  env.tick(1000 / 60);
  snap("tick while hidden");
  env.setHidden(false);
  snap("tab visible");
  run(90);
  env.scrollTo(3500);
  env.enter({ target: dragDeep });
  run(30, 1000 / 30);
  env.mutate();
  run(2);
  env.focus(dragDeep);
  env.advance(3000);
  snap("after the safety timer");
  env.resize();
  run(60);
  env.setReduced(true);
  snap("reduced motion on");
  controller.stop();
  snap("stop");
  run(2);
  return trace;
}

// ---- the log label ----

/** Every `console.error` the code makes on its failure paths, as plain values. */
export function logTrace(port: Port) {
  const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  let calls: unknown[][] = [];
  try {
    const failure = new Error("boom");
    port.guardedSetup("glass delegation", () => { throw failure; })();
    const stops = port.guardedSetup("glass mode", () => () => { throw failure; });
    stops();

    const { env: brokenEnv, root: brokenRoot } = revealScene();
    brokenEnv.onScroll = () => { throw failure; };
    port.startScrollReveal(() => port.createScrollReveal({ root: brokenRoot, env: brokenEnv }));

    const { env: disconnectEnv, root: disconnectRoot } = revealScene();
    disconnectEnv.createIntersectionObserver = (deliver, rootMargin) => {
      disconnectEnv.deliver = deliver;
      disconnectEnv.rootMargin = rootMargin;
      return { observe: () => undefined, unobserve: () => undefined, disconnect: () => { throw failure; } };
    };
    const controller = port.createScrollReveal({ root: disconnectRoot, env: disconnectEnv });
    controller.start();
    controller.stop();

    const { env: mountEnv, root: mountRoot } = revealScene();
    const unmount = port.mountScrollReveal(mountRoot, { env: mountEnv, context: "the mount", onDisarm: () => { throw failure; } });
    unmount();
    calls = spy.mock.calls.map((args) => args.map((arg) => (arg instanceof Error ? `Error: ${arg.message}` : arg)));
  } finally {
    spy.mockRestore();
  }
  return calls;
}
