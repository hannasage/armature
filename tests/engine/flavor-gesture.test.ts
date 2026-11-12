import { describe, expect, it } from "vitest";
import { defineFlavor, validateFlavor, type Flavor, type GestureFlavor } from "../../src/engine/flavor";
import { requireGesture } from "../../src/gesture";
import { glassFlavor } from "../../src/glass/flavor";
import { projection } from "../../examples/projection/flavor";
import { swipey } from "../helpers/gesture-flavor";

const part = swipey.gesture as GestureFlavor;
const withGesture = (patch: Partial<Record<keyof GestureFlavor, unknown>> | undefined, base: Flavor = swipey): Flavor =>
  ({ ...base, gesture: patch === undefined ? undefined : { ...part, ...patch } }) as Flavor;

describe("the gesture part of a flavor", () => {
  it("is optional: the glass flavor and the Projection flavor have none and stay valid", () => {
    expect(glassFlavor.gesture).toBeUndefined();
    expect(projection.gesture).toBeUndefined();
    expect(() => validateFlavor(glassFlavor)).not.toThrow();
    expect(() => validateFlavor(projection)).not.toThrow();
  });

  it("validates a good part, and defineFlavor freezes it", () => {
    expect(() => validateFlavor(withGesture({}))).not.toThrow();
    const frozen = defineFlavor({ ...swipey, gesture: { ...part, rest: { ...part.rest }, swipe: { ...part.swipe }, rubberBand: { ...part.rubberBand }, springKeys: { ...part.springKeys } } });
    expect(Object.isFrozen(frozen.gesture)).toBe(true);
    expect(Object.isFrozen(frozen.gesture?.swipe)).toBe(true);
  });

  it.each([
    ["friction", 0], ["friction", -1], ["friction", Number.NaN], ["friction", Infinity], ["friction", "4"],
  ])("rejects a friction of %s: %s", (key, value) => {
    expect(() => validateFlavor(withGesture({ [key]: value }))).toThrow(TypeError);
    expect(() => validateFlavor(withGesture({ [key]: value }))).toThrow('The flavor "swipey" has a gesture part with a friction that is not a finite number above 0.');
  });

  it("rejects a rubber band with a stiffness or a reach that is not a finite number above 0", () => {
    for (const bad of [0, -5, Number.NaN, Infinity]) {
      expect(() => validateFlavor(withGesture({ rubberBand: { stiffness: bad, reach: 120 } }))).toThrow('The flavor "swipey" has a gesture part with a rubber band whose stiffness and reach are not both finite numbers above 0.');
      expect(() => validateFlavor(withGesture({ rubberBand: { stiffness: 300, reach: bad } }))).toThrow(/rubber band/);
    }
    expect(() => validateFlavor(withGesture({ rubberBand: undefined }))).toThrow(/rubber band/);
    expect(() => validateFlavor(withGesture({ rubberBand: null }))).toThrow(/rubber band/);
  });

  it("rejects swipe thresholds that are not both finite numbers above 0", () => {
    for (const bad of [0, -5, Number.NaN, Infinity]) {
      expect(() => validateFlavor(withGesture({ swipe: { velocity: bad, distance: 40 } }))).toThrow('The flavor "swipey" has a gesture part whose swipe velocity and distance are not both finite numbers above 0.');
      expect(() => validateFlavor(withGesture({ swipe: { velocity: 500, distance: bad } }))).toThrow(/swipe velocity and distance/);
    }
    expect(() => validateFlavor(withGesture({ swipe: undefined }))).toThrow(/swipe/);
  });

  it("rejects rest limits that are missing or not finite numbers above 0, with the same words as the other parts", () => {
    expect(() => validateFlavor(withGesture({ rest: { restDelta: 0, restSpeed: 5 } }))).toThrow("has a gesture rest whose restDelta and restSpeed are not both finite numbers above 0.");
    expect(() => validateFlavor(withGesture({ rest: { restDelta: 0.5, restSpeed: Number.NaN } }))).toThrow(TypeError);
    expect(() => validateFlavor(withGesture({ rest: undefined }))).toThrow(/gesture rest/);
  });

  it("rejects a snap spring key that is not in springs, and names the flavor and the key", () => {
    expect(() => validateFlavor(withGesture({ springKeys: { snap: "missing" } }))).toThrow('The flavor "swipey" has no spring named "missing".');
    expect(() => validateFlavor(withGesture({ springKeys: undefined }))).toThrow(TypeError);
  });

  it("rejects a gesture part that is not an object", () => {
    expect(() => validateFlavor({ ...swipey, gesture: 3 } as unknown as Flavor)).toThrow('The flavor "swipey" has a gesture part that is not an object.');
    expect(() => validateFlavor({ ...swipey, gesture: null } as unknown as Flavor)).toThrow(TypeError);
  });
});

describe("requireGesture", () => {
  it("returns the part", () => {
    expect(requireGesture(swipey)).toBe(swipey.gesture);
  });
  it("throws a clear TypeError that names the flavor when the part is missing", () => {
    expect(() => requireGesture(glassFlavor)).toThrow('The flavor "glass" has no gesture part.');
    expect(() => requireGesture(glassFlavor)).toThrow(TypeError);
  });
  it("validates the flavor first", () => {
    expect(() => requireGesture(withGesture({ friction: -1 }))).toThrow(/friction/);
  });
});
