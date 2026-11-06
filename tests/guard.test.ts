import { describe, expect, it, vi } from "vitest";
import { guardedSetup } from "../src/engine/guard";

describe("guardedSetup", () => {
  it("runs the setup once and hands back its cleanup", () => {
    const cleanup = vi.fn();
    const setup = vi.fn(() => cleanup);
    const stop = guardedSetup("test", setup, vi.fn());
    expect(setup).toHaveBeenCalledTimes(1);
    stop();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("does not throw when the setup throws, reports it once with its context, and gives a cleanup that does nothing", () => {
    const report = vi.fn();
    const stop = guardedSetup("media query", () => { throw new Error("matchMedia is not a function"); }, report);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][1]).toBe("media query");
    expect((report.mock.calls[0][0] as Error).message).toContain("matchMedia");
    expect(() => stop()).not.toThrow();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("accepts a setup with no cleanup, and reports a cleanup that throws instead of throwing", () => {
    const report = vi.fn();
    expect(() => guardedSetup("none", () => undefined, report)()).not.toThrow();
    expect(report).not.toHaveBeenCalled();
    guardedSetup("bad stop", () => () => { throw new Error("stop failed"); }, report)();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][1]).toBe("bad stop (while stopping)");
  });

  it("logs to console.error by default", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      guardedSetup("default", () => { throw new Error("boom"); });
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0][0])).toContain("default");
    } finally { error.mockRestore(); }
  });
});
