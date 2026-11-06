import { describe, expect, it } from "vitest";
import { defineFlavor, validateFlavor, type Flavor } from "../../src/engine/flavor";
import { glassFlavor } from "../../src/glass/flavor";
import { acme } from "../helpers/other-flavor";
import { projection } from "../../examples/projection/flavor";

/** A deep copy that is not frozen. Functions are shared. */
const copy = <T>(value: T): T => {
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) return value.map(copy) as T;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)])) as T;
};

const isDeepFrozen = (value: unknown, seen = new Set<unknown>()): boolean => {
  if (typeof value !== "object" || value === null || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value) && Object.values(value).every((item) => isDeepFrozen(item, seen));
};

describe("defineFlavor", () => {
  it("returns the flavor it was given", () => {
    const flavor = copy(acme);
    expect(defineFlavor(flavor)).toBe(flavor);
  });

  it("validates, and throws the same TypeError as validateFlavor", () => {
    const bad = { ...copy(acme), prefix: "Bad" };
    expect(() => defineFlavor(bad)).toThrow('The flavor "acme" has the prefix');
    expect(() => defineFlavor(bad)).toThrow(TypeError);
    expect(() => defineFlavor({ ...copy(acme), springs: { x: { stiffness: -1, damping: 1 } } } as Flavor)).toThrow(TypeError);
  });

  it("freezes every level, including springs, parts, arrays, and personalities", () => {
    const flavor = defineFlavor(copy(acme));
    expect(isDeepFrozen(flavor)).toBe(true);
    expect(Object.isFrozen(flavor.springs)).toBe(true);
    expect(Object.isFrozen(flavor.springs.tap)).toBe(true);
    expect(Object.isFrozen(flavor.surface?.defaults.specularRest)).toBe(true);
    expect(Object.isFrozen(flavor.reveal?.personalities.pop)).toBe(true);
  });

  it("makes a later change throw, so the validation cannot go stale", () => {
    const flavor = defineFlavor(copy(acme));
    expect(() => { (flavor as { prefix: string }).prefix = "Bad"; }).toThrow(TypeError);
    expect(() => { (flavor.springs.tap as { stiffness: number }).stiffness = -5; }).toThrow(TypeError);
    expect(() => { (flavor.surface as { hoverGlow: number }).hoverGlow = 9; }).toThrow(TypeError);
    expect(() => { delete (flavor as { surface?: unknown }).surface; }).toThrow(TypeError);
    expect(flavor.prefix).toBe("acme");
    expect(flavor.springs.tap.stiffness).toBe(250);
    expect(() => validateFlavor(flavor)).not.toThrow();
  });

  it("leaves a personality function callable", () => {
    const flavor = defineFlavor(copy(acme));
    const start = flavor.reveal?.personalities.pop.start({ personality: "pop", velocity: 0 }, { t: 0, direction: 1 });
    expect(start).toEqual({ x: 0, y: 10, scale: 0.5, rotate: 3 });
  });

  it("does not freeze the input when validation fails", () => {
    const bad = { ...copy(acme), prefix: "Bad" };
    expect(() => defineFlavor(bad)).toThrow();
    expect(Object.isFrozen(bad)).toBe(false);
    expect(Object.isFrozen(bad.springs)).toBe(false);
  });

  it("accepts a flavor that is already frozen, such as the glass flavor, and a shared or repeated object", () => {
    expect(defineFlavor(glassFlavor)).toBe(glassFlavor);
    const shared = { restDelta: 0.001, restSpeed: 0.01 };
    const flavor = defineFlavor({ name: "s", prefix: "s", logLabel: "s", springs: { a: { stiffness: 1, damping: 1 } }, follower: { x: { var: "x", springKey: "a", rest: shared }, y: { var: "y", springKey: "a", rest: shared } } });
    expect(Object.isFrozen(shared)).toBe(true);
    expect(flavor.follower?.y.rest).toBe(shared);
  });

  it("throws a clear TypeError when the argument is not an object", () => {
    for (const value of [undefined, null, 3, "glass"]) expect(() => defineFlavor(value as never), String(value)).toThrow(/Expected a flavor object/);
  });

  it("is what the Projection example uses: the example is frozen all the way down", () => {
    expect(isDeepFrozen(projection)).toBe(true);
    expect(() => { (projection.springs.mechanical as { damping: number }).damping = 1; }).toThrow(TypeError);
  });
});
