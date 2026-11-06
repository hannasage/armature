/**
 * The glass spring presets, as named exports. They are the same objects as `glassFlavor.springs`, so the values live in one place.
 */
import { glassFlavor } from "./flavor";

const presets = glassFlavor.springs;

/** The lens position. A little overshoot, so it feels like liquid. */
export const lensX = presets.lensX;
/** The lens width. Looser than position, so the lens breathes as it travels. */
export const lensWidth = presets.lensWidth;
/** A press. Almost critically damped, so it settles without a visible bounce. */
export const press = presets.press;
/** Letting go of a press. Underdamped on purpose, so the surface springs a little past its rest size. */
export const release = presets.release;
/** A soft follow. */
export const gentle = presets.gentle;
/** A firm follow. */
export const stiff = presets.stiff;
