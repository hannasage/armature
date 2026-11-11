// Fails when an entry is over its cap in size-budget.json, or when an entry has no cap.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { checkBudget, formatTable, measureAll, root } from "./size-lib.mjs";

const budget = JSON.parse(readFileSync(join(root, "size-budget.json"), "utf8"));
const rows = await measureAll();
console.log(formatTable(rows));
const problems = checkBudget(rows, budget);

if (problems.length > 0) {
  console.error("\nSize check failed:");
  for (const text of problems) console.error(`  - ${text}`);
  process.exit(1);
}
console.log("\nSize check passed: every entry is within its cap.");
