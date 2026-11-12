import { describe, expect, it } from "vitest";
import { defineFlavor, requireFollower, validateFlavor, type Flavor, type RestLimits } from "../../src/engine/flavor";
import { glassFlavor } from "../../src/glass/flavor";
import { acme } from "../helpers/other-flavor";

// Amendment 2, item 3: one name, `rest`, for the rest limits of a surface, a lens, and a follower, and `followers` for the follower part.

const limits: RestLimits = { restDelta: 0.001, restSpeed: 0.01 };
const springs = { s: { stiffness: 100, damping: 10 } };
const base = { name: "n", prefix: "n", logLabel: "n", springs };

describe("RestLimits", () => {
  it("is the one shape of the surface rest, the lens rest, and the follower rest", () => {
    const surfaceRest: RestLimits = glassFlavor.surface!.rest;
    const lensRest: RestLimits = glassFlavor.lens!.rest;
    const followerRest: RestLimits = { ...limits };
    expect(surfaceRest).toEqual(expect.objectContaining({ restDelta: expect.any(Number), restSpeed: expect.any(Number) }));
    expect(lensRest).toEqual({ restDelta: 0.05, restSpeed: 1 });
    expect(followerRest).toEqual(limits);
  });
});

describe("the new names", () => {
  it("validates a flavor with `lens.rest` and a `followers` part", () => {
    expect(() => validateFlavor(acme)).not.toThrow();
    const flavor: Flavor = { ...base, followers: { thumb: { var: "thumb", springKey: "s", rest: limits } } };
    expect(() => validateFlavor(flavor)).not.toThrow();
    expect(requireFollower(flavor, "thumb").var).toBe("thumb");
  });

  it("freezes the followers part with defineFlavor", () => {
    const flavor = defineFlavor({ ...base, followers: { thumb: { var: "thumb", springKey: "s", rest: limits } } });
    expect(Object.isFrozen(flavor.followers)).toBe(true);
  });

  it("checks a lens rest with a bad number under the new name", () => {
    const flavor: Flavor = { ...acme, lens: { ...acme.lens!, rest: { restDelta: 0, restSpeed: 1 } } };
    expect(() => validateFlavor(flavor)).toThrow(/The flavor "acme" has a lens rest/);
  });
});

describe("the old names", () => {
  it("throws a TypeError that says `rest` when a lens still has `pixelRest`", () => {
    const flavor = { ...acme, lens: { ...acme.lens!, pixelRest: limits } } as unknown as Flavor;
    expect(() => validateFlavor(flavor)).toThrow(TypeError);
    expect(() => validateFlavor(flavor)).toThrow('The flavor "acme" has a lens part with "pixelRest". Use "rest" instead.');
  });

  it("throws a TypeError that says `followers` when a flavor still has `follower`", () => {
    const flavor = { ...base, follower: { thumb: { var: "thumb", springKey: "s", rest: limits } } } as unknown as Flavor;
    expect(() => validateFlavor(flavor)).toThrow(TypeError);
    expect(() => validateFlavor(flavor)).toThrow('The flavor "n" has a "follower" part. Use "followers" instead.');
  });

  it("refuses the old names in defineFlavor and in the require helpers too", () => {
    const old = { ...base, follower: {} } as unknown as Flavor;
    expect(() => defineFlavor(old)).toThrow(/Use "followers" instead/);
    expect(() => requireFollower(old, "thumb")).toThrow(/Use "followers" instead/);
  });

  it("names the old field even when its value is undefined or empty", () => {
    expect(() => validateFlavor({ ...base, follower: undefined } as unknown as Flavor)).toThrow(/Use "followers" instead/);
    expect(() => validateFlavor({ ...acme, lens: { ...acme.lens!, pixelRest: undefined } } as unknown as Flavor)).toThrow(/Use "rest" instead/);
  });
});
