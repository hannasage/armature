import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The rules that `scripts/check-pack.mjs` applies to the packed tarball. They are plain functions in `scripts/pack-rules.mjs`,
// so a test can run them without packing anything.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface PackRules {
  SIZE_FACTOR: number;
  MEASURED_SIZE: number;
  isAllowedPackFile(path: string): boolean;
  disallowedFiles(paths: string[]): string[];
  sizeLimit(measured?: number): number;
  withinSizeBudget(size: number, measured?: number): boolean;
  missingExportTargets(exportsMap: Record<string, unknown>, paths: string[]): string[];
}

const rules = (await import(pathToFileURL(join(root, "scripts/pack-rules.mjs")).href)) as PackRules;

describe("isAllowedPackFile", () => {
  it("allows the files under dist", () => {
    expect(rules.isAllowedPackFile("dist/index.js")).toBe(true);
    expect(rules.isAllowedPackFile("dist/glass/react/LqgFilter.d.ts")).toBe(true);
    expect(rules.isAllowedPackFile("dist/dom/follower.js.map")).toBe(true);
    expect(rules.isAllowedPackFile("dist/styles.css")).toBe(true);
  });

  it("allows the README, the license, and package.json", () => {
    expect(rules.isAllowedPackFile("README.md")).toBe(true);
    expect(rules.isAllowedPackFile("LICENSE")).toBe(true);
    expect(rules.isAllowedPackFile("package.json")).toBe(true);
  });

  it("refuses source, tests, docs, examples, scripts, and the changelog", () => {
    for (const path of ["src/index.ts", "tests/package/contract.test.ts", "docs/baseline.md", "examples/projection/flavor.ts", "scripts/check-pack.mjs", "CHANGELOG.md"]) {
      expect(rules.isAllowedPackFile(path), path).toBe(false);
    }
  });

  it("refuses config files, lock files, and hidden files", () => {
    for (const path of ["package-lock.json", "tsconfig.json", "vite.config.ts", ".github/workflows/ci.yml", ".gitignore", ".npmrc", ".env"]) {
      expect(rules.isAllowedPackFile(path), path).toBe(false);
    }
  });

  it("refuses a path that only looks like dist", () => {
    expect(rules.isAllowedPackFile("distillery/index.js")).toBe(false);
    expect(rules.isAllowedPackFile("dist")).toBe(false);
    expect(rules.isAllowedPackFile("README.md.bak")).toBe(false);
    expect(rules.isAllowedPackFile("dist/../src/index.ts")).toBe(false);
    expect(rules.isAllowedPackFile("")).toBe(false);
  });
});

describe("disallowedFiles", () => {
  it("returns only the files that are not allowed, in order", () => {
    expect(rules.disallowedFiles(["dist/index.js", "src/index.ts", "LICENSE", "docs/baseline.md"])).toEqual(["src/index.ts", "docs/baseline.md"]);
  });

  it("returns an empty list for an empty or clean list", () => {
    expect(rules.disallowedFiles([])).toEqual([]);
    expect(rules.disallowedFiles(["dist/index.js", "README.md"])).toEqual([]);
  });
});

describe("size budget", () => {
  it("is 1.5 times the measured size", () => {
    expect(rules.SIZE_FACTOR).toBe(1.5);
    expect(rules.sizeLimit(1000)).toBe(1500);
    expect(rules.sizeLimit()).toBe(Math.floor(rules.MEASURED_SIZE * 1.5));
  });

  it("accepts a size at the limit and refuses one byte over", () => {
    expect(rules.withinSizeBudget(1500, 1000)).toBe(true);
    expect(rules.withinSizeBudget(1501, 1000)).toBe(false);
  });

  it("refuses a size that is not a positive finite number", () => {
    for (const size of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(rules.withinSizeBudget(size, 1000), String(size)).toBe(false);
  });

  it("records a measured size above zero", () => {
    expect(Number.isInteger(rules.MEASURED_SIZE)).toBe(true);
    expect(rules.MEASURED_SIZE).toBeGreaterThan(0);
  });
});

describe("missingExportTargets", () => {
  const map = {
    ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    "./styles.css": "./dist/styles.css",
  };

  it("returns nothing when every target is in the list", () => {
    expect(rules.missingExportTargets(map, ["dist/index.d.ts", "dist/index.js", "dist/styles.css"])).toEqual([]);
  });

  it("names each target that is not in the list", () => {
    expect(rules.missingExportTargets(map, ["dist/index.js"])).toEqual(["dist/index.d.ts", "dist/styles.css"]);
  });
});
