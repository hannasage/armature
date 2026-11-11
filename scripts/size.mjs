// Prints the size table of every package entry. Add `--json` for machine output.
// Add `--out <file>` to write the same output to a file inside the repository.
import { writeFileSync } from "node:fs";
import process from "node:process";
import { esbuildVersion, formatTable, measureAll, resolveOut } from "./size-lib.mjs";

const args = process.argv.slice(2);
let outFile = null;
try {
  const outIndex = args.indexOf("--out");
  if (outIndex !== -1) outFile = resolveOut(args[outIndex + 1]);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const rows = await measureAll();
const text = args.includes("--json")
  ? JSON.stringify({ esbuild: esbuildVersion, entries: rows }, null, 2)
  : `esbuild ${esbuildVersion}, bundle, minify, esm, React external, then gzip\n\n${formatTable(rows)}`;
console.log(text);
if (outFile) writeFileSync(outFile, `${text}\n`);
