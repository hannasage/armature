import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { Flavor } from "../../src/engine/flavor";
import { glassFlavor } from "../../src/glass";
import { readDoc, root, sectionOf } from "../helpers/doc-pages";

// The contract review after the third flavor. The rule of the stamped spec: a part of the flavor contract is marked stable only after a second
// real flavor uses it. A real flavor is a flavor outside tests/helpers that ships as a documented example or product: the glass flavor, and the
// flavor of each folder under examples/. This test finds them, works out which part each one uses, and checks the record on the page and the
// marks in the type.

const rules = (await import(pathToFileURL(join(root, "scripts/pack-rules.mjs")).href)) as { experimentalParts(text: string): string[] };

const isFlavor = (value: unknown): value is Flavor =>
  typeof value === "object" && value !== null && typeof (value as Flavor).prefix === "string" && typeof (value as Flavor).springs === "object";

/** The real flavors by name: glass, and every flavor that an examples/<folder>/flavor.ts exports. */
async function realFlavors(): Promise<Record<string, Flavor>> {
  const found: Record<string, Flavor> = { glass: glassFlavor as Flavor };
  const folders = readdirSync(join(root, "examples"), { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const folder of folders) {
    const file = join(root, "examples", folder.name, "flavor.ts");
    const module = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    for (const value of Object.values(module)) if (isFlavor(value)) found[value.name] = value;
  }
  return found;
}

const REAL = await realFlavors();
const TOP = ["name", "prefix", "logLabel", "springs"] as const;
const PARTS = ["surface", "lens", "reveal", "followers", "gesture", "timeline", "layout"] as const;

/** A part counts as used only when it is there and not empty. */
const used = (value: unknown) => value !== undefined && value !== null && (typeof value !== "object" || Object.keys(value).length > 0);
const usersOf = (part: string): string[] => Object.keys(REAL).filter((name) => used((REAL[name] as unknown as Record<string, unknown>)[part]));
const statusOf = (users: readonly string[]) => (users.length >= 2 ? "stable" : "experimental");
const listed = (users: readonly string[]) =>
  users.length === 1 ? `${users[0]} only` : users.length === 2 ? `${users[0]} and ${users[1]}` : `${users.slice(0, -1).join(", ")}, and ${users.at(-1)}`;

const page = readDoc("contract-review.md");
const review = () => sectionOf(page, "Review after the third flavor");
const type = readFileSync(join(root, "src/engine/flavor.ts"), "utf8");

describe("the contract review after the third flavor", () => {
  it("finds three real flavors, glass and the two examples, each with its own prefix", () => {
    expect(Object.keys(REAL).sort()).toEqual(["glass", "projection", "tide"]);
    expect(new Set(Object.values(REAL).map((flavor) => flavor.prefix)).size).toBe(3);
  });

  it("does not count an empty part as a use", () => {
    expect(used({})).toBe(false);
    expect(used(undefined)).toBe(false);
    expect(used({ a: 1 })).toBe(true);
  });

  it("finds every top-level field in all three flavors", () => {
    for (const field of TOP) expect(usersOf(field), field).toEqual(Object.keys(REAL));
  });

  it("covers every optional part of the type and no other", () => {
    const body = type.slice(type.indexOf("export interface Flavor<"), type.indexOf("\n}\n", type.indexOf("export interface Flavor<")));
    const optional = [...body.matchAll(/^ {2}readonly (\w+)\?:/gm)].map((match) => match[1]);
    expect(optional.sort()).toEqual([...PARTS].sort());
  });

  it("records the status of the top level as the rule gives it", () => {
    const line = `- ${TOP.map((field) => `\`${field}\``).join(", ").replace(/, (`springs`)$/, ", and $1")}: ${statusOf(usersOf("springs"))}. Used by ${listed(usersOf("springs"))}.`;
    expect(review()).toContain(line);
  });

  it.each(PARTS)("records the status of the %s part as the rule gives it, with the flavors that use it", (part) => {
    const users = usersOf(part);
    expect(review()).toContain(`- \`${part}\`: ${statusOf(users)}. Used by ${listed(users)}.`);
  });

  it("finds the third flavor using every part that amendment 1 added, and the follower", () => {
    for (const part of ["followers", "gesture", "timeline", "layout"]) expect(usersOf(part), part).toContain("tide");
  });

  it("marks with an @experimental line of its own exactly the parts that stay experimental", () => {
    expect(rules.experimentalParts(type)).toEqual(PARTS.filter((part) => statusOf(usersOf(part)) === "experimental"));
    expect(type.match(/^\s*\*\s*@experimental\b/gm)).toHaveLength(5);
  });

  it("defines a real flavor as the test does, and leaves the freeze of the API to the maintainer", () => {
    expect(review()).toContain("A real flavor is a flavor outside `tests/helpers` that ships as a documented example or product.");
    expect(review()).toMatch(/belong to the maintainer/);
    expect(review()).toMatch(/The maintainer decides what 1\.0 freezes/);
    expect(review()).not.toMatch(/Hanna/);
  });

  it("marks the counts of the first review as counts of Milestone 2", () => {
    expect(page).toContain("As of Milestone 2, the `.` entry had 29 runtime names and 17 type names");
    expect(page).toContain("As of Milestone 2, all 527 earlier tests passed unchanged.");
  });
});
