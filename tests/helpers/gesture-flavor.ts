import type { Flavor } from "../../src/engine/flavor";

/** A flavor with a gesture part, for the gesture tests. The numbers are round so a test can work out the answer by hand. */
export const swipey: Flavor = {
  name: "swipey",
  prefix: "swp",
  logLabel: "swipey",
  springs: {
    snap: { stiffness: 300, damping: 30 },
    soft: { stiffness: 100, damping: 20 },
  },
  gesture: {
    friction: 4,
    rubberBand: { stiffness: 300, reach: 120 },
    swipe: { velocity: 500, distance: 40 },
    springKeys: { snap: "snap" },
    rest: { restDelta: 0.5, restSpeed: 5 },
  },
};
