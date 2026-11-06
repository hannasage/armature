// Runs after the build. It copies the stylesheet and checks the "use client" lines.
// The source files that start with "use client" must be the five glass-bound behavior files. They must start with it in dist, and no other file may.
import { copyFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

copyFileSync("src/glass/styles.css", "dist/styles.css");

function walk(dir, ext) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path, ext);
    return ext.some((e) => path.endsWith(e)) ? [path] : [];
  });
}

const directive = /^\s*["']use client["']/;
const expected = walk("src", [".ts", ".tsx"])
  .filter((file) => directive.test(readFileSync(file, "utf8")))
  .map((file) => file.slice("src/".length).replace(/\.tsx?$/, ".js"))
  .sort();
const actual = walk("dist", [".js"])
  .filter((file) => directive.test(readFileSync(file, "utf8")))
  .map((file) => file.slice("dist/".length))
  .sort();

// The five glass-bound behavior files are the ones that carry the line. The filter component and every generic file must not.
const FIVE = [
  "glass/react/LqgProvider.js",
  "glass/react/LqgRevealProvider.js",
  "glass/react/useLqgLens.js",
  "glass/react/useLqgReveal.js",
  "glass/react/useLqgSurface.js",
];
if (JSON.stringify(expected) !== JSON.stringify(FIVE)) {
  throw new Error(`"use client" must be on exactly these source files.\nexpected: ${FIVE.join(", ")}\nfound in src: ${expected.join(", ")}`);
}

if (JSON.stringify(expected) !== JSON.stringify(actual)) {
  throw new Error(`"use client" mismatch.\nexpected: ${expected.join(", ")}\nactual: ${actual.join(", ")}`);
}
console.log(`"use client" kept on ${actual.length} files.`);
