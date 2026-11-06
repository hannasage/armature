import { afterEach, describe, expect, it, vi } from "vitest";
import { mountScrollReveal } from "../../src/dom/reveal-mount";
import { lqgDrag, lqgReveal, LQG_LINE, LQG_REVEAL_GROUP } from "../../src/dom/reveal-attrs";
import { FakeElement, FakeRoot, FakeScrollEnv } from "../helpers/fake-scroll-env";

afterEach(() => vi.restoreAllMocks());

class Host extends FakeRoot {
  classes = new Set<string>();
  classList = { add: (...tokens: string[]) => tokens.forEach(token => this.classes.add(token)), remove: (...tokens: string[]) => tokens.forEach(token => this.classes.delete(token)) };
  add(attrs: Record<string, string>, top = 1600) {
    const element = new FakeElement(attrs, { top, left: 0, width: 100, height: 100 });
    this.members.push(element);
    return element;
  }
}

describe("mountScrollReveal", () => {
  it("arms, puts the armed class on the host, and unmounts to a clean page", () => {
    const env = new FakeScrollEnv();
    const host = new Host();
    const card = host.add({ "data-lqg-reveal": "drop" });
    const stop = mountScrollReveal(host, { env, armedClass: "js-reveal" });
    expect(host.classes.has("js-reveal")).toBe(true);
    expect(env.style(card, "opacity")).toBe("0");
    stop();
    expect(host.classes.size).toBe(0);
    expect(env.style(card, "opacity")).toBeUndefined();
    expect(env.scrollListeners.size).toBe(0);
    stop();
  });

  it("puts no class on the host under reduced motion", () => {
    const env = new FakeScrollEnv();
    env.reduced = true;
    const host = new Host();
    host.add({ "data-lqg-reveal": "drop" });
    mountScrollReveal(host, { env, armedClass: "js-reveal" });
    expect(host.classes.size).toBe(0);
    expect(env.styleWrites).toEqual([]);
  });

  it("with a throwing environment leaves every target visible, removes the armed class, and logs with context", () => {
    const env = new FakeScrollEnv();
    env.onFocusIn = () => { throw new TypeError("addEventListener is not a function"); };
    const host = new Host();
    const card = host.add({ "data-lqg-reveal": "drop" });
    const reports: Array<[unknown, string]> = [];
    const stop = mountScrollReveal(host, { env, armedClass: "js-reveal", context: "Home reveal", report: (error, context) => reports.push([error, context]) });
    expect(host.classes.size).toBe(0);
    expect(env.style(card, "opacity")).toBeUndefined();
    expect(env.scrollListeners.size).toBe(0);
    expect(reports.map(item => item[1])).toEqual(["Home reveal"]);
    expect(() => stop()).not.toThrow();
  });

  it("with no browser at all (no window) shows everything and logs to the console", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const host = new Host();
    host.add({ "data-lqg-reveal": "drop" });
    const stop = mountScrollReveal(host, { armedClass: "js-reveal", context: "Work reveal" });
    expect(host.classes.size).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain("Work reveal");
    stop();
  });

  it("logs, and does not throw, when stopping throws", () => {
    const env = new FakeScrollEnv();
    const host = new Host();
    host.add({ "data-lqg-reveal": "drop" });
    const reports: string[] = [];
    const stop = mountScrollReveal(host, { env, onDisarm: () => { throw new Error("late"); }, report: (_error, context) => reports.push(context) });
    expect(() => stop()).not.toThrow();
    expect(reports).toEqual(["scroll reveal (while stopping)"]);
  });
});

describe("attribute helpers", () => {
  it("lqgReveal names the personality, with an optional delay and tilt, clamped", () => {
    expect(lqgReveal("drop")).toEqual({ "data-lqg-reveal": "drop" });
    expect(lqgReveal("slide", { delayMs: 120.7 })).toEqual({ "data-lqg-reveal": "slide", "data-lqg-reveal-delay": "120" });
    expect(lqgReveal("drop", { tilt: 2.2 })).toEqual({ "data-lqg-reveal": "drop", "data-lqg-tilt": "2.2" });
    expect(lqgReveal("drop", { tilt: 99, delayMs: 99_999 })).toEqual({ "data-lqg-reveal": "drop", "data-lqg-reveal-delay": "2000", "data-lqg-tilt": "4" });
    expect(lqgReveal("fade", { delayMs: -5, tilt: Number.NaN })).toEqual({ "data-lqg-reveal": "fade" });
    expect(lqgReveal("slide", { side: "right" })).toEqual({ "data-lqg-reveal": "slide", "data-lqg-side": "right" });
    expect(lqgReveal("slide", { side: "up" as never })).toEqual({ "data-lqg-reveal": "slide" });
  });
  it("lqgDrag names the depth, clamped to 0.4 to 1", () => {
    expect(lqgDrag(0.55)).toEqual({ "data-lqg-drag": "", "data-lqg-depth": "0.55" });
    expect(lqgDrag(0.1)["data-lqg-depth"]).toBe("0.4");
    expect(lqgDrag(7)["data-lqg-depth"]).toBe("1");
    expect(lqgDrag(Number.NaN)["data-lqg-depth"]).toBe("0.4");
  });
  it("the group and line markers are plain attributes", () => {
    expect(LQG_REVEAL_GROUP).toEqual({ "data-lqg-reveal-group": "" });
    expect(LQG_LINE).toEqual({ "data-lqg-line": "" });
  });
});
