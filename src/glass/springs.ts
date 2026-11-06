/**
 * The glass springs, as named exports: the six presets, the three reveal springs, and the drag spring. They are the same objects as `glassFlavor.springs`, so the values live in one place.
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

const reveal = glassFlavor.reveal;

/**
 * The spring of a slow reveal and of a fast one, on the progress `p` (travel 1). The slow one is the library's `gentle` (120)
 * with a little more damping, and the fast one is `lensWidth`'s wobble (180) with a little more damping. With the presets as
 * they are, the overshoot would be 7.3 percent and 20.8 percent of the travel. These two give 3.5 and 12.0 percent, which is
 * what the reveal is meant to feel like.
 */
export const revealSlow = reveal.springs.slow;
export const revealFast = reveal.springs.fast;
/** The spring of a `fade`: nearly critically damped, so a form field never overshoots. */
export const revealCalm = reveal.springs.calm;

/**
 * The spring that pulls a dragged element after its target and back to 0. Slightly under critical, so it settles in about 0.5 s. It rests
 * under 0.02 px (or 0.02 degrees) and 0.1 per second, far below what the eye sees, so the frame loop ends soon after the scroll does.
 */
export const dragSpring = reveal.drag.spring;
