import { describe, expect, it } from "vitest";
import { installDelegation } from "../helpers/glass";
import { FakeNode, FakeRoot } from "../helpers/fake-dom";
import { FakeEnv } from "../helpers/fake-env";

function setup() {
  const env = new FakeEnv();
  const root = new FakeRoot();
  const delegate = installDelegation(root, { env });
  const button = new FakeNode({ "data-lqg": "" }, { left: 0, top: 0, width: 200, height: 100 });
  const label = new FakeNode({}, { left: 10, top: 10, width: 50, height: 20 }, button);
  const plain = new FakeNode();
  return { env, root, delegate, button, label, plain, v: (name: string, target: object) => env.read(target, name) };
}

describe("installDelegation", () => {
  it("installs exactly one set of listeners on the root, passive, with leave in the capture phase", () => {
    const t = setup();
    expect([...t.root.listeners.keys()].sort()).toEqual(["pointercancel", "pointerdown", "pointerleave", "pointermove", "pointerup"]);
    expect(t.root.listenerCount).toBe(5);
    expect(t.root.listeners.get("pointerdown")![0].options).toEqual({ passive: true });
    expect(t.root.listeners.get("pointerleave")![0].options).toEqual({ passive: true, capture: true });
  });

  it("presses an element that carries data-lqg, even when the event starts in a child", () => {
    const t = setup();
    t.root.fire("pointerdown", t.label);
    t.env.settle();
    expect(t.v("--lqg-press", t.button)).toBe("0.97");
  });

  it("ignores elements that do not carry data-lqg, and targets that are not elements", () => {
    const t = setup();
    t.root.fire("pointerdown", t.plain);
    t.root.fire("pointermove", t.plain);
    t.root.fire("pointerdown", null);
    t.root.fire("pointerdown", { nodeType: 3 });
    expect(t.env.requested).toBe(0);
    expect(t.env.writes).toHaveLength(0);
  });

  it("releases the pressed element on a pointerup anywhere, with the overshoot", () => {
    const t = setup();
    t.root.fire("pointerdown", t.button);
    t.env.settle();
    t.root.fire("pointerup", t.plain);
    let peak = 0;
    while (t.env.pending > 0) { t.env.tick(); peak = Math.max(peak, Number(t.v("--lqg-press", t.button))); }
    expect(peak).toBeGreaterThan(1.002);
    expect(t.v("--lqg-press", t.button)).toBe("1");
  });

  it("releases on pointercancel", () => {
    const t = setup();
    t.root.fire("pointerdown", t.button);
    t.env.settle();
    t.root.fire("pointercancel", t.plain);
    t.env.settle();
    expect(t.v("--lqg-press", t.button)).toBe("1");
  });

  it("tracks the specular over the element, including over its children", () => {
    const t = setup();
    t.root.fire("pointermove", t.label, { clientX: 50, clientY: 25 });
    t.env.settle();
    expect(t.v("--lqg-spec-x", t.button)).toBe("25%");
    expect(t.v("--lqg-spec-y", t.button)).toBe("25%");
  });

  it("lets the specular and glow go when the pointer moves onto something else", () => {
    const t = setup();
    t.root.fire("pointermove", t.button, { clientX: 50, clientY: 25 });
    t.env.settle();
    expect(Number(t.v("--lqg-glow", t.button))).toBeGreaterThan(0);
    t.root.fire("pointermove", t.plain);
    t.env.settle();
    expect(t.v("--lqg-glow", t.button)).toBe("0");
    expect(t.v("--lqg-spec-x", t.button)).toBe("50%");
  });

  it("handles pointerleave fired on the element itself, and not on a child", () => {
    const t = setup();
    t.root.fire("pointermove", t.button, { clientX: 50, clientY: 25 });
    t.env.settle();
    t.root.fire("pointerleave", t.label);
    t.env.settle();
    expect(Number(t.v("--lqg-glow", t.button))).toBeGreaterThan(0);
    t.root.fire("pointerleave", t.button);
    t.env.settle();
    expect(t.v("--lqg-glow", t.button)).toBe("0");
  });

  it("keeps one surface per element, so a loop is not doubled", () => {
    const t = setup();
    for (let i = 0; i < 10; i += 1) t.root.fire("pointermove", t.button, { clientX: i * 10, clientY: 10 });
    expect(t.env.pending).toBe(1);
    expect(t.env.requested).toBe(1);
  });

  it("works for elements added after install, with no registration", () => {
    const t = setup();
    const late = new FakeNode({ "data-lqg": "" }, { left: 300, top: 0, width: 100, height: 40 });
    t.root.fire("pointerdown", late);
    t.env.settle();
    expect(t.v("--lqg-press", late)).toBe("0.97");
  });

  it("lights the other members of a group, and nothing outside it", () => {
    const t = setup();
    const left = new FakeNode({ "data-lqg": "", "data-lqg-group": "nav" }, { left: 0, top: 0, width: 100, height: 40 });
    const right = new FakeNode({ "data-lqg": "", "data-lqg-group": "nav" }, { left: 120, top: 0, width: 100, height: 40 });
    const stranger = new FakeNode({ "data-lqg": "", "data-lqg-group": "other" }, { left: 120, top: 0, width: 100, height: 40 });
    t.root.members = [left, right, stranger];
    t.root.fire("pointermove", left, { clientX: 10, clientY: 10 });
    t.env.settle();
    expect(Number(t.v("--lqg-glow", right))).toBeGreaterThan(0);
    expect(t.v("--lqg-glow", stranger)).toBeUndefined();
    expect(t.root.queries.some((query) => query.includes('data-lqg-group="nav"'))).toBe(true);
  });

  it("does not run a query for a group name that could break the selector", () => {
    const t = setup();
    const odd = new FakeNode({ "data-lqg": "", "data-lqg-group": 'a"] , body [x="' });
    t.root.fire("pointermove", odd, { clientX: 1, clientY: 1 });
    expect(t.root.queries).toEqual([]);
  });

  it("does nothing under reduced motion", () => {
    const t = setup();
    t.env.reduced = true;
    t.root.fire("pointerdown", t.button);
    t.root.fire("pointermove", t.button, { clientX: 5, clientY: 5 });
    t.root.fire("pointerup", t.button);
    expect(t.env.requested).toBe(0);
    expect(t.env.writes).toHaveLength(0);
  });

  it("removes every listener on destroy, cancels frames, resets active surfaces, and ignores later events", () => {
    const t = setup();
    t.root.fire("pointerdown", t.button);
    t.env.tick();
    t.delegate.destroy();
    expect(t.root.listenerCount).toBe(0);
    expect(t.root.removed).toHaveLength(5);
    expect(t.env.pending).toBe(0);
    expect(t.v("--lqg-press", t.button)).toBe("1");
    const writes = t.env.writes.length;
    t.root.fire("pointerdown", t.button);
    expect(t.env.writes.length).toBe(writes);
    expect(() => t.delegate.destroy()).not.toThrow();
  });

  it("forgets idle surfaces so a long page does not hold every element it ever met", () => {
    const t = setup();
    const first = new FakeNode({ "data-lqg": "" });
    t.root.fire("pointermove", first, { clientX: 1, clientY: 1 });
    t.root.fire("pointerleave", first);
    t.env.settle();
    expect(t.delegate.surfaceCount).toBe(1);
    // Meeting a second element prunes the first, which is now idle.
    t.root.fire("pointermove", t.button, { clientX: 1, clientY: 1 });
    expect(t.delegate.surfaceCount).toBe(1);
    t.root.fire("pointerleave", t.button);
    t.env.settle();
    t.root.fire("pointermove", first, { clientX: 1, clientY: 1 });
    expect(t.delegate.surfaceCount).toBe(1);
    t.delegate.destroy();
    expect(t.delegate.surfaceCount).toBe(0);
  });
});
