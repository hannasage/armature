/**
 * A kind says what a value is made of. The value controller springs the components of a kind one by one, so a kind turns a value
 * into an array of numbers and back. It also parses, interpolates, measures distance, and writes a value as text.
 * This file holds the number kind and the vector kind. Other kinds, such as color, follow the same interface.
 */
import { lerp } from "../engine/math";

export interface Kind<T> {
  readonly name: string;
  /** Turns an input into a value, or throws a TypeError that says what the kind needs. */
  parse(input: unknown): T;
  /** The numbers a value is made of. It returns a new array. */
  toArray(value: T): number[];
  /** The value that a list of components makes. */
  fromArray(parts: readonly number[]): T;
  interpolate(from: T, to: T, progress: number): T;
  distance(a: T, b: T): number;
  /** The value as text, with at most 4 decimals. */
  serialize(value: T): string;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const text = (value: number) => String(Number(value.toFixed(4)));

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
