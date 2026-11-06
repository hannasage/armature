import { afterEach, describe, expect, it, vi } from "vitest";
import { guardedSetup } from "../../src/engine/guard";
import { glassFlavor } from "../../src/glass/flavor";
import { guardedSetup as legacyGuardedSetup } from "../golden/legacy/guard";
import { acme } from "../helpers/other-flavor";

afterEach(() => vi.restoreAllMocks());

const boom = new Error("boom");

describe("the log label", () => {
  it("is [liquid-glass] for the glass flavor, the same text as the legacy code", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    guardedSetup("glass mode", () => { throw boom; }, undefined, glassFlavor)();
    legacyGuardedSetup("glass mode", () => { throw boom; })();
    expect(spy.mock.calls).toHaveLength(2);
    expect(spy.mock.calls[0]).toEqual(["[liquid-glass] glass mode failed to start and was skipped.", boom]);
    expect(spy.mock.calls[0]).toEqual(spy.mock.calls[1]);
  });
  it("is the glass label when the glass flavor is passed", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    guardedSetup("x", () => { throw boom; }, undefined, glassFlavor)();
    expect(spy.mock.calls[0]?.[0]).toBe("[liquid-glass] x failed to start and was skipped.");
  });
  it("is the flavor's label for another flavor, on the start path and on the stop path", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    guardedSetup("delegation", () => { throw boom; }, undefined, acme)();
    guardedSetup("mode", () => () => { throw boom; }, undefined, acme)();
    expect(spy.mock.calls).toEqual([
      ["[acme-motion] delegation failed to start and was skipped.", boom],
      ["[acme-motion] mode (while stopping) failed to start and was skipped.", boom],
    ]);
  });
  it("is not used when the caller gives a report function", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const report = vi.fn();
    guardedSetup("x", () => { throw boom; }, report, acme)();
    expect(report).toHaveBeenCalledWith(boom, "x");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("the behavior is unchanged", () => {
  it("returns the cleanup the setup gave, and runs it once per call", () => {
    const cleanup = vi.fn();
    const stop = guardedSetup("x", () => cleanup, undefined, acme);
    stop();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
  it("returns a no-op for a setup that gave nothing", () => {
    expect(() => guardedSetup("x", () => undefined, undefined, acme)()).not.toThrow();
  });
});
