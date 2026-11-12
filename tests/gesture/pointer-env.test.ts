import { describe, expect, it } from "vitest";
import { createBrowserPointerEnvironment, createDrag, type PointerHandlers, type PointerSample } from "../../src/gesture";
import { swipey } from "../helpers/gesture-flavor";

type Listener = (event: Record<string, unknown>) => void;

/** An element and a window with just the parts the browser pointer environment calls. */
function fakeBrowser() {
  const listeners = new Map<string, Listener[]>();
  const captured: number[] = [];
  const released: number[] = [];
  const style = new Map<string, string>();
  const element = {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    removeEventListener: (type: string, listener: Listener) => listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== listener)),
    setPointerCapture: (id: number) => { captured.push(id); },
    releasePointerCapture: (id: number) => { released.push(id); },
    style: {
      setProperty: (name: string, value: string) => { style.set(name, value); },
      removeProperty: (name: string) => { style.delete(name); },
      getPropertyValue: (name: string) => style.get(name) ?? "",
    },
  };
  const win = {
    requestAnimationFrame: (callback: (time: number) => void) => { callback(5); return 7; },
    cancelAnimationFrame: () => undefined,
    performance: { now: () => 1234 },
    matchMedia: (query: string) => ({ matches: query.includes("reduce") }),
  };
  const fire = (type: string, event: Record<string, unknown>) => { for (const listener of listeners.get(type) ?? []) listener(event); };
  return { element, win, listeners, captured, released, style, fire };
}

const recorder = () => {
  const calls: string[] = [];
  const samples: PointerSample[] = [];
  const handlers: PointerHandlers = {
    down: (p) => { calls.push("down"); samples.push(p); },
    move: (p) => { calls.push("move"); samples.push(p); },
    up: (p) => { calls.push("up"); samples.push(p); },
    cancel: (p) => { calls.push("cancel"); samples.push(p); },
  };
  return { calls, samples, handlers };
};

describe("the browser pointer environment", () => {
  it("is made with no window access, so it is safe to import on a server", () => {
    expect(() => createBrowserPointerEnvironment()).not.toThrow();
  });

  it("takes the clock, the frames, the media query, and the style writes from the window and the element", () => {
    const { win, element, style } = fakeBrowser();
    const env = createBrowserPointerEnvironment(win as never);
    expect(env.now()).toBe(1234);
    let seen = 0;
    expect(env.requestFrame((time) => { seen = time; })).toBe(7);
    expect(seen).toBe(5);
    expect(env.matchMedia?.("(prefers-reduced-motion: reduce)").matches).toBe(true);
    env.setStyle(element, "translate", "1px 2px");
    expect(style.get("translate")).toBe("1px 2px");
    env.setStyle(element, "translate", null);
    expect(style.has("translate")).toBe(false);
  });

  it("passes down, move, up, and cancel with the event time stamp as the time, and captures the pointer on down", () => {
    const { win, element, fire, captured } = fakeBrowser();
    const env = createBrowserPointerEnvironment(win as never);
    const { calls, samples, handlers } = recorder();
    env.onPointer(element, handlers);
    fire("pointerdown", { pointerId: 3, clientX: 10, clientY: 20, timeStamp: 100, pointerType: "touch", button: 0 });
    fire("pointermove", { pointerId: 3, clientX: 12, clientY: 25, timeStamp: 116 });
    fire("pointerup", { pointerId: 3, clientX: 13, clientY: 26, timeStamp: 120 });
    fire("pointercancel", { pointerId: 4, clientX: 1, clientY: 2, timeStamp: 130 });
    expect(calls).toEqual(["down", "move", "up", "cancel"]);
    expect(samples[0]).toEqual({ id: 3, x: 10, y: 20, time: 100 });
    expect(samples[1]).toEqual({ id: 3, x: 12, y: 25, time: 116 });
    expect(captured).toEqual([3]);
  });

  it("ignores a press of a mouse button other than the main one", () => {
    const { win, element, fire } = fakeBrowser();
    const { calls, handlers } = recorder();
    createBrowserPointerEnvironment(win as never).onPointer(element, handlers);
    fire("pointerdown", { pointerId: 1, clientX: 0, clientY: 0, timeStamp: 1, pointerType: "mouse", button: 2 });
    expect(calls).toEqual([]);
  });

  it("survives a pointer that cannot be captured, and reports the failure to the handlers", () => {
    const { win, element, fire } = fakeBrowser();
    const failure = new Error("no such pointer");
    element.setPointerCapture = () => { throw failure; };
    const { calls, handlers } = recorder();
    const faults: unknown[] = [];
    createBrowserPointerEnvironment(win as never).onPointer(element, { ...handlers, fault: (error) => faults.push(error) });
    expect(() => fire("pointerdown", { pointerId: 1, clientX: 0, clientY: 0, timeStamp: 1, pointerType: "touch", button: 0 })).not.toThrow();
    expect(calls).toEqual(["down"]);
    expect(faults).toEqual([failure]);
  });

  it("maps a lost pointer capture to a cancel", () => {
    const { win, element, fire } = fakeBrowser();
    const { calls, samples, handlers } = recorder();
    createBrowserPointerEnvironment(win as never).onPointer(element, handlers);
    fire("lostpointercapture", { pointerId: 5, clientX: 1, clientY: 2, timeStamp: 50 });
    expect(calls).toEqual(["cancel"]);
    expect(samples[0]).toEqual({ id: 5, x: 1, y: 2, time: 50 });
  });

  it("ignores the press of a pointer that is not the primary one", () => {
    const { win, element, fire } = fakeBrowser();
    const { calls, handlers } = recorder();
    createBrowserPointerEnvironment(win as never).onPointer(element, handlers);
    fire("pointerdown", { pointerId: 2, clientX: 0, clientY: 0, timeStamp: 1, pointerType: "touch", button: 0, isPrimary: false });
    expect(calls).toEqual([]);
    fire("pointerdown", { pointerId: 1, clientX: 0, clientY: 0, timeStamp: 1, pointerType: "touch", button: 0, isPrimary: true });
    expect(calls).toEqual(["down"]);
  });

  it("reads an inline style, and gives null for none", () => {
    const { win, element, style } = fakeBrowser();
    const env = createBrowserPointerEnvironment(win as never);
    expect(env.getStyle?.(element, "touch-action")).toBeNull();
    style.set("touch-action", "manipulation");
    expect(env.getStyle?.(element, "touch-action")).toBe("manipulation");
  });

  it("ends a drag when the capture is lost, so a press whose release never arrives does not stick", () => {
    const { win, element, fire } = fakeBrowser();
    const drag = createDrag(element as never, { flavor: swipey, axis: "x", env: createBrowserPointerEnvironment(win as never) });
    fire("pointerdown", { pointerId: 1, clientX: 0, clientY: 0, timeStamp: 1, pointerType: "touch", button: 0, isPrimary: true });
    fire("pointermove", { pointerId: 1, clientX: 10, clientY: 0, timeStamp: 17 });
    expect(drag.getState().dragging).toBe(true);
    fire("lostpointercapture", { pointerId: 1, clientX: 10, clientY: 0, timeStamp: 30 });
    expect(drag.getState().dragging).toBe(false);
    drag.destroy();
  });

  it("removes all four listeners with the function it returns", () => {
    const { win, element, fire, listeners } = fakeBrowser();
    const { calls, handlers } = recorder();
    const off = createBrowserPointerEnvironment(win as never).onPointer(element, handlers);
    expect([...listeners.keys()].sort()).toEqual(["lostpointercapture", "pointercancel", "pointerdown", "pointermove", "pointerup"]);
    off();
    fire("pointerdown", { pointerId: 1, clientX: 0, clientY: 0, timeStamp: 1, pointerType: "touch", button: 0 });
    expect(calls).toEqual([]);
    for (const list of listeners.values()) expect(list).toEqual([]);
  });
});
