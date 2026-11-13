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
  childEnv(env: Record<string, string | undefined>): Record<string, string | undefined>;
  experimentalParts(text: string): string[];
  packRecord(bytes: number, files: number, measured?: number): { bytes: number; files: number; limit: number; measuredSize: number; withinLimit: boolean };
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

describe("childEnv", () => {
  // `npm publish --dry-run` runs prepublishOnly with npm_config_dry_run=true. The pack in the check must still write its tarball.
  it("turns off a dry run that the parent npm command set", () => {
    expect(rules.childEnv({ npm_config_dry_run: "true", PATH: "/bin" })).toEqual({ npm_config_dry_run: "false", PATH: "/bin" });
  });

  it("sets dry run off when the parent set nothing", () => {
    expect(rules.childEnv({ PATH: "/bin" }).npm_config_dry_run).toBe("false");
  });

  it("does not change the object it was given", () => {
    const env = { npm_config_dry_run: "true" };
    rules.childEnv(env);
    expect(env.npm_config_dry_run).toBe("true");
  });
});

describe("experimentalParts", () => {
  it("reads the parts of Flavor whose comment has an @experimental line, in a source file and in a declaration file", () => {
    const source = "export interface Flavor<P extends string = string> {\n  readonly name: string;\n  /**\n   * A part.\n   * @experimental Not yet.\n   */\n  readonly lens?: LensFlavor;\n  /** Fine. */\n  readonly surface?: SurfaceFlavor;\n}\n";
    expect(rules.experimentalParts(source)).toEqual(["lens"]);
    expect(rules.experimentalParts(source.replace("export interface", "export declare interface").replaceAll("readonly ", ""))).toEqual(["lens"]);
  });
  it("does not count a tag inside the text of a line, a tag of another interface, or a part with no comment", () => {
    const text = "export interface Other {\n  /**\n   * @experimental\n   */\n  readonly x?: number;\n}\nexport interface Flavor<P> {\n  /** Drag. @experimental inline. */\n  readonly gesture?: G;\n  readonly layout?: L;\n}\n";
    expect(rules.experimentalParts(text)).toEqual([]);
    expect(rules.experimentalParts("no type here")).toEqual([]);
  });
  it("finds the five experimental parts in the source of the engine", async () => {
    const { readFileSync } = await import("node:fs");
    expect(rules.experimentalParts(readFileSync(join(root, "src/engine/flavor.ts"), "utf8"))).toEqual(["lens", "reveal", "gesture", "timeline", "layout"]);
  });
});

describe("packRecord", () => {
  it("records the size, the files, and the limit, and says whether the size is within it", () => {
    expect(rules.packRecord(300000, 259)).toEqual({ bytes: 300000, files: 259, limit: rules.sizeLimit(), measuredSize: rules.MEASURED_SIZE, withinLimit: true });
    expect(rules.packRecord(rules.sizeLimit() + 1, 1).withinLimit).toBe(false);
  });
  it("refuses a size or a count that is not a whole number above 0", () => {
    for (const [bytes, files] of [[0, 1], [1, 0], [1.5, 1], [Number.NaN, 1]]) expect(() => rules.packRecord(bytes, files)).toThrow(TypeError);
  });
});

