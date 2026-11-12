import type { Flavor } from "../../src/engine/flavor";

/** A flavor with a timeline part, for the timeline tests. Its names are round so a test can write the same keys by hand. */
export const tempo: Flavor = {
  name: "tempo",
  prefix: "tmp",
  logLabel: "tempo",
  springs: {
    settle: { stiffness: 170, damping: 26 },
    soft: { stiffness: 40, damping: 4 },
  },
  timeline: {
    curves: { "ease-out": [0, 0, 0.58, 1], "snap-in": [0.2, 0, 0, 1] },
    defaultCurve: "ease-out",
    sequences: {
      enter: { keys: [[0, 0], [300, 1, "ease-out"], [800, 0.5, "settle"]] },
      fade: { keys: [[0, 0], [200, 1]] },
    },
  },
};
