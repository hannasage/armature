import { afterEach, describe, expect, it, vi } from "vitest";
import { createScrollReveal, startScrollReveal, type ScrollRevealOptions } from "../src/core/scroll-reveal";
import type { ScrollElement } from "../src/engine/scroll-env";
import { FakeElement, FakeRoot, FakeScrollEnv } from "./helpers/fake-scroll-env";

/*
 * createScrollReveal (GI-70) on an injected environment, with no DOM and no clock but the fake one.
 */
afterEach(() => vi.restoreAllMocks());

const ALLOWED = new Set(["translate", "scale", "rotate", "opacity", "clip-path", "will-change", "--lqg-reveal-delay"]);

function setup(extra: Partial<ScrollRevealOptions> = {}, env = new FakeScrollEnv()) {
  const root = new FakeRoot();
  const make = (attrs: Record<string, string> = { "data-lqg-reveal": "drop" }, top = 1600, parent?: FakeElement) => {
    const element = new FakeElement(attrs, { top, left: 0, width: 300, height: 200 }, parent);
    root.members.push(element);
    return element;
  };
  const controller = createScrollReveal({ env, root, ...extra });
  return { env, root, make, controller };
}

/** Scrolls at `speed` px per second for `frames` frames. */
function scrollAt(env: FakeScrollEnv, speed: number, frames: number) {
  for (let i = 0; i < frames; i++) {
    env.scrollTo(env.y + (speed / 60));
    env.tick();
  }
}
const pair = (value: string | undefined) => (value ?? "0px 0px").split(" ").map(part => Number.parseFloat(part));
const number = (value: string | undefined) => Number.parseFloat(value ?? "NaN");
const left = (env: FakeScrollEnv, element: ScrollElement) => Object.keys(env.styles.get(element) ?? {}).filter(key => key !== "--lqg-reveal-delay");

/** Runs one reveal from the moment it enters to rest. Returns the y track as a share of the start offset. */
function track(env: FakeScrollEnv, controller: ReturnType<typeof createScrollReveal>, element: ScrollElement) {
  const startY = pair(env.style(element, "translate"))[1];
  const shares: number[] = [];
  while (env.pending > 0 && shares.length < 600) {
    env.tick();
    shares.push(pair(env.style(element, "translate"))[1] / startY);
  }
  void controller;
  return { startY, shares };
}

describe("arming", () => {
  it("hides nothing until it has armed", () => {
    const { env, make } = setup();
    make({ "data-lqg-reveal": "drop" }, 1600);
    expect(env.styleWrites).toEqual([]);
    expect(env.attrs.size).toBe(0);
    expect(env.observerCreated).toBe(0);
    expect(env.scrollListeners.size).toBe(0);
  });

  it("a target in view at arming shows at once with no entry, and is never hidden", () => {
    const { env, make, controller } = setup();
    const inView = make({ "data-lqg-reveal": "drop" }, 100);
    const above = make({ "data-lqg-reveal": "fade" }, -300);
    expect(controller.start()).toBe(true);
    expect(env.attr(inView, "data-lqg-revealed")).toBe("now");
    expect(env.attr(above, "data-lqg-revealed")).toBe("now");
    expect(env.styleWrites).toEqual([]);
    expect(env.observed.has(inView)).toBe(false);
    expect(controller.phase(inView)).toBe("none");
    expect(env.pending).toBe(0);
  });

  it("a target whose top is in the lowest 8 percent still waits: 828 of 900 is below the fold", () => {
    const { env, make, controller } = setup();
    const edge = make({ "data-lqg-reveal": "drop" }, 828);
    const just = make({ "data-lqg-reveal": "drop" }, 827);
    controller.start();
    expect(controller.phase(edge)).toBe("waiting");
    expect(env.attr(just, "data-lqg-revealed")).toBe("now");
  });

  it("a target below the fold is hidden with opacity 0 and its start offset, and is observed with the fold margin", () => {
    const { env, make, controller } = setup();
    const card = make({ "data-lqg-reveal": "drop" });
    controller.start();
    expect(env.style(card, "opacity")).toBe("0");
    expect(pair(env.style(card, "translate"))).toEqual([0, 28]);
    expect(env.observed.has(card)).toBe(true);
    expect(env.rootMargin).toBe("0px 0px -8% 0px");
    expect(env.observerCreated).toBe(1);
    expect(controller.phase(card)).toBe("waiting");
  });

  it("an element that already has the revealed attribute is left alone", () => {
    const { env, make, controller } = setup();
    const held = make({ "data-lqg-reveal": "drop", "data-lqg-revealed": "now" });
    controller.start();
    expect(env.styles.get(held)).toBeUndefined();
    expect(controller.phase(held)).toBe("none");
  });

  it("an element the site says should not spring is left as it is", () => {
    const { env, make, controller } = setup({ accepts: element => element.getAttribute("data-skip") === null });
    const skipped = make({ "data-lqg-reveal": "drop", "data-skip": "" });
    controller.start();
    expect(env.styles.get(skipped)).toBeUndefined();
    expect(controller.phase(skipped)).toBe("none");
  });

  it("calls onArm after arming and onDisarm on stop, once each", () => {
    const calls: string[] = [];
    const { controller } = setup({ onArm: () => calls.push("arm"), onDisarm: () => calls.push("disarm") });
    controller.start();
    controller.start();
    controller.stop();
    controller.stop();
    expect(calls).toEqual(["arm", "disarm"]);
  });
});

describe("reduced motion, and no observer", () => {
  it("arms nothing and writes nothing under reduced motion", () => {
    const env = new FakeScrollEnv();
    env.reduced = true;
    const { make, controller } = setup({}, env);
    const card = make();
    expect(controller.start()).toBe(false);
    expect(controller.armed).toBe(false);
    expect(env.styleWrites).toEqual([]);
    expect(env.attrs.size).toBe(0);
    expect(env.observerCreated).toBe(0);
    expect(env.scrollListeners.size).toBe(0);
    expect(env.visibilityListeners.size).toBe(0);
    expect(env.pending).toBe(0);
    expect(env.timers.size).toBe(0);
    void card;
  });

  it("arms nothing in a browser with no IntersectionObserver", () => {
    const env = new FakeScrollEnv().withoutObserver();
    const { make, controller } = setup({}, env);
    make();
    expect(controller.start()).toBe(false);
    expect(env.styleWrites).toEqual([]);
  });

  it("turning reduced motion on stops the controller and shows everything, and turning it off does not re-arm", () => {
    const calls: string[] = [];
    const { env, make, controller } = setup({ onDisarm: () => calls.push("disarm") });
    const card = make();
    controller.start();
    expect(env.style(card, "opacity")).toBe("0");
    env.setReduced(true);
    expect(controller.armed).toBe(false);
    expect(left(env, card)).toEqual([]);
    expect(calls).toEqual(["disarm"]);
    env.setReduced(false);
    expect(controller.armed).toBe(false);
    expect(left(env, card)).toEqual([]);
    expect(env.observerCreated).toBe(1);
  });
});

describe("the entry", () => {
  it("springs a target in when it enters, writes only the individual properties, and ends with every one cleared", () => {
    const { env, make, controller } = setup();
    const card = make();
    controller.start();
    env.enter({ target: card });
    expect(controller.phase(card)).toBe("running");
    expect(env.attr(card, "data-lqg-revealed")).toBe("true");
    expect(env.pending).toBe(1);
    env.settle();
    expect(controller.phase(card)).toBe("settled");
    expect(left(env, card)).toEqual([]);
    expect(env.pending).toBe(0);
    expect(controller.pose(card)).toEqual({ x: 0, y: 0, scale: 1, rotate: 0, opacity: 1, clipTop: 0 });
    for (const write of env.styleWrites) expect(ALLOWED.has(write.property), write.property).toBe(true);
    expect(env.styleWrites.some(write => write.property === "transform")).toBe(false);
  });

  it("ends at exactly translate 0, scale 1, rotate 0, opacity 1 on the last frame before the style is cleared", () => {
    const { env, make, controller } = setup();
    const card = make();
    controller.start();
    env.enter({ target: card });
    let lastPose = controller.pose(card);
    while (env.pending > 0) {
      env.tick();
      if (controller.phase(card) === "running") lastPose = controller.pose(card);
    }
    expect(Math.abs(lastPose.y)).toBeLessThan(0.5);
    expect(controller.pose(card)).toEqual({ x: 0, y: 0, scale: 1, rotate: 0, opacity: 1, clipTop: 0 });
  });

  it("starts about 28 px away in a slow scroll and farther in a fast one, capped at 110", () => {
    const starts: number[] = [];
    for (const speed of [0, 200, 1500, 4000, 40_000]) {
      const { env, make, controller } = setup();
      const card = make();
      controller.start();
      scrollAt(env, speed, 25);
      env.enter({ target: card });
      starts.push(pair(env.style(card, "translate"))[1]);
    }
    expect(starts[0]).toBe(28);
    expect(starts[1]).toBe(28);
    expect(starts[2]).toBeGreaterThan(40);
    expect(starts[2]).toBeLessThan(105);
    expect(starts[3]).toBeGreaterThan(105);
    expect(starts[3]).toBeLessThanOrEqual(110);
    expect(starts[4]).toBe(110);
  });

  it("starts from above when the page scrolls up", () => {
    const { env, make, controller } = setup();
    env.y = 5000;
    const card = make();
    controller.start();
    scrollAt(env, -1500, 25);
    env.enter({ target: card });
    expect(pair(env.style(card, "translate"))[1]).toBeLessThan(-40);
    expect(number(env.style(card, "rotate"))).toBeLessThan(0);
  });

  it("overshoots under 4 percent in a slow scroll, and about 12 percent in a fast one", () => {
    const run = (speed: number) => {
      const { env, make, controller } = setup();
      const card = make();
      controller.start();
      scrollAt(env, speed, 25);
      env.enter({ target: card });
      const { shares } = track(env, controller, card);
      return -Math.min(...shares);
    };
    const slow = run(150);
    const fast = run(4500);
    expect(slow).toBeGreaterThan(0.02);
    expect(slow).toBeLessThan(0.04);
    expect(fast).toBeGreaterThan(0.1);
    expect(fast).toBeLessThan(0.14);
    expect(fast).toBeGreaterThan(slow);
  });

  it("a drop scales from 0.94 and tilts, and the tilt sign follows the scroll direction", () => {
    const tiltAt = (speed: number, attrs: Record<string, string> = {}) => {
      const { env, make, controller } = setup();
      env.y = 5000;
      const card = make({ "data-lqg-reveal": "drop", ...attrs });
      controller.start();
      scrollAt(env, speed, 25);
      env.enter({ target: card });
      return { rotate: number(env.style(card, "rotate")), scale: number(env.style(card, "scale")) };
    };
    const down = tiltAt(4500);
    const up = tiltAt(-4500);
    expect(down.scale).toBeCloseTo(0.94, 3);
    expect(down.rotate).toBeGreaterThan(1.2);
    expect(down.rotate).toBeLessThanOrEqual(1.5);
    expect(up.rotate).toBeCloseTo(-down.rotate, 3);
    expect(tiltAt(4500, { "data-lqg-tilt": "2.2" }).rotate).toBeCloseTo(2.2, 2);
  });

  it("an unknown personality falls back to drop", () => {
    const { env, make, controller } = setup();
    const card = make({ "data-lqg-reveal": "spin" });
    controller.start();
    env.enter({ target: card });
    expect(env.style(card, "scale")).toBe("0.94");
  });

  it("slide starts on alternating sides by index within the group, and settles", () => {
    const { env, root, make, controller } = setup();
    const group = new FakeElement({ "data-lqg-reveal-group": "" });
    root.members.push(group);
    const cards = [0, 1, 2].map(index => make({ "data-lqg-reveal": "slide" }, 1600 + index * 300, group));
    controller.start();
    env.enter(...cards.map(target => ({ target })));
    const sides = cards.map(card => Math.sign(pair(env.style(card, "translate"))[0]));
    expect(sides).toEqual([-1, 1, -1]);
    expect(env.style(cards[0], "scale")).toBeUndefined();
    env.settle();
    for (const card of cards) expect(left(env, card)).toEqual([]);
  });

  it("data-lqg-side sends a slide in from the named side, whatever its index", () => {
    const { env, root, make, controller } = setup();
    const group = new FakeElement({ "data-lqg-reveal-group": "" });
    root.members.push(group);
    const cards = [["left", 1600], ["left", 1900], ["right", 1900], ["sideways", 2200]].map(([side, top], index) => make({ "data-lqg-reveal": "slide", "data-lqg-side": String(side) }, Number(top) + index, group));
    controller.start();
    env.enter(...cards.map(target => ({ target })));
    // The last one has no valid side, so it alternates by its index (3 is odd: from the right).
    expect(cards.map(card => Math.sign(pair(env.style(card, "translate"))[0]))).toEqual([-1, -1, 1, 1]);
  });

  it("fade rises 12 px and its spring does not overshoot", () => {
    const { env, make, controller } = setup();
    const field = make({ "data-lqg-reveal": "fade" });
    controller.start();
    scrollAt(env, 4500, 25);
    env.enter({ target: field });
    expect(pair(env.style(field, "translate"))[1]).toBe(12);
    expect(env.style(field, "scale")).toBeUndefined();
    const { shares } = track(env, controller, field);
    expect(Math.min(...shares)).toBeGreaterThanOrEqual(-0.0001);
  });

  it("mask opens the clip with the spring, line by line, and ends with no clip", () => {
    const { env, make, controller } = setup();
    const heading = make({ "data-lqg-reveal": "mask" });
    const lines = [0, 1].map(() => new FakeElement({ "data-lqg-line": "" }, { top: 1600, left: 0, width: 300, height: 40 }, heading));
    controller.start();
    expect(env.style(heading, "opacity")).toBe("0");
    env.enter({ target: heading });
    expect(env.style(heading, "opacity")).toBeUndefined();
    expect(env.style(heading, "clip-path")).toMatch(/^inset\(100% -8px 0 -8px\)$/);
    for (const line of lines) {
      expect(env.style(line, "opacity")).toBe("0");
      expect(pair(env.style(line, "translate"))[1]).toBeGreaterThan(20);
    }
    // The first line starts moving first. The second waits 60 ms.
    for (let i = 0; i < 3; i++) env.tick();
    const first = pair(env.style(lines[0], "translate"))[1];
    const second = pair(env.style(lines[1], "translate"))[1];
    expect(first).toBeLessThan(second);
    expect(number(env.style(heading, "clip-path")?.match(/inset\(([-\d.]+)%/)?.[1])).toBeLessThan(100);
    env.settle();
    expect(env.style(heading, "clip-path")).toBeUndefined();
    expect(left(env, heading)).toEqual([]);
    for (const line of lines) expect(left(env, line)).toEqual([]);
    expect(controller.phase(heading)).toBe("settled");
  });

  it("a mask with no lines clips and rises as one piece", () => {
    const { env, make, controller } = setup();
    const heading = make({ "data-lqg-reveal": "mask" });
    controller.start();
    env.enter({ target: heading });
    expect(env.style(heading, "clip-path")).toBeDefined();
    expect(env.style(heading, "translate")).toBeDefined();
    env.settle();
    expect(left(env, heading)).toEqual([]);
  });

  it("a target reveals once", () => {
    const { env, make, controller } = setup();
    const card = make();
    controller.start();
    env.enter({ target: card });
    env.settle();
    const writes = env.styleWrites.length;
    env.enter({ target: card });
    env.enter({ target: card, isIntersecting: false });
    env.enter({ target: card });
    expect(env.styleWrites.length).toBe(writes);
    expect(env.pending).toBe(0);
    expect(env.observed.has(card)).toBe(false);
  });

  it("a target that has not entered is not revealed by an entry that says it is outside", () => {
    const { env, make, controller } = setup();
    const card = make();
    controller.start();
    env.enter({ target: card, isIntersecting: false });
    expect(controller.phase(card)).toBe("waiting");
    expect(env.style(card, "opacity")).toBe("0");
  });
});

describe("stagger", () => {
  function group(count: number, tops?: number[]) {
    const t = setup();
    const parent = new FakeElement({ "data-lqg-reveal-group": "" });
    t.root.members.push(parent);
    const cards = Array.from({ length: count }, (_, index) => t.make({ "data-lqg-reveal": "drop" }, tops?.[index] ?? 1600 + index * 20, parent));
    t.controller.start();
    return { ...t, cards };
  }
  const delays = (env: FakeScrollEnv, cards: FakeElement[]) => cards.map(card => env.style(card, "--lqg-reveal-delay"));

  it("members that arrive together start 60 ms apart in reading order", () => {
    // The DOM order is 0, 1, 2 but the tops put 2 first and 0 last.
    const { env, cards } = group(3, [2400, 2000, 1600]);
    env.enter(...cards.map(target => ({ target })));
    expect(delays(env, cards)).toEqual(["120ms", "60ms", "0ms"]);
  });

  it("is capped at 6 steps", () => {
    const { env, cards } = group(9);
    env.enter(...cards.map(target => ({ target })));
    expect(delays(env, cards)).toEqual(["0ms", "60ms", "120ms", "180ms", "240ms", "300ms", "360ms", "360ms", "360ms"]);
  });

  it("an explicit delay adds to the stagger, and an element outside a group gets only its own delay", () => {
    const t = setup();
    const parent = new FakeElement({ "data-lqg-reveal-group": "" });
    t.root.members.push(parent);
    const a = t.make({ "data-lqg-reveal": "drop" }, 1600, parent);
    const b = t.make({ "data-lqg-reveal": "drop", "data-lqg-reveal-delay": "100" }, 1700, parent);
    const alone = t.make({ "data-lqg-reveal": "drop", "data-lqg-reveal-delay": "40" }, 2400);
    const alone2 = t.make({ "data-lqg-reveal": "drop" }, 2500);
    t.controller.start();
    t.env.enter({ target: a }, { target: b }, { target: alone }, { target: alone2 });
    expect([a, b, alone, alone2].map(card => t.env.style(card, "--lqg-reveal-delay"))).toEqual(["0ms", "160ms", "40ms", "0ms"]);
  });

  it("an element waits out its delay before it moves", () => {
    const { env, cards } = group(2);
    env.enter(...cards.map(target => ({ target })));
    const before = env.style(cards[1], "translate");
    env.tick(16);
    env.tick(16);
    expect(env.style(cards[1], "translate")).toBe(before);
    expect(env.style(cards[0], "translate")).not.toBe(before);
    for (let i = 0; i < 6; i++) env.tick(16);
    expect(env.style(cards[1], "translate")).not.toBe(before);
  });
});

describe("targets in the last 8 percent of the page", () => {
  // The viewport is 900 px tall, so the fold is at 828. A target at top 880 is below it, and it never meets the observer's margin
  // unless the page can scroll until the target is above the fold.
  it("arrives when the scroll reaches the end of the page, and not before", () => {
    const { env, make, controller } = setup();
    env.docHeight = 1000;
    const cta = make({ "data-lqg-reveal": "fade" }, 880);
    controller.start();
    expect(controller.phase(cta)).toBe("waiting");
    env.scrollTo(50);
    expect(controller.phase(cta)).toBe("waiting");
    env.scrollTo(100);
    expect(controller.phase(cta)).toBe("running");
    env.settle();
    expect(left(env, cta)).toEqual([]);
  });

  it("arrives on a resize or zoom that leaves the page with nowhere to scroll", () => {
    const { env, make, controller } = setup();
    env.docHeight = 2400;
    const cta = make({ "data-lqg-reveal": "fade" }, 880);
    controller.start();
    env.resize();
    expect(controller.phase(cta)).toBe("waiting");
    env.docHeight = 900;
    env.resize();
    expect(controller.phase(cta)).toBe("running");
  });

  it("is shown by the safety timer when it can never meet the margin", () => {
    const { env, make, controller } = setup();
    env.docHeight = 900;
    const stuck = make({ "data-lqg-reveal": "fade" }, 880);
    controller.start();
    env.enter({ target: stuck, isIntersecting: false });
    env.advance(2600);
    expect(left(env, stuck)).toEqual([]);
    expect(controller.phase(stuck)).toBe("settled");
  });

  it("keeps a target below the fold hidden when the page is long enough to scroll it clear", () => {
    const { env, make, controller } = setup();
    env.docHeight = 3000;
    const below = make({ "data-lqg-reveal": "fade" }, 880);
    controller.start();
    env.enter({ target: make({ "data-lqg-reveal": "fade" }, 5000), isIntersecting: false });
    env.advance(2600);
    expect(controller.phase(below)).toBe("waiting");
  });

  it("arrives when the layout shrinks after the first safety pass, with no resize, once the page changes", () => {
    const { env, make, controller } = setup();
    env.docHeight = 2400;
    const cta = make({ "data-lqg-reveal": "fade" }, 880);
    controller.start();
    env.enter({ target: cta, isIntersecting: false });
    env.advance(2600);
    expect(controller.phase(cta)).toBe("waiting");
    // An accordion closes, or content settles: the page is now short, and no scroll or resize event comes.
    env.docHeight = 900;
    env.mutate();
    env.tick();
    expect(controller.phase(cta)).toBe("running");
  });

  it("arms the safety timer again for a target still waiting after a rescan, and not when nothing waits", () => {
    const { env, make, controller } = setup();
    env.docHeight = 2400;
    const cta = make({ "data-lqg-reveal": "fade" }, 880);
    controller.start();
    env.enter({ target: cta, isIntersecting: false });
    env.advance(2600);
    expect(env.timers.size).toBe(0);
    env.mutate();
    env.tick();
    expect(env.timers.size).toBe(1);
    const quiet = setup();
    quiet.env.docHeight = 2400;
    quiet.controller.start();
    quiet.env.advance(2600);
    quiet.env.mutate();
    quiet.env.tick();
    expect(quiet.env.timers.size).toBe(0);
  });

  it("leaves a waiting target that is entirely above the viewport alone when the page end is reached", () => {
    const { env, make, controller } = setup();
    env.docHeight = 900;
    controller.start();
    // Added later, as a streamed section is, and parked above the viewport.
    const above = make({ "data-lqg-reveal": "fade" }, -1500);
    env.mutate();
    env.tick();
    expect(controller.phase(above)).toBe("waiting");
    env.scrollTo(0);
    expect(controller.phase(above)).toBe("waiting");
  });

  it("does nothing at the end of the page when the environment cannot report the page height", () => {
    const { env, make, controller } = setup();
    const cta = make({ "data-lqg-reveal": "fade" }, 880);
    controller.start();
    env.scrollTo(100000);
    expect(controller.phase(cta)).toBe("waiting");
  });

  it("stops listening for scroll and resize when it stops", () => {
    const { env, controller } = setup();
    controller.start();
    expect(env.resizeListeners.size).toBe(1);
    controller.stop();
    expect(env.resizeListeners.size).toBe(0);
    expect(env.scrollListeners.size).toBe(0);
  });
});

describe("stopping with a broken listener", () => {
  it("still clears every target, disarms, and reports each broken step, when an unsubscribe throws", () => {
    const reports: Array<[unknown, string]> = [];
    const env = new FakeScrollEnv();
    env.onVisibilityChange = () => () => { throw new Error("remove failed"); };
    const calls: string[] = [];
    const { make, controller } = setup({ report: (error, context) => reports.push([error, context]), onArm: () => calls.push("arm"), onDisarm: () => calls.push("disarm") }, env);
    const a = make({ "data-lqg-reveal": "drop" }, 1600);
    const b = make({ "data-lqg-reveal": "fade" }, 2400);
    controller.start();
    expect(env.style(a, "opacity")).toBe("0");
    expect(() => controller.stop()).not.toThrow();
    expect(left(env, a)).toEqual([]);
    expect(left(env, b)).toEqual([]);
    expect(controller.armed).toBe(false);
    expect(calls).toEqual(["arm", "disarm"]);
    expect(reports).toHaveLength(1);
    expect(reports[0][1]).toBe("the reveal stop (listener)");
    // The listeners after the broken one were still removed.
    expect(env.scrollListeners.size).toBe(0);
    expect(env.resizeListeners.size).toBe(0);
  });

  it("still disarms when the observer cannot disconnect", () => {
    const reports: string[] = [];
    const env = new FakeScrollEnv();
    const make = env.createIntersectionObserver!;
    env.createIntersectionObserver = (deliver, margin) => { const observer = make(deliver, margin); return { ...observer, disconnect: () => { throw new Error("disconnect failed"); } }; };
    const calls: string[] = [];
    const { controller } = setup({ report: (_error, context) => reports.push(context), onDisarm: () => calls.push("disarm") }, env);
    controller.start();
    controller.stop();
    expect(controller.armed).toBe(false);
    expect(calls).toEqual(["disarm"]);
    expect(reports).toEqual(["the reveal stop (observer)"]);
  });
});

describe("a throw inside the controller", () => {
  /** Makes the first style write after `arm()` throw, as a failing DOM write would, and leaves later writes alone so the clean-up can run. */
  function failing() {
    const reports: Array<[unknown, string]> = [];
    const { env, make, controller } = setup({ report: (error, context) => reports.push([error, context]) });
    const write = env.setStyle;
    let armed = false;
    env.setStyle = (target, property, value) => {
      if (armed) { armed = false; throw new Error("style write failed"); }
      write(target, property, value);
    };
    return { env, make, controller, reports, arm: () => { armed = true; } };
  }

  it("stops, shows every target, and reports once when an observer batch throws", () => {
    const { env, make, controller, reports, arm } = failing();
    const a = make({ "data-lqg-reveal": "drop" }, 1600);
    const b = make({ "data-lqg-reveal": "fade" }, 2400);
    controller.start();
    expect(env.style(a, "opacity")).toBe("0");
    arm();
    env.enter({ target: a });
    expect(reports).toHaveLength(1);
    expect(reports[0][1]).toBe("the reveal observer");
    expect(controller.armed).toBe(false);
    expect(left(env, a)).toEqual([]);
    expect(left(env, b)).toEqual([]);
  });

  it("stops, shows every target, and reports once when a frame throws, so no target stays half revealed", () => {
    const { env, make, controller, reports, arm } = failing();
    const a = make({ "data-lqg-reveal": "drop" }, 1600);
    const b = make({ "data-lqg-reveal": "fade" }, 2400);
    controller.start();
    env.enter({ target: a });
    expect(controller.phase(a)).toBe("running");
    arm();
    env.tick();
    expect(reports).toHaveLength(1);
    expect(reports[0][1]).toBe("the reveal frame");
    expect(controller.armed).toBe(false);
    expect(left(env, a)).toEqual([]);
    expect(left(env, b)).toEqual([]);
    expect(env.pending).toBe(0);
  });

  it("logs to the console by default, naming where it failed", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { env, make, controller } = setup();
    const a = make({ "data-lqg-reveal": "drop" }, 1600);
    controller.start();
    const write = env.setStyle;
    let armed = true;
    env.setStyle = (target, property, value) => { if (armed) { armed = false; throw new Error("style write failed"); } write(target, property, value); };
    env.enter({ target: a });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain("the reveal observer");
  });
});

describe("frame timing", () => {
  it("measures each step from the previous frame time, even when now() runs ahead of the frame clock", () => {
    const run = (lag: number) => {
      const { env, make, controller } = setup();
      const card = make({ "data-lqg-reveal": "drop" }, 1600);
      controller.start();
      env.enter({ target: card });
      env.tick();
      env.lag = lag;
      for (let i = 0; i < 8; i++) env.tick();
      return controller.pose(card);
    };
    const exact = run(0);
    const late = run(9);
    expect(late.y).toBeCloseTo(exact.y, 6);
    expect(late.scale).toBeCloseTo(exact.scale, 6);
  });
});

describe("late arrivals, focus, and the safety timer", () => {
  it("picks up a node added later, born hidden, and reveals it when it lands", () => {
    const { env, make, controller } = setup();
    controller.start();
    const late = make({ "data-lqg-reveal": "slide" });
    expect(env.style(late, "opacity")).toBeUndefined();
    env.mutate();
    env.tick();
    expect(env.style(late, "opacity")).toBe("0");
    expect(env.observed.has(late)).toBe(true);
    env.enter({ target: late });
    expect(controller.phase(late)).toBe("running");
    env.settle();
    expect(left(env, late)).toEqual([]);
  });

  it("coalesces a burst of DOM changes into one scan per frame", () => {
    const { env, root, make, controller } = setup();
    controller.start();
    const scans = vi.spyOn(root, "querySelectorAll");
    const late = make({ "data-lqg-reveal": "slide" });
    for (let i = 0; i < 25; i++) env.mutate();
    expect(scans).not.toHaveBeenCalled();
    expect(env.pending).toBe(1);
    env.tick();
    expect(scans).toHaveBeenCalledTimes(1);
    expect(env.style(late, "opacity")).toBe("0");
    // The next burst costs one more scan, not a backlog.
    for (let i = 0; i < 25; i++) env.mutate();
    env.tick();
    expect(scans).toHaveBeenCalledTimes(2);
  });

  it("cancels a pending scan when it stops, and scans nothing after", () => {
    const { env, root, make, controller } = setup();
    controller.start();
    make({ "data-lqg-reveal": "slide" });
    env.mutate();
    const scans = vi.spyOn(root, "querySelectorAll");
    controller.stop();
    env.tick();
    expect(scans).not.toHaveBeenCalled();
  });

  it("does not hide a node it has already decided when the mutation observer fires again", () => {
    const { env, make, controller } = setup();
    const card = make();
    controller.start();
    env.enter({ target: card });
    env.settle();
    env.mutate();
    env.mutate();
    env.tick();
    expect(left(env, card)).toEqual([]);
    expect(controller.phase(card)).toBe("settled");
  });

  it("keyboard focus on a waiting target shows it at once, with no spring", () => {
    const { env, make, controller } = setup();
    const field = make({ "data-lqg-reveal": "fade" });
    const input = new FakeElement({}, undefined, field);
    controller.start();
    env.focus(input);
    expect(env.attr(field, "data-lqg-revealed")).toBe("now");
    expect(left(env, field)).toEqual([]);
    expect(env.pending).toBe(0);
    expect(controller.phase(field)).toBe("settled");
  });

  it("a focus that is not a keyboard focus (null) shows nothing", () => {
    const { env, make, controller } = setup();
    const field = make({ "data-lqg-reveal": "fade" });
    controller.start();
    env.focus(null);
    expect(controller.phase(field)).toBe("waiting");
  });

  it("the safety timer shows a target that is in view but still hidden, 2.5 s after arming, and leaves one far below", () => {
    const { env, make, controller } = setup();
    const near = make({ "data-lqg-reveal": "drop" }, 1600);
    const far = make({ "data-lqg-reveal": "drop" }, 5000);
    controller.start();
    env.enter({ target: far, isIntersecting: false }); // the observer answered, so it is alive
    near.rect = { ...near.rect, top: 300 }; // it scrolled into view and the observer has not said so
    env.advance(2499);
    expect(controller.phase(near)).toBe("waiting");
    env.advance(2);
    expect(controller.phase(near)).toBe("settled");
    expect(left(env, near)).toEqual([]);
    expect(controller.phase(far)).toBe("waiting");
    expect(env.style(far, "opacity")).toBe("0");
  });

  it("if the observer never answered, the safety timer shows every hidden target", () => {
    const { env, make, controller } = setup();
    const cards = [make({ "data-lqg-reveal": "drop" }, 1600), make({ "data-lqg-reveal": "drop" }, 9000)];
    controller.start();
    env.advance(2600);
    for (const card of cards) expect(left(env, card)).toEqual([]);
  });

  it("a node added later arms the safety timer again", () => {
    const { env, make, controller } = setup();
    controller.start();
    env.advance(2600);
    const late = make();
    env.mutate();
    env.tick();
    expect(env.timers.size).toBe(1);
    env.advance(2600);
    expect(left(env, late)).toEqual([]);
  });
});

describe("the frame loop", () => {
  it("pauses on a hidden tab and resumes on a visible one", () => {
    const { env, make, controller } = setup();
    const card = make();
    controller.start();
    env.enter({ target: card });
    expect(env.pending).toBe(1);
    env.setHidden(true);
    expect(env.pending).toBe(0);
    env.setHidden(false);
    expect(env.pending).toBe(1);
    env.settle();
    expect(controller.phase(card)).toBe("settled");
  });

  it("starts paused when the tab is already hidden", () => {
    const env = new FakeScrollEnv();
    env.hidden = true;
    const { make, controller } = setup({}, env);
    const card = make();
    controller.start();
    env.enter({ target: card });
    expect(env.pending).toBe(0);
    env.setHidden(false);
    expect(env.pending).toBe(1);
  });

  it("runs one frame while anything moves, and none when everything rests", () => {
    const { env, make, controller } = setup();
    const cards = [make(), make({ "data-lqg-reveal": "slide" }, 1700), make({ "data-lqg-reveal": "fade" }, 1800)];
    controller.start();
    expect(env.pending).toBe(0);
    scrollAt(env, 2000, 10);
    env.enter(...cards.map(target => ({ target })));
    let worst = 0;
    while (env.pending > 0) { worst = Math.max(worst, env.pending); env.tick(); }
    expect(worst).toBe(1);
    expect(env.pending).toBe(0);
    expect(controller.velocity()).toBe(0);
    expect(env.requested).toBeGreaterThan(5);
  });

  it("a scroll with nothing to reveal runs the loop only while the speed is not 0", () => {
    const { env, make, controller } = setup();
    make({ "data-lqg-reveal": "drop" }, 9000);
    controller.start();
    scrollAt(env, 1500, 10);
    expect(env.pending).toBe(1);
    env.settle();
    expect(env.pending).toBe(0);
  });

  it("a long stall does not fast-forward a spring: a frame counts as 100 ms at most", () => {
    const { env, make, controller } = setup();
    const card = make();
    controller.start();
    env.enter({ target: card });
    env.tick(5000);
    expect(controller.phase(card)).toBe("running");
  });
});

describe("stop", () => {
  it("removes every listener, cancels the frame, and leaves every target visible and clear", () => {
    const { env, root, make, controller } = setup();
    const waiting = make({ "data-lqg-reveal": "drop" }, 2000);
    const running = make({ "data-lqg-reveal": "drop" }, 1600);
    const heading = make({ "data-lqg-reveal": "mask" }, 2200);
    const line = new FakeElement({ "data-lqg-line": "" }, undefined, heading);
    controller.start();
    env.enter({ target: running }, { target: heading });
    env.tick();
    expect(env.pending).toBe(1);
    controller.stop();
    expect(env.pending).toBe(0);
    expect(env.cancelled.length).toBeGreaterThan(0);
    expect(env.scrollListeners.size).toBe(0);
    expect(env.removedScroll).toBe(env.addedScroll);
    expect(env.visibilityListeners.size).toBe(0);
    expect(env.reducedListeners.size).toBe(0);
    expect(env.focusListeners.size).toBe(0);
    expect(env.changeListeners.size).toBe(0);
    expect(env.timers.size).toBe(0);
    expect(env.observerDisconnected).toBe(1);
    for (const element of [waiting, running, heading, line]) expect(left(env, element)).toEqual([]);
    expect(controller.armed).toBe(false);
    controller.stop();
    void root;
  });

  it("can start again after a stop (React strict mode runs an effect twice) and decides each target again", () => {
    const { env, make, controller } = setup();
    const card = make();
    const inView = make({ "data-lqg-reveal": "drop" }, 100);
    controller.start();
    controller.stop();
    expect(left(env, card)).toEqual([]);
    expect(controller.start()).toBe(true);
    expect(env.style(card, "opacity")).toBe("0");
    expect(controller.phase(card)).toBe("waiting");
    expect(env.attr(inView, "data-lqg-revealed")).toBe("now");
    expect(env.observerCreated).toBe(2);
  });
});

describe("a failing environment (startScrollReveal)", () => {
  it("leaves the page visible, removes the armed marker, and logs with context when starting throws half way", () => {
    const env = new FakeScrollEnv();
    env.onReducedMotionChange = () => { throw new TypeError("reduced.addEventListener is not a function"); };
    const calls: string[] = [];
    const reports: Array<[unknown, string]> = [];
    const { make, controller } = setup({ onArm: () => calls.push("arm"), onDisarm: () => calls.push("disarm") }, env);
    const card = make();
    const result = startScrollReveal(() => controller, { context: "Home reveal", report: (error, context) => reports.push([error, context]) });
    expect(result).toBe(controller);
    expect(controller.armed).toBe(false);
    expect(left(env, card)).toEqual([]);
    expect(calls).toEqual(["arm", "disarm"]);
    expect(env.scrollListeners.size).toBe(0);
    expect(env.observerDisconnected).toBe(1);
    expect(reports).toHaveLength(1);
    expect(reports[0][1]).toBe("Home reveal");
    expect((reports[0][0] as Error).message).toContain("addEventListener");
  });

  it("logs to the console by default, naming the context", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = startScrollReveal(() => { throw new TypeError("window.matchMedia is not a function"); }, { context: "Work reveal" });
    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain("Work reveal");
    expect(spy.mock.calls[0][1]).toBeInstanceOf(TypeError);
  });

  it("returns the controller and logs nothing when all is well", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { controller } = setup();
    expect(startScrollReveal(() => controller)).toBe(controller);
    expect(controller.armed).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("layer hints", () => {
  it("gives a moving piece a layer with will-change while it runs, and removes it at rest", () => {
    const { env, make, controller } = setup();
    const card = make();
    controller.start();
    expect(env.style(card, "will-change")).toBeUndefined();
    env.enter({ target: card });
    expect(env.style(card, "will-change")).toBe("translate, scale, rotate, opacity");
    env.tick();
    env.tick();
    expect(env.style(card, "will-change")).toBe("translate, scale, rotate, opacity");
    env.settle();
    expect(env.style(card, "will-change")).toBeUndefined();
    expect(left(env, card)).toEqual([]);
  });

  it("gives a mask heading a clip hint, and its lines a move hint", () => {
    const { env, make, controller } = setup();
    const heading = make({ "data-lqg-reveal": "mask" });
    const line = new FakeElement({ "data-lqg-line": "" }, undefined, heading);
    controller.start();
    env.enter({ target: heading });
    expect(env.style(heading, "will-change")).toBe("clip-path");
    expect(env.style(line, "will-change")).toBe("translate, scale, rotate, opacity");
    env.settle();
    expect(env.style(heading, "will-change")).toBeUndefined();
    expect(env.style(line, "will-change")).toBeUndefined();
  });
});
