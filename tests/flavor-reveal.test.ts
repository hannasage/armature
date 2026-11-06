import { afterEach, describe, expect, it, vi } from "vitest";
import { mountScrollReveal } from "../src/dom/reveal-mount";
import * as attrs from "../src/dom/reveal-attrs";
import * as reveal from "../src/dom/reveal";
import { glassFlavor } from "../src/glass/flavor";
import type { Flavor } from "../src/engine/flavor";
import * as legacyAttrs from "./golden/legacy/scroll-attrs";
import * as legacyReveal from "./golden/legacy/scroll-reveal";
import { acme } from "./helpers/other-flavor";
import { FakeElement, FakeRoot, FakeScrollEnv } from "./helpers/fake-scroll-env";

afterEach(() => vi.restoreAllMocks());

const rect = (top: number, left = 0, height = 100) => ({ top, left, width: 300, height });

function scene() {
  const env = new FakeScrollEnv();
  env.height = 900;
  env.docHeight = 5000;
  const root = new FakeRoot();
  return { env, root };
}

describe("scroll-reveal and scroll-attrs keep their old exports", () => {
  it("has every legacy export, with the same value for each constant", () => {
    for (const [legacy, now] of [[legacyReveal, reveal], [legacyAttrs, attrs]] as const) {
      for (const [name, value] of Object.entries(legacy)) {
        expect(name in now, name).toBe(true);
        const current = (now as Record<string, unknown>)[name];
        if (typeof value === "function") expect(typeof current, name).toBe("function");
        else expect(current, name).toStrictEqual(value);
      }
    }
  });
  it("belowFold gives the same answer as the legacy function", () => {
    for (const height of [0, 480, 900, 1080]) for (const top of [-10, 0, 400, 827, 828, 829, 899, 900, 5000]) expect(reveal.belowFold(top, height), `${top} ${height}`).toBe(legacyReveal.belowFold(top, height));
    expect(reveal.belowFold(828, 900, glassFlavor)).toBe(true);
    expect(reveal.belowFold(827, 900, glassFlavor)).toBe(false);
  });
  it("belowFold and the root margin use the fold of another flavor", () => {
    expect(reveal.belowFold(720, 900, acme)).toBe(true);
    expect(reveal.belowFold(719, 900, acme)).toBe(false);
    expect(reveal.revealRootMargin(acme)).toBe("0px 0px -20% 0px");
    expect(reveal.revealRootMargin()).toBe("0px 0px -8% 0px");
    expect(reveal.ROOT_MARGIN).toBe(legacyReveal.ROOT_MARGIN);
  });
});

describe("a controller with another flavor", () => {
  it("watches the flavor's attributes and ignores the glass ones", () => {
    const { env, root } = scene();
    const glassOnly = new FakeElement({ "data-lqg-reveal": "drop" }, rect(1300));
    const mine = new FakeElement({ "data-acme-enter": "pop" }, rect(1000));
    root.members = [glassOnly, mine];
    const controller = reveal.createScrollReveal({ root, env, flavor: acme });
    expect(controller.start()).toBe(true);
    expect(env.rootMargin).toBe("0px 0px -20% 0px");
    expect(controller.phase(mine)).toBe("waiting");
    expect(controller.phase(glassOnly)).toBe("none");
    expect(env.styleWrites.every((write) => write.target === mine)).toBe(true);
  });

  it("uses the flavor's fold: an element the glass fold shows at once waits under a wider fold", () => {
    const { env, root } = scene();
    const high = new FakeElement({ "data-acme-enter": "pop" }, rect(700));
    const low = new FakeElement({ "data-acme-enter": "pop" }, rect(750));
    root.members = [high, low];
    const controller = reveal.createScrollReveal({ root, env, flavor: acme });
    controller.start();
    expect(env.attr(high, "data-acme-entered")).toBe("now");
    expect(controller.phase(low)).toBe("waiting");
    expect(env.attr(low, "data-acme-entered")).toBeUndefined();
  });

  it("hides a waiting piece by its traits: only a personality with hiddenTranslate gets the offset", () => {
    const { env, root } = scene();
    const pop = new FakeElement({ "data-acme-enter": "pop" }, rect(1000));
    const float = new FakeElement({ "data-acme-enter": "float" }, rect(1100));
    const wipe = new FakeElement({ "data-acme-enter": "wipe" }, rect(1200));
    root.members = [pop, float, wipe];
    reveal.createScrollReveal({ root, env, flavor: acme }).start();
    expect(env.styles.get(pop)).toEqual({ opacity: "0" });
    expect(env.styles.get(float)).toEqual({ opacity: "0", translate: "0px 7px" });
    expect(env.styles.get(wipe)).toEqual({ opacity: "0" });
  });

  it("writes scale and rotate only for a scaleRotate personality, and uses the flavor's hints and delay variable", () => {
    const { env, root } = scene();
    const pop = new FakeElement({ "data-acme-enter": "pop" }, rect(1000));
    const float = new FakeElement({ "data-acme-enter": "float", "data-acme-enter-delay": "250" }, rect(1100));
    root.members = [pop, float];
    const controller = reveal.createScrollReveal({ root, env, flavor: acme });
    controller.start();
    env.enter({ target: pop }, { target: float });
    expect(env.styles.get(pop)).toEqual({
      translate: "0px 10px", scale: "0.5", rotate: "3deg", opacity: "0", "will-change": "translate, opacity", "--acme-enter-delay": "0ms",
    });
    expect(env.styles.get(float)).toEqual({ translate: "0px 7px", opacity: "0", "will-change": "translate, opacity", "--acme-enter-delay": "250ms" });
    expect(env.attr(pop, "data-acme-entered")).toBe("true");
    expect(env.attr(float, "data-acme-entered")).toBe("true");
  });

  it("clips by the clips trait: the box clips, the flavor's rows move, and the clip side comes from the flavor", () => {
    const { env, root } = scene();
    const wipe = new FakeElement({ "data-acme-enter": "wipe" }, rect(1200, 0, 90));
    const one = new FakeElement({ "data-acme-row": "" }, rect(1200, 0, 40), wipe);
    const two = new FakeElement({ "data-acme-row": "" }, rect(1245, 0, 40), wipe);
    root.members = [wipe];
    const controller = reveal.createScrollReveal({ root, env, flavor: acme });
    controller.start();
    env.enter({ target: wipe });
    expect(env.styles.get(wipe)).toEqual({ "clip-path": "inset(100% -2px 0 -2px)", "will-change": "clip", "--acme-enter-delay": "0ms" });
    expect(env.styles.get(one)).toEqual({ translate: "0px 40px", opacity: "0", "will-change": "translate, opacity" });
    expect(env.styles.get(two)).toEqual({ translate: "0px 40px", opacity: "0", "will-change": "translate, opacity" });
  });

  it("staggers a group by the flavor's step and cap", () => {
    const { env, root } = scene();
    const group = new FakeElement({ "data-acme-enter-group": "" }, rect(1000));
    const members = [0, 1, 2, 3, 4].map((i) => new FakeElement({ "data-acme-enter": "pop" }, rect(1000, i * 100), group));
    root.members = members;
    reveal.createScrollReveal({ root, env, flavor: acme }).start();
    env.enter(...members.map((target) => ({ target })));
    expect(members.map((member) => env.style(member, "--acme-enter-delay"))).toEqual(["0ms", "100ms", "200ms", "300ms", "300ms"]);
  });

  it("uses the flavor's safety time", () => {
    const { env, root } = scene();
    const pop = new FakeElement({ "data-acme-enter": "pop" }, rect(1000));
    root.members = [pop];
    reveal.createScrollReveal({ root, env, flavor: acme }).start();
    env.advance(999);
    expect(env.attr(pop, "data-acme-entered")).toBeUndefined();
    env.advance(1);
    expect(env.attr(pop, "data-acme-entered")).toBe("now");
  });

  it("drags the flavor's elements and reads the flavor's depth attribute", () => {
    const { env, root } = scene();
    const dragged = new FakeElement({ "data-acme-pull": "", "data-acme-weight": "2" }, rect(300));
    root.members = [dragged];
    const controller = reveal.createScrollReveal({ root, env, flavor: acme });
    controller.start();
    env.enter({ target: dragged });
    for (const y of [100, 300, 600]) {
      env.scrollTo(y);
      env.tick(16);
    }
    expect(controller.velocity()).toBeGreaterThan(0);
    expect(env.style(dragged, "will-change")).toBe("translate");
    expect(Number.parseFloat(env.style(dragged, "translate")!.split(" ")[1])).toBeGreaterThan(0);
    expect(env.style(dragged, "rotate")).toMatch(/deg$/);
  });

  it("logs with the flavor's label", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { env, root } = scene();
    env.createIntersectionObserver = () => ({ observe: () => undefined, unobserve: () => undefined, disconnect: () => { throw new Error("boom"); } });
    const controller = reveal.createScrollReveal({ root, env, flavor: acme });
    controller.start();
    controller.stop();
    expect(spy.mock.calls[0]?.[0]).toBe("[acme-motion] the reveal stop (observer) failed; every element is shown instead.");
  });

  it("writes no name that belongs to the glass flavor", () => {
    const { env, root } = scene();
    const group = new FakeElement({ "data-acme-enter-group": "" }, rect(1000));
    const pop = new FakeElement({ "data-acme-enter": "pop", "data-acme-lean": "6", "data-acme-from": "left" }, rect(1000), group);
    const wipe = new FakeElement({ "data-acme-enter": "wipe" }, rect(1200), group);
    new FakeElement({ "data-acme-row": "" }, rect(1200, 0, 30), wipe);
    const dragged = new FakeElement({ "data-acme-pull": "" }, rect(300));
    root.members = [pop, wipe, dragged];
    const controller = reveal.createScrollReveal({ root, env, flavor: acme });
    controller.start();
    env.enter({ target: pop }, { target: wipe }, { target: dragged });
    env.scrollTo(500);
    env.settle(16, 400);
    controller.stop();
    expect(JSON.stringify([env.styleWrites.map((w) => [w.property, w.value]), [...env.attrs.values()]])).not.toContain("lqg");
  });

  it("a personality with an unknown spring kind stops the controller, shows everything, and logs", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { env, root } = scene();
    const odd = { ...acme, reveal: { ...acme.reveal, personalities: { ...acme.reveal.personalities, pop: { ...acme.reveal.personalities.pop, spring: "weird" as never } } } };
    const pop = new FakeElement({ "data-acme-enter": "pop" }, rect(1000));
    root.members = [pop];
    const controller = reveal.createScrollReveal({ root, env, flavor: odd });
    controller.start();
    env.enter({ target: pop });
    expect(controller.armed).toBe(false);
    expect(env.styles.get(pop)).toEqual({});
    expect(String(spy.mock.calls[0]?.[0])).toBe("[acme-motion] the reveal observer failed; every element is shown instead.");
    expect(String((spy.mock.calls[0]?.[1] as Error).message)).toBe("Unknown reveal spring kind: weird.");
  });

  it("fails with a clear error when the flavor has no reveal part", () => {
    const { env, root } = scene();
    const bare: Flavor = { name: "bare", prefix: "zz", logLabel: "bare", springs: {} };
    expect(() => reveal.createScrollReveal({ root, env, flavor: bare })).toThrow('The flavor "bare" has no reveal part.');
  });
});

describe("startScrollReveal and mountScrollReveal", () => {
  it("log with the flavor's label", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    reveal.startScrollReveal(() => { throw new Error("boom"); }, { flavor: acme });
    expect(spy.mock.calls[0]?.[0]).toBe("[acme-motion] scroll reveal failed to start; every element is shown instead.");

    const { env, root } = scene();
    const unmount = mountScrollReveal(root, { env, flavor: acme, onDisarm: () => { throw new Error("boom"); } });
    unmount();
    expect(spy.mock.calls[1]?.[0]).toBe("[acme-motion] scroll reveal (while stopping) failed; every element is shown instead.");
  });
  it("log with the glass label by default", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    reveal.startScrollReveal(() => { throw new Error("boom"); });
    expect(spy.mock.calls[0]?.[0]).toBe("[liquid-glass] scroll reveal failed to start; every element is shown instead.");
  });
  it("mount passes the flavor to the controller", () => {
    const { env, root } = scene();
    const pop = new FakeElement({ "data-acme-enter": "pop" }, rect(1000));
    root.members = [pop];
    const classes: string[] = [];
    const host = Object.assign(root, { classList: { add: (...t: string[]) => classes.push(...t), remove: () => undefined } });
    const unmount = mountScrollReveal(host, { env, flavor: acme, armedClass: "armed" });
    expect(env.rootMargin).toBe("0px 0px -20% 0px");
    expect(classes).toEqual(["armed"]);
    expect(env.styles.get(pop)).toEqual({ opacity: "0" });
    unmount();
  });
});

describe("attribute helpers with another flavor", () => {
  it("lqgReveal names and limits come from the flavor", () => {
    expect(attrs.lqgReveal("pop", { delayMs: 9999, tilt: 99, side: "left" }, acme)).toEqual({
      "data-acme-enter": "pop", "data-acme-enter-delay": "500", "data-acme-lean": "10", "data-acme-from": "left",
    });
    expect(attrs.lqgReveal("float", undefined, acme)).toEqual({ "data-acme-enter": "float" });
  });
  it("lqgReveal without a flavor matches the legacy helper", () => {
    for (const options of [undefined, {}, { delayMs: 300 }, { delayMs: 99999, tilt: 99, side: "right" as const }, { delayMs: -5, tilt: -1 }, { delayMs: Number.NaN }]) {
      expect(attrs.lqgReveal("drop", options)).toStrictEqual(legacyAttrs.lqgReveal("drop", options));
    }
  });
  it("lqgDrag clamps to the flavor's depth range", () => {
    expect(attrs.lqgDrag(5, acme)).toEqual({ "data-acme-pull": "", "data-acme-weight": "2" });
    expect(attrs.lqgDrag(0, acme)).toEqual({ "data-acme-pull": "", "data-acme-weight": "0.2" });
    expect(attrs.lqgDrag(Number.NaN, acme)).toEqual({ "data-acme-pull": "", "data-acme-weight": "0.2" });
    for (const depth of [-1, 0.4, 0.7, 1, 2, Number.NaN]) expect(attrs.lqgDrag(depth)).toStrictEqual(legacyAttrs.lqgDrag(depth));
  });
  it("the group and line attributes are built from the flavor, and frozen", () => {
    expect(attrs.revealGroupAttributes(acme)).toEqual({ "data-acme-enter-group": "" });
    expect(attrs.revealLineAttributes(acme)).toEqual({ "data-acme-row": "" });
    expect(Object.isFrozen(attrs.revealGroupAttributes(acme))).toBe(true);
    expect(attrs.LQG_REVEAL_GROUP).toStrictEqual(legacyAttrs.LQG_REVEAL_GROUP);
    expect(attrs.LQG_LINE).toStrictEqual(legacyAttrs.LQG_LINE);
    expect(Object.isFrozen(attrs.LQG_LINE)).toBe(true);
  });
});

describe("the one deliberate behavior change", () => {
  const run = (create: (options: { root: FakeRoot; env: FakeScrollEnv; personalityOf: () => never }) => { start(): boolean }) => {
    const { env, root } = scene();
    const card = new FakeElement({ "data-lqg-reveal": "drop" }, rect(1600));
    root.members = [card];
    create({ root, env, personalityOf: () => "wobble" as never }).start();
    env.enter({ target: card });
    return { env, card };
  };

  it("a custom personalityOf that returns a name outside the flavor now gets the fallback (drop) pose and writes scale and rotate", () => {
    const { env, card } = run(reveal.createScrollReveal);
    expect(env.style(card, "scale")).toBe("0.94");
    expect(env.style(card, "rotate")).toBe("0.6deg");
    expect(env.style(card, "translate")).toBe("0px 28px");
  });

  it("the legacy code gave that name the drop start pose but wrote no scale and no rotate", () => {
    const { env, card } = run(legacyReveal.createScrollReveal);
    expect(env.style(card, "scale")).toBeUndefined();
    expect(env.style(card, "rotate")).toBeUndefined();
    expect(env.style(card, "translate")).toBe("0px 28px");
  });
});
