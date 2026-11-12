import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

// The new subpaths `/frame` and `/values` sit beside the engine. The spring-only entry reaches neither one, and neither one reaches
// the DOM, React, or glass code. A static scan of the source text finds every import specifier. A bundle of the entry checks the size.

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

/** The folder of src that a specifier points into, or null for a package such as react. */
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

describe("the layers", () => {
  it("keeps frame and values free of the DOM, React, and glass layers", () => {
    expect(reaches("frame", ["dom", "react", "glass", "values"])).toEqual([]);
    expect(reaches("values", ["dom", "react", "glass"])).toEqual([]);
  });

  it("keeps the engine free of the new subpaths", () => {
    expect(reaches("engine", ["frame", "values"])).toEqual([]);
  });

  it("keeps glass free of the new subpaths", () => {
    expect(reaches("glass", ["frame", "values"])).toEqual([]);
  });

  it("finds a forbidden import in a made-up file", () => {
    const text = 'import { createScheduler } from "../frame/scheduler";\nexport * from "../values";';
    const layers = specifiersOf(text).map((specifier) => layerOf(specifier, join(root, "src", "engine", "x.ts")));
    expect(layers).toEqual(["frame", "values"]);
    expect(layerOf("@hannasage/armature/values", join(root, "src", "dom", "x.ts"))).toBe("values");
    expect(layerOf("react", join(root, "src", "dom", "x.ts"))).toBeNull();
  });
});

describe("the spring-only entry", () => {
  const bundle = async (entry: string) => {
    const result = await build({
      entryPoints: [join(root, entry)], bundle: true, minify: true, format: "esm", write: false, metafile: true,
      external: ["react", "react/jsx-runtime", "react-dom"], logLevel: "silent", outdir: "out",
    });
    const inputs = Object.keys(Object.values(result.metafile.outputs)[0].inputs);
    return { inputs, gzipped: gzipSync(result.outputFiles[0].contents).length };
  };

  it("reaches no file of /frame or /values", async () => {
    const { inputs } = await bundle("src/index.ts");
    expect(inputs.length).toBeGreaterThan(3);
    expect(inputs.filter((file) => /(^|\/)src\/(frame|values)\//.test(file))).toEqual([]);
  });

  it("is no larger than it was before /frame and /values: 3,688 bytes gzipped", async () => {
    // The figure is the size after the follower, rest, and name changes of amendment 2 and before any code of this milestone reached the entry.
    expect((await bundle("src/index.ts")).gzipped).toBeLessThanOrEqual(3688);
  });

  it("keeps /frame and /values free of glass code", async () => {
    for (const entry of ["src/frame/index.ts", "src/values/index.ts"]) {
      const { inputs } = await bundle(entry);
      expect(inputs.filter((file) => /(^|\/)src\/(glass|dom|react)\//.test(file)), entry).toEqual([]);
    }
  });

  it("keeps /frame small: the scheduler pulls in only the step constants of the spring file", async () => {
    expect((await bundle("src/frame/index.ts")).gzipped).toBeLessThan(1000);
  });
});
