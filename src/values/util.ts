// Small helpers that the kinds share. They are internal: `index.ts` does not export this file.
import { lerp } from "../engine/math";

export const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** A number as text, with at most 4 decimals and no trailing zeros. */
export const text = (value: number): string => String(Number(value.toFixed(4)));

/** The straight-line distance between two lists of numbers of the same length. */
export const gap = (a: readonly number[], b: readonly number[]): number => Math.sqrt(a.reduce((sum, n, i) => sum + (n - b[i]) ** 2, 0));

/** Each number of `a` moved toward the one of `b` by `progress`. */
export const mix = (a: readonly number[], b: readonly number[], progress: number): number[] => a.map((n, i) => lerp(n, b[i], progress));
