import { afterEach, describe, expect, it, vi } from "vitest";
import { createScheduler } from "../../src/frame";
import { createValue, numberKind } from "../../src/values";
import { FakeEnv } from "../helpers/fake-env";

// A step that throws once must not freeze the value. The vector step is replaced so that the first call throws.
const control = vi.hoisted(() => ({ fail: true }));
vi.mock("../../src/values/vector", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/values/vector")>();
  return {
    ...actual,
    stepVectorSpring: (...args: Parameters<typeof actual.stepVectorSpring>) => {
      if (control.fail) {
        control.fail = false;
        throw new Error("boom");
      }
      return actual.stepVectorSpring(...args);
    },
  };
});

afterEach(() => vi.restoreAllMocks());

describe("a step that throws", () => {
  it("is logged by the scheduler, and to() works again afterward", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    control.fail = true;
    const env = new FakeEnv();
    const scheduler = createScheduler(env);
    const value = createValue(scheduler, numberKind, 0, { spring: { stiffness: 220, damping: 14 } });
    value.to(1);
    env.tick(1000 / 60);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(scheduler.size).toBe(0);
    value.to(1);
    expect(scheduler.size).toBe(1);
    env.settle();
    expect(value.get()).toBe(1);
  });
});
