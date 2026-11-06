import { describe, expect, it } from "vitest";
import { glassFlavor } from "../src/glass/flavor";
import * as spring from "../src/engine/spring";
import * as legacy from "./golden/legacy/spring";

describe("spring keeps its old exports", () => {
  it("has every legacy export, with the same value for each constant and preset", () => {
    for (const [name, value] of Object.entries(legacy)) {
      expect(name in spring, name).toBe(true);
      const now = (spring as Record<string, unknown>)[name];
      if (typeof value === "function") expect(typeof now, name).toBe("function");
      else expect(now, name).toStrictEqual(value);
    }
  });
  it("keeps the presets frozen", () => {
    for (const name of ["lensX", "lensWidth", "press", "release", "gentle", "stiff"] as const) expect(Object.isFrozen(spring[name]), name).toBe(true);
  });
});

describe("the presets are the glass flavor's springs", () => {
  it("are the same objects, so the values live in one place", () => {
    expect(spring.lensX).toBe(glassFlavor.springs.lensX);
    expect(spring.lensWidth).toBe(glassFlavor.springs.lensWidth);
    expect(spring.press).toBe(glassFlavor.springs.press);
    expect(spring.release).toBe(glassFlavor.springs.release);
    expect(spring.gentle).toBe(glassFlavor.springs.gentle);
    expect(spring.stiff).toBe(glassFlavor.springs.stiff);
  });
});

describe("MAX_FRAME", () => {
  it("is 0.1 seconds, the value the three frame loops used", () => {
    expect(spring.MAX_FRAME).toBe(0.1);
  });
  it("caps the frame time of a step: a long frame moves the spring like a frame of MAX_FRAME", () => {
    const start = spring.retarget(spring.createSpring(spring.press, 0), 1);
    expect(spring.stepSpring(start, 1, 0.5)).toStrictEqual(spring.stepSpring(start, 1, spring.MAX_FRAME));
    expect(spring.stepSpring(start, 1, 60)).toStrictEqual(spring.stepSpring(start, 1, spring.MAX_FRAME));
    expect(spring.stepSpring(start, 1, 0.09)).not.toStrictEqual(spring.stepSpring(start, 1, spring.MAX_FRAME));
  });
});
