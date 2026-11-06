import { describe, expect, it } from "vitest";
import { createScrollReveal } from "../src/dom/reveal";
import type { ScrollElement } from "../src/engine/scroll-env";
import { FakeElement, FakeRoot, FakeScrollEnv } from "./helpers/fake-scroll-env";

/*
 * The scroll drag of createScrollReveal (GI-70): a revealed element trails the scroll, scaled by its depth, and settles to 0.
 */
function setup() {
  const env = new FakeScrollEnv();
  const root = new FakeRoot();
  const controller = createScrollReveal({ env, root });
  const make = (attrs: Record<string, string>, top = 200) => {
    const element = new FakeElement({ "data-lqg-drag": "", ...attrs }, { top, left: 0, width: 300, height: 200 });
    root.members.push(element);
    return element;
  };
  return { env, root, controller, make };
}
function scrollAt(env: FakeScrollEnv, speed: number, frames: number) {
  for (let i = 0; i < frames; i++) {
    env.scrollTo(env.y + speed / 60);
    env.tick();
  }
}
const shiftOf = (env: FakeScrollEnv, element: ScrollElement) => Number.parseFloat((env.style(element, "translate") ?? "0px 0px").split(" ")[1]);
const turnOf = (env: FakeScrollEnv, element: ScrollElement) => Number.parseFloat(env.style(element, "rotate") ?? "0");
const inView = (env: FakeScrollEnv, ...targets: ScrollElement[]) => env.enter(...targets.map(target => ({ target })));

describe("scroll drag", () => {
  it("a revealed drag element trails the scroll: a shift of up to 6 px and a turn of up to 0.8 degrees, in the scroll direction", () => {
    const { env, controller, make } = setup();
    const card = make({ "data-lqg-depth": "1" });
    controller.start();
    inView(env, card);
    scrollAt(env, 1200, 30);
    expect(shiftOf(env, card)).toBeGreaterThan(3);
    expect(shiftOf(env, card)).toBeLessThanOrEqual(6.1);
    expect(turnOf(env, card)).toBeGreaterThan(0.3);
    expect(turnOf(env, card)).toBeLessThanOrEqual(0.82);
  });

  it("is clamped however fast the scroll", () => {
    const { env, controller, make } = setup();
    const card = make({ "data-lqg-depth": "1" });
    controller.start();
    inView(env, card);
    let peakShift = 0;
    let peakTurn = 0;
    for (let i = 0; i < 40; i++) {
      env.scrollTo(env.y + 30_000);
      env.tick();
      peakShift = Math.max(peakShift, Math.abs(shiftOf(env, card)));
      peakTurn = Math.max(peakTurn, Math.abs(turnOf(env, card)));
    }
    expect(peakShift).toBeLessThanOrEqual(6 * 1.03);
    expect(peakTurn).toBeLessThanOrEqual(0.8 * 1.03);
    expect(peakShift).toBeGreaterThan(5);
  });

  it("depth scales the shift, so layers move by different amounts", () => {
    const { env, controller, make } = setup();
    const front = make({ "data-lqg-depth": "1" });
    const back = make({ "data-lqg-depth": "0.5" });
    const floor = make({ "data-lqg-depth": "0.05" });
    const plain = make({});
    controller.start();
    inView(env, front, back, floor, plain);
    scrollAt(env, 3000, 40);
    expect(shiftOf(env, back) / shiftOf(env, front)).toBeCloseTo(0.5, 1);
    expect(shiftOf(env, floor) / shiftOf(env, front)).toBeCloseTo(0.4, 1);
    expect(shiftOf(env, plain) / shiftOf(env, front)).toBeCloseTo(0.7, 1);
  });

  it("flips sign when the scroll direction reverses", () => {
    const { env, controller, make } = setup();
    env.y = 9000;
    const card = make({ "data-lqg-depth": "1" });
    controller.start();
    inView(env, card);
    scrollAt(env, 1500, 25);
    const down = [shiftOf(env, card), turnOf(env, card)];
    scrollAt(env, -1500, 60);
    const up = [shiftOf(env, card), turnOf(env, card)];
    expect(down[0]).toBeGreaterThan(0);
    expect(down[1]).toBeGreaterThan(0);
    expect(up[0]).toBeLessThan(0);
    expect(up[1]).toBeLessThan(0);
  });

  it("settles to exactly 0 on a spring within about 700 ms of the scroll stopping, then the loop ends", () => {
    const { env, controller, make } = setup();
    const card = make({ "data-lqg-depth": "1" });
    controller.start();
    inView(env, card);
    scrollAt(env, 2400, 30);
    expect(shiftOf(env, card)).toBeGreaterThan(4);
    let elapsed = 0;
    let nearZero: number | undefined;
    while (env.pending > 0 && elapsed < 3000) {
      env.tick();
      elapsed += 1000 / 60;
      if (nearZero === undefined && Math.abs(shiftOf(env, card)) < 0.05 && Math.abs(turnOf(env, card)) < 0.005) nearZero = elapsed;
    }
    expect(nearZero).toBeDefined();
    expect(nearZero!).toBeLessThan(700);
    expect(elapsed).toBeLessThan(900);
    expect(env.pending).toBe(0);
    expect(env.style(card, "translate")).toBeUndefined();
    expect(env.style(card, "rotate")).toBeUndefined();
  });

  it("does not run a frame loop while the page is still and nothing drags", () => {
    const { env, controller, make } = setup();
    const card = make({});
    controller.start();
    inView(env, card);
    expect(env.pending).toBe(0);
    expect(env.styleWrites).toEqual([]);
  });

  it("an element that is out of the viewport does not drag, and one that leaves is put back at once", () => {
    const { env, controller, make } = setup();
    const away = make({}, 5000);
    const card = make({ "data-lqg-depth": "1" });
    controller.start();
    inView(env, card);
    scrollAt(env, 2000, 20);
    expect(shiftOf(env, card)).toBeGreaterThan(2);
    expect(env.style(away, "translate")).toBeUndefined();
    env.enter({ target: card, isIntersecting: false });
    env.tick();
    expect(env.style(card, "translate")).toBeUndefined();
    expect(env.style(card, "rotate")).toBeUndefined();
  });

  it("an element that has not revealed yet does not drag", () => {
    const { env, controller, make } = setup();
    const card = make({ "data-lqg-reveal": "drop", "data-lqg-depth": "1" }, 1600);
    controller.start();
    scrollAt(env, 2000, 20);
    expect(controller.phase(card)).toBe("waiting");
    expect(env.style(card, "rotate")).toBeUndefined();
    expect(shiftOf(env, card)).toBe(28); // still its hidden start offset, not a drag
  });

  it("starts to drag only after the reveal has settled, and the two never fight over translate", () => {
    const { env, controller, make } = setup();
    const card = make({ "data-lqg-reveal": "drop", "data-lqg-depth": "1" }, 1600);
    controller.start();
    inView(env, card);
    expect(controller.phase(card)).toBe("running");
    scrollAt(env, 600, 60);
    expect(controller.phase(card)).toBe("settled");
    scrollAt(env, 1500, 30);
    expect(shiftOf(env, card)).toBeGreaterThan(3);
    env.settle();
    expect(env.style(card, "translate")).toBeUndefined();
  });

  it("an element with no drag attribute never drags, and only translate and rotate are written", () => {
    const { env, controller, root } = setup();
    const plain = new FakeElement({}, { top: 100, left: 0, width: 10, height: 10 });
    root.members.push(plain);
    const card = new FakeElement({ "data-lqg-drag": "" }, { top: 100, left: 0, width: 10, height: 10 });
    root.members.push(card);
    controller.start();
    env.enter({ target: card });
    scrollAt(env, 2000, 20);
    env.settle();
    expect(env.styles.get(plain)).toBeUndefined();
    for (const write of env.styleWrites) expect(["translate", "rotate", "will-change"]).toContain(write.property);
  });

  it("uses the one frame loop of the controller", () => {
    const { env, controller, make } = setup();
    const cards = [make({}), make({}), make({})];
    controller.start();
    inView(env, ...cards);
    let worst = 0;
    for (let i = 0; i < 30; i++) {
      env.scrollTo(env.y + 40);
      worst = Math.max(worst, env.pending);
      env.tick();
    }
    while (env.pending > 0) { worst = Math.max(worst, env.pending); env.tick(); }
    expect(worst).toBe(1);
  });
});

describe("layer hints for the drag", () => {
  it("holds will-change only while the element is dragged, and drops it when it is flat", () => {
    const { env, controller, make } = setup();
    const card = make({ "data-lqg-depth": "1" });
    controller.start();
    inView(env, card);
    expect(env.style(card, "will-change")).toBeUndefined();
    scrollAt(env, 1500, 10);
    expect(env.style(card, "will-change")).toBe("translate, rotate");
    env.settle();
    expect(env.style(card, "will-change")).toBeUndefined();
  });
});
