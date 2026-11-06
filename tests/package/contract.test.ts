import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The package contract for the first prerelease. This test reads package.json and fails when a field that decides
// what npm publishes drifts. It does not build or pack anything. `scripts/check-pack.mjs` checks the real tarball.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, unknown> & {
  exports: Record<string, unknown>;
  files: string[];
  publishConfig: Record<string, unknown>;
  scripts: Record<string, string>;
};

describe("package contract", () => {
  it("has the public name and the prerelease version", () => {
    expect(pkg.name).toBe("@hannasage/armature");
    expect(pkg.version).toBe("1.0.0-next.0");
  });

  it("is public, MIT, and ESM only", () => {
    expect(pkg.private).toBeUndefined();
    expect(pkg.license).toBe("MIT");
    expect(pkg.type).toBe("module");
  });

  it("publishes dist, the README, and the license, and nothing else", () => {
    expect([...pkg.files].sort()).toEqual(["LICENSE", "README.md", "dist"]);
  });

  it("publishes publicly on the next tag", () => {
    expect(pkg.publishConfig).toEqual({ access: "public", tag: "next" });
  });

  it("exports the five subpaths and the stylesheet, and nothing else", () => {
    expect(Object.keys(pkg.exports).sort()).toEqual([".", "./dom", "./glass", "./glass/react", "./react", "./styles.css"]);
  });

  it("gives each code subpath a types file and an import file, and no require file", () => {
    for (const [subpath, target] of Object.entries(pkg.exports)) {
      if (subpath === "./styles.css") {
        expect(target).toBe("./dist/styles.css");
        continue;
      }
      expect(Object.keys(target as object).sort(), subpath).toEqual(["import", "types"]);
    }
  });

  it("has no repository field while the repository is private", () => {
    expect(pkg).not.toHaveProperty("repository");
  });

  it("has no engines field, because the built code is browser code with no Node floor", () => {
    expect(pkg).not.toHaveProperty("engines");
  });

  it("has no runtime dependencies", () => {
    expect(pkg).not.toHaveProperty("dependencies");
  });

  it("keeps React an optional peer", () => {
    expect(pkg.peerDependencies).toEqual({ react: ">=18" });
    expect(pkg.peerDependenciesMeta).toEqual({ react: { optional: true } });
  });

  it("runs the pack check, after the other gates, before every publish", () => {
    const { scripts } = pkg;
    expect(scripts["check:pack"]).toBe("node scripts/check-pack.mjs");
    expect(scripts.prepublishOnly).toBe("npm run typecheck && npm run lint && npm test && npm run build && npm run check:pack");
  });

  it("marks the stylesheet as the only file with side effects", () => {
    expect(pkg.sideEffects).toEqual(["./dist/styles.css"]);
  });
});
