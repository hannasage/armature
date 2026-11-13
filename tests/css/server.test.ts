import { afterEach, describe, expect, it, vi } from "vitest";
import * as css from "../../src/css";
import { acme } from "../helpers/other-flavor";

// /css runs on the server, in a build step, or in a test. It returns strings, takes no environment, and reads no browser global. Here every browser
// global is replaced by an object that throws when it is touched, and the four functions still run.

const trap = (name: string) =>
  new Proxy({}, {
    get() {
      throw new Error(`${name} was touched`);
    },
  });

afterEach(() => vi.unstubAllGlobals());

describe("/css with no browser", () => {
  it("exports four functions that return strings, and nothing else", () => {
    expect(Object.keys(css).sort()).toEqual(["cssFlavor", "cssKeyframes", "cssKeyframesFit", "cssLinear"]);
  });

  it("runs while window, document, CSS, matchMedia, and requestAnimationFrame throw when touched", () => {
    for (const name of ["window", "document", "CSS", "matchMedia", "requestAnimationFrame", "cancelAnimationFrame", "HTMLElement"]) vi.stubGlobal(name, trap(name));
    expect(css.cssLinear({ stiffness: 170, damping: 26 })).toMatch(/^linear\(/);
    expect(css.cssKeyframes("k", { tracks: [{ property: "opacity", keys: [[0, 0], [100, 1]] }], stepMs: 50 })).toContain("@keyframes k {");
    expect(css.cssKeyframesFit("k", { tracks: [{ property: "scale", keys: [[0, 0], [200, 1, { stiffness: 170, damping: 26 }]] }] }).count).toBeGreaterThan(2);
    expect(css.cssFlavor(acme)).toContain("@property --acme-squeeze");
  });

  it("returns a string from each function", () => {
    expect(typeof css.cssLinear({ stiffness: 170, damping: 26 })).toBe("string");
    expect(typeof css.cssKeyframes("k", { tracks: [{ property: "opacity", keys: [[0, 0], [100, 1]] }] })).toBe("string");
    expect(typeof css.cssFlavor(acme)).toBe("string");
  });

  it("starts no frame loop and no timer: nothing is left running after a call", () => {
    const timers = vi.spyOn(globalThis, "setTimeout");
    const intervals = vi.spyOn(globalThis, "setInterval");
    css.cssKeyframes("k", { tracks: [{ property: "opacity", keys: [[0, 0], [100, 1]] }] });
    expect(timers).not.toHaveBeenCalled();
    expect(intervals).not.toHaveBeenCalled();
    timers.mockRestore();
    intervals.mockRestore();
  });
});
