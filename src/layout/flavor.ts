import type { Flavor } from "../engine/flavor";
import { finite, has, plain } from "./util";

/**
 * The layout part of a flavor. A layout writes the individual CSS properties `translate` and `scale`, so the part names no variable and no attribute.
 * Offsets are in pixels, and a size is a difference in pixels too, so one rest threshold in pixels serves every part of a move.
 * - `springKeys.move` is a key in `Flavor.springs`: the spring a layout change, and a shared element, goes back to zero on.
 * - `springKeys.exit` is the key of the spring of an exit. It defaults to `move`.
 * - `rest` is a `RestLimits`. A move rests when its offset (px) is below `restDelta` and its speed (px per second) is below `restSpeed`.
 *   A spring that sets its own limits keeps them.
 */
export type LayoutFlavor = NonNullable<Flavor["layout"]>;

/**
 * Checks the layout part of a flavor, and throws a TypeError that names the flavor when it does not hold together. A flavor with no part passes.
 * `validateFlavor` does not run it, because the spring-only entry has no room under its cap. `createLayout`, `createPresence`, `createShared`,
 * and `requireLayout` run it. The maintainer chose this for the timeline part on 2026-11-12 (option A), and the layout part follows it.
 */
export function checkLayoutFlavor(flavor: Flavor, label: string): void {
  const part: unknown = flavor.layout;
  if (part === undefined) return;
  if (!plain(part)) throw new TypeError(`${label} has a layout part that is not an object.`);
  const { springKeys, rest } = part;
  if (!plain(springKeys)) throw new TypeError(`${label} has a layout part with no spring keys.`);
  const springs: unknown = flavor.springs;
  for (const name of ["move", "exit"]) {
    const key = springKeys[name];
    if (key === undefined && name === "exit") continue;
    if (typeof key !== "string") throw new TypeError(`${label} has a layout spring key "${name}" that is not text.`);
    if (!has(springs, key)) throw new TypeError(`${label} has no spring named "${key}".`);
    if (!plain((springs as Record<string, unknown>)[key])) throw new TypeError(`${label} has a spring "${key}" that is not an object.`);
  }
  if (!plain(rest)) throw new TypeError(`${label} has a layout part with no rest limits.`);
  for (const name of ["restDelta", "restSpeed"]) {
    const value = rest[name];
    if (!finite(value) || value <= 0) throw new TypeError(`${label} has a layout part with a rest limit "${name}" that is not a finite number above 0.`);
  }
}

/** The layout part of a flavor. Throws a clear TypeError when the flavor has none or does not hold together. */
export function requireLayout(flavor: Flavor): LayoutFlavor {
  if (typeof flavor !== "object" || flavor === null) throw new TypeError(`Expected a flavor object, got ${flavor === null ? "null" : typeof flavor}.`);
  const label = `The flavor "${flavor.name}"`;
  checkLayoutFlavor(flavor, label);
  if (flavor.layout === undefined) throw new TypeError(`${label} has no layout part.`);
  return flavor.layout;
}
