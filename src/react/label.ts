import type { Flavor } from "../engine/flavor";

/** The context word for a logged failure: the flavor's name and the part, such as `glass surface`. A missing flavor gives `armature`. */
export const contextOf = (flavor: Flavor | undefined, part: string): string => `${flavor?.name ?? "armature"} ${part}`;
