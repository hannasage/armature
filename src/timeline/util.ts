// Small helpers that the timeline and its flavor check share. They are internal: `index.ts` does not export this file.

export const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export const has = (object: unknown, key: string) => typeof object === "object" && object !== null && Object.prototype.hasOwnProperty.call(object, key);
export const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reads a list of keys, `[time, value, step?]`, and maps each one. The list is not empty, and each key has two or three parts. The times are
 * finite, 0 or more, and never go back. `bad` throws the TypeError, so each caller words its own message. The caller checks value and step.
 */
export function mapKeys<T>(source: unknown, bad: (problem: string) => never, each: (value: unknown, step: unknown, index: number, time: number) => T): T[] {
  if (!Array.isArray(source) || source.length === 0) return bad("no keys");
  let last = 0;
  return (source as unknown[]).map((key, i) => {
    if (!Array.isArray(key) || key.length < 2 || key.length > 3) return bad("a key that is not [time, value, step]");
    const [time, value, step] = key as unknown[];
    if (!finite(time) || time < last) return bad("a key time that is not finite, or goes back in time");
    last = time;
    return each(value, step, i, time);
  });
}
