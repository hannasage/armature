/** The property and the value that the probe asks about. A browser that does not know `linear()` rejects the value. */
const PROPERTY = "animation-timing-function";
const VALUE = "linear(0, 0.5, 1)";

/** What `CSS.supports` looks like when called with two arguments. A test passes its own. */
export type SupportsProbe = (property: string, value: string) => boolean;

/**
 * True when the browser parses a `linear()` timing function. The rule: `CSS.supports("animation-timing-function", "linear(0, 0.5, 1)")` must
 * return exactly `true`. A missing `CSS` object (a server), a missing `supports`, an answer that is not `true`, and a throw all give false.
 */
export function supportsLinear(probe?: SupportsProbe): boolean {
  try {
    if (probe) return probe(PROPERTY, VALUE) === true;
    const css = (globalThis as { CSS?: { supports?: unknown } }).CSS;
    // Called as a method, because `CSS.supports` throws when it is called on another object.
    return typeof css?.supports === "function" && css.supports(PROPERTY, VALUE) === true;
  } catch {
    return false;
  }
}
