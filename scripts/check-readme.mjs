// Fails when the README and package.json disagree. See scripts/readme-rules.mjs for the rules.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkReadme } from "./readme-rules.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const readme = readFileSync(join(root, "README.md"), "utf8");
const problems = checkReadme(readme, pkg);

if (problems.length > 0) {
  console.error("README check failed:");
  for (const text of problems) console.error(`  - ${text}`);
  process.exit(1);
}
console.log(`README check passed: ${pkg.name}@${pkg.version}`);
