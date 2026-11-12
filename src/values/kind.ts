/**
 * A kind says what a value is made of. The value controller springs the components of a kind one by one, so a kind turns a value
 * into an array of numbers and back. It also parses, interpolates, measures distance, and writes a value as text.
 * This file holds the interface, the number kind, and the vector kind. The color kind, the path kind, and the 3D transform kind
 * follow the same interface in their own files.
 */
import { lerp } from "../engine/math";
import { finite, text } from "./util";

export interface Kind<T> {
  readonly name: string;
  /** Turns an input into a value, or throws a TypeError that says what the kind needs. */
  parse(input: unknown): T;
  /** The numbers a value is made of. It returns a new array. */
  toArray(value: T): number[];
  /** The value that a list of components makes. */
  fromArray(parts: readonly number[]): T;
  /**
   * Optional. The rest distance, in the numbers of this kind, that `createValue` uses when the spring sets no `restDelta`. The numbers of a
   * kind have their own scale (a color runs from 0 to 1, a rotation is a unit quaternion, a path is in pixels), so a kind says what "close
   * enough" means for them. A `restDelta` in the spring config wins.
   */
  readonly restDelta?: number;
  /**
   * Optional. Picks, among the component lists that make one and the same target, the one nearest to `from`, so a spring travels the short way.
   * A rotation has two quaternions for one turn, and the controller asks this before it springs. It returns a new array, and a kind with
   * one list per target leaves this out.
   */
  align?(from: readonly number[], to: readonly number[]): number[];
  interpolate(from: T, to: T, progress: number): T;
  distance(a: T, b: T): number;
  /** The value as text, with at most 4 decimals. */
  serialize(value: T): string;
}

export const numberKind: Kind<number> = {
  name: "number",
  parse(input) {
    if (!finite(input)) throw new TypeError("A number value must be a finite number.");
    return input;
  },
  toArray: (value) => [value],
  fromArray: (parts) => parts[0],
  interpolate: lerp,
  distance: (a, b) => Math.abs(a - b),
  serialize: text,
};

/** A kind for an array of `length` numbers, such as a point or a size. */
export function vectorKind(length: number): Kind<number[]> {
  if (!Number.isInteger(length) || length < 1) throw new TypeError("A vector kind needs a whole length of 1 or more.");
  const name = `vector${length}`;
  return {
    name,
    parse(input) {
      if (!Array.isArray(input) || input.length !== length || !input.every(finite)) {
        throw new TypeError(`A ${name} value must be an array of ${length} finite numbers.`);
      }
      return [...input];
    },
    toArray: (value) => [...value],
    fromArray: (parts) => [...parts],
    interpolate: (from, to, progress) => from.map((n, i) => lerp(n, to[i], progress)),
    distance: (a, b) => Math.hypot(...a.map((n, i) => n - b[i])),
    serialize: (value) => value.map(text).join(" "),
  };
}
