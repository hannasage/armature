import { createSpring, retarget, stepSpring, type SpringConfig } from "../../src/engine/spring";

/** Every config that ships as a preset: the glass flavor (springs, reveal springs, drag spring) and the Projection UI example. */
import { glassFlavor } from "../../src/glass";
import { projection } from "../../examples/projection/flavor";

export const presets: Array<[string, SpringConfig]> = [
  ...Object.entries(glassFlavor.springs).map(([name, config]): [string, SpringConfig] => [`glass ${name}`, config]),
  ...Object.entries(glassFlavor.reveal!.springs).map(([name, config]): [string, SpringConfig] => [`glass reveal ${name}`, config]),
  ["glass drag", glassFlavor.reveal!.drag.spring],
  ...Object.entries(projection.springs).map(([name, config]): [string, SpringConfig] => [`projection ${name}`, config]),
];

/** The solver's own series from 0 to 1: one value per step, from the first step to the step where the spring rests. Built here with the engine functions only. */
export function solverSeries(config: SpringConfig): { step: number; values: number[] } {
  let state = retarget(createSpring(config, 0), 1);
  const step = state.config.step;
  const values = [0];
  for (let i = 0; i < 20000; i += 1) {
    state = stepSpring(state, 1, step);
    values.push(state.value);
    if (state.value === 1 && state.velocity === 0) break;
  }
  return { step, values };
}

/** Reads a `linear(...)` string with a parser of its own: a list of [progress 0..1, value]. A stop with no percent gets the first or last place. */
export function parseLinear(css: string): Array<[number, number]> {
  const match = /^linear\((.*)\)$/.exec(css);
  if (!match) throw new Error(`not a linear() string: ${css}`);
  const stops = match[1].split(",").map((part) => part.trim().split(/\s+/));
  return stops.map((stop, i): [number, number] => {
    const value = Number(stop[0]);
    const at = stop[1] !== undefined ? Number(stop[1].replace("%", "")) / 100 : i === 0 ? 0 : i === stops.length - 1 ? 1 : Number.NaN;
    if (!Number.isFinite(value) || Number.isNaN(at)) throw new Error(`bad stop "${stop.join(" ")}"`);
    return [at, value];
  });
}

/** The piecewise-linear value of a stop list at `progress`. */
export function evalStops(stops: Array<[number, number]>, progress: number): number {
  if (progress <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i += 1) {
    const [x1, y1] = stops[i];
    const [x0, y0] = stops[i - 1];
    if (progress <= x1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (progress - x0)) / (x1 - x0);
  }
  return stops[stops.length - 1][1];
}
