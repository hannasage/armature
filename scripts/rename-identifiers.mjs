// Renames the generic engine and DOM types from their old `Lqg*` names to `Armature*`.
// It uses plain regular expressions on whole words and nothing else. It does not parse the code.
// It runs over src/** and tests/**, and skips tests/golden/legacy, which is a frozen copy of the old code.
// It never touches a CSS variable, an attribute, a class, or a log label: none of those contain a whole word below.
// Run it with: node scripts/rename-identifiers.mjs
// Running it again changes nothing.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const RENAMES = [
  [/\bLqgScrollEnvironment\b/g, "ArmatureScrollEnvironment"],
  [/\bLqgEnvironment\b/g, "ArmatureEnvironment"],
  [/\bLqgTarget\b/g, "ArmatureTarget"],
  [/\bLqgRevealAttributes\b/g, "ArmatureRevealAttributes"],
];

const SKIP = new Set(["tests/golden/legacy"]);

function walk(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = posix.join(dir, entry.name);
    if (SKIP.has(path)) return [];
    if (entry.isDirectory()) return walk(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

let changed = 0;
for (const file of [...walk("src"), ...walk("tests")]) {
  const before = readFileSync(join(root, file), "utf8");
  let after = before;
  for (const [pattern, name] of RENAMES) after = after.replace(pattern, name);
  if (after !== before) {
    writeFileSync(join(root, file), after);
    changed += 1;
  }
}
console.log(`renamed identifiers in ${changed} files`);
