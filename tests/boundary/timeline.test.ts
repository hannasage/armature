import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

// G5 adds `/timeline`. The spring-only entry reaches no file of it, and it reaches no glass, DOM, React, values, linear, or gesture code.
// It may use the frame scheduler, the bezier file of /curves, and the engine. A static scan of the import specifiers checks the folders,
// and a bundle of each entry checks what it really pulls in.

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

const bundle = async (entry: string) => {
  const result = await build({
    entryPoints: [join(root, entry)], bundle: true, minify: true, format: "esm", write: false, metafile: true,
    external: ["react", "react/jsx-runtime", "react-dom"], logLevel: "silent", outdir: "out",
  });
  return { inputs: Object.keys(Object.values(result.metafile.outputs)[0].inputs), gzipped: gzipSync(result.outputFiles[0].contents).length };
};

describe("the G5 layers", () => {
  it("has source files in src/timeline", () => {
    expect(sourceFiles(join(root, "src", "timeline")).length).toBeGreaterThan(2);
  });

  it("keeps /timeline free of the DOM, React, glass, values, linear, and gesture layers", () => {
    expect(reaches("timeline", ["dom", "react", "glass", "values", "linear", "gesture"])).toEqual([]);
  });

  it("keeps the engine, glass, and the other new subpaths free of /timeline", () => {
    for (const layer of ["engine", "glass", "frame", "values", "curves", "linear", "gesture"]) expect(reaches(layer, ["timeline"]), layer).toEqual([]);
  });

  it("reaches only the bezier file of /curves, and not the curves entry", () => {
    const specifiers = sourceFiles(join(root, "src", "timeline")).flatMap((file) => specifiersOf(readFileSync(file, "utf8")).filter((s) => /curves/.test(s)));
    for (const specifier of specifiers) expect(specifier).toMatch(/curves\/bezier$/);
  });
});

describe("the entries", () => {
  it("lets the spring-only entry reach no file of /timeline, or of any other new subpath", async () => {
    const { inputs } = await bundle("src/index.ts");
    expect(inputs.length).toBeGreaterThan(3);
    expect(inputs.filter((file) => /(^|\/)src\/(timeline|gesture|frame|values|curves|linear)\//.test(file))).toEqual([]);
  });

  it("keeps the spring-only entry as G4 left it: no timeline check in validateFlavor, and the size of 3,854", async () => {
    const { gzipped } = await bundle("src/index.ts");
    expect(gzipped).toBeLessThanOrEqual(3854 + 20);
    expect(gzipped).toBeLessThanOrEqual(4000);
  });

  it("bundles /timeline from its own files, the scheduler, the spring, and the bezier file, and no glass, DOM, React, values, linear, or gesture code", async () => {
    const { inputs } = await bundle("src/timeline/index.ts");
    for (const name of ["timeline", "flavor"]) expect(inputs.some((file) => file.endsWith(`src/timeline/${name}.ts`)), name).toBe(true);
    for (const file of ["src/frame/scheduler.ts", "src/engine/spring.ts", "src/curves/bezier.ts"]) expect(inputs.some((input) => input.endsWith(file)), file).toBe(true);
    expect(inputs.filter((file) => /(^|\/)src\/(glass|dom|react|values|linear|gesture)\//.test(file))).toEqual([]);
  });

  it("keeps /timeline free of glass code and of the rest of /curves", async () => {
    const { inputs } = await bundle("src/timeline/index.ts");
    expect(inputs.filter((file) => /(^|\/)src\/glass\//.test(file))).toEqual([]);
    expect(inputs.filter((file) => /src\/curves\/(tween|tween-value|fit|easings|index)\.ts$/.test(file))).toEqual([]);
  });

  it("keeps /timeline free of the flavor check and the scroll environment it does not need", async () => {
    const { inputs } = await bundle("src/timeline/index.ts");
    expect(inputs.filter((file) => /src\/engine\/(flavor|scroll-env)\.ts$/.test(file))).toEqual([]);
  });
});
