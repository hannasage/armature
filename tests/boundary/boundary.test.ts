import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The engine, the DOM controllers, and the generic React layer must not know about any flavor. This is a static scan of the source text:
// it finds every import and re-export specifier in src/engine, src/dom, and src/react and fails when one points into src/glass.
// The glass-bound React wrappers are in src/glass/react, so the generic src/react holds no glass code.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const glassDir = join(root, "src", "glass");
const scanned = ["src/engine", "src/dom", "src/react"];

/** Every module specifier in a source text: static imports, re-exports, side-effect imports, dynamic imports, and require calls. */
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

/** True when a specifier, written in the file at `from`, points into src/glass. */
export function pointsIntoGlass(specifier: string, from: string): boolean {
  if (specifier.startsWith(".")) {
    const target = resolve(dirname(from), specifier);
    return target === glassDir || target.startsWith(glassDir + sep);
  }
  return /(^|\/)glass(\/|$)/.test(specifier);
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
    for (const specifier of specifiersOf(text)) expect(pointsIntoGlass(specifier, from), specifier).toBe(true);
  });
  it("accepts the engine, the DOM, a package, and a word that only contains glass", () => {
    expect(pointsIntoGlass("../engine/flavor", from)).toBe(false);
    expect(pointsIntoGlass("./surface", from)).toBe(false);
    expect(pointsIntoGlass("react", from)).toBe(false);
    expect(pointsIntoGlass("./glassy", from)).toBe(false);
  });
  it("catches a bare package path into the glass entry", () => {
    expect(pointsIntoGlass("@hannasage/armature/glass", from)).toBe(true);
  });
});

describe("the boundary", () => {
  for (const dir of scanned) {
    const files = sourceFiles(join(root, dir));

    it(`${dir} holds source files`, () => {
      expect(files.length).toBeGreaterThan(3);
    });

    it(`no file in ${dir} imports or re-exports from src/glass`, () => {
      const offenders = files.flatMap((file) =>
        specifiersOf(readFileSync(file, "utf8"))
          .filter((specifier) => pointsIntoGlass(specifier, file))
          .map((specifier) => `${relative(root, file)} -> ${specifier}`),
      );
      expect(offenders).toEqual([]);
    });
  }
});
