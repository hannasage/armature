import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["dist/**", "coverage/**", "node_modules/**"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // The imported liquid-glass code is kept verbatim from commit 4c7b59b.
    // These two rules fire on it, so they are off until Milestone 1 rewrites those lines.
    rules: {
      "no-useless-assignment": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { console: "readonly" } },
  },
);
