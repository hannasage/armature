import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./support";

const text = readFileSync(join(repoRoot, "docs/workflow-audit.md"), "utf8");
const rows = text
  .split("\n")
  .filter((line) => line.startsWith("|") && !line.startsWith("|---"))
  .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
const header = rows[0];
const body = rows.slice(1);

describe("docs/workflow-audit.md", () => {
  it("has the eight columns in order", () => {
    expect(header).toEqual(["Name", "Steps", "How often", "Estimated tokens saved per run", "Safety class", "Inputs", "Outputs", "Decision"]);
  });

  it("has a full row for every candidate", () => {
    expect(body.length).toBeGreaterThanOrEqual(8);
    for (const row of body) {
      expect(row, row[0]).toHaveLength(8);
      for (const cell of row) expect(cell, row[0]).not.toBe("");
    }
  });

  it("starts every decision with script or keep as agent task", () => {
    for (const row of body) expect(row[7], row[0]).toMatch(/^(script|keep as agent task)\b/);
  });

  it("names the required candidates with the required decisions", () => {
    const decision = (start: string) => body.find((row) => row[0].startsWith(start))?.[7] ?? "";
    expect(decision("Full gate run")).toMatch(/^script/);
    expect(decision("PR open")).toMatch(/^script/);
    expect(decision("Tree cleanliness")).toMatch(/^script/);
    expect(decision("Release preflight")).toMatch(/^script/);
    expect(decision("Pack-size baseline")).toMatch(/^script/);
    expect(decision("Public API list")).toMatch(/^script/);
    expect(decision("Three-viewport")).toMatch(/^keep as agent task/);
    expect(decision("Flaky-test")).toMatch(/^keep as agent task/);
  });

  it("labels the token figures as estimates", () => {
    expect(text).toMatch(/estimates/i);
  });

  it("follows the plain-English rules: no contractions, no em-dashes, no semicolons", () => {
    expect(text).not.toMatch(/[A-Za-z]['’](?:t|s|re|ve|ll|d|m)(?![A-Za-z])/);
    expect(text).not.toContain("—");
    expect(text).not.toContain(";");
  });

  it("holds no home path", () => {
    expect(text).not.toMatch(/\/Users\/|\/home\//);
  });
});
