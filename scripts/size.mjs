// Prints the size table of every package entry. Add `--json` for machine output.
// Add `--out <file>` to write the table to a file as well.
import { writeFileSync } from "node:fs";
import process from "node:process";
import { esbuildVersion, formatTable, measureAll } from "./size-lib.mjs";

const args = process.argv.slice(2);
const rows = await measureAll();
const outIndex = args.indexOf("--out");
const table = formatTable(rows);

if (args.includes("--json")) {
  console.log(JSON.stringify({ esbuild: esbuildVersion, entries: rows }, null, 2));
} else {
  console.log(`esbuild ${esbuildVersion}, bundle, minify, esm, React external, then gzip\n\n${table}`);
}
if (outIndex !== -1 && args[outIndex + 1]) writeFileSync(args[outIndex + 1], `${table}\n`);
