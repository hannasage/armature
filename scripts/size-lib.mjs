// Measures every package entry the way docs/baseline.md did: esbuild with bundle, minify, and the esm format,
// then gzip. React stays external. Each entry is measured alone, with the files it imports.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import { gzipSync } from "node:zlib";
import { build, version as esbuildVersion } from "esbuild";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export { esbuildVersion };

/** The JavaScript target of an export: a string, or the "import" field of a condition object. */
function importTarget(value) {
  return typeof value === "string" ? value : value.import;
}

/** Map an exports target to its source file. ./dist/dom/index.js has the source src/dom/index.ts. */
export function sourceFor(value) {
  const target = importTarget(value).replace(/^\.\/dist\//, "");
  // The build copies src/glass/styles.css to dist/styles.css.
  if (target === "styles.css") return "src/glass/styles.css";
  return `src/${target.replace(/\.js$/, ".ts")}`;
}

/** The entries of a package: one per key of the exports map, in the order of the map. */
export function entriesOf(pkg) {
  return Object.entries(pkg.exports).map(([key, value]) => ({
    key: key === "." ? pkg.name : `${pkg.name}/${key.slice(2)}`,
    source: sourceFor(value),
  }));
}

/** Measure one source file. Returns the minified and the gzipped size in bytes. */
export async function measureEntry(source, dir = root) {
  const file = join(dir, source);
  if (!existsSync(file)) throw new Error(`the entry source ${source} does not exist`);
  const result = await build({
    entryPoints: [file],
    bundle: true,
    minify: true,
    format: "esm",
    write: false,
    external: ["react", "react/jsx-runtime", "react-dom"],
    logLevel: "silent",
    outdir: "out",
  });
  const output = result.outputFiles.find((f) => !f.path.endsWith(".map")) ?? result.outputFiles[0];
  const bytes = Buffer.from(output.contents);
  return { minified: bytes.length, gzipped: gzipSync(bytes).length };
}

/** Measure every entry of package.json. */
export async function measureAll(dir = root) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const rows = [];
  for (const entry of entriesOf(pkg)) rows.push({ ...entry, ...(await measureEntry(entry.source, dir)) });
  return rows;
}

/** A markdown table of the measured rows. */
export function formatTable(rows) {
  const number = (n) => n.toLocaleString("en-US");
  const lines = ["| Entry | Source | Minified (bytes) | Gzipped (bytes) |", "| --- | --- | ---: | ---: |"];
  for (const row of rows) lines.push(`| \`${row.key}\` | \`${row.source}\` | ${number(row.minified)} | ${number(row.gzipped)} |`);
  return lines.join("\n");
}

/**
 * Compare measured rows with a budget. The budget maps an entry name to { cap } in gzipped bytes.
 * Returns a list of problems: an entry over its cap, an entry with no cap, or a cap with no entry.
 */
export function checkBudget(rows, budget) {
  const caps = budget.caps ?? {};
  const problems = [];
  for (const row of rows) {
    const cap = caps[row.key]?.cap;
    if (typeof cap !== "number" || !Number.isFinite(cap) || cap <= 0) problems.push(`${row.key} has no cap in the budget`);
    else if (row.gzipped > cap) problems.push(`${row.key} is ${row.gzipped} bytes gzipped, which is ${row.gzipped - cap} over its cap of ${cap}`);
  }
  const names = new Set(rows.map((row) => row.key));
  for (const name of Object.keys(caps)) if (!names.has(name)) problems.push(`the budget has a cap for ${name}, and the package has no such entry`);
  return problems;
}
