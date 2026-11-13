import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    // The examples import the package by its public names. These point those names at the source entries, so a test
    // reads the code in `src` and not an old build in `dist`. Each name matches exactly, so a deep path does not resolve.
    alias: [
      { find: /^@hannasage\/armature$/, replacement: src("index.ts") },
      { find: /^@hannasage\/armature\/frame$/, replacement: src("frame/index.ts") },
      { find: /^@hannasage\/armature\/gesture$/, replacement: src("gesture/index.ts") },
      { find: /^@hannasage\/armature\/timeline$/, replacement: src("timeline/index.ts") },
      { find: /^@hannasage\/armature\/layout$/, replacement: src("layout/index.ts") },
      { find: /^@hannasage\/armature\/values$/, replacement: src("values/index.ts") },
      { find: /^@hannasage\/armature\/curves$/, replacement: src("curves/index.ts") },
      { find: /^@hannasage\/armature\/linear$/, replacement: src("linear/index.ts") },
      { find: /^@hannasage\/armature\/dom$/, replacement: src("dom/index.ts") },
      { find: /^@hannasage\/armature\/react$/, replacement: src("react/index.ts") },
      { find: /^@hannasage\/armature\/glass$/, replacement: src("glass/index.ts") },
      { find: /^@hannasage\/armature\/glass\/react$/, replacement: src("glass/react/index.ts") },
      { find: /^@hannasage\/armature\/css$/, replacement: src("css/index.ts") },
      { find: /^@hannasage\/armature\/vue$/, replacement: src("vue/index.ts") },
      { find: /^@hannasage\/armature\/svelte$/, replacement: src("svelte/index.ts") },
    ],
  },
  test: {
    environment: "node",
    // A few heavy tests (the golden scroll reveal, the glass grid) hit the 5 s default when the machine is under load.
    testTimeout: 20000,
    hookTimeout: 20000,
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
