import { describe, expect, it } from "vitest";
import { validateFlavor, type Flavor, type FollowerSpec } from "../../src/engine/flavor";
import { glassFlavor } from "../../src/glass/flavor";
import { acme } from "../helpers/other-flavor";
import { projection } from "../../examples/projection/flavor";

const rest = { restDelta: 0.001, restSpeed: 0.01 };
const thumb: FollowerSpec = { var: "thumb", springKey: "tap", rest };
const withSprings = (springs: Flavor["springs"]): Flavor => ({ ...acme, springs: { ...acme.springs, ...springs } });
const withFollowers = (followers: Flavor["followers"]): Flavor => ({ ...acme, followers });

describe("validateFlavor and spring numbers", () => {
  it("still accepts the glass flavor, the Projection example, and the test flavor", () => {
    for (const flavor of [glassFlavor, projection, acme]) expect(() => validateFlavor(flavor)).not.toThrow();
  });

  it("accepts a spring with no mass, a damping of 0, and an extra rest value", () => {
    expect(() => validateFlavor(withSprings({ free: { stiffness: 100, damping: 0 } }))).not.toThrow();
    expect(() => validateFlavor(withSprings({ rested: { stiffness: 100, damping: 1, mass: 2, restDelta: 0.1, restSpeed: 0.1 } }))).not.toThrow();
  });

  it("rejects a stiffness that is missing, zero, negative, or not finite, and names the flavor and the spring", () => {
    for (const stiffness of [undefined, 0, -1, NaN, Infinity, "600"]) {
      const flavor = withSprings({ bad: { stiffness: stiffness as never, damping: 10 } });
      expect(() => validateFlavor(flavor), String(stiffness)).toThrow(TypeError);
      expect(() => validateFlavor(flavor), String(stiffness)).toThrow('The flavor "acme" has a spring "bad" with a stiffness');
    }
  });

  it("rejects a damping that is missing, negative, or not finite", () => {
    for (const damping of [undefined, -0.1, NaN, -Infinity, null]) {
      expect(() => validateFlavor(withSprings({ bad: { stiffness: 100, damping: damping as never } })), String(damping)).toThrow('spring "bad" with a damping');
    }
  });

  it("rejects a mass that is present and zero, negative, or not finite", () => {
    for (const mass of [0, -1, NaN, Infinity, "1"]) {
      expect(() => validateFlavor(withSprings({ bad: { stiffness: 100, damping: 10, mass: mass as never } })), String(mass)).toThrow('spring "bad" with a mass');
    }
  });

  it("rejects a spring that is not an object", () => {
    expect(() => validateFlavor(withSprings({ bad: null as never }))).toThrow('spring "bad" that is not an object');
    expect(() => validateFlavor(withSprings({ bad: 5 as never }))).toThrow(TypeError);
  });
});

describe("validateFlavor and rest limits", () => {
  const badRests = [{ restDelta: 0, restSpeed: 0.01 }, { restDelta: 0.01, restSpeed: -1 }, { restDelta: NaN, restSpeed: 0.01 }, { restDelta: 0.01, restSpeed: Infinity }, { restDelta: undefined, restSpeed: 0.01 }, { restDelta: "1", restSpeed: 1 }];

  it("rejects a follower rest with a bad number, and names the follower", () => {
    for (const bad of badRests) {
      const flavor = withFollowers({ thumb: { ...thumb, rest: bad as never } });
      expect(() => validateFlavor(flavor), JSON.stringify(bad)).toThrow(TypeError);
      expect(() => validateFlavor(flavor), JSON.stringify(bad)).toThrow(/The flavor "acme" has a follower "thumb" with a rest/);
    }
  });

  it("rejects a follower with no rest, and names the flavor and the follower", () => {
    const flavor = withFollowers({ thumb: { var: "thumb", springKey: "tap" } as never });
    expect(() => validateFlavor(flavor)).toThrow(TypeError);
    expect(() => validateFlavor(flavor)).toThrow('The flavor "acme" has a follower "thumb" with no rest limits.');
    expect(() => validateFlavor(withFollowers({ thumb: { ...thumb, rest: null as never } }))).toThrow(/follower "thumb" with no rest limits/);
  });

  it("rejects a surface rest with a bad number", () => {
    for (const bad of badRests) {
      const flavor: Flavor = { ...acme, surface: { ...acme.surface, rest: bad as never } };
      expect(() => validateFlavor(flavor), JSON.stringify(bad)).toThrow(/The flavor "acme" has a surface rest/);
    }
  });

  it("rejects a lens rest with a bad number", () => {
    for (const bad of badRests) {
      const flavor: Flavor = { ...acme, lens: { ...acme.lens, rest: bad as never } };
      expect(() => validateFlavor(flavor), JSON.stringify(bad)).toThrow(/The flavor "acme" has a lens rest/);
    }
  });
});
