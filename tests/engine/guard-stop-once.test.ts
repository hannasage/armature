import { describe, expect, it, vi } from "vitest";
import { guardedSetup } from "../../src/engine/guard";
import { acme } from "../helpers/other-flavor";

// The stop function that guardedSetup returns runs the cleanup once. A second call does nothing, so a component that stops twice cannot destroy twice.

describe("the stop function of guardedSetup", () => {
  it("runs the cleanup once, however many times it is called", () => {
    const cleanup = vi.fn();
    const stop = guardedSetup("once", () => cleanup, vi.fn(), acme);
    stop();
    stop();
    stop();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("reports a cleanup that throws once, and not again on a second call", () => {
    const report = vi.fn();
    const stop = guardedSetup("bad stop", () => () => { throw new Error("stop failed"); }, report, acme);
    stop();
    stop();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("stays a no-op after a failed setup", () => {
    const report = vi.fn();
    const stop = guardedSetup("bad setup", () => { throw new Error("no"); }, report, acme);
    stop();
    stop();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("runs the cleanup once even when the reporter throws, and when the cleanup stops again from inside", () => {
    const cleanup = vi.fn(() => { throw new Error("stop failed"); });
    const stop = guardedSetup("loud", () => cleanup, () => { throw new Error("reporter failed"); }, acme);
    expect(() => stop()).toThrow("reporter failed");
    expect(() => stop()).not.toThrow();
    expect(cleanup).toHaveBeenCalledTimes(1);

    const holder: { stop?: () => void } = {};
    const inner = vi.fn(() => holder.stop!());
    holder.stop = guardedSetup("re-entrant", () => inner, vi.fn(), acme);
    holder.stop();
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
