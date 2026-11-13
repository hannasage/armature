// A timeline as `@keyframes` text. The values are not worked out here. A real timeline from /timeline is built on a do-nothing environment and
// read at evenly spaced times, so the text holds the numbers that the timeline gives, spring and decay steps included.
import type { Flavor } from "../engine/flavor";
import { createTimeline, type TimelineEnvironment, type TrackSpec } from "../timeline/timeline";
import { escapeIdent } from "./escape";
import { clamp, num, safeValue } from "./text";

/** One track of the text: the CSS property to write, and the keys or the named sequence. `transform` is refused, as it is for a timeline. */
export type CssTrack = Omit<TrackSpec, "target" | "value"> & {
  /** The individual CSS property, such as `opacity`, `translate`, `scale`, `rotate`, or a custom property. Never `transform`. */
  property: string;
};

export interface KeyframesOptions {
  tracks: readonly CssTrack[];
  /** As for a timeline: `"together"` (default) or `"sequence"`. */
  place?: "together" | "sequence";
  /** As for a timeline, in milliseconds. */
  stagger?: number;
  /** For named sequences, curves, and springs. */
  flavor?: Flavor;
  /** Milliseconds between two stops. Default 1000/60. A finite number of 1 or more. At most 5,000 stops are written. */
  stepMs?: number;
}

export interface KeyframesFit {
  css: string;
  /** Milliseconds. Use it as the duration of the animation. */
  duration: number;
  /** The number of stops written. */
  count: number;
}

const MAX_STOPS = 5000;
/** A unit is letters or a percent sign. It cannot carry a digit, a space, or a symbol. */
const UNIT = /^[a-zA-Z%]{0,12}$/;
const idle: TimelineEnvironment = { requestFrame: () => 0, cancelFrame: () => undefined, now: () => 0, setStyle: () => undefined };

/**
 * `@keyframes` text, with the duration and the number of stops. The stops are spaced `stepMs` apart, and the last one is on the end of the timeline.
 * It runs with no DOM and no environment. The name is escaped, a unit is letters only, and the text a `format` function returns must pass `safeValue`.
 * A timeline with no length throws a RangeError, and so does a `stepMs` that would need more than 5,000 stops.
 */
export function cssKeyframesFit(name: string, options: KeyframesOptions): KeyframesFit {
  if (typeof name !== "string" || name === "") throw new TypeError("A keyframes name must be text and not empty.");
  const id = escapeIdent(name);
  if (typeof options !== "object" || options === null) throw new TypeError("Keyframes need an options object.");
  const { tracks, place, stagger, flavor, stepMs = 1000 / 60 } = options;
  if (!Array.isArray(tracks) || tracks.length === 0) throw new TypeError("Keyframes need a list of one or more tracks.");
  if (typeof stepMs !== "number" || !Number.isFinite(stepMs) || stepMs < 1) throw new RangeError("stepMs must be a finite number of 1 or more.");
  for (const track of tracks) {
    if (typeof track !== "object" || track === null) throw new TypeError("A track is an object.");
    if (track.unit !== undefined && (typeof track.unit !== "string" || !UNIT.test(track.unit))) throw new TypeError("The unit of a track is letters or a percent sign.");
    if (track.format !== undefined && typeof track.format !== "function") throw new TypeError("The format of a track is a function.");
  }
  // The unit and the format are applied below, after the checks, so the timeline only gives numbers.
  const specs = tracks.map((track) => ({ keys: track.keys, sequence: track.sequence, offset: track.offset, target: idle, value: track.property }));
  const timeline = createTimeline(idle, { tracks: specs, place, stagger, flavor });
  try {
    const { duration } = timeline.getState();
    if (!(duration > 0)) throw new RangeError("The timeline has no length, so there is nothing to write as keyframes.");
    const steps = Math.ceil(duration / stepMs);
    if (steps > MAX_STOPS) throw new RangeError(`The timeline needs ${steps} stops at this stepMs, and the most is ${MAX_STOPS}. Raise stepMs.`);
    const lines = [`@keyframes ${id} {`];
    for (let i = 0; i <= steps; i += 1) {
      timeline.seek(i === steps ? duration : (i * duration) / steps);
      const state = timeline.getState();
      if (state.failed) throw state.failed;
      const written = tracks.map(({ property, unit, format }, k) => {
        const value = format ? safeValue(format(clamp(state.values[k])), `The format of the track "${property}"`) : num(state.values[k], "A timeline value") + (unit ?? "");
        return `${property}: ${value};`;
      });
      lines.push(`  ${Number(((i / steps) * 100).toFixed(4))}% { ${written.join(" ")} }`);
    }
    return { css: `${lines.join("\n")}\n}\n`, duration, count: steps + 1 };
  } finally {
    timeline.destroy();
  }
}

/** `@keyframes` text of a timeline. See `cssKeyframesFit`, which also returns the duration. */
export function cssKeyframes(name: string, options: KeyframesOptions): string {
  return cssKeyframesFit(name, options).css;
}
