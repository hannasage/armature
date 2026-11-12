/**
 * The 3D transform kind. A value is a translation, a rotation about an axis, a scale, and a perspective. A spring and a tween both run on
 * these components: the translation, a unit quaternion for the rotation, the scale, and the inverse of the perspective distance.
 *
 * A quaternion and its negative are one rotation. The kind picks the one nearest to where the value is (`align`), and a tween blends along the
 * great arc (slerp), so a rotation always takes the short way and has no gimbal flip. The inverse of the distance, in 1000 / px, lets a
 * perspective of none (0) blend with a real one without passing through a tiny distance.
 *
 * The kind writes only the individual CSS properties `translate`, `rotate`, and `scale`, and never `transform`. The perspective goes on the
 * parent of the element. `transform3dStyles` splits them. The element writes the three properties in the fixed order of CSS (translate,
 * rotate, scale), which is the order that the decomposition has, so no case needs `transform`.
 */
import { clamp } from "../engine/math";
import type { Kind } from "./kind";
import { finite, gap, mix, text } from "./util";

type Triple = [number, number, number];

export interface Transform3D {
  /** Pixels along x, y, and z. */
  translate: Triple;
  /** A turn of `angle` degrees about `axis`. The axis has length 1. */
  rotate: { axis: Triple; angle: number };
  scale: Triple;
  /** Pixels from the viewer to the screen. 0 means none. */
  perspective: number;
}

export interface Transform3DStyles {
  /** The three properties of the element. */
  element: { translate: string; rotate: string; scale: string };
  /** The property of the parent of the element. */
  parent: { perspective: string };
}

const triple = (value: unknown, what: string): Triple => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(finite)) throw new TypeError(`The ${what} of a 3D transform must be an array of 3 finite numbers.`);
  return [value[0], value[1], value[2]];
};

const KEYS = ["translate", "rotate", "scale", "perspective"];
const DEGREE = Math.PI / 360;
// The components: translate 0 to 2, quaternion x y z w 3 to 6, scale 7 to 9, the inverse perspective 10.
const Q = [3, 4, 5, 6];
const dot = (a: readonly number[], b: readonly number[]) => Q.reduce((sum, i) => sum + a[i] * b[i], 0);

const toArray = (input: Transform3D): number[] => {
  // Every method checks its input as parse does: finite parts, a perspective of 0 or more, and an axis that has length 1.
  const v = transform3dKind.parse(input);
  const half = v.rotate.angle * DEGREE;
  const s = Math.sin(half);
  return [...v.translate, v.rotate.axis[0] * s, v.rotate.axis[1] * s, v.rotate.axis[2] * s, Math.cos(half), ...v.scale, v.perspective > 0 ? 1000 / v.perspective : 0];
};

const fromArray = (p: readonly number[]): Transform3D => {
  if (p.length !== 11 || !p.every(finite)) throw new TypeError("A 3D transform needs 11 finite components: translate, a quaternion, scale, and the inverse perspective.");
  const norm = Math.hypot(p[3], p[4], p[5], p[6]);
  const [x, y, z, w] = norm < 1e-9 ? [0, 0, 0, 1] : Q.map((i) => p[i] / norm);
  const length = Math.hypot(x, y, z);
  // A quaternion with no vector part is the identity, whether w is 1 or -1.
  const still = length < 1e-9;
  return {
    translate: [p[0], p[1], p[2]],
    rotate: { axis: still ? [0, 0, 1] : [x / length, y / length, z / length], angle: still ? 0 : (Math.atan2(length, w) * 360) / Math.PI },
    scale: [p[7], p[8], p[9]],
    perspective: p[10] > 1e-9 ? 1000 / p[10] : 0,
  };
};

/** The target components, with the quaternion turned to the side of `from` that it is nearest to. */
const align = (from: readonly number[], to: readonly number[]): number[] => (dot(from, to) < 0 ? to.map((n, i) => (i >= 3 && i <= 6 ? -n : n)) : [...to]);

/** The three properties for an element, and the perspective for its parent. */
export function transform3dStyles(value: Transform3D): Transform3DStyles {
  const { translate, rotate, scale, perspective } = transform3dKind.parse(value);
  return {
    element: {
      translate: translate.map((n) => `${text(n)}px`).join(" "),
      rotate: `${rotate.axis.map(text).join(" ")} ${text(rotate.angle)}deg`,
      scale: scale.map(text).join(" "),
    },
    parent: { perspective: perspective > 0 ? `${text(perspective)}px` : "none" },
  };
}

export const transform3dKind: Kind<Transform3D> = {
  name: "transform3d",
  parse(input) {
    if (input === null || typeof input !== "object" || Array.isArray(input)) throw new TypeError("A 3D transform value must be an object with translate, rotate, scale, and perspective.");
    const given = input as Record<string, unknown>;
    const extra = Object.keys(given).find((key) => !KEYS.includes(key));
    if (extra !== undefined) throw new TypeError(`A 3D transform holds translate, rotate, scale, and perspective, and nothing else. It cannot hold "${extra}".`);
    const { translate = [0, 0, 0], rotate = { axis: [0, 0, 1], angle: 0 }, scale = 1, perspective = 0 } = given;
    const turn = rotate as { axis?: unknown; angle?: unknown } | null;
    if (turn === null || typeof turn !== "object" || !finite(turn.angle)) throw new TypeError("The rotate of a 3D transform must be { axis: [x, y, z], angle } with the angle in degrees.");
    const axis = triple(turn.axis, "rotate axis");
    const length = Math.hypot(...axis);
    if (length === 0 && turn.angle !== 0) throw new TypeError("The rotate axis of a 3D transform needs a length above 0.");
    if (!finite(perspective) || perspective < 0) throw new TypeError("The perspective of a 3D transform must be a finite number of pixels, 0 or more. 0 means none.");
    return {
      translate: triple(translate, "translate"),
      rotate: { axis: length === 0 ? [0, 0, 1] : [axis[0] / length, axis[1] / length, axis[2] / length], angle: turn.angle },
      scale: finite(scale) ? [scale, scale, scale] : triple(scale, "scale"),
      perspective,
    };
  },
  restDelta: 0.0005,
  toArray,
  fromArray,
  align,
  interpolate(from, to, progress) {
    if (!finite(progress)) throw new TypeError("A 3D transform progress must be a finite number.");
    const a = toArray(from);
    const b = align(a, toArray(to));
    const out = mix(a, b, progress);
    // Along the great arc between the two unit quaternions. They are nearly the same rotation when the dot is near 1, and a lerp is then exact enough.
    const cos = clamp(dot(a, b), -1, 1);
    const theta = Math.acos(cos);
    if (cos < 0.9995) {
      const k0 = Math.sin((1 - progress) * theta) / Math.sin(theta);
      const k1 = Math.sin(progress * theta) / Math.sin(theta);
      for (const i of Q) out[i] = k0 * a[i] + k1 * b[i];
    }
    return fromArray(out);
  },
  distance: (a, b) => {
    const x = toArray(a);
    return gap(x, align(x, toArray(b)));
  },
  // The perspective is not in this text. It belongs to the parent, and `transform3dStyles` gives it.
  serialize: (value) => {
    const { element } = transform3dStyles(value);
    return `translate: ${element.translate}; rotate: ${element.rotate}; scale: ${element.scale}`;
  },
};
