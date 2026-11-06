// Runs after the build. It copies the stylesheet, adds the file extension to the imports in the type declarations,
// and checks the "use client" lines.
// The source files that start with "use client" must be the ten files that use a hook. They must start with it in dist, and no other file may.
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

copyFileSync("src/glass/styles.css", "dist/styles.css");

function walk(dir, ext) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path, ext);
    return ext.some((e) => path.endsWith(e)) ? [path] : [];
  });
}

// The source uses extensionless relative imports, and tsc writes them as they are. Node16 and NodeNext resolution cannot follow those in a
// package of type "module", so each relative import in a declaration file gets the ".js" extension, or "/index.js" for a folder.
for (const file of walk("dist", [".d.ts"])) {
  const text = readFileSync(file, "utf8");
  const fixed = text.replace(/(\bfrom\s*|\bimport\s*\(\s*)(["'])(\.{1,2}\/[^"']*)\2/g, (whole, lead, quote, specifier) => {
    if (/\.(js|css|json)$/.test(specifier)) return whole;
    const base = resolve(dirname(file), specifier);
    if (existsSync(`${base}.d.ts`)) return `${lead}${quote}${specifier}.js${quote}`;
    if (existsSync(join(base, "index.d.ts"))) return `${lead}${quote}${specifier.replace(/\/$/, "")}/index.js${quote}`;
    return whole;
  });
  if (fixed !== text) writeFileSync(file, fixed);
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

// The files that use a hook carry the line: the five generic ones and the five glass-bound wrappers. The glass filter component and every other file must not.
const CLIENT_FILES = [
  "react/ArmatureProvider.js",
  "react/ArmatureRevealProvider.js",
  "react/useArmatureLens.js",
  "react/useArmatureReveal.js",
  "react/useArmatureSurface.js",
  "glass/react/LqgProvider.js",
  "glass/react/LqgRevealProvider.js",
  "glass/react/useLqgLens.js",
  "glass/react/useLqgReveal.js",
  "glass/react/useLqgSurface.js",
];
if (JSON.stringify(expected) !== JSON.stringify([...CLIENT_FILES].sort())) {
  throw new Error(`"use client" must be on exactly these source files.\nexpected: ${[...CLIENT_FILES].sort().join(", ")}\nfound in src: ${expected.join(", ")}`);
}

if (JSON.stringify(expected) !== JSON.stringify(actual)) {
  throw new Error(`"use client" mismatch.\nexpected: ${expected.join(", ")}\nactual: ${actual.join(", ")}`);
}
console.log(`"use client" kept on ${actual.length} files.`);
