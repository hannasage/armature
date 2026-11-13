import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

// G7 adds `/css`, `/vue`, and `/svelte`.
//   - The spring-only entry reaches no file of any of them.
//   - `/css` reaches no DOM, React, Vue, Svelte, or glass code, and its source names no browser global.
//   - An adapter reaches the engine and the controllers it wraps (`dom`, `gesture`, `layout`), and nothing of glass, React, CSS output, or the other
//     adapter. It holds no motion logic: it imports no solver and no scheduler, and names no frame or timer.
//   - No other layer reaches an adapter or `/css`.
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

/** The folder of src that a specifier points into, or null for a package such as vue. */
function layerOf(specifier: string, from: string): string | null {
  if (specifier.startsWith("@hannasage/armature/")) return specifier.split("/")[2] ?? null;
  if (!specifier.startsWith(".")) return null;
  const target = relative(join(root, "src"), resolve(dirname(from), specifier));
  return target.startsWith("..") ? null : target.split(sep)[0];
}

/** The packages a layer imports by bare name, such as vue or svelte. A scoped name of this package is not one. */
const packagesOf = (layer: string): string[] =>
  sourceFiles(join(root, "src", layer)).flatMap((file) =>
    specifiersOf(readFileSync(file, "utf8")).filter((specifier) => !specifier.startsWith(".") && !specifier.startsWith("@hannasage/")).map((specifier) => specifier.split("/")[0]),
  );

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

const code = (file: string) => readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const bundle = async (entry: string) => {
  const result = await build({
    entryPoints: [join(root, entry)], bundle: true, minify: true, format: "esm", write: false, metafile: true,
    external: ["react", "react/jsx-runtime", "react-dom", "vue", "svelte"], logLevel: "silent", outdir: "out",
  });
  return { inputs: Object.keys(Object.values(result.metafile.outputs)[0].inputs), gzipped: gzipSync(result.outputFiles[0].contents).length };
};

const NEW = ["css", "vue", "svelte"];
const OTHERS = ["engine", "glass", "frame", "values", "curves", "linear", "gesture", "timeline", "layout", "dom", "react"];

describe("the G7 layers", () => {
  it.each(NEW)("has source files in src/%s", (layer) => {
    expect(sourceFiles(join(root, "src", layer)).length).toBeGreaterThan(1);
  });

  it("keeps every other layer free of /css, /vue, and /svelte", () => {
    for (const layer of OTHERS) expect(reaches(layer, NEW), layer).toEqual([]);
  });

  it("keeps /css free of the DOM, React, Vue, Svelte, glass, gesture, layout, and values layers", () => {
    expect(reaches("css", ["dom", "react", "vue", "svelte", "glass", "gesture", "layout", "values"])).toEqual([]);
    expect(packagesOf("css")).toEqual([]);
  });

  it("reaches the engine, curves, linear, timeline, and frame from /css, and nothing else of the package", () => {
    const layers = new Set<string>();
    for (const file of sourceFiles(join(root, "src", "css"))) for (const specifier of specifiersOf(readFileSync(file, "utf8"))) layers.add(layerOf(specifier, file) ?? "");
    layers.delete("css");
    layers.delete("");
    expect([...layers].every((layer) => ["engine", "curves", "linear", "timeline", "frame"].includes(layer)), [...layers].join(", ")).toBe(true);
    expect(layers.has("linear")).toBe(true);
  });

  it("names no browser global in the source of /css", () => {
    for (const file of sourceFiles(join(root, "src", "css"))) {
      expect(code(file).match(/\b(window|document|navigator|HTMLElement|Element|requestAnimationFrame|cancelAnimationFrame|matchMedia|CSS\.supports|setTimeout|setInterval|globalThis|self)\b/g), relative(root, file)).toBeNull();
    }
  });

  it.each([["vue", "svelte"], ["svelte", "vue"]])("keeps /%s free of glass, React, CSS output, the other adapter, and every layer that is not a controller", (layer, other) => {
    expect(reaches(layer, ["glass", "react", "css", other, "values", "curves", "linear", "timeline", "frame"])).toEqual([]);
  });

  it("reaches only the engine and the controller layers from an adapter", () => {
    for (const adapter of ["vue", "svelte"]) {
      const layers = new Set<string>();
      for (const file of sourceFiles(join(root, "src", adapter))) for (const specifier of specifiersOf(readFileSync(file, "utf8"))) layers.add(layerOf(specifier, file) ?? "");
      layers.delete(adapter);
      layers.delete("");
      expect([...layers].every((layer) => ["engine", "dom", "gesture", "layout"].includes(layer)), `${adapter}: ${[...layers].join(", ")}`).toBe(true);
      expect(layers.has("dom"), adapter).toBe(true);
    }
  });

  it("lets /vue import vue and nothing else by name, and /svelte import no package", () => {
    expect([...new Set(packagesOf("vue"))]).toEqual(["vue"]);
    expect(packagesOf("svelte")).toEqual([]);
  });

  it("holds no motion logic in an adapter: no solver, no scheduler, no frame, no timer, no clock", () => {
    for (const adapter of ["vue", "svelte"]) {
      for (const file of sourceFiles(join(root, "src", adapter))) {
        const text = code(file);
        const where = relative(root, file);
        expect(specifiersOf(text).filter((specifier) => /(^|\/)(spring|math|scheduler|env|scroll-env|scroll-velocity)$/.test(specifier)), where).toEqual([]);
        expect(text.match(/\b(stepSpring|createSpring|retarget|reconfigure|requestFrame|requestAnimationFrame|setTimeout|setInterval|performance|Math\.(exp|pow|sqrt|sin|cos)|FIXED_STEP)\b/g), where).toBeNull();
      }
    }
  });

  it("writes no property named transform in /css, /vue, or /svelte", () => {
    for (const layer of NEW) {
      for (const file of sourceFiles(join(root, "src", layer))) {
        expect(code(file).match(/["'`][^"'`\n]*transform[^"'`\n]*["'`]/gi), relative(root, file)).toBeNull();
      }
    }
  });
});

describe("the entries", () => {
  it("lets the spring-only entry reach no file of /css, /vue, or /svelte, and keeps it as G6 left it", async () => {
    const { inputs, gzipped } = await bundle("src/index.ts");
    expect(inputs.length).toBeGreaterThan(3);
    expect(inputs.filter((file) => /(^|\/)src\/(css|vue|svelte)\//.test(file))).toEqual([]);
    expect(gzipped).toBeLessThanOrEqual(3853);
  });

  it("bundles /css from its own files, and no DOM, React, Vue, Svelte, glass, gesture, layout, or values code", async () => {
    const { inputs } = await bundle("src/css/index.ts");
    for (const file of ["src/css/keyframes.ts", "src/css/flavor.ts", "src/css/escape.ts", "src/linear/linear.ts", "src/timeline/timeline.ts"]) {
      expect(inputs.some((input) => input.endsWith(file)), file).toBe(true);
    }
    expect(inputs.filter((file) => /(^|\/)src\/(dom|react|vue|svelte|glass|gesture|layout|values)\//.test(file))).toEqual([]);
    expect(inputs.filter((file) => file.includes("node_modules"))).toEqual([]);
  });

  it("bundles each adapter with the controllers it wraps, no glass or React code, and no copy of vue or svelte", async () => {
    for (const adapter of ["vue", "svelte"]) {
      const { inputs } = await bundle(`src/${adapter}/index.ts`);
      for (const file of ["src/dom/surface.ts", "src/dom/follower.ts", "src/gesture/drag.ts", "src/layout/layout.ts"]) expect(inputs.some((input) => input.endsWith(file)), `${adapter}: ${file}`).toBe(true);
      expect(inputs.filter((file) => /(^|\/)src\/(glass|react|css)\//.test(file)), adapter).toEqual([]);
      expect(inputs.filter((file) => file.includes("node_modules")), adapter).toEqual([]);
    }
  });
});
