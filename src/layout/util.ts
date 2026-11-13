// Small helpers that the layout controllers and their flavor check share. They are internal: `index.ts` does not export this file.

export const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
export const has = (object: unknown, key: string) => typeof object === "object" && object !== null && Object.prototype.hasOwnProperty.call(object, key);
export const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** An element, or any other thing a controller can write to. */
export const thing = (value: unknown): value is object => (typeof value === "object" || typeof value === "function") && value !== null;
export const toError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));
