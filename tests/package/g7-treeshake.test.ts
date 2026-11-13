import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

// The size of an adapter entry counts all four controllers, because the entry exports four functions. A page that imports one function must pay for that
// controller only. The package has no side effects except styles.css, so a bundler can drop the rest. These tests bundle a page that imports one function.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function page(entry: string, name: string) {
  const result = await build({
    stdin: { contents: `import { ${name} } from ${JSON.stringify(join(root, entry))};\nconsole.log(${name});`, resolveDir: root, loader: "ts" },
    bundle: true, minify: true, format: "esm", write: false, metafile: true, external: ["vue", "svelte"], logLevel: "silent", outdir: "out",
  });
  return { inputs: Object.keys(Object.values(result.metafile.outputs)[0].inputs), gzipped: gzipSync(result.outputFiles[0].contents).length };
}

/** The gzipped bytes of a page that imports one follower function, as docs/baseline.md records them (G7 build, "One import"). A pin is an upper bound, as the size pins elsewhere are. */
const ONE = { vue: 3392, svelte: 3339 };
const baseline = readFileSync(join(root, "docs/baseline.md"), "utf8");

const has = (inputs: string[], file: string) => inputs.some((input) => input.endsWith(file));

describe("a page that imports one function", () => {
  it("pays for the follower from /vue, and not for the drag, layout, or surface controllers", async () => {
    const one = await page("src/vue/index.ts", "useArmatureFollower");
    const all = await page("src/vue/index.ts", "useArmatureFollower, useArmatureSurface, useArmatureDrag, useArmatureLayout");
    expect(has(one.inputs, "src/dom/follower.ts")).toBe(true);
    for (const file of ["src/dom/surface.ts", "src/gesture/drag.ts", "src/layout/layout.ts", "src/layout/motion.ts"]) expect(has(one.inputs, file), file).toBe(false);
    expect(one.gzipped).toBeLessThan(all.gzipped / 2);
    expect(one.gzipped).toBeLessThan(4000);
    expect(one.gzipped).toBeLessThanOrEqual(ONE.vue);
  });

  it("pays for the follower from /svelte, and not for the drag, layout, or surface controllers", async () => {
    const one = await page("src/svelte/index.ts", "follow");
    const all = await page("src/svelte/index.ts", "follow, surface, drag, layout");
    expect(has(one.inputs, "src/dom/follower.ts")).toBe(true);
    for (const file of ["src/dom/surface.ts", "src/gesture/drag.ts", "src/layout/layout.ts", "src/layout/motion.ts"]) expect(has(one.inputs, file), file).toBe(false);
    expect(one.gzipped).toBeLessThan(all.gzipped / 2);
    expect(one.gzipped).toBeLessThan(4000);
    expect(one.gzipped).toBeLessThanOrEqual(ONE.svelte);
  });

  it("pays for the drag only when the drag is imported, and for the layout only when the layout is imported", async () => {
    expect(has((await page("src/vue/index.ts", "useArmatureDrag")).inputs, "src/gesture/drag.ts")).toBe(true);
    expect(has((await page("src/vue/index.ts", "useArmatureDrag")).inputs, "src/dom/follower.ts")).toBe(false);
    expect(has((await page("src/svelte/index.ts", "layout")).inputs, "src/layout/layout.ts")).toBe(true);
    expect(has((await page("src/svelte/index.ts", "layout")).inputs, "src/dom/follower.ts")).toBe(false);
  });

  it("drops the timeline and the flavor sheet from /css when only cssLinear is imported, and keeps the linear exporter", async () => {
    const one = await page("src/css/index.ts", "cssLinear");
    expect(has(one.inputs, "src/timeline/timeline.ts")).toBe(false);
    expect(has(one.inputs, "src/css/flavor.ts")).toBe(false);
    expect(has(one.inputs, "src/linear/linear.ts")).toBe(true);
  });

  it("records the two single-import sizes in docs/baseline.md", () => {
    expect(baseline).toContain(`${ONE.vue.toLocaleString("en-US")} gzipped bytes from \`/vue\``);
    expect(baseline).toContain(`${ONE.svelte.toLocaleString("en-US")} from \`/svelte\``);
  });
});
