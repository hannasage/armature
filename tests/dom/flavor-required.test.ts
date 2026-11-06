import { afterEach, describe, expect, it, vi } from "vitest";
import { installDelegation } from "../../src/dom/delegate";
import { createLens } from "../../src/dom/lens";
import { createScrollReveal, belowFold, revealRootMargin, startScrollReveal } from "../../src/dom/reveal";
import { guardedSetup } from "../../src/engine/guard";
import { dragTarget, parseDelay, parseDepth, parsePersonality, revealPose, revealSpring, velocityBlend } from "../../src/dom/reveal-motion";
import { attachSurface, createSurface } from "../../src/dom/surface";
import { revealAttributes } from "../../src/dom/reveal-attrs";
import { FakeEnv } from "../helpers/fake-env";
import { FakeRoot as FakeDomRoot } from "../helpers/fake-dom";
import { FakeRoot, FakeScrollEnv } from "../helpers/fake-scroll-env";

// The engine and the DOM controllers have no default flavor. A call that leaves the flavor out fails with a clear TypeError,
// and does not fall back to any flavor. The casts stand in for a caller that is not type checked.
const MISSING = /Expected a flavor object, got undefined/;

describe("a call with no flavor fails clearly", () => {
  it("surface", () => {
    const box = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }) };
    expect(() => createSurface(box, { env: new FakeEnv() } as never)).toThrow(MISSING);
    expect(() => attachSurface({ ...box, addEventListener: () => undefined, removeEventListener: () => undefined }, { env: new FakeEnv() } as never)).toThrow(MISSING);
  });
  it("lens", () => {
    expect(() => createLens({ container: {}, measure: () => null, env: new FakeEnv() } as never)).toThrow(MISSING);
  });
  it("delegation", () => {
    expect(() => installDelegation(new FakeDomRoot(), { env: new FakeEnv() } as never)).toThrow(MISSING);
  });
  it("scroll reveal", () => {
    expect(() => createScrollReveal({ root: new FakeRoot(), env: new FakeScrollEnv() } as never)).toThrow(MISSING);
  });
  it("the reveal numbers", () => {
    expect(() => velocityBlend(1, undefined as never)).toThrow(MISSING);
    expect(() => revealSpring(1, undefined as never)).toThrow(MISSING);
    expect(() => parsePersonality("drop", undefined as never)).toThrow(MISSING);
    expect(() => parseDelay("1", undefined as never)).toThrow(MISSING);
    expect(() => parseDepth("1", undefined as never)).toThrow(MISSING);
    expect(() => dragTarget(1, 1, undefined as never)).toThrow(MISSING);
    expect(() => revealPose({ x: 0, y: 0, scale: 1, rotate: 0 }, 0.5, undefined as never)).toThrow(MISSING);
    expect(() => revealRootMargin(undefined as never)).toThrow(MISSING);
    expect(() => belowFold(1, 1, undefined as never)).toThrow(MISSING);
    expect(() => revealAttributes("drop", undefined, undefined as never)).toThrow(MISSING);
  });
});

describe("a failure reported with no flavor", () => {
  afterEach(() => vi.restoreAllMocks());

  it("guardedSetup logs with the engine's own label and does not throw", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => guardedSetup("x", () => { throw new Error("boom"); }, undefined, undefined as never)()).not.toThrow();
    expect(spy.mock.calls[0]?.[0]).toBe("[armature] x failed to start and was skipped.");
  });

  it("startScrollReveal logs with the engine's own label and does not throw", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(startScrollReveal(() => { throw new Error("boom"); }, {} as never)).toBeNull();
    expect(spy.mock.calls[0]?.[0]).toBe("[armature] scroll reveal failed to start; every element is shown instead.");
  });
});
