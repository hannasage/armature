import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

// G3 adds the color, path, and 3D transform kinds to `/values`. Three rules hold for them:
//   1. Nothing in the package writes the CSS property `transform` from code. The 3D kind writes `translate`, `rotate`, and `scale`.
//   2. The spring-only entry `.` does not grow, and it does not reach the kinds.
//   3. The kinds sit in `/values` and reach no DOM, React, glass, curves, or linear code.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** The text of a source file without block comments and line comments. A `//` inside a string, such as a URL, is kept. */
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/([;,{}()]\s*)\/\/.*$/gm, "$1");

/** The ways code writes the property `transform`: a string that names it, a `style.transform` access, or a `transform:` key or declaration. */
const WRITES = [/["'`]transform["'`]/, /\.transform\b/, /(^|[^\w-])transform\s*:/, /setProperty\(\s*["'`]transform/];
const writesTransform = (text: string): string[] => WRITES.filter((pattern) => pattern.test(withoutComments(text))).map(String);

const bundle = async (entry: string) => {
  const result = await build({
    entryPoints: [join(root, entry)], bundle: true, minify: true, format: "esm", write: false, metafile: true,
    external: ["react", "react/jsx-runtime", "react-dom"], logLevel: "silent", outdir: "out",
  });
  const inputs = Object.keys(Object.values(result.metafile.outputs)[0].inputs);
  return { inputs, gzipped: gzipSync(result.outputFiles[0].contents).length };
};

describe("nothing writes `transform`", () => {
  it("finds a write in made-up text, and ignores a comment", () => {
    expect(writesTransform('el.style.transform = "x";')).not.toEqual([]);
    expect(writesTransform('setProperty("transform", v)')).not.toEqual([]);
    expect(writesTransform('const css = `transform: ${v}`;')).not.toEqual([]);
    expect(writesTransform("const s = { transform: v };")).not.toEqual([]);
    expect(writesTransform("// never `transform`, as the rule says\n/* transform: none */\nconst a = 1;")).toEqual([]);
    expect(writesTransform("const b = transform3dKind; type T = Transform3D;")).toEqual([]);
    expect(writesTransform("const c = 'translate: 1px'; // transform: none")).toEqual([]);
  });

  it("has no write of the property in any TypeScript source of the package", () => {
    const found: string[] = [];
    for (const file of sourceFiles(join(root, "src"))) {
      const hits = writesTransform(readFileSync(file, "utf8"));
      if (hits.length > 0) found.push(`${relative(root, file)}: ${hits.join(" ")}`);
    }
    expect(found).toEqual([]);
  });

  it("has the 3D kind in the source it scans", () => {
    const files = sourceFiles(join(root, "src", "values")).map((file) => relative(root, file).split(sep).join("/"));
    expect(files).toEqual(expect.arrayContaining(["src/values/color.ts", "src/values/path.ts", "src/values/transform3d.ts"]));
  });
});

describe("the spring-only entry", () => {
  it("does not grow past its size at G4, and stays under its cap of 4,000", async () => {
    // G4 adds the check of the optional gesture part to validateFlavor, which grew this entry from 3,686 to 3,854. The cap did not move. G7 added 12 bytes for a stop function that runs once, so the limit here is 3,865.
    const { gzipped } = await bundle("src/index.ts");
    expect(gzipped).toBeLessThanOrEqual(3865);
    const budget = JSON.parse(readFileSync(join(root, "size-budget.json"), "utf8")) as { caps: Record<string, { cap: number }> };
    expect(budget.caps["@hannasage/armature"].cap).toBe(4000);
  });

  it("reaches no file of the value layer, so no kind", async () => {
    const { inputs } = await bundle("src/index.ts");
    expect(inputs.filter((file) => /(^|\/)src\/values\//.test(file))).toEqual([]);
  });
});

describe("the kinds", () => {
  it("sit in /values, with the number kind, the vector kind, and the controller", async () => {
    const { inputs } = await bundle("src/values/index.ts");
    for (const name of ["kind", "vector", "value", "color", "color-names", "path", "transform3d"]) {
      expect(inputs.some((file) => file.endsWith(`src/values/${name}.ts`)), name).toBe(true);
    }
  });

  it("reach no DOM, React, glass, curves, linear, or frame code", async () => {
    const { inputs } = await bundle("src/values/index.ts");
    expect(inputs.filter((file) => /(^|\/)src\/(dom|react|glass|curves|linear|frame)\//.test(file))).toEqual([]);
  });

  it("are not pulled into /curves, which takes a kind as an argument", async () => {
    const { inputs } = await bundle("src/curves/index.ts");
    expect(inputs.filter((file) => /(^|\/)src\/values\//.test(file))).toEqual([]);
  });
});
