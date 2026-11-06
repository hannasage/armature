import { describe, expect, it } from "vitest";
import { validateFlavor, type Flavor, type FollowerSpec } from "../../src/engine/flavor";
import { acme } from "../helpers/other-flavor";

const rest = { restDelta: 0.001, restSpeed: 0.01 };
const thumb: FollowerSpec = { var: "thumb", springKey: "tap", rest };
const withFollowers = (follower: Flavor["follower"]): Flavor => ({ ...acme, follower });

describe("validateFlavor and follower variable names", () => {
  it("rejects a name that is not lowercase letters, digits, and hyphens starting with a letter", () => {
    for (const name of ["Thumb", "1a", "-a", "a b", "a_b", "a.b", "é", "a:b"]) {
      expect(() => validateFlavor(withFollowers({ thumb: { ...thumb, var: name } })), name).toThrow(/The flavor "acme" has a follower "thumb" with the variable name/);
    }
    for (const name of ["a", "thumb", "thumb-2", "a1-b2"]) expect(() => validateFlavor(withFollowers({ thumb: { ...thumb, var: name } })), name).not.toThrow();
  });

  it("rejects two followers with the same variable name, and names both", () => {
    const flavor = withFollowers({ one: { ...thumb, var: "same" }, two: { ...thumb, var: "same" } });
    expect(() => validateFlavor(flavor)).toThrow(TypeError);
    expect(() => validateFlavor(flavor)).toThrow('The flavor "acme" has the followers "one" and "two" with the same variable name "same".');
  });

  it("rejects a name that a surface variable already uses", () => {
    for (const name of Object.values(acme.surface.vars)) {
      expect(() => validateFlavor(withFollowers({ thumb: { ...thumb, var: name } })), name).toThrow(/follower "thumb" with the variable name "[a-z-]+", which the surface already uses/);
    }
  });

  it("rejects a name that a lens variable already uses", () => {
    for (const name of Object.values(acme.lens.vars)) {
      expect(() => validateFlavor(withFollowers({ thumb: { ...thumb, var: name } })), name).toThrow(/which the lens already uses/);
    }
  });

  it("rejects a name that the reveal delay property already uses", () => {
    expect(() => validateFlavor(withFollowers({ thumb: { ...thumb, var: acme.reveal.delayProperty } }))).toThrow(/which the reveal already uses/);
  });

  it("allows a follower name that only looks like a variable of a part the flavor does not have", () => {
    const bare: Flavor = { name: "bare", prefix: "zz", logLabel: "bare", springs: { s: { stiffness: 1, damping: 1 } }, follower: { x: { var: "press", springKey: "s", rest } } };
    expect(() => validateFlavor(bare)).not.toThrow();
  });
});
