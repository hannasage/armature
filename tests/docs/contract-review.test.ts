import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Flavor } from "../../src/engine/flavor";
import { glassFlavor } from "../../src/glass";
import { projection } from "../../examples/projection/flavor";
import { tide } from "../../examples/tide/flavor";
import { readDoc, root, sectionOf } from "../helpers/doc-pages";

// The contract review after the third flavor. The rule of the stamped spec: a part of the flavor contract is marked stable only after a second
// real flavor uses it. This test works out which real flavor uses which part, and checks the record on the page and the marks in the type.

const REAL: Record<string, Flavor> = { glass: glassFlavor as Flavor, projection: projection as Flavor, tide: tide as Flavor };
const TOP = ["name", "prefix", "logLabel", "springs"] as const;
const PARTS = ["surface", "lens", "reveal", "followers", "gesture", "timeline", "layout"] as const;

const usersOf = (part: string): string[] => Object.keys(REAL).filter((name) => (REAL[name] as unknown as Record<string, unknown>)[part] !== undefined);
const statusOf = (users: readonly string[]) => (users.length >= 2 ? "stable" : "experimental");
const listed = (users: readonly string[]) =>
  users.length === 1 ? `${users[0]} only` : users.length === 2 ? `${users[0]} and ${users[1]}` : `${users.slice(0, -1).join(", ")}, and ${users.at(-1)}`;

const page = readDoc("contract-review.md");
const review = () => sectionOf(page, "Review after the third flavor");

describe("the contract review after the third flavor", () => {
  it("counts three real flavors, each with its own prefix", () => {
    expect(new Set(Object.values(REAL).map((flavor) => flavor.prefix)).size).toBe(3);
  });

  it("finds every top-level field in all three flavors", () => {
    for (const field of TOP) expect(usersOf(field), field).toEqual(["glass", "projection", "tide"]);
  });

  it("covers every optional part of the type and no other", () => {
    const type = readFileSync(join(root, "src/engine/flavor.ts"), "utf8");
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

  it("marks with @experimental exactly the parts that stay experimental", () => {
    const type = readFileSync(join(root, "src/engine/flavor.ts"), "utf8");
    const body = type.slice(type.indexOf("export interface Flavor<"));
    const lines = body.split("\n");
    const marked = PARTS.filter((part) => {
      const at = lines.findIndex((line) => new RegExp(`^ {2}readonly ${part}\\?:`).test(line));
      return lines[at - 1].includes("@experimental");
    });
    expect(marked).toEqual(PARTS.filter((part) => statusOf(usersOf(part)) === "experimental"));
  });

  it("leaves the freeze of the API to Hanna", () => {
    expect(review()).toMatch(/belong to Hanna/);
    expect(review()).toMatch(/Hanna decides what 1\.0 freezes/);
  });
});
