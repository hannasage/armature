import { describe, expect, it, vi } from "vitest";
import { createBrowserLayoutEnvironment } from "../../src/layout";

// The browser environment takes a window as an argument, so a test runs it with no browser. It reads no global until a method runs.

function fakeWindow() {
  return {
    requestAnimationFrame: vi.fn(() => 7),
    cancelAnimationFrame: vi.fn(),
    performance: { now: () => 12.5 },
    matchMedia: vi.fn((query: string) => ({ matches: query.includes("reduce") })),
  };
}
function fakeElement(parent?: object) {
  return {
    parentNode: parent ?? null,
    style: { setProperty: vi.fn(), removeProperty: vi.fn() },
    getBoundingClientRect: () => ({ left: 1, top: 2, width: 30, height: 40, right: 31, bottom: 42, x: 1, y: 2 }),
  };
}

describe("the browser layout environment", () => {
  it("is made with no window, and touches no global until a method runs", () => {
    expect(() => createBrowserLayoutEnvironment()).not.toThrow();
    expect(() => createBrowserLayoutEnvironment().requestFrame(() => undefined)).toThrow();
  });

  it("passes the frame loop, the clock, and the media query to the window it is given", () => {
    const win = fakeWindow();
    const env = createBrowserLayoutEnvironment(win as never);
    const callback = () => undefined;
    expect(env.requestFrame(callback)).toBe(7);
    expect(win.requestAnimationFrame).toHaveBeenCalledWith(callback);
    env.cancelFrame(7);
    expect(win.cancelAnimationFrame).toHaveBeenCalledWith(7);
    expect(env.now()).toBe(12.5);
    expect(env.matchMedia!("(prefers-reduced-motion: reduce)").matches).toBe(true);
  });

  it("measures the box of an element from its bounding rectangle", () => {
    const env = createBrowserLayoutEnvironment(fakeWindow() as never);
    expect(env.measure(fakeElement())).toEqual({ x: 1, y: 2, width: 30, height: 40 });
  });

  it("writes an individual property with setProperty, and removes it for null", () => {
    const env = createBrowserLayoutEnvironment(fakeWindow() as never);
    const el = fakeElement();
    env.setStyle(el, "translate", "1px 2px");
    env.setStyle(el, "scale", "0.5 0.5");
    env.setStyle(el, "scale", null);
    expect(el.style.setProperty).toHaveBeenNthCalledWith(1, "translate", "1px 2px");
    expect(el.style.setProperty).toHaveBeenNthCalledWith(2, "scale", "0.5 0.5");
    expect(el.style.removeProperty).toHaveBeenCalledWith("scale");
  });

  it.each(["transform", "-webkit-transform", "-moz-transform", "-ms-transform", "-o-transform", "Transform", "TRANSFORM", "-WebKit-Transform"])(
    "rejects the name %s with a TypeError, and writes nothing",
    (name) => {
      const env = createBrowserLayoutEnvironment(fakeWindow() as never);
      const el = fakeElement();
      expect(() => env.setStyle(el, name, "rotate(1deg)")).toThrow(TypeError);
      expect(() => env.setStyle(el, name, null)).toThrow(TypeError);
      expect(el.style.setProperty).not.toHaveBeenCalled();
      expect(el.style.removeProperty).not.toHaveBeenCalled();
    },
  );

  it.each(["translate", "scale", "rotate", "opacity", "--lof-x", "transform-origin", "transformation"])("accepts the name %s", (name) => {
    const env = createBrowserLayoutEnvironment(fakeWindow() as never);
    const el = fakeElement();
    expect(() => env.setStyle(el, name, "1")).not.toThrow();
    expect(el.style.setProperty).toHaveBeenCalledWith(name, "1");
  });

  it("reads a style, and sets a timer that can be cancelled", () => {
    const win = { ...fakeWindow(), setTimeout: vi.fn(() => 9), clearTimeout: vi.fn() };
    const env = createBrowserLayoutEnvironment(win as never);
    const el = { ...fakeElement(), style: { setProperty: vi.fn(), removeProperty: vi.fn(), getPropertyValue: vi.fn(() => "3px 4px") } };
    expect(env.getStyle!(el, "translate")).toBe("3px 4px");
    const cancel = env.after!(5000, () => undefined);
    expect(win.setTimeout).toHaveBeenCalledWith(expect.any(Function), 5000);
    cancel();
    expect(win.clearTimeout).toHaveBeenCalledWith(9);
  });

  it("unmounts a child of the container, and does nothing for an element that is not one", () => {
    const env = createBrowserLayoutEnvironment(fakeWindow() as never);
    const container = { removeChild: vi.fn() };
    const child = fakeElement(container);
    expect(env.unmount!(container, child)).toBe(true);
    expect(container.removeChild).toHaveBeenCalledWith(child);
    container.removeChild.mockClear();
    expect(env.unmount!(container, fakeElement({}))).toBe(false);
    expect(env.unmount!(container, fakeElement())).toBe(false);
    expect(container.removeChild).not.toHaveBeenCalled();
  });
});
