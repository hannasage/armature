import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bezier } from "../../src/curves";
import { defineFlavor, validateFlavor, type Flavor, type TimelineFlavor } from "../../src/engine/flavor";
import { glassFlavor } from "../../src/glass/flavor";
import { createTimeline, requireTimeline, type Keyframe } from "../../src/timeline";
import { projection } from "../../examples/projection/flavor";
import { swipey } from "../helpers/gesture-flavor";
import { FakeTimelineEnv } from "../helpers/fake-timeline-env";
import { tempo } from "../helpers/timeline-flavor";

// The timeline part is optional. validateFlavor of the spring-only entry does not check it, because that entry has no room under its cap. The check
// runs in requireTimeline and createTimeline.
const check = (flavor: Flavor) => requireTimeline(flavor);

const part = tempo.timeline as TimelineFlavor;
const withPart = (patch: Record<string, unknown> | null | string | number | unknown[]): Flavor =>
  ({ ...tempo, timeline: patch !== null && typeof patch === "object" && !Array.isArray(patch) ? { ...part, ...patch } : patch }) as unknown as Flavor;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("the timeline part of a flavor", () => {
  it("is optional: the glass flavor, the Projection flavor, and a gesture flavor have none and stay valid", () => {
    for (const flavor of [glassFlavor, projection, swipey]) {
      expect(flavor.timeline).toBeUndefined();
      expect(() => validateFlavor(flavor)).not.toThrow();
    }
  });

  it("passes a good part, an empty part, and a part of one piece, and defineFlavor freezes it", () => {
    expect(() => check(tempo)).not.toThrow();
    expect(() => validateFlavor(tempo)).not.toThrow();
    expect(() => check(withPart({ curves: undefined, defaultCurve: undefined, sequences: undefined }))).not.toThrow();
    expect(() => check(withPart({ curves: {}, defaultCurve: undefined, sequences: {} }))).not.toThrow();
    const frozen = defineFlavor({ ...tempo, timeline: { curves: { x: [0, 0, 1, 1] as const }, sequences: { go: { keys: [[0, 0, "settle"] as const, [100, 1, "x"] as const] } } } });
    expect(Object.isFrozen(frozen.timeline)).toBe(true);
    expect(Object.isFrozen(frozen.timeline?.sequences?.go.keys[1])).toBe(true);
  });

  it.each([
    ["a part that is null", null as unknown as undefined, /timeline part that is not an object/],
    ["a part that is a string", "x", /timeline part that is not an object/],
    ["a part that is a list", [], /timeline part that is not an object/],
    ["curves that are a list", { curves: [] }, /timeline part whose curves/],
    ["curves that are null", { curves: null }, /timeline part whose curves/],
    ["a curve of three numbers", { curves: { c: [0, 0, 1] } }, /timeline curve "c"/],
    ["a curve with NaN", { curves: { c: [0, NaN, 1, 1] } }, /timeline curve "c"/],
    ["a curve with Infinity", { curves: { c: [0, 0, 1, Infinity] } }, /timeline curve "c"/],
    ["a curve with x1 under 0", { curves: { c: [-0.1, 0, 1, 1] } }, /timeline curve "c"/],
    ["a curve with x2 over 1", { curves: { c: [0, 0, 1.5, 1] } }, /timeline curve "c"/],
    ["a curve that is a string", { curves: { c: "ease" } }, /timeline curve "c"/],
    ["a curve name with capitals", { curves: { Ease: [0, 0, 1, 1] } }, /timeline name "Ease"/],
    ["a curve name with a space", { curves: { "a b": [0, 0, 1, 1] } }, /timeline name "a b"/],
    ["an empty curve name", { curves: { "": [0, 0, 1, 1] } }, /timeline name ""/],
    ["a curve with the name of a spring", { curves: { settle: [0, 0, 1, 1] } }, /timeline curve "settle".*spring/],
    ["a default curve that is not a curve", { defaultCurve: "nope" }, /default curve "nope"/],
    ["a default curve that is a spring", { defaultCurve: "settle" }, /default curve "settle"/],
    ["a default curve that is not text", { defaultCurve: 5 }, /default curve 5/],
    ["sequences that are a list", { sequences: [] }, /timeline part whose sequences/],
    ["a sequence name with capitals", { sequences: { Go: { keys: [[0, 0]] } } }, /timeline name "Go"/],
    ["a sequence that is null", { sequences: { go: null } }, /sequence "go"/],
    ["a sequence with no keys list", { sequences: { go: {} } }, /sequence "go"/],
    ["a sequence with an empty keys list", { sequences: { go: { keys: [] } } }, /sequence "go"/],
    ["a key that is not a list", { sequences: { go: { keys: [5] } } }, /sequence "go"/],
    ["a key time of NaN", { sequences: { go: { keys: [[NaN, 0]] } } }, /sequence "go"/],
    ["a negative key time", { sequences: { go: { keys: [[-1, 0]] } } }, /sequence "go"/],
    ["keys that go back in time", { sequences: { go: { keys: [[0, 0], [100, 1], [50, 2]] } } }, /sequence "go"/],
    ["a key value of NaN", { sequences: { go: { keys: [[0, NaN]] } } }, /sequence "go"/],
    ["a key value of null", { sequences: { go: { keys: [[0, null]] } } }, /sequence "go"/],
    ["a key value that is a string", { sequences: { go: { keys: [[0, "1"]] } } }, /sequence "go"/],
    ["a step that is not text", { sequences: { go: { keys: [[0, 0], [100, 1, 5]] } } }, /sequence "go".*step/],
    ["a step that names nothing", { sequences: { go: { keys: [[0, 0], [100, 1, "nope"]] } } }, /sequence "go".*"nope"/],
  ])("rejects %s", (_name, patch, message) => {
    const flavor = withPart(patch as never);
    expect(() => check(flavor)).toThrow(TypeError);
    expect(() => check(flavor)).toThrow(/The flavor "tempo" has /);
    expect(() => check(flavor)).toThrow(message);
  });

  it("is not checked by validateFlavor of the spring-only entry: that is a recorded deviation, and the timeline checks it instead", () => {
    const flavor = withPart({ defaultCurve: "nope" });
    expect(() => validateFlavor(flavor)).not.toThrow();
    expect(() => createTimeline(new FakeTimelineEnv(), { flavor, tracks: [] })).toThrow(/default curve/);
  });

  it("returns the part from requireTimeline, and throws when the flavor has none or a bad one", () => {
    expect(requireTimeline(tempo)).toBe(part);
    expect(() => requireTimeline(swipey)).toThrow('The flavor "swipey" has no timeline part.');
    expect(() => requireTimeline(withPart({ defaultCurve: "nope" }))).toThrow(/default curve/);
    expect(() => requireTimeline(null as unknown as Flavor)).toThrow(TypeError);
  });
});

describe("a timeline with a flavor", () => {
  const make = (tracks: Array<Record<string, unknown>>, flavor: Flavor | null = tempo) => {
    const env = new FakeTimelineEnv();
    const targets = tracks.map(() => ({}));
    const tl = createTimeline(env, { flavor: flavor ?? undefined, tracks: tracks.map((track, i) => ({ target: targets[i], value: "opacity", ...track })) as never });
    return { env, targets, tl };
  };
  const series = (tl: ReturnType<typeof make>["tl"]) => {
    const out: Array<number | undefined> = [];
    const duration = tl.getState().duration;
    for (let ms = 0; ms <= duration; ms += 25) {
      tl.seek(ms);
      out.push(tl.getState().values[0]);
    }
    return out;
  };

  it("plays a named sequence the same as the keys written out with the same curves and springs", () => {
    const named = make([{ sequence: "enter" }]);
    const by_hand: Keyframe[] = [[0, 0], [300, 1, bezier(0, 0, 0.58, 1)], [800, 0.5, { stiffness: 170, damping: 26 }]];
    const written = make([{ keys: by_hand }], null);
    expect(named.tl.getState().duration).toBeCloseTo(written.tl.getState().duration, 9);
    expect(series(named.tl)).toEqual(series(written.tl));
  });

  it("starts a sequence at the offset of its track, and shares nothing between two tracks of one sequence", () => {
    const { tl } = make([{ sequence: "fade" }, { sequence: "fade", offset: 100 }]);
    tl.seek(100);
    expect(tl.getState().values[0]).toBeCloseTo(bezier(0, 0, 0.58, 1)(0.5), 9);
    expect(tl.getState().values[1]).toBe(0);
    expect(tl.getState().duration).toBe(300);
  });

  it("uses the default curve for a key with no curve, and a straight line without a flavor", () => {
    const ease = bezier(0, 0, 0.58, 1);
    const a = make([{ keys: [[0, 0], [100, 100]] }]);
    a.tl.seek(50);
    expect(a.tl.getState().values[0]).toBeCloseTo(100 * ease(0.5), 9);
    const b = make([{ keys: [[0, 0], [100, 100]] }], null);
    b.tl.seek(50);
    expect(b.tl.getState().values[0]).toBeCloseTo(50, 9);
    const c = make([{ keys: [[0, 0], [100, 100]] }], swipey);
    c.tl.seek(50);
    expect(c.tl.getState().values[0]).toBeCloseTo(50, 9);
  });

  it("takes the name of a curve or of a spring as a step", () => {
    const curve = make([{ keys: [[0, 0], [100, 100, "snap-in"]] }]);
    curve.tl.seek(40);
    expect(curve.tl.getState().values[0]).toBeCloseTo(100 * bezier(0.2, 0, 0, 1)(0.4), 9);
    const named = make([{ keys: [[0, 0], [100, 100, "soft"]] }]);
    const direct = make([{ keys: [[0, 0], [100, 100, { stiffness: 40, damping: 4 }]] }], null);
    expect(series(named.tl)).toEqual(series(direct.tl));
  });

  it("takes the name of a spring from a flavor with no timeline part", () => {
    const { tl } = make([{ keys: [[0, 0], [100, 100, "snap"]] }], swipey);
    tl.seek(tl.getState().duration);
    expect(tl.getState().values[0]).toBe(100);
  });

  it.each([
    ["a step that names nothing", { keys: [[0, 0], [100, 1, "nope"]] }, tempo, /no curve or spring named "nope"/],
    ["a sequence that does not exist", { sequence: "nope" }, tempo, /no sequence named "nope"/],
    ["a sequence on a flavor with no timeline part", { sequence: "enter" }, swipey, /has no timeline part/],
    ["a curve name on a flavor with no timeline part", { keys: [[0, 0], [100, 1, "ease-out"]] }, swipey, /no curve or spring named "ease-out"/],
    ["both keys and a sequence", { keys: [[0, 0], [100, 1]], sequence: "enter" }, tempo, /keys or a sequence/],
    ["a sequence name that is not text", { sequence: 5 }, tempo, /sequence/],
    ["a name that is on the prototype", { keys: [[0, 0], [100, 1, "constructor"]] }, tempo, /no curve or spring named "constructor"/],
    ["a sequence name that is on the prototype", { sequence: "toString" }, tempo, /no sequence named "toString"/],
  ])("throws a TypeError for %s", (_name, track, flavor, message) => {
    expect(() => make([track], flavor)).toThrow(TypeError);
    expect(() => make([track], flavor)).toThrow(message);
  });

  it("throws a TypeError for a flavor with a bad timeline part, or one that is not an object", () => {
    expect(() => make([{ sequence: "enter" }], withPart({ defaultCurve: "nope" }))).toThrow(/default curve/);
    expect(() => createTimeline(new FakeTimelineEnv(), { flavor: 5 as unknown as Flavor, tracks: [] })).toThrow(TypeError);
  });

  it("labels a logged failure with the flavor label", () => {
    const { env, tl } = make([{ keys: [[0, 0], [100, 100]] }]);
    env.failWith = new Error("nope");
    tl.seek(10);
    expect(String(vi.mocked(console.error).mock.calls[0][0])).toContain("[tempo]");
  });
});
