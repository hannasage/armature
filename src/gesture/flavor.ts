import { validateFlavor, type Flavor, type GestureFlavor } from "../engine/flavor";

/** The gesture part of a flavor. Throws a clear TypeError when the flavor has none or does not hold together. */
export function requireGesture(flavor: Flavor): GestureFlavor {
  validateFlavor(flavor);
  if (flavor.gesture === undefined) throw new TypeError(`The flavor "${flavor.name}" has no gesture part.`);
  return flavor.gesture;
}
