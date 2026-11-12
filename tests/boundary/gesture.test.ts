import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

// G4 adds `/gesture`. The spring-only entry reaches no file of it, and it reaches no glass, DOM, React, values, curves, linear, or frame code.
// A static scan of the import specifiers checks the folders, and a bundle of each entry checks what it really pulls in.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const specifiersOf = (text: string): string[] =>
  [
    /\b(?:import|export)\b[^"'`;]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ].flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[1]));

function layerOf(specifier: string, from: string): string | null {
  if (specifier.startsWith("@hannasage/armature/")) return specifier.split("/")[2] ?? null;
  if (!specifier.startsWith(".")) return null;
  const target = relative(join(root, "src"), resolve(dirname(from), specifier));
  return target.startsWith("..") ? null : target.split(sep)[0];
}

function reaches(layer: string, forbidden: string[]): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(join(root, "src", layer))) {
    for (const specifier of specifiersOf(readFileSync(file, "utf8"))) {
      const target = layerOf(specifier, file);
      if (target !== null && forbidden.includes(target)) found.push(`${relative(root, file)} imports ${specifier}`);
    }
  }
  return found;
}

const bundleInputs = async (entry: string): Promise<string[]> => {
  const result = await build({
    entryPoints: [join(root, entry)], bundle: true, minify: true, format: "esm", write: false, metafile: true,
    external: ["react", "react/jsx-runtime", "react-dom"], logLevel: "silent", outdir: "out",
  });
  return Object.keys(Object.values(result.metafile.outputs)[0].inputs);
};

describe("the G4 layers", () => {
  it("has source files in src/gesture", () => {
    expect(sourceFiles(join(root, "src", "gesture")).length).toBeGreaterThan(3);
  });

  it("keeps /gesture free of the DOM, React, glass, values, curves, linear, and frame layers", () => {
    expect(reaches("gesture", ["dom", "react", "glass", "values", "curves", "linear", "frame"])).toEqual([]);
  });

  it("keeps the engine, glass, and the other new subpaths free of /gesture", () => {
    expect(reaches("engine", ["gesture"])).toEqual([]);
    expect(reaches("glass", ["gesture"])).toEqual([]);
    expect(reaches("frame", ["gesture"])).toEqual([]);
    expect(reaches("values", ["gesture"])).toEqual([]);
    expect(reaches("curves", ["gesture"])).toEqual([]);
    expect(reaches("linear", ["gesture"])).toEqual([]);
  });
});

describe("the entries", () => {
  it("lets the spring-only entry reach no file of /gesture, or of any other new subpath", async () => {
    const inputs = await bundleInputs("src/index.ts");
    expect(inputs.length).toBeGreaterThan(3);
    expect(inputs.filter((file) => /(^|\/)src\/(gesture|frame|values|curves|linear)\//.test(file))).toEqual([]);
  });

  it("bundles /gesture from its own files and the engine, and no glass, DOM, or React code", async () => {
    const inputs = await bundleInputs("src/gesture/index.ts");
    for (const name of ["drag", "pointer-env", "pointer-velocity"]) expect(inputs.some((file) => file.endsWith(`src/gesture/${name}.ts`)), name).toBe(true);
    expect(inputs.filter((file) => /(^|\/)src\/(glass|dom|react|values|curves|linear|frame)\//.test(file))).toEqual([]);
  });

  it("keeps /gesture free of the scroll reveal and the scroll environment code it does not need", async () => {
    const inputs = await bundleInputs("src/gesture/index.ts");
    expect(inputs.filter((file) => /src\/engine\/scroll-env\.ts$/.test(file))).toEqual([]);
  });
});
