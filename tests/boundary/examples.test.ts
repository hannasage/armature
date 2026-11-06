import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { specifiersOf } from "../helpers/specifiers";

// A flavor in `examples/` stands in for a flavor that lives in another repository. It may import the public Armature
// entries and nothing else: no relative path, no deep path into `src` or `dist`, no other package. The public entries
// are the keys of the "exports" map in package.json, so this test follows the package when an entry is added.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; exports: Record<string, unknown> };

/** The import specifiers a consumer may write: the package name, and the name plus each code subpath of the exports map. */
const PUBLIC = Object.keys(pkg.exports)
  .filter((key) => !/\.css$/.test(key))
  .map((key) => (key === "." ? pkg.name : `${pkg.name}/${key.slice(2)}`));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:[cm]?[jt]sx?)$/.test(entry.name) ? [path] : [];
  });
}

const isPublic = (specifier: string) => PUBLIC.includes(specifier);

describe("the list of public specifiers", () => {
  it("is built from the exports map", () => {
    expect(PUBLIC).toEqual(expect.arrayContaining(["@hannasage/armature", "@hannasage/armature/dom", "@hannasage/armature/react"]));
    expect(PUBLIC.every((specifier) => specifier.startsWith("@hannasage/armature"))).toBe(true);
  });
  it("accepts a public entry and rejects a deep path, a relative path, and another package", () => {
    expect(isPublic("@hannasage/armature/dom")).toBe(true);
    for (const bad of ["@hannasage/armature/dom/follower", "@hannasage/armature/dist/index.js", "@hannasage/armature/src/engine/flavor", "../../src/engine/flavor", "./flavor", "react", "@hannasage/armature-extra", "@hannasage/armature/styles.css"]) {
      expect(isPublic(bad), bad).toBe(false);
    }
  });
});

describe("the examples", () => {
  const files = sourceFiles(join(root, "examples"));

  it("hold at least the Projection flavor", () => {
    expect(files.map((file) => relative(root, file))).toContain(join("examples", "projection", "flavor.ts"));
  });

  it("import nothing except the public Armature entries", () => {
    const offenders = files.flatMap((file) =>
      specifiersOf(readFileSync(file, "utf8"))
        .filter((specifier) => !isPublic(specifier))
        .map((specifier) => `${relative(root, file)} -> ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });
});
