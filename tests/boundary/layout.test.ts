import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

// G6 adds `/layout`. The spring-only entry reaches no file of it or of any other new subpath, and `/layout` reaches no glass, DOM, React, values,
// curves, linear, gesture, or timeline code. It may use the frame scheduler and the engine. A static scan of the import specifiers checks the
// folders, and a bundle of each entry checks what it really pulls in.

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

describe("the G6 layers", () => {
  it("has source files in src/layout", () => {
    expect(sourceFiles(join(root, "src", "layout")).length).toBeGreaterThan(4);
  });

  it("keeps /layout free of the DOM, React, glass, values, curves, linear, gesture, and timeline layers", () => {
    expect(reaches("layout", ["dom", "react", "glass", "values", "curves", "linear", "gesture", "timeline"])).toEqual([]);
  });

  it("keeps every other layer free of /layout", () => {
    for (const layer of ["engine", "glass", "frame", "values", "curves", "linear", "gesture", "timeline", "dom", "react"]) {
      expect(reaches(layer, ["layout"]), layer).toEqual([]);
    }
  });

  it("reaches the engine and the frame scheduler, and nothing else of the package", () => {
    const layers = new Set<string>();
    for (const file of sourceFiles(join(root, "src", "layout"))) {
      for (const specifier of specifiersOf(readFileSync(file, "utf8"))) {
        const layer = layerOf(specifier, file);
        if (layer !== null && layer !== "layout") layers.add(layer);
      }
    }
    expect([...layers].sort()).toEqual(["engine", "frame"]);
  });

  it("writes no property named transform: no text in the controllers names one, and the environment guards against it", () => {
    for (const file of sourceFiles(join(root, "src", "layout"))) {
      if (file.endsWith(`${sep}env.ts`)) continue;
      const code = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code.match(/["'`][^"'`\n]*transform[^"'`\n]*["'`]/gi), relative(root, file)).toBeNull();
    }
  });
});

describe("the entries", () => {
  it("lets the spring-only entry reach no file of /layout, or of any other new subpath", async () => {
    const { inputs } = await bundle("src/index.ts");
    expect(inputs.length).toBeGreaterThan(3);
    expect(inputs.filter((file) => /(^|\/)src\/(layout|timeline|gesture|frame|values|curves|linear)\//.test(file))).toEqual([]);
  });

  it("keeps the spring-only entry as G5 left it: no layout check in validateFlavor, and the size of 3,853 plus the 5 bytes of the G7 stop-once guard (3,858)", async () => {
    const { gzipped } = await bundle("src/index.ts");
    expect(gzipped).toBeLessThanOrEqual(3858);
    expect(gzipped).toBeLessThanOrEqual(4000);
  });

  it("bundles /layout from its own files, the scheduler, and the spring, and no glass, DOM, React, values, curves, linear, gesture, or timeline code", async () => {
    const { inputs } = await bundle("src/layout/index.ts");
    for (const name of ["layout", "presence", "shared", "flavor", "env"]) expect(inputs.some((file) => file.endsWith(`src/layout/${name}.ts`)), name).toBe(true);
    for (const file of ["src/frame/scheduler.ts", "src/engine/spring.ts"]) expect(inputs.some((input) => input.endsWith(file)), file).toBe(true);
    expect(inputs.filter((file) => /(^|\/)src\/(glass|dom|react|values|curves|linear|gesture|timeline)\//.test(file))).toEqual([]);
  });

  it("keeps /layout free of the flavor check of the engine and of the scroll environment it does not need", async () => {
    const { inputs } = await bundle("src/layout/index.ts");
    expect(inputs.filter((file) => /src\/engine\/(flavor|scroll-env)\.ts$/.test(file))).toEqual([]);
  });
});
