/**
 * The scroll reveal and the scroll drag (GI-70), as one controller on an injected environment.
 *
 * Reveal. The controller registers the elements under a root that carry `data-lqg-reveal`. Nothing is hidden until `start()` has
 * armed it: the markup, a page with no script, and reduced motion all show every element. When it arms, an element in view (or
 * above it) is shown at once with no entry. An element below the fold waits hidden (opacity 0 and its start offset). When it enters
 * the viewport, a spring runs it in with the individual properties `translate`, `scale`, `rotate`, and `opacity` (and `clip-path`
 * for a `mask`), never `transform`, blur, or a shadow. How far it starts, and how lively the spring is, depend on how fast the page is
 * scrolling at that moment (`scroll-motion.ts`). Each element reveals once. Its personality is the value of `data-lqg-reveal`:
 * `drop`, `mask`, `slide`, or `fade`.
 *
 * Drag. While the page scrolls, a revealed element that carries `data-lqg-drag` trails the scroll a little, like cloth, by a shift and a
 * turn proportional to the speed and scaled by its `data-lqg-depth`. When the scroll stops, a spring settles it back to exactly 0.
 *
 * Cost. One IntersectionObserver, one frame loop, and one scroll listener, which wakes the loop. The loop runs only while something
 * moves: a reveal in flight, a non-zero scroll speed, or a drag that has not settled. A frame reads no layout. Geometry is read once,
 * when an element enters.
 *
 * Safety. A timer shows anything still hidden and in view 2.5 s after arming. Keyboard focus on a waiting element shows it at once.
 * A hidden tab pauses the loop. Turning reduced motion on stops the controller and shows everything. Turning it off does not arm
 * it again: that is deliberate, because content a reader already sees stays visible.
 */
import { cssVar, dataAttr, logTag, personalityOf, requireReveal, type Flavor, type PersonalitySpec } from "../engine/flavor";
import { glassFlavor } from "../glass/flavor";
import { prefersReducedMotion } from "../engine/env";
import { createSpring, MAX_FRAME, retarget, stepSpring, type SpringConfig, type SpringState } from "../engine/spring";
import { createBrowserScrollEnvironment, type LqgScrollEnvironment, type ScrollElement, type ScrollEntry, type ScrollObserver, type ScrollRoot } from "../engine/scroll-env";
import {
  dragTarget, parseDelay, parseDepth, parsePersonality, revealPose, revealSpring, revealStart, staggerDelayFor,
  REST_POSE, type RevealPose, type RevealStart,
} from "./reveal-motion";
import { createScrollVelocity, type ScrollVelocity } from "../engine/scroll-velocity";

// The names and numbers below are the glass values, kept as exports so old call sites keep working.
// A controller reads its own flavor, which is glass unless `options.flavor` says otherwise.
const glass = glassFlavor.reveal;

export const REVEAL_ATTRIBUTE = dataAttr(glassFlavor, glass.attributes.reveal);
export const REVEAL_GROUP_ATTRIBUTE = dataAttr(glassFlavor, glass.attributes.group);
export const REVEAL_DELAY_ATTRIBUTE = dataAttr(glassFlavor, glass.attributes.delay);
/** Set on an element when it has been decided: `now` when it was shown at once, `true` when it was sprung in. */
export const REVEALED_ATTRIBUTE = dataAttr(glassFlavor, glass.attributes.revealed);
export const DRAG_ATTRIBUTE = dataAttr(glassFlavor, glass.attributes.drag);
export const DEPTH_ATTRIBUTE = dataAttr(glassFlavor, glass.attributes.depth);
/** The most a `drop` tilts, in degrees. */
export const TILT_ATTRIBUTE = dataAttr(glassFlavor, glass.attributes.tilt);
/** `left` or `right`: which side a `slide` comes from. Without it, a slide alternates by its index in the group. */
export const SIDE_ATTRIBUTE = dataAttr(glassFlavor, glass.attributes.side);
/** Marks a line of a `mask` heading. The lines rise one after another through the clip of the heading. */
export const LINE_ATTRIBUTE = dataAttr(glassFlavor, glass.attributes.line);
/** Written on a revealed element: the stagger it started with, as a record. */
export const REVEAL_DELAY_PROPERTY = cssVar(glassFlavor, glass.delayProperty);

export const SAFETY_MS = glass.safetyMs;
/** An element whose top is in the lowest 8 percent of the viewport still waits, so a reveal is seen and not spent at the screen edge. */
export const FOLD_PERCENT = glass.foldPercent;

/** The root margin of the intersection observer for a flavor: the fold, as a negative bottom margin. */
export function revealRootMargin(flavor: Flavor = glassFlavor): string {
  return `0px 0px -${requireReveal(flavor).foldPercent}% 0px`;
}
export const ROOT_MARGIN = revealRootMargin(glassFlavor);

/** True when a top edge is in the lowest part of the viewport (8 percent for glass), or past it. Integer math, so 900 px gives exactly 828. */
export function belowFold(top: number, viewportHeight: number, flavor: Flavor = glassFlavor): boolean {
  return top * 100 >= viewportHeight * (100 - requireReveal(flavor).foldPercent);
}

export interface ScrollRevealOptions {
  /** The elements to watch are found under this root. */
  root: ScrollRoot;
  /** The names and numbers to use. Default: the glass flavor. It needs a reveal part. */
  flavor?: Flavor;
  /** Defaults to the real browser, made when the controller is made. A test passes a fake. */
  env?: LqgScrollEnvironment;
  /** Which elements are reveal targets. Default `[data-lqg-reveal]`. A site that keeps its own attributes lists them here. */
  selector?: string;
  /** Which ancestor groups siblings for the stagger. Default `[data-lqg-reveal-group]`. */
  groupSelector?: string;
  /** Which elements drag. Default `[data-lqg-drag]`. */
  dragSelector?: string;
  /** The attribute that records a decision. Default `data-lqg-revealed`. An element that already has it is left alone. */
  revealedAttribute?: string;
  /** The personality of an element, or null when it is not a target. Default reads `data-lqg-reveal`. */
  personalityOf?(element: ScrollElement): string | null;
  /** The extra delay of an element in ms, added to the stagger. Default reads `data-lqg-reveal-delay`. */
  delayOf?(element: ScrollElement): number;
  /** Says whether an element should use the spring path at all. Default true. An element that says false is left as it is. */
  accepts?(element: ScrollElement): boolean;
  /** Called once the controller has armed, and again by `stop()` as `onDisarm`. A site toggles its own class here. */
  onArm?(): void;
  onDisarm?(): void;
  /** Called with an error from a frame, an intersection batch, or a rescan. By then the controller has stopped and shown everything. Default: `console.error`. */
  report?(error: unknown, context: string): void;
}

export type RevealPhase = "none" | "waiting" | "running" | "settled";

export interface ScrollRevealController {
  /** Returns true when it armed. False under reduced motion or with no IntersectionObserver, and then nothing was touched. */
  start(): boolean;
  /** Removes every listener, cancels the frame, and leaves every element visible and clear. Safe to call twice. */
  stop(): void;
  readonly armed: boolean;
  /** The scroll speed it reads, or 0 when not armed. */
  velocity(): number;
  /** Where an element is: waiting hidden, running in, or settled. For tests and debugging. */
  phase(element: ScrollElement): RevealPhase;
  /** The pose an element is in now. The rest pose once it has settled or if it is not tracked. */
  pose(element: ScrollElement): RevealPose;
}

interface Run {
  readonly element: ScrollElement;
  readonly role: "move" | "clip" | "both";
  readonly start: RevealStart;
  spring: SpringState;
  wait: number;
  done: boolean;
}

interface Target {
  readonly element: ScrollElement;
  readonly personality: string;
  readonly groupIndex: number;
  readonly tilt: number | undefined;
  readonly side: -1 | 1 | undefined;
  phase: "waiting" | "running" | "settled";
  runs: Run[];
}

interface Drag {
  readonly element: ScrollElement;
  readonly depth: number;
  shift: SpringState;
  turn: SpringState;
  inView: boolean;
  live: boolean;
}

function assertNever(value: never): never {
  throw new TypeError(`Unknown reveal spring kind: ${String(value)}.`);
}

const number = (value: number, digits: number) => String(Number(value.toFixed(digits)));

export function createScrollReveal(options: ScrollRevealOptions): ScrollRevealController {
  const env = options.env ?? createBrowserScrollEnvironment();
  const root = options.root;
  const flavor = options.flavor ?? glassFlavor;
  const config = requireReveal(flavor);
  const attribute = (name: string) => dataAttr(flavor, name);
  const revealAttribute = attribute(config.attributes.reveal);
  const delayAttribute = attribute(config.attributes.delay);
  const dragAttribute = attribute(config.attributes.drag);
  const depthAttribute = attribute(config.attributes.depth);
  const tiltAttribute = attribute(config.attributes.tilt);
  const sideAttribute = attribute(config.attributes.side);
  const lineAttribute = attribute(config.attributes.line);
  const delayProperty = cssVar(flavor, config.delayProperty);
  const rootMargin = revealRootMargin(flavor);
  const specOf = (name: string) => personalityOf(config, name);
  const defaultDragSelector = `[${dragAttribute}]`;
  const selector = options.selector ?? `[${revealAttribute}]`;
  const groupSelector = options.groupSelector ?? `[${attribute(config.attributes.group)}]`;
  const dragSelector = options.dragSelector ?? defaultDragSelector;
  const revealedAttribute = options.revealedAttribute ?? attribute(config.attributes.revealed);
  const personalityFor = options.personalityOf ?? ((element: ScrollElement) => (element.hasAttribute(revealAttribute) ? parsePersonality(element.getAttribute(revealAttribute), flavor) : null));
  const delayOf = options.delayOf ?? ((element: ScrollElement) => parseDelay(element.getAttribute(delayAttribute), flavor));
  const accepts = options.accepts ?? (() => true);
  const report = options.report ?? ((error: unknown, context: string) => console.error(`${logTag(flavor)} ${context} failed; every element is shown instead.`, error));

  let armed = false;
  let seen = new WeakSet<ScrollElement>();
  let targets = new Map<ScrollElement, Target>();
  let waiting = new Set<Target>();
  let running = new Set<Target>();
  let drags = new Map<ScrollElement, Drag>();
  let groupCounts = new Map<ScrollElement | null, number>();
  let written = new WeakMap<ScrollElement, Record<string, string>>();
  let observer: ScrollObserver | undefined;
  let mutations: { disconnect(): void } | undefined;
  let unsubscribe: Array<() => void> = [];
  let velocity: ScrollVelocity | undefined;
  let safety: number | undefined;
  let delivered = false;
  let frame = 0;
  let last = 0;
  let paused = false;

  // ---- guard ----

  /** A callback that cannot leave the page half revealed: an exception stops the controller, which shows every element, and reports once. */
  function guard<Args extends unknown[]>(context: string, run: (...args: Args) => void): (...args: Args) => void {
    return (...args: Args) => {
      try { run(...args); } catch (error) {
        try { stop(); } catch (stopError) { report(stopError, `${context} (while stopping)`); }
        report(error, context);
      }
    };
  }

  // ---- writing ----

  /** Writes one inline property, or removes it with null. A value that is already there is not written again. */
  const put = (element: ScrollElement, property: string, value: string | null) => {
    const seenFor = written.get(element);
    if (value === null) {
      if (!seenFor || !(property in seenFor)) return;
      const { [property]: _removed, ...rest } = seenFor;
      void _removed;
      // The write comes first, so a write that throws leaves the record as it was and `stop` still finds the property to clear.
      env.setStyle(element, property, null);
      written.set(element, rest);
      return;
    }
    if (seenFor?.[property] === value) return;
    env.setStyle(element, property, value);
    written.set(element, { ...(seenFor ?? {}), [property]: value });
  };

  const clear = (element: ScrollElement) => {
    for (const property of ["translate", "scale", "rotate", "opacity", "clip-path", "will-change"]) put(element, property, null);
  };

  const writePose = (target: Target, run: Run, pose: RevealPose, atRest: boolean) => {
    const element = run.element;
    if (atRest) { clear(element); return; }
    if (run.role !== "clip") {
      put(element, "translate", `${number(pose.x, 2)}px ${number(pose.y, 2)}px`);
      if (specOf(target.personality).scaleRotate) {
        put(element, "scale", number(pose.scale, 4));
        put(element, "rotate", `${number(pose.rotate, 3)}deg`);
      }
      put(element, "opacity", number(pose.opacity, 3));
    }
    if (run.role !== "move") put(element, "clip-path", `inset(${number(pose.clipTop, 2)}% ${config.clipSide} 0 ${config.clipSide})`);
  };

  // ---- the frame loop ----

  const dragBusy = () => {
    for (const drag of drags.values()) if (drag.live) return true;
    return false;
  };
  const busy = () => running.size > 0 || Boolean(velocity?.active) || dragBusy();

  /** Start a chain from idle. The first step is measured from now. */
  function schedule() {
    if (frame || !armed || paused) return;
    last = env.now();
    frame = env.requestFrame(tick);
  }
  /** Ask for the next frame from inside a frame. `last` stays at the frame time `tick` took, so no time is lost between frames. */
  function continueChain() {
    if (frame || !armed || paused) return;
    frame = env.requestFrame(tick);
  }

  const stopFrame = () => {
    if (frame) { env.cancelFrame(frame); frame = 0; }
  };

  const eligible = (drag: Drag) => {
    const target = targets.get(drag.element);
    return !target || target.phase === "settled";
  };

  const clearDrag = (drag: Drag) => {
    drag.shift = createSpring(config.drag.spring, 0);
    drag.turn = createSpring(config.drag.spring, 0);
    drag.live = false;
    put(drag.element, "translate", null);
    put(drag.element, "rotate", null);
    put(drag.element, "will-change", null);
  };

  const stepDrags = (speed: number, dt: number) => {
    for (const drag of drags.values()) {
      if (!drag.inView || !eligible(drag)) {
        if (drag.live) clearDrag(drag);
        continue;
      }
      const goal = dragTarget(speed, drag.depth, flavor);
      if (!drag.live && goal.shift === 0 && goal.turn === 0) continue;
      drag.shift = stepSpring(drag.shift, goal.shift, dt);
      drag.turn = stepSpring(drag.turn, goal.turn, dt);
      if (goal.shift === 0 && goal.turn === 0 && drag.shift.value === 0 && drag.turn.value === 0) { clearDrag(drag); continue; }
      if (!drag.live) put(drag.element, "will-change", config.hints.drag);
      drag.live = true;
      put(drag.element, "translate", `0px ${number(drag.shift.value, 2)}px`);
      put(drag.element, "rotate", `${number(drag.turn.value, 3)}deg`);
    }
  };

  const stepTarget = (target: Target, dt: number) => {
    let allDone = true;
    for (const run of target.runs) {
      if (run.done) continue;
      if (run.wait > 0) {
        run.wait -= dt * 1000;
        allDone = false;
        continue;
      }
      run.spring = stepSpring(run.spring, 1, dt);
      const p = run.spring.value;
      const atRest = p === 1 && run.spring.velocity === 0;
      writePose(target, run, revealPose(run.start, p, flavor), atRest);
      if (atRest) run.done = true;
      else allDone = false;
    }
    if (allDone) {
      target.phase = "settled";
      running.delete(target);
    }
  };

  const tick = guard("the reveal frame", (time: number) => {
    frame = 0;
    if (!armed) return;
    const dt = Math.min(MAX_FRAME, Math.max(0, (time - last) / 1000));
    last = time;
    velocity?.sample(time);
    for (const target of [...running]) stepTarget(target, dt);
    stepDrags(velocity?.read() ?? 0, dt);
    if (busy()) continueChain();
  });

  // ---- reveal ----

  /** The spring a personality asks for: the speed-blended one, or the calm one. */
  const springFor = (kind: PersonalitySpec["spring"], speed: number): SpringConfig => {
    switch (kind) {
      case "speed": return revealSpring(speed, flavor);
      case "calm": return config.springs.calm;
      default: return assertNever(kind);
    }
  };

  const startOffsetFor = (personality: string) => revealStart({ personality, velocity: 0 }, flavor);

  /** Hidden: opacity 0 and the start offset of a slow scroll. A `mask` hides its box only, and its lines are placed when it starts. */
  const hide = (target: Target) => {
    const element = target.element;
    put(element, "opacity", "0");
    if (specOf(target.personality).hiddenTranslate) put(element, "translate", `0px ${number(startOffsetFor(target.personality).y, 2)}px`);
  };

  /** Shown at once, with no entry. */
  const showNow = (target: Target) => {
    waiting.delete(target);
    running.delete(target);
    for (const run of target.runs) clear(run.element);
    clear(target.element);
    target.runs = [];
    target.phase = "settled";
    env.setAttribute(target.element, revealedAttribute, "now");
    if (!drags.has(target.element)) observer?.unobserve(target.element);
  };

  const begin = (target: Target, batchIndex: number, inGroup: boolean) => {
    const element = target.element;
    const speed = velocity?.read() ?? 0;
    const spec = specOf(target.personality);
    const springConfig = springFor(spec.spring, speed);
    const delay = (inGroup ? staggerDelayFor(batchIndex, flavor) : 0) + delayOf(element);
    const makeSpring = () => retarget(createSpring(springConfig, 0), 1);
    const runs: Run[] = [];
    if (spec.clips) {
      const lines = element.querySelectorAll ? [...element.querySelectorAll(`[${lineAttribute}]`)] : [];
      if (lines.length > 0) {
        runs.push({ element, role: "clip", start: { x: 0, y: 0, scale: 1, rotate: 0 }, spring: makeSpring(), wait: delay, done: false });
        lines.forEach((line, index) => runs.push({
          element: line,
          role: "move",
          start: revealStart({ personality: target.personality, velocity: speed, height: line.getBoundingClientRect().height }, flavor),
          spring: makeSpring(),
          wait: delay + staggerDelayFor(index, flavor),
          done: false,
        }));
      } else {
        runs.push({ element, role: "both", start: revealStart({ personality: target.personality, velocity: speed, height: element.getBoundingClientRect().height }, flavor), spring: makeSpring(), wait: delay, done: false });
      }
    } else {
      runs.push({
        element,
        role: "move",
        start: revealStart({ personality: target.personality, velocity: speed, index: target.groupIndex, tilt: target.tilt, side: target.side }, flavor),
        spring: makeSpring(),
        wait: delay,
        done: false,
      });
    }
    target.runs = runs;
    target.phase = "running";
    waiting.delete(target);
    running.add(target);
    // The box was hidden while it waited. Now each piece takes its start pose in the same task, so nothing flashes.
    put(element, "opacity", null);
    for (const run of runs) {
      writePose(target, run, revealPose(run.start, 0, flavor), false);
      put(run.element, "will-change", run.role === "move" ? config.hints.move : run.role === "clip" ? config.hints.clip : `${config.hints.move}, ${config.hints.clip}`);
    }
    env.setAttribute(element, revealedAttribute, "true");
    put(element, delayProperty, `${delay}ms`);
    if (!drags.has(element)) observer?.unobserve(element);
    schedule();
  };

  /**
   * A waiting target can stay hidden for good: a target whose top sits in the lowest 8 percent of the viewport even at the end of the page never meets
   * the observer's margin. This says whether the target is in that place now, at the largest scroll the page has.
   */
  const cannotTrigger = (target: Target, height: number) => {
    const total = env.scrollHeight?.();
    if (total === undefined || !Number.isFinite(total)) return false;
    const room = Math.max(0, total - height - env.scrollY());
    return belowFold(target.element.getBoundingClientRect().top - room, height, flavor);
  };

  const armSafety = () => {
    if (safety !== undefined) return;
    safety = env.setTimeout(guard("the reveal safety timer", () => {
      safety = undefined;
      const height = env.viewportHeight();
      for (const target of [...waiting]) {
        if (target.element.isConnected === false) { waiting.delete(target); targets.delete(target.element); continue; }
        if (!delivered || !belowFold(target.element.getBoundingClientRect().top, height, flavor) || cannotTrigger(target, height)) showNow(target);
      }
    }), config.safetyMs);
  };

  const registerDrag = (element: ScrollElement) => {
    if (drags.has(element)) return;
    drags.set(element, { element, depth: parseDepth(element.getAttribute(depthAttribute), flavor), shift: createSpring(config.drag.spring, 0), turn: createSpring(config.drag.spring, 0), inView: false, live: false });
    observer?.observe(element);
  };

  const scan = (initial: boolean) => {
    const height = env.viewportHeight();
    let added = false;
    const list = selector === dragSelector ? selector : `${selector},${dragSelector}`;
    for (const element of root.querySelectorAll(list)) {
      if (seen.has(element)) continue;
      seen.add(element);
      if (element.hasAttribute(dragAttribute) || matchesDrag(element)) registerDrag(element);
      const personality = personalityFor(element);
      if (!personality || !accepts(element) || element.hasAttribute(revealedAttribute)) continue;
      if (initial && !belowFold(element.getBoundingClientRect().top, height, flavor)) {
        env.setAttribute(element, revealedAttribute, "now");
        continue;
      }
      const group = element.closest(groupSelector);
      const index = groupCounts.get(group) ?? 0;
      groupCounts.set(group, index + 1);
      const tilt = Number(element.getAttribute(tiltAttribute));
      const sideValue = element.getAttribute(sideAttribute);
      const side = sideValue === "left" ? -1 : sideValue === "right" ? 1 : undefined;
      const target: Target = { element, personality, groupIndex: index, tilt: Number.isFinite(tilt) && tilt > 0 ? tilt : undefined, side, phase: "waiting", runs: [] };
      targets.set(element, target);
      waiting.add(target);
      hide(target);
      observer?.observe(element);
      added = true;
    }
    if (added) armSafety();
  };

  /** A burst of DOM changes, such as a streamed section landing in pieces, costs one scan per frame. The frame runs before the next paint, so a new node is hidden before it shows. */
  let rescanFrame = 0;
  const rescan = () => {
    if (rescanFrame || !armed) return;
    rescanFrame = env.requestFrame(guard("the reveal rescan", () => {
      rescanFrame = 0;
      if (!armed) return;
      scan(false);
      // The page changed, so where its end is may have changed too: a layout that shrank leaves a last-8% target with no scroll or resize to wake it.
      revealAtEnd();
      if (waiting.size > 0) armSafety();
    }));
  };

  // A custom drag selector cannot be tested with hasAttribute, so ask the element's own `closest`, which also matches itself.
  const matchesDrag = (element: ScrollElement) => dragSelector !== defaultDragSelector && element.closest(dragSelector) === element;

  /** Start a batch of arriving targets. Members of one group that arrive together stagger in reading order: by row, then by column. */
  const startArrivals = (arriving: ReadonlyArray<{ target: ScrollElement; boundingClientRect: { readonly top: number; readonly left: number } }>) => {
    const groups = new Map<ScrollElement | null, typeof arriving[number][]>();
    for (const entry of arriving) {
      const key = entry.target.closest(groupSelector);
      groups.set(key, [...(groups.get(key) ?? []), entry]);
    }
    for (const [key, members] of groups) {
      members.sort((a, b) => Math.round(a.boundingClientRect.top / 8) - Math.round(b.boundingClientRect.top / 8) || a.boundingClientRect.left - b.boundingClientRect.left);
      members.forEach((entry, index) => begin(targets.get(entry.target)!, index, key !== null));
    }
  };

  const onEntries = guard("the reveal observer", (entries: ScrollEntry[]) => {
    delivered = true;
    const arriving: ScrollEntry[] = [];
    for (const entry of entries) {
      const drag = drags.get(entry.target);
      if (drag) {
        drag.inView = entry.isIntersecting;
      }
      const target = targets.get(entry.target);
      if (entry.isIntersecting && target && target.phase === "waiting") arriving.push(entry);
    }
    startArrivals(arriving);
  });

  /**
   * At the end of the page nothing can scroll further, so a waiting target in the last 8 percent of the viewport would never meet the observer's margin.
   * Once the scroll has reached the end, every waiting target that is on screen arrives. Runs on scroll and on resize or zoom, which change where the end is.
   */
  const revealAtEnd = guard("the reveal at the page end", () => {
    if (!armed || waiting.size === 0) return;
    const total = env.scrollHeight?.();
    if (total === undefined || !Number.isFinite(total)) return;
    const height = env.viewportHeight();
    if (env.scrollY() + height < total - 1) return;
    const arriving = [...waiting].filter(target => target.element.isConnected !== false).map(target => ({ target: target.element, boundingClientRect: target.element.getBoundingClientRect() })).filter(entry => entry.boundingClientRect.top < height && entry.boundingClientRect.top + (entry.target.getBoundingClientRect().height ?? 0) > 0);
    startArrivals(arriving);
  });
  const onResize = () => { revealAtEnd(); if (waiting.size > 0) armSafety(); };

  // ---- life ----

  /** One step of stopping. A step that throws is reported, and the steps after it still run, so one broken listener cannot leave the page hidden or the armed class on. */
  const release = (what: string, step: () => void) => {
    try { step(); } catch (error) { report(error, `the reveal stop (${what})`); }
  };

  const stop = () => {
    release("frames", () => { stopFrame(); if (rescanFrame) { env.cancelFrame(rescanFrame); rescanFrame = 0; } });
    release("safety timer", () => { if (safety !== undefined) env.clearTimeout(safety); });
    safety = undefined;
    release("observer", () => observer?.disconnect());
    release("mutation watch", () => mutations?.disconnect());
    observer = mutations = undefined;
    for (const off of unsubscribe) release("listener", off);
    unsubscribe = [];
    release("velocity", () => velocity?.destroy());
    velocity = undefined;
    // Leave every element visible and clear, so a stopped controller (or one that failed half way) hides nothing.
    for (const target of targets.values()) {
      for (const run of target.runs) release("clear", () => clear(run.element));
      release("clear", () => clear(target.element));
    }
    for (const drag of drags.values()) if (drag.live) release("drag", () => clearDrag(drag));
    targets = new Map();
    waiting = new Set();
    running = new Set();
    drags = new Map();
    groupCounts = new Map();
    seen = new WeakSet();
    written = new WeakMap();
    delivered = false;
    paused = false;
    const wasArmed = armed;
    armed = false;
    // Last, and not guarded: it is the one step whose error the caller reports as its own, and nothing is left to run after it.
    if (wasArmed) options.onDisarm?.();
  };

  const start = () => {
    if (armed) return true;
    const create = env.createIntersectionObserver;
    if (!create || prefersReducedMotion(env)) return false;
    armed = true;
    delivered = false;
    paused = env.tabHidden();
    velocity = createScrollVelocity(env, { onWake: schedule });
    observer = create(onEntries, rootMargin);
    // Decide every target before anything is hidden for good, so a target in view is never hidden for a frame.
    scan(true);
    options.onArm?.();
    mutations = env.watch?.(root, rescan);
    // Each subscription is kept as soon as it exists, so one that throws later in the list cannot leave an earlier one behind for `stop`.
    unsubscribe = [];
    const focus = env.onFocusIn?.(root, guard("the reveal focus handler", focused => {
      const found = focused?.closest(selector);
      const target = found ? targets.get(found) : undefined;
      // A person who tabs to a field below the fold must see where focus is, so a waiting target that gains focus shows at once.
      if (target && target.phase === "waiting") showNow(target);
    }));
    if (focus) unsubscribe.push(focus);
    unsubscribe.push(env.onScroll(revealAtEnd));
    if (env.onResize) unsubscribe.push(env.onResize(onResize));
    unsubscribe.push(env.onVisibilityChange(guard("the reveal visibility handler", hidden => {
      paused = hidden;
      if (hidden) stopFrame();
      else if (busy()) schedule();
    })));
    // Turning reduced motion ON stops everything. Turning it off again does not re-arm: what the reader already sees stays visible.
    if (env.onReducedMotionChange) unsubscribe.push(env.onReducedMotionChange(reduced => { if (reduced) stop(); }));
    armSafety();
    return true;
  };

  return {
    start,
    stop,
    get armed() { return armed; },
    velocity: () => velocity?.read() ?? 0,
    phase(element) {
      const target = targets.get(element);
      return target ? target.phase : "none";
    },
    pose(element) {
      const target = targets.get(element);
      if (!target || target.phase === "settled" || target.runs.length === 0) return { ...REST_POSE };
      const run = target.runs.find(item => item.role !== "clip") ?? target.runs[0];
      if (run.wait > 0) return revealPose(run.start, 0, flavor);
      return revealPose(run.start, run.spring.value, flavor);
    },
  };
}

export interface GuardedStartOptions {
  /** Where it failed, for the log line. */
  context?: string;
  /** Its label starts the default log line. Default: the glass flavor. */
  flavor?: Flavor;
  /** Called with the error. Default: `console.error`. */
  report?(error: unknown, context: string): void;
}

/**
 * Makes and starts a controller, and never throws. If making it or starting it throws (matchMedia missing, an old Safari without
 * `addEventListener` on a media query list, a MutationObserver that cannot be made), it stops the controller, so every element is
 * visible and any armed marker is removed, and it logs the error with its context. It returns the controller, or null when it
 * could not even be made.
 */
export function startScrollReveal(create: () => ScrollRevealController, options: GuardedStartOptions = {}): ScrollRevealController | null {
  const context = options.context ?? "scroll reveal";
  const report = options.report ?? ((error: unknown, where: string) => console.error(`${logTag(options.flavor ?? glassFlavor)} ${where} failed to start; every element is shown instead.`, error));
  let controller: ScrollRevealController | undefined;
  try {
    controller = create();
    controller.start();
    return controller;
  } catch (error) {
    try { controller?.stop(); } catch (stopError) { report(stopError, `${context} (while stopping)`); }
    report(error, context);
    return controller ?? null;
  }
}

