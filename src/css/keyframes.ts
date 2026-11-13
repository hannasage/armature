// A timeline as `@keyframes` text. The values are not worked out here. A real timeline from /timeline is built on a do-nothing environment and
// read at evenly spaced times, so the text holds the numbers that the timeline gives, spring and decay steps included.
import type { Flavor } from "../engine/flavor";
import { createTimeline, type TimelineEnvironment, type TrackSpec } from "../timeline/timeline";
import { escapeIdent } from "./escape";
import { num, safeValue } from "./text";

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
  /** The most milliseconds between two stops. The stops are evenly spaced. Default 1000/60. A finite number of 1 or more. At most 5,000 stops are written. */
  stepMs?: number;
}

export interface KeyframesFit {
  css: string;
  /** Milliseconds. Use it as the duration of the animation. */
  duration: number;
  /** The number of stops written. */
  count: number;
  /** True when a spring or a decay in the timeline was cut at 10 seconds without resting, as `capped` of a timeline state says. */
  capped: boolean;
}

/** The most stops written. */
const MAX_STOPS = 5000;
/** A unit is letters or a percent sign. It cannot carry a digit, a space, or a symbol. */
const UNIT = /^[a-zA-Z%]{0,12}$/;
/** CSS-wide keywords and `none` cannot name a keyframes rule. */
const RESERVED = /^(none|initial|inherit|unset|revert|revert-layer|default)$/i;
const idle: TimelineEnvironment = { requestFrame: () => 0, cancelFrame: () => undefined, now: () => 0, setStyle: () => undefined };

/**
 * `@keyframes` text, with the duration, the number of stops, and `capped`. The stops are evenly spaced, at most `stepMs` apart, and the first is at
 * 0 and the last on the end of the timeline. It runs with no DOM and no environment. The name is escaped, a unit is letters only, and the text a
 * `format` function returns must pass `safeValue`. `format` gets the value rounded to 4 places, as the number is written when there is no `format`.
 * A timeline with no length throws a RangeError, and so does a `stepMs` that would need more than 5,000 stops.
 */
export function cssKeyframesFit(name: string, options: KeyframesOptions): KeyframesFit {
  if (typeof name !== "string" || name === "") throw new TypeError("A keyframes name must be text and not empty.");
  if (RESERVED.test(name)) throw new TypeError(`The keyframes name "${name}" is a CSS keyword and cannot name a keyframes rule.`);
  const id = escapeIdent(name);
  if (typeof options !== "object" || options === null) throw new TypeError("Keyframes need an options object.");
  const { tracks, place, stagger, flavor, stepMs = 1000 / 60 } = options;
  if (!Array.isArray(tracks) || tracks.length === 0) throw new TypeError("Keyframes need a list of one or more tracks.");
  if (typeof stepMs !== "number" || !Number.isFinite(stepMs) || stepMs < 1) throw new RangeError("stepMs must be a finite number of 1 or more.");
  // Each field of a track is read once. The checks and the text below use these locals, so a getter cannot give one value to the check and another to the text.
  const read = tracks.map((track) => {
    if (typeof track !== "object" || track === null) throw new TypeError("A track is an object.");
    const { property, unit, format, keys, sequence, offset } = track;
    if (unit !== undefined && (typeof unit !== "string" || !UNIT.test(unit))) throw new TypeError("The unit of a track is letters or a percent sign.");
    if (format !== undefined && typeof format !== "function") throw new TypeError("The format of a track is a function.");
    return { property, unit: unit ?? "", format, keys, sequence, offset };
  });
  // The unit and the format are applied below, after the checks, so the timeline only gives numbers.
  const specs = read.map(({ property, keys, sequence, offset }) => ({ keys, sequence, offset, target: idle, value: property }));
  const timeline = createTimeline(idle, { tracks: specs, place, stagger, flavor });
  try {
    const { duration, capped } = timeline.getState();
    if (!(duration > 0)) throw new RangeError("The timeline has no length, so there is nothing to write as keyframes.");
    const steps = Math.ceil(duration / stepMs);
    if (steps + 1 > MAX_STOPS) throw new RangeError(`The timeline needs ${steps + 1} stops at this stepMs, and the most is ${MAX_STOPS}. Raise stepMs.`);
    const lines = [`@keyframes ${id} {`];
    for (let i = 0; i <= steps; i += 1) {
      timeline.seek(i === steps ? duration : (i * duration) / steps);
      const state = timeline.getState();
      if (state.failed) throw state.failed;
      const written = read.map(({ property, unit, format }, k) => {
        const rounded = num(state.values[k], "A timeline value");
        const value = format ? safeValue(format(Number(rounded)), `The format of the track "${property}"`) : rounded + unit;
        return `${property}: ${value};`;
      });
      lines.push(`  ${Number(((i / steps) * 100).toFixed(4))}% { ${written.join(" ")} }`);
    }
    return { css: `${lines.join("\n")}\n}\n`, duration, count: steps + 1, capped };
  } finally {
    timeline.destroy();
  }
}

/** `@keyframes` text of a timeline. See `cssKeyframesFit`, which also returns the duration. */
export function cssKeyframes(name: string, options: KeyframesOptions): string {
  return cssKeyframesFit(name, options).css;
}
