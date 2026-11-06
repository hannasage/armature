/** Small pure helpers shared by the engine and by flavors. No flavor knowledge lives here. */

export const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

export const lerp = (from: number, to: number, amount: number): number => from + (to - from) * amount;
