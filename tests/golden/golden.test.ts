import { describe, expect, it } from "vitest";
import { legacyPort, newPort, logTrace, lensTrace, revealTrace, springScripts, springTrace, surfaceTrace, type Port } from "./harness";

// The reference is the frozen legacy copy. The subject is the current code under src/.
// Every comparison is strict, with no tolerance.
const reference: Port = legacyPort;
const subject: Port = newPort;

describe("golden: springs", () => {
  const names = Object.keys(reference.springs);

  it("covers the six presets, the reveal springs, and the drag spring", () => {
    expect(names).toEqual(["lensX", "lensWidth", "press", "release", "gentle", "stiff", "revealSlow", "revealFast", "revealCalm", "dragSpring"]);
    expect(Object.keys(subject.springs)).toEqual(names);
  });

  for (const script of springScripts()) {
    it(`matches frame by frame: ${script.name}`, () => {
      for (const name of names) {
        const expected = springTrace(reference, reference.springs[name], script);
        const actual = springTrace(subject, subject.springs[name], script);
        expect(actual, name).toStrictEqual(expected);
      }
    });
  }

  it("moves: a trace is not one repeated state", () => {
    const script = springScripts()[0];
    const trace = springTrace(reference, reference.springs.press, script);
    expect(trace.length).toBe(script.steps.length + 1);
    expect(new Set(trace.map((state) => state.value)).size).toBeGreaterThan(20);
  });
});

describe("golden: surface", () => {
  it("writes the same variables and ends in the same state after every frame", () => {
    expect(surfaceTrace(subject)).toStrictEqual(surfaceTrace(reference));
  });
  it("is not an empty trace", () => {
    const names = JSON.stringify(surfaceTrace(reference));
    for (const name of ["--lqg-press", "--lqg-flex", "--lqg-spec-x", "--lqg-spec-y", "--lqg-glow"]) expect(names).toContain(name);
  });
});

describe("golden: lens", () => {
  it("writes the same variables and ends in the same state after every frame", () => {
    expect(lensTrace(subject)).toStrictEqual(lensTrace(reference));
  });
  it("is not an empty trace", () => {
    const names = JSON.stringify(lensTrace(reference));
    for (const name of ["--lqg-lens-x", "--lqg-lens-y", "--lqg-lens-w", "--lqg-lens-h", "--lqg-lens-sx", "--lqg-lens-sy", "data-lqg-lens"]) expect(names).toContain(name);
  });
});

describe("golden: scroll reveal", () => {
  it("writes the same styles and attributes and ends in the same state after every frame", () => {
    expect(revealTrace(subject)).toStrictEqual(revealTrace(reference));
  });
  it("is not an empty trace", () => {
    const text = JSON.stringify(revealTrace(reference));
    for (const name of ["translate", "scale", "rotate", "opacity", "clip-path", "will-change", "data-lqg-revealed", "--lqg-reveal-delay"]) expect(text).toContain(name);
  });
});

describe("golden: the log label", () => {
  it("logs the same arguments on every failure path", () => {
    expect(logTrace(subject)).toStrictEqual(logTrace(reference));
  });
  it("pins the label text", () => {
    const calls = logTrace(reference);
    expect(calls.length).toBe(5);
    for (const call of calls) expect(String(call[0])).toMatch(/^\[liquid-glass\] /);
  });
});

describe("golden: the harness catches a difference", () => {
  const changed: Port = {
    ...newPort,
    createSurface: (element, options) => newPort.createSurface(element, { ...options, pressScale: 0.9 }),
    createLens: (options) => newPort.createLens({ ...options, stretchVelocity: 1000 }),
    createScrollReveal: (options) => newPort.createScrollReveal({ ...options, revealedAttribute: "data-lqg-seen" }),
    guardedSetup: (context, setup) => newPort.guardedSetup(context, setup, () => undefined),
  };
  it("sees a changed surface", () => {
    expect(surfaceTrace(changed)).not.toStrictEqual(surfaceTrace(reference));
  });
  it("sees a changed lens", () => {
    expect(lensTrace(changed)).not.toStrictEqual(lensTrace(reference));
  });
  it("sees a changed reveal", () => {
    expect(revealTrace(changed)).not.toStrictEqual(revealTrace(reference));
  });
  it("sees a changed log", () => {
    expect(logTrace(changed)).not.toStrictEqual(logTrace(reference));
  });
  it("sees a changed spring", () => {
    const script = springScripts()[0];
    expect(springTrace(reference, { stiffness: 171, damping: 26 }, script)).not.toStrictEqual(springTrace(reference, reference.springs.press, script));
  });
});
