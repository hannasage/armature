import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineFlavor, validateFlavor, type Flavor, type LayoutFlavor } from "../../src/engine/flavor";
import { glassFlavor } from "../../src/glass/flavor";
import { createLayout, createPresence, createShared, requireLayout } from "../../src/layout";
import { projection } from "../../examples/projection/flavor";
import { swipey } from "../helpers/gesture-flavor";
import { FakeLayoutEnv } from "../helpers/fake-layout-env";
import { lofty } from "../helpers/layout-flavor";
import { tempo } from "../helpers/timeline-flavor";

// The layout part is optional. validateFlavor of the spring-only entry does not check it, because that entry has no room under its cap (the
// decision of the maintainer for the timeline part, option A, 2026-11-12). The check runs in requireLayout, createLayout, createPresence, and createShared.
const check = (flavor: Flavor) => requireLayout(flavor);
const part = lofty.layout as LayoutFlavor;
const withPart = (patch: unknown): Flavor => ({ ...lofty, layout: patch }) as unknown as Flavor;
const mix = (patch: Record<string, unknown>) => withPart({ ...part, ...patch });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("the layout part of a flavor", () => {
  it("is optional: the glass flavor, the Projection flavor, a timeline flavor, and a gesture flavor have none and stay valid", () => {
    for (const flavor of [glassFlavor, projection, tempo, swipey]) {
      expect(flavor.layout).toBeUndefined();
      expect(() => validateFlavor(flavor)).not.toThrow();
    }
  });

  it("passes a good part, a part with no exit key, and defineFlavor freezes it", () => {
    expect(() => check(lofty)).not.toThrow();
    expect(() => validateFlavor(lofty)).not.toThrow();
    expect(check(lofty)).toBe(lofty.layout);
    expect(() => check(mix({ springKeys: { move: "move" } }))).not.toThrow();
    const frozen = defineFlavor({ ...lofty, layout: { springKeys: { move: "move" }, rest: { restDelta: 1, restSpeed: 1 } } });
    expect(Object.isFrozen(frozen.layout)).toBe(true);
    expect(Object.isFrozen(frozen.layout?.springKeys)).toBe(true);
  });

  it.each([
    ["a part that is null", null, /layout part that is not an object/],
    ["a part that is a string", "x", /layout part that is not an object/],
    ["a part that is a list", [], /layout part that is not an object/],
    ["no spring keys", { rest: part.rest }, /layout part with no spring keys/],
    ["spring keys that are null", { springKeys: null }, /layout part with no spring keys/],
    ["no move key", { springKeys: {} }, /layout spring key "move"/],
    ["a move key that is not text", { springKeys: { move: 5 } }, /layout spring key "move"/],
    ["a move key that is not a spring", { springKeys: { move: "nope" } }, /no spring named "nope"/],
    ["an exit key that is not a spring", { springKeys: { move: "move", exit: "nope" } }, /no spring named "nope"/],
    ["an exit key that is not text", { springKeys: { move: "move", exit: 3 } }, /layout spring key "exit"/],
    ["an inherited spring key", { springKeys: { move: "toString" } }, /no spring named "toString"/],
    ["no rest limits", { springKeys: part.springKeys }, /layout part with no rest limits/],
    ["rest limits that are null", { rest: null }, /layout part with no rest limits/],
    ["a restDelta of 0", { rest: { restDelta: 0, restSpeed: 1 } }, /rest limit "restDelta"/],
    ["a negative restDelta", { rest: { restDelta: -1, restSpeed: 1 } }, /rest limit "restDelta"/],
    ["a restDelta of NaN", { rest: { restDelta: NaN, restSpeed: 1 } }, /rest limit "restDelta"/],
    ["a restDelta of Infinity", { rest: { restDelta: Infinity, restSpeed: 1 } }, /rest limit "restDelta"/],
    ["a restSpeed of 0", { rest: { restDelta: 1, restSpeed: 0 } }, /rest limit "restSpeed"/],
    ["a restSpeed that is text", { rest: { restDelta: 1, restSpeed: "1" } }, /rest limit "restSpeed"/],
    ["a restSpeed of NaN", { rest: { restDelta: 1, restSpeed: NaN } }, /rest limit "restSpeed"/],
  ])("throws a TypeError that names the flavor for %s", (_name, patch, message) => {
    const flavor = patch !== null && typeof patch === "object" && !Array.isArray(patch) ? mix(patch as Record<string, unknown>) : withPart(patch);
    expect(() => check(flavor)).toThrow(TypeError);
    expect(() => check(flavor)).toThrow(/The flavor "lofty"/);
    expect(() => check(flavor)).toThrow(message);
  });

  it("throws for a spring that is not an object", () => {
    const flavor = { ...lofty, springs: { ...lofty.springs, move: null } } as unknown as Flavor;
    expect(() => check(flavor)).toThrow(/spring "move"/);
  });

  it("is not checked by validateFlavor: a bad part passes it, and fails when a controller is made", () => {
    const bad = mix({ rest: { restDelta: -1, restSpeed: 1 } });
    expect(() => validateFlavor(bad)).not.toThrow();
    const env = new FakeLayoutEnv();
    expect(() => createLayout({}, { flavor: bad, env })).toThrow(/rest limit "restDelta"/);
    expect(() => createPresence({}, { flavor: bad, env })).toThrow(/rest limit "restDelta"/);
    expect(() => createShared({ flavor: bad, env })).toThrow(/rest limit "restDelta"/);
  });

  it("is required by every controller, and the error says so", () => {
    const env = new FakeLayoutEnv();
    expect(() => requireLayout(glassFlavor)).toThrow(/The flavor "liquid-glass" has no layout part/);
    expect(() => createLayout({}, { flavor: tempo, env })).toThrow(/The flavor "tempo" has no layout part/);
    expect(() => createPresence({}, { flavor: tempo, env })).toThrow(/has no layout part/);
    expect(() => createShared({ flavor: tempo, env })).toThrow(/has no layout part/);
  });

  it("throws a TypeError for a flavor that is missing or not an object", () => {
    const env = new FakeLayoutEnv();
    for (const flavor of [undefined, null, 5, "x"]) {
      expect(() => requireLayout(flavor as unknown as Flavor)).toThrow(TypeError);
      expect(() => createLayout({}, { flavor: flavor as unknown as Flavor, env })).toThrow(TypeError);
    }
    expect(() => createLayout({}, undefined as never)).toThrow(TypeError);
  });
});
