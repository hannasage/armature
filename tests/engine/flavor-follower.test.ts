import { describe, expect, it } from "vitest";
import { requireFollower, validateFlavor, type Flavor, type FollowerSpec } from "../../src/engine/flavor";
import { glassFlavor } from "../../src/glass/flavor";
import { acme } from "../helpers/other-flavor";

const thumb: FollowerSpec = { var: "thumb", springKey: "tap", rest: { restDelta: 0.001, restSpeed: 0.01 } };
const withFollowers = (follower: Flavor["follower"], patch: Partial<Flavor> = {}): Flavor => ({ ...acme, follower, ...patch });

describe("the follower part of a flavor", () => {
  it("is optional: the glass flavor and the test flavor have none and still validate", () => {
    expect(glassFlavor.follower).toBeUndefined();
    expect(() => validateFlavor(glassFlavor)).not.toThrow();
    expect(() => validateFlavor(acme)).not.toThrow();
  });

  it("validates when every follower names a spring that exists", () => {
    expect(() => validateFlavor(withFollowers({ thumb, grow: { ...thumb, var: "grow", springKey: "letgo" } }))).not.toThrow();
  });

  it("rejects a follower whose spring key is missing from springs, and names the flavor and the key", () => {
    const flavor = withFollowers({ thumb: { ...thumb, springKey: "nope" } });
    expect(() => validateFlavor(flavor)).toThrow('The flavor "acme" has no spring named "nope".');
    expect(() => validateFlavor(flavor)).toThrow(TypeError);
  });

  it("rejects a spring key that only Object has", () => {
    expect(() => validateFlavor(withFollowers({ thumb: { ...thumb, springKey: "constructor" } }))).toThrow(TypeError);
  });

  it("rejects a follower with an empty or missing variable suffix and names the follower", () => {
    expect(() => validateFlavor(withFollowers({ thumb: { ...thumb, var: "" } }))).toThrow('The flavor "acme" has a follower "thumb" with no variable name.');
    expect(() => validateFlavor(withFollowers({ thumb: { ...thumb, var: undefined as never } }))).toThrow(/follower "thumb"/);
  });

  it("rejects a follower part that is not an object, and a follower entry that is not an object", () => {
    expect(() => validateFlavor(withFollowers(3 as never))).toThrow('The flavor "acme" has a follower part that is not an object.');
    expect(() => validateFlavor(withFollowers({ thumb: null as never }))).toThrow(/follower "thumb"/);
  });
});

describe("requireFollower", () => {
  const flavor = withFollowers({ thumb });

  it("returns the named follower", () => {
    expect(requireFollower(flavor, "thumb")).toBe(thumb);
  });

  it("throws a clear TypeError when the flavor has no follower part", () => {
    expect(() => requireFollower(acme, "thumb")).toThrow('The flavor "acme" has no follower part.');
    expect(() => requireFollower(acme, "thumb")).toThrow(TypeError);
    expect(() => requireFollower(glassFlavor, "thumb")).toThrow('The flavor "glass" has no follower part.');
  });

  it("throws a clear TypeError for a name the flavor does not have, including names Object has", () => {
    expect(() => requireFollower(flavor, "slide")).toThrow('The flavor "acme" has no follower named "slide".');
    expect(() => requireFollower(flavor, "constructor")).toThrow(TypeError);
    expect(() => requireFollower(flavor, "toString")).toThrow(TypeError);
  });

  it("runs validateFlavor first", () => {
    expect(() => requireFollower(withFollowers({ thumb }, { prefix: "Bad" }), "thumb")).toThrow('The flavor "acme" has the prefix');
  });

  it("throws a clear TypeError when the argument is not an object", () => {
    for (const value of [0, "glass", undefined, null]) expect(() => requireFollower(value as never, "thumb"), String(value)).toThrow(/Expected a flavor object/);
  });
});
