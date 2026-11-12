import type { Flavor, TimelineFlavor } from "../engine/flavor";

const NAME = /^[a-z][a-z0-9-]*$/;
const own = (object: unknown, key: string) => typeof object === "object" && object !== null && Object.prototype.hasOwnProperty.call(object, key);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Checks the timeline part of a flavor, and throws a TypeError that names the flavor when it does not hold together. A flavor with no part passes.
 * `validateFlavor` does not run it, because the spring-only entry has no room under its cap. `createTimeline` and `requireTimeline` run it.
 */
export function checkTimelineFlavor(flavor: Flavor, label: string): void {
  const part: unknown = flavor.timeline;
  if (part === undefined) return;
  if (!plain(part)) throw new TypeError(`${label} has a timeline part that is not an object.`);
  const { curves, defaultCurve, sequences } = part;
  const named = (name: string) => {
    if (!NAME.test(name)) throw new TypeError(`${label} has a timeline name ${JSON.stringify(name)}. A name is lowercase letters, digits, and hyphens, and starts with a letter.`);
  };
  if (curves !== undefined) {
    if (!plain(curves)) throw new TypeError(`${label} has a timeline part whose curves are not an object.`);
    for (const [name, points] of Object.entries(curves)) {
      named(name);
      const p = points as number[];
      if (!Array.isArray(p) || p.length !== 4 || !p.every(finite) || p[0] < 0 || p[0] > 1 || p[2] < 0 || p[2] > 1) {
        throw new TypeError(`${label} has the timeline curve ${JSON.stringify(name)}, which needs four finite numbers with x1 and x2 from 0 to 1.`);
      }
      if (own(flavor.springs, name)) throw new TypeError(`${label} has the timeline curve ${JSON.stringify(name)} and a spring with the same name.`);
    }
  }
  if (defaultCurve !== undefined && !(typeof defaultCurve === "string" && own(curves, defaultCurve))) {
    throw new TypeError(`${label} has a timeline default curve ${JSON.stringify(defaultCurve)} that is not one of its curves.`);
  }
  if (sequences === undefined) return;
  if (!plain(sequences)) throw new TypeError(`${label} has a timeline part whose sequences are not an object.`);
  for (const [name, sequence] of Object.entries(sequences)) {
    named(name);
    const bad = (problem: string): never => {
      throw new TypeError(`${label} has the timeline sequence ${JSON.stringify(name)} with ${problem}.`);
    };
    const keys = plain(sequence) ? sequence.keys : undefined;
    if (!Array.isArray(keys) || keys.length === 0) bad("no keys");
    let last = 0;
    for (const key of keys as unknown[]) {
      if (!Array.isArray(key) || key.length < 2 || key.length > 3) bad("a key that is not [time, value, step]");
      const [time, value, step] = key as unknown[];
      if (!finite(time) || time < last) bad("a key time that is not finite, or goes back in time");
      if (!finite(value)) bad("a key value that is not a finite number");
      if (step !== undefined) {
        if (typeof step !== "string") bad("a step that is not text");
        if (!own(curves, step as string) && !own(flavor.springs, step as string)) bad(`a step named ${JSON.stringify(step)}, which is no curve and no spring`);
      }
      last = time as number;
    }
  }
}

/** The timeline part of a flavor. Throws a clear TypeError when the flavor has none or does not hold together. */
export function requireTimeline(flavor: Flavor): TimelineFlavor {
  if (typeof flavor !== "object" || flavor === null) throw new TypeError(`Expected a flavor object, got ${flavor === null ? "null" : typeof flavor}.`);
  const label = `The flavor "${flavor.name}"`;
  checkTimelineFlavor(flavor, label);
  if (flavor.timeline === undefined) throw new TypeError(`${label} has no timeline part.`);
  return flavor.timeline;
}
