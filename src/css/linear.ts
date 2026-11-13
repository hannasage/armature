import type { Curve } from "../curves/bezier";
import type { SpringConfig } from "../engine/spring";
import { toLinear, type LinearOptions } from "../linear/linear";

/**
 * The CSS `linear()` string of a spring or a curve, within a tolerance of the solver's own samples. It is `toLinear` from `@hannasage/armature/linear`
 * under a name that says it returns CSS, and it holds no sampling of its own. It throws what `toLinear` throws.
 */
export function cssLinear(source: SpringConfig | Curve, options?: LinearOptions): string {
  return toLinear(source, options);
}
