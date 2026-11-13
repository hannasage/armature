import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The layers point one way: glass sits on react, react on dom, dom on engine. A lower layer must not know a higher one.
// This is a static scan of the source text. It finds every import, type import, and re-export specifier in a layer
// and fails when one points into a layer that is not allowed.
//
//   src/engine imports nothing from src/dom, src/react, or src/glass.
//   src/dom imports nothing from src/react or src/glass.
//   src/react imports nothing from src/glass.
//   src/layout imports nothing from src/dom, src/react, or src/glass, and no other layer imports src/layout (see boundary/layout.test.ts).

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RULES = [
  { layer: "engine", forbidden: ["dom", "react", "glass", "layout"] },
  { layer: "dom", forbidden: ["react", "glass"] },
  { layer: "react", forbidden: ["glass"] },
  // G6: /layout reaches only the engine and the frame scheduler. It never reaches the DOM, React, or glass code.
  { layer: "layout", forbidden: ["dom", "react", "glass"] },
];

/** Every module specifier in a source text: static imports, type imports, re-exports, side-effect imports, dynamic imports, and require calls. */
export function specifiersOf(text: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\b(?:import|export)\b[^"'`;]*?\bfrom\s*["']([^"']+)["']/g, // import x from, import type x from, export * from, export { x } from
    /\bimport\s*["']([^"']+)["']/g, // import "x"
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // import("x")
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, // require("x")
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) found.push(match[1]);
  return found;
}

/** True when a specifier, written in the file at `from`, points into the layer `name` (a folder of src). */
export function pointsInto(specifier: string, from: string, name: string): boolean {
  if (specifier.startsWith(".")) {
    const folder = join(root, "src", name);
    const target = resolve(dirname(from), specifier);
    return target === folder || target.startsWith(folder + sep);
  }
  // A package path into one entry of this package. The bare word "react" is the React package and is always allowed.
  return new RegExp(`^@hannasage/armature/${name}(/|$)`).test(specifier);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("the scanner", () => {
  const from = join(root, "src", "dom", "example.ts");
  it("finds the specifier of every form of import and re-export", () => {
    const text = [
      'import { a } from "../glass/flavor";',
      'import type { B } from "../glass/flavor";',
      'import * as c from "../glass/flavor";',
      'import d from "../glass/flavor";',
      'import "../glass/flavor";',
      'export * from "../glass/flavor";',
      'export { e } from "../glass/flavor";',
      'export type { F } from "../glass/flavor";',
      'const g = await import("../glass/flavor");',
      'const h = require("../glass/flavor");',
      'import {\n  i,\n  j,\n} from "../glass/flavor";',
    ].join("\n");
    expect(specifiersOf(text)).toHaveLength(11);
    for (const specifier of specifiersOf(text)) expect(pointsInto(specifier, from, "glass"), specifier).toBe(true);
  });
  it("points each folder name at its own folder only", () => {
    expect(pointsInto("../dom/surface", join(root, "src", "engine", "x.ts"), "dom")).toBe(true);
    expect(pointsInto("../react/index", join(root, "src", "dom", "x.ts"), "react")).toBe(true);
    expect(pointsInto("../engine/flavor", from, "dom")).toBe(false);
    expect(pointsInto("./surface", from, "dom")).toBe(true);
    expect(pointsInto("./surface", from, "react")).toBe(false);
    expect(pointsInto("./glassy", from, "glass")).toBe(false);
  });
  it("allows the React package and catches a package path into another entry", () => {
    expect(pointsInto("react", from, "react")).toBe(false);
    expect(pointsInto("react/jsx-runtime", from, "react")).toBe(false);
    expect(pointsInto("@hannasage/armature/glass", from, "glass")).toBe(true);
    expect(pointsInto("@hannasage/armature/react", from, "react")).toBe(true);
    expect(pointsInto("@hannasage/armature/dom", from, "dom")).toBe(true);
  });
});

describe("the boundary", () => {
  for (const { layer, forbidden } of RULES) {
    const files = sourceFiles(join(root, "src", layer));

    it(`src/${layer} holds source files`, () => {
      expect(files.length).toBeGreaterThan(3);
    });

    for (const name of forbidden) {
      it(`no file in src/${layer} imports or re-exports from src/${name}`, () => {
        const offenders = files.flatMap((file) =>
          specifiersOf(readFileSync(file, "utf8"))
            .filter((specifier) => pointsInto(specifier, file, name))
            .map((specifier) => `${relative(root, file)} -> ${specifier}`),
        );
        expect(offenders).toEqual([]);
      });
    }
  }
});
