/**
 * The color kind. A color value is a CSS color string. The kind reads hex, `rgb()`, `hsl()`, and the CSS color names, and it writes `#rrggbb`,
 * or `#rrggbbaa` when the color is not opaque.
 *
 * It blends in OKLab, a perceptual space: an equal step in the numbers is about an equal step to the eye. OKLab has no hue number, so the
 * hue cannot wrap the long way. A straight line between two colors turns the hue by the short arc, and a grey has no hue to jump. The components
 * are the OKLab lightness and the two color axes, each multiplied by the alpha (premultiplied, as CSS blends), then the alpha. A spring and a
 * tween both run on them. A blend that leaves the sRGB gamut is clamped when it is written.
 */
import { clamp } from "../engine/math";
import { namedColors } from "./color-names";
import type { Kind } from "./kind";
import { finite, gap, mix } from "./util";

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/;
const fail = (): never => {
  throw new TypeError("A color value must be a CSS color string: hex, rgb(), hsl(), or a color name.");
};

/** A number token, or a percent token scaled so that 100% is `full`. Anything else is NaN. */
function unit(token: string, full: number): number {
  const percent = token.endsWith("%");
  const body = percent ? token.slice(0, -1) : token;
  return NUMBER.test(body) ? (percent ? (+body * full) / 100 : +body) : NaN;
}

/** sRGB channels 0 to 255 and an alpha 0 to 1, from CSS text. It throws a TypeError for text that is not a color. */
function read(input: unknown): number[] {
  if (typeof input !== "string") return fail();
  const css = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(css);
  if (hex) {
    const digits = hex[1].length < 5 ? hex[1].replace(/./g, "$&$&") : hex[1];
    const n = (digits.match(/../g) ?? fail()).map((pair) => parseInt(pair, 16));
    return [n[0], n[1], n[2], n.length > 3 ? n[3] / 255 : 1];
  }
  const named = css === "transparent" ? 0 : namedColors()[css];
  if (named !== undefined) return [named >> 16, (named >> 8) & 255, named & 255, css === "transparent" ? 0 : 1];
  const call = /^(rgb|hsl)a?\(([^)]*)\)$/.exec(css);
  if (!call) return fail();
  const t = call[2].trim().split(/\s*[,/]\s*|\s+/);
  if (t.length < 3 || t.length > 4) return fail();
  const alpha = t.length === 4 ? unit(t[3], 1) : 1;
  let rgb: number[];
  if (call[1] === "rgb") {
    rgb = t.slice(0, 3).map((token) => unit(token, 255));
  } else {
    const h = ((unit(t[0].replace(/deg$/, ""), 360) % 360) + 360) % 360;
    const s = clamp(unit(t[1], 100), 0, 100) / 100;
    const l = clamp(unit(t[2], 100), 0, 100) / 100;
    const chroma = s * Math.min(l, 1 - l);
    rgb = [0, 8, 4].map((offset) => {
      const k = (offset + h / 30) % 12;
      return 255 * (l - chroma * clamp(Math.min(k - 3, 9 - k), -1, 1));
    });
  }
  return rgb.concat(alpha).some((n) => !Number.isFinite(n)) ? fail() : [...rgb.map((n) => clamp(n, 0, 255)), clamp(alpha, 0, 1)];
}

const byte = (value: number): string => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");
const write = ([r, g, b, alpha]: number[]): string => {
  const a = Math.round(clamp(alpha, 0, 1) * 255);
  return `#${byte(r)}${byte(g)}${byte(b)}${a < 255 ? byte(a) : ""}`;
};

// Linear sRGB to the cone responses (LMS), then the cube root and the OKLab axes. They are the CSS Color 4 matrices, multiplied through.
const TO_LMS = [0.41222146947, 0.53633253726, 0.051445993268, 0.21190349582, 0.68069955065, 0.10739695354, 0.08830245919, 0.28171883914, 0.62997870167];
const TO_LAB = [0.210454268309, 0.793617774702, -0.0040720430116, 1.97799853243, -2.42859224205, 0.450593709617, 0.0259040424655, 0.782771712458, -0.808675754923];
const FROM_LAB = [1, 0.396337777376, 0.215803757310, 1, -0.105561345816, -0.063854172826, 1, -0.089484177530, -1.29148554802];
const FROM_LMS = [4.0767416361, -3.3077115393, 0.23096990318, -1.2684379733, 2.6097573493, -0.341319376, -0.0041960761387, -0.70341861794, 1.7076146941];
const apply = (m: number[], v: number[]) => [0, 3, 6].map((row) => m[row] * v[0] + m[row + 1] * v[1] + m[row + 2] * v[2]);
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

const toArray = (value: string): number[] => {
  const [r, g, b, alpha] = read(value);
  const [l, a, bb] = apply(TO_LAB, apply(TO_LMS, [r, g, b].map((c) => toLinear(c / 255))).map(Math.cbrt));
  return [l * alpha, a * alpha, bb * alpha, alpha];
};

const fromArray = (parts: readonly number[]): string => {
  if (parts.length < 4 || !parts.slice(0, 4).every(finite)) throw new TypeError("A color needs 4 finite components: the lightness and two axes, each times the alpha, then the alpha.");
  // The parts are premultiplied by the alpha they came with. An alpha past 1 is clamped for the output, and the parts are divided by it first.
  const raw = parts[3];
  if (Math.round(clamp(raw, 0, 1) * 255) === 0) return "#00000000";
  const lms = apply(FROM_LAB, parts.slice(0, 3).map((n) => n / raw)).map((n) => n ** 3);
  return write([...apply(FROM_LMS, lms).map((c) => 255 * toGamma(clamp(c, 0, 1))), raw]);
};

export const colorKind: Kind<string> = {
  name: "color",
  parse: (input) => write(read(input)),
  toArray,
  fromArray,
  restDelta: 0.0002,
  // The ends are exact. A blend between them runs on the premultiplied OKLab components. A progress outside 0 to 1 extrapolates, and the gamut clamp holds it.
  interpolate(from, to, progress) {
    if (!finite(progress)) throw new TypeError("A color progress must be a finite number.");
    return progress === 0 ? write(read(from)) : progress === 1 ? write(read(to)) : fromArray(mix(toArray(from), toArray(to), progress));
  },
  distance: (a, b) => gap(toArray(a), toArray(b)),
  serialize: (value) => write(read(value)),
};
