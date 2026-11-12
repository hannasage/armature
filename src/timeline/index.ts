// Timeline: tracks, keyframes, sequence and stagger, with play, pause, reverse, seek, and scrub. A step can be a curve, a spring, or a decay.
// It runs on the shared frame scheduler and writes individual CSS properties through an injected environment.
// It imports the engine, the frame scheduler, and the bezier file of /curves. The spring-only entry reaches none of it.
export { createBrowserTimelineEnvironment, createTimeline } from "./timeline";
export type { DecayStep, Keyframe, Timeline, TimelineEnvironment, TimelineOptions, TimelineState, TimelineStep, TrackSpec } from "./timeline";
export { requireTimeline } from "./flavor";
