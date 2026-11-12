// Curves: the cubic-bezier evaluator, named easings as data, the tween, and the bezier fitting aid.
// It holds no flavor, reads no environment, and imports no other subpath at run time. The tween value takes a scheduler and a kind as arguments.
export { bezier } from "./bezier";
export type { BezierPoints, Curve, Easing } from "./bezier";
export { easing, easings } from "./easings";
export type { EasingName } from "./easings";
export { createTween, isTweenDone, retargetTween, stepTween } from "./tween";
export type { TweenState } from "./tween";
export { createTweenValue } from "./tween-value";
export type { TweenMove, TweenValue, TweenValueOptions, TweenValueState } from "./tween-value";
export { fitBezier } from "./fit";
export type { BezierFit } from "./fit";
