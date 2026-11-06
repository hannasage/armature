import { defineConfig } from "vite";

// Build each source file to its own output file (preserveModules). A "use client" line then
// stays at the top of the React file that has it, and no other file gains one.
// The source uses extensionless relative imports, which Node ESM cannot load from plain tsc output.
// The build rewrites them. tsconfig.build.json then adds the type declarations.
export default defineConfig({
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        "react/index": "src/react/index.ts",
      },
      formats: ["es"],
    },
    rolldownOptions: {
      external: ["react", "react/jsx-runtime", "react-dom"],
      output: {
        preserveModules: true,
        preserveModulesRoot: "src",
      },
      // The directive is kept per file here. scripts/postbuild.mjs checks it, so the warning is noise.
      onLog(level, log, handler) {
        if (log.code === "MODULE_LEVEL_DIRECTIVE") return;
        handler(level, log);
      },
    },
    sourcemap: true,
    minify: false,
  },
});
