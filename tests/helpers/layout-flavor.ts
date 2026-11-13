import type { Flavor } from "../../src/engine/flavor";

/** A flavor with a layout part, for the layout tests. Its names are round so a test can write the same springs by hand. */
export const lofty: Flavor = {
  name: "lofty",
  prefix: "lof",
  logLabel: "lofty",
  springs: {
    move: { stiffness: 170, damping: 26 },
    exit: { stiffness: 300, damping: 30 },
    loose: { stiffness: 60, damping: 4 },
  },
  layout: {
    springKeys: { move: "move", exit: "exit" },
    rest: { restDelta: 0.05, restSpeed: 0.5 },
  },
};
