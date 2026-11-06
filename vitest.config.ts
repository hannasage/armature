import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string) => fileURLToPath(new URL(`./src/${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    // The examples import the package by its public names. These point those names at the source entries, so a test
    // reads the code in `src` and not an old build in `dist`. Each name matches exactly, so a deep path does not resolve.
    alias: [
      { find: /^@hannasage\/armature$/, replacement: src("index.ts") },
      { find: /^@hannasage\/armature\/dom$/, replacement: src("dom/index.ts") },
      { find: /^@hannasage\/armature\/react$/, replacement: src("react/index.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
