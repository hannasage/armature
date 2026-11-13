// CSS output: functions that return strings. No DOM, no environment, no browser global, so it runs on a server, in a build step, or in a test.
// A spring or a curve becomes `linear()`, a timeline becomes `@keyframes`, and a flavor becomes a stylesheet.
// It imports the engine, the curves, the `linear()` exporter, and the timeline, and no DOM, React, Vue, Svelte, or glass code.
export { cssLinear } from "./linear";
export { cssKeyframes, cssKeyframesFit } from "./keyframes";
export type { CssTrack, KeyframesFit, KeyframesOptions } from "./keyframes";
export { cssFlavor } from "./flavor";
