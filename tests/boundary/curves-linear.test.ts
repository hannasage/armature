import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

// G2 adds `/curves` and `/linear`. The spring-only entry reaches neither one. Neither one reaches the DOM, React, or glass code, and /curves
// does not reach /linear. A static scan of the import specifiers checks the folders, and a bundle of each entry checks what it really pulls in.

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

describe("the G2 layers", () => {
  it("keeps /curves and /linear free of the DOM, React, and glass layers", () => {
    expect(reaches("curves", ["dom", "react", "glass"])).toEqual([]);
    expect(reaches("linear", ["dom", "react", "glass"])).toEqual([]);
  });

  it("keeps /curves free of /linear", () => {
    expect(reaches("curves", ["linear"])).toEqual([]);
  });

  it("keeps the engine, glass, frame, and values free of /curves and /linear", () => {
    for (const layer of ["engine", "glass", "frame", "values", "dom", "react"]) {
      expect(reaches(layer, ["curves", "linear"]), layer).toEqual([]);
    }
  });
});

describe("the engine entry", () => {
  it("reaches no file of /curves or /linear", async () => {
    const inputs = await bundleInputs("src/index.ts");
    expect(inputs.length).toBeGreaterThan(3);
    expect(inputs.filter((file) => /(^|\/)src\/(curves|linear)\//.test(file))).toEqual([]);
  });

  it("is not pulled into /curves or /linear from the DOM, React, or glass side", async () => {
    for (const entry of ["src/curves/index.ts", "src/linear/index.ts"]) {
      const inputs = await bundleInputs(entry);
      expect(inputs.filter((file) => /(^|\/)src\/(glass|dom|react)\//.test(file)), entry).toEqual([]);
    }
  });

  it("keeps /curves free of the scheduler and the value layer at run time, because it takes both by argument", async () => {
    const inputs = await bundleInputs("src/curves/index.ts");
    expect(inputs.filter((file) => /(^|\/)src\/(frame|values)\//.test(file))).toEqual([]);
  });

  it("gives /linear the curves code and the spring solver, and nothing from the engine's browser plumbing", async () => {
    const inputs = await bundleInputs("src/linear/index.ts");
    expect(inputs.some((file) => /src\/curves\//.test(file))).toBe(true);
    expect(inputs.some((file) => /src\/engine\/spring\.ts$/.test(file))).toBe(true);
    expect(inputs.filter((file) => /src\/engine\/(env|scroll-env|guard|preferences|flavor)\.ts$/.test(file))).toEqual([]);
  });
});
