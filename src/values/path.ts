/**
 * The path kind. A path value is SVG path data. A kind is made for one structure: the commands of a template path, in order. Every path that
 * the kind reads has that structure, so the numbers of two paths line up one to one, and a spring or a tween can move each number.
 *
 * A path with another structure is rejected with a TypeError that names both structures. There is no resampler: it cannot blend a path with
 * three segments into one with four, and it does not guess. A relative command (`l`) and an absolute one (`L`) are different commands. The two
 * arc flags are part of the structure, because a flag cannot be blended. `z` and `Z` are the same command.
 *
 * `parse` and `toArray` keep the full precision of the numbers. Only `serialize` and `fromArray`, which write text, round to 6 decimals.
 */
import type { Kind } from "./kind";
import { finite, gap, mix } from "./util";

interface Segment {
  /** The command letter. `Z` for a close. */
  c: string;
  n: number[];
}

/** How many numbers each command takes. */
const ARITY: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/iy;
const SEPARATOR = /[\s,]*/y;
const isArc = (c: string) => c === "a" || c === "A";
/** The numbers of an arc at these places are flags. */
const isFlag = (c: string, index: number) => isArc(c) && (index === 3 || index === 4);

/** The segments of path data. Implicit repeats become explicit, so `M 0 0 1 1` reads as a move and a line. */
function read(input: unknown): Segment[] {
  if (typeof input !== "string") throw new TypeError("A path value must be a string of SVG path data.");
  const segments: Segment[] = [];
  let i = 0;
  const fail: (why: string) => never = (why) => {
    throw new TypeError(`A path value must be SVG path data, and this one ${why} at position ${i}.`);
  };
  const skip = () => {
    SEPARATOR.lastIndex = i;
    SEPARATOR.test(input);
    i = SEPARATOR.lastIndex;
  };
  skip();
  if (i >= input.length) fail("is empty");
  while (i < input.length) {
    let c = input[i];
    const arity = ARITY[c.toLowerCase()];
    if (!/[a-z]/i.test(c) || arity === undefined) fail(`has "${c}" where a command should be`);
    if (segments.length === 0 && c !== "M" && c !== "m") fail("must start with a moveto (M or m), and it starts with another command");
    i += 1;
    skip();
    if (arity === 0) {
      segments.push({ c: "Z", n: [] });
      continue;
    }
    do {
      const n: number[] = [];
      for (let j = 0; j < arity; j += 1) {
        if (isFlag(c, j)) {
          if (input[i] !== "0" && input[i] !== "1") fail("has an arc flag that is not 0 or 1");
          n.push(+input[i]);
          i += 1;
        } else {
          NUMBER.lastIndex = i;
          const match = NUMBER.exec(input);
          if (!match) fail(`needs ${arity} numbers for the command ${c}`);
          const value = +match[0];
          if (!Number.isFinite(value)) fail("has a number that is not finite");
          n.push(value);
          i = NUMBER.lastIndex;
        }
        skip();
      }
      segments.push({ c, n });
      // More numbers after a command repeat it. After a moveto they draw lines.
      c = c === "M" ? "L" : c === "m" ? "l" : c;
    } while (i < input.length && !/[a-z]/i.test(input[i]));
  }
  return segments;
}

/** The structure of a path: the commands in order, and the flags of an arc. */
const shapeOf = (segments: Segment[]): string[] => segments.map(({ c, n }) => (isArc(c) ? `${c}${n[3]}${n[4]}` : c));
/** A number rounded to 6 decimals, with no trailing zeros. Six decimals keep a path on a 0 to 1 viewBox exact to 1e-6. */
const round = (n: number): string => String(Number(n.toFixed(6)));
const write = (segments: Segment[], digits: (n: number) => string): string => segments.map(({ c, n }) => [c, ...n.map(digits)].join(" ")).join(" ");

/**
 * A kind for the paths that have the structure of `template`. The numbers of a path are in the units of its coordinates, and the rest distance
 * defaults to 0.01 of a unit. On a unit viewBox (0 to 1) that is 1% of the box, so pass `{ restDelta }` there, for example 0.0001.
 */
export function pathKind(template: string, options: { restDelta?: number } = {}): Kind<string, false> {
  if (options.restDelta !== undefined && !(finite(options.restDelta) && options.restDelta > 0)) throw new TypeError("The restDelta of a path kind must be a finite number above 0.");
  const base = read(template);
  const shape = shapeOf(base);
  const expected = shape.join(" ");

  const check = (input: unknown): Segment[] => {
    const segments = read(input);
    const got = shapeOf(segments).join(" ");
    if (got !== expected) throw new TypeError(`The path has a different structure than the template. Expected "${expected}" and got "${got}".`);
    return segments;
  };
  const count = base.reduce((sum, { c, n }) => sum + n.filter((_, j) => !isFlag(c, j)).length, 0);
  const toArray = (value: string): number[] => check(value).flatMap(({ c, n }) => n.filter((_, j) => !isFlag(c, j)));
  const fromArray = (parts: readonly number[]): string => {
    if (parts.length !== count || !parts.every(finite)) throw new TypeError(`A path of the structure "${expected}" needs ${count} finite numbers.`);
    let k = 0;
    return write(
      base.map(({ c, n }) => ({ c, n: n.map((flag, j) => (isFlag(c, j) ? flag : parts[k++])) })),
      round,
    );
  };

  return {
    name: `path:${shape.join("")}`,
    restDelta: options.restDelta,
    parse: (input) => write(check(input), String),
    toArray,
    fromArray,
    interpolate: (from, to, progress) => fromArray(mix(toArray(from), toArray(to), progress)),
    distance: (a, b) => gap(toArray(a), toArray(b)),
    serialize: (value) => write(check(value), round),
  };
}
