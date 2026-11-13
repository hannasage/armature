// Measures every package entry the way docs/baseline.md did: esbuild with bundle, minify, and the esm format,
// then gzip. React, Vue, and Svelte stay external. Each entry is measured alone, with the files it imports.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import { gzipSync } from "node:zlib";
import { build, version as esbuildVersion } from "esbuild";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export { esbuildVersion };

/** The JavaScript target of an export: a string, or the "import" field of a condition object. */
function importTarget(value, key) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.import === "string") return value.import;
  throw new Error(`export "${key}" has no string target and no "import" string, so it cannot be measured`);
}

/** Map an exports target to its source file. ./dist/dom/index.js has the source src/dom/index.ts. */
export function sourceFor(value, key = "?") {
  const target = importTarget(value, key);
  if (target.includes("*")) throw new Error(`export "${key}" is a wildcard, and the size check does not measure wildcards`);
  if (!target.startsWith("./dist/")) throw new Error(`export "${key}" has the target ${target}, which does not start with ./dist/`);
  const name = target.slice("./dist/".length);
  // The build copies src/glass/styles.css to dist/styles.css.
  const source = name === "styles.css" ? "src/glass/styles.css" : `src/${name.replace(/\.js$/, ".ts")}`;
  if (!resolve(root, source).startsWith(`${join(root, "src")}${sep}`)) throw new Error(`export "${key}" maps to ${source}, which is not inside src/`);
  return source;
}

/** The entries of a package: one per key of the exports map, in the order of the map. */
export function entriesOf(pkg) {
  return Object.entries(pkg.exports ?? {}).map(([key, value]) => {
    if (key.includes("*")) throw new Error(`export "${key}" is a wildcard, and the size check does not measure wildcards`);
    return { key: key === "." ? pkg.name : `${pkg.name}/${key.slice(2)}`, source: sourceFor(value, key) };
  });
}

/** The cap for a measured gzipped size: plus 10 percent, rounded up to the next 10 bytes. */
export function capFor(gzipped) {
  return Math.ceil(Math.ceil((gzipped * 11) / 10) / 10) * 10;
}

const PROTECTED = new Set(["package.json", "package-lock.json", "size-budget.json", "README.md", "CHANGELOG.md", "LICENSE"]);

/**
 * Check the --out argument of the size script. The output is a .md or .json file inside the repository.
 * The check follows symlinks, so a link that leaves the repository is refused. A tracked file is never overwritten.
 */
export function resolveOut(arg, dir = root) {
  if (arg === undefined || arg === "" || arg.startsWith("--")) throw new Error("--out needs a file path");
  if (!/\.(md|json)$/.test(arg)) throw new Error("--out must name a .md or .json file");
  const rootReal = realpathSync(dir);
  const target = resolve(dir, arg);
  const parent = dirname(target);
  if (!existsSync(parent)) throw new Error(`the directory of --out ${arg} does not exist`);
  let final = join(realpathSync(parent), basename(target));
  if (existsSync(target)) final = realpathSync(target);
  else if (lstatExists(target)) throw new Error("the --out path is a broken symlink");
  if (!final.startsWith(`${rootReal}${sep}`)) throw new Error(`--out must name a file inside the repository, and ${arg} is outside it`);
  const relativePath = final.slice(rootReal.length + 1);
  // Fail closed: exit 0 is tracked, exit 1 is untracked, and anything else (no git, not a repository) is an error.
  const git = spawnSync("git", ["-c", `safe.directory=${rootReal}`, "ls-files", "--error-unmatch", "--", relativePath], { cwd: rootReal, stdio: "ignore" });
  if (git.error || (git.status !== 0 && git.status !== 1)) {
    const reason = git.error ? git.error.message : `exited with ${git.status}`;
    throw new Error(`cannot tell whether ${arg} is tracked: git ${reason}`);
  }
  if (PROTECTED.has(relativePath) || git.status === 0) throw new Error(`--out ${arg} would overwrite a tracked file`);
  return final;
}

function lstatExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Measure one source file. Returns the minified and the gzipped size in bytes. */
export async function measureEntry(source, dir = root) {
  const file = resolve(dir, source);
  if (!existsSync(file)) throw new Error(`the entry source ${source} does not exist`);
  const result = await build({
    entryPoints: [file],
    bundle: true,
    minify: true,
    format: "esm",
    write: false,
    external: ["react", "react/jsx-runtime", "react-dom", "vue", "svelte"],
    logLevel: "silent",
    outdir: "out",
  });
  if (result.warnings.length > 0) {
    throw new Error(`esbuild reported ${result.warnings.length} warning(s) for ${source}: ${result.warnings.map((w) => w.text).join("; ")}`);
  }
  const output = result.outputFiles.find((f) => !f.path.endsWith(".map")) ?? result.outputFiles[0];
  const bytes = Buffer.from(output.contents);
  if (bytes.length === 0) throw new Error(`the entry ${source} built to an empty file`);
  return { minified: bytes.length, gzipped: gzipSync(bytes).length };
}

/** The layers of src that an adapter or the CSS output wraps. Their files are left out when the own code of an entry is measured. */
export const WRAPPED_LAYERS = ["engine", "dom", "gesture", "layout", "timeline", "linear", "curves", "frame"];

/**
 * Measure the code of one entry alone: the files of its own folder, with every file of a wrapped layer marked external.
 * The result is what the entry adds on top of the layers it wraps. `source` is the entry file, such as src/vue/index.ts.
 */
export async function measureOwn(source, dir = root) {
  const file = resolve(dir, source);
  if (!existsSync(file)) throw new Error(`the entry source ${source} does not exist`);
  const own = relative(join(dir, "src"), file).split(sep)[0];
  // esbuild resolves symlinks, so the layer of an import is read from the real path of src.
  const srcReal = realpathSync(join(dir, "src"));
  const leaveOut = {
    name: "wrapped-layers",
    setup(b) {
      b.onResolve({ filter: /^\.\.?\// }, (args) => {
        const target = resolve(args.resolveDir, args.path);
        const inside = relative(srcReal, target);
        const layer = inside.split(sep)[0];
        // The specifier that esbuild writes for an external import is part of the bundle, and so of its gzip size. An absolute path would make the size
        // depend on where the repository is checked out, so the specifier is the path inside src, in a fixed form.
        return layer !== own && WRAPPED_LAYERS.includes(layer) ? { path: `armature-layer:${inside.split(sep).join("/")}`, external: true } : null;
      });
    },
  };
  const result = await build({
    entryPoints: [file], bundle: true, minify: true, format: "esm", write: false, plugins: [leaveOut],
    external: ["react", "react/jsx-runtime", "react-dom", "vue", "svelte"], logLevel: "silent", outdir: "out",
  });
  const bytes = Buffer.from((result.outputFiles.find((f) => !f.path.endsWith(".map")) ?? result.outputFiles[0]).contents);
  return { minified: bytes.length, gzipped: gzipSync(bytes).length };
}

/** Compare the own code of each entry named in `ownCaps` with its cap. Returns a list of problems. */
export async function checkOwnCaps(budget, dir = root) {
  const problems = [];
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const sources = new Map(entriesOf(pkg).map((entry) => [entry.key, entry.source]));
  for (const [key, { cap }] of Object.entries(budget.ownCaps ?? {})) {
    const source = sources.get(key);
    if (source === undefined) problems.push(`the budget has an own-code cap for ${key}, and the package has no such entry`);
    else if (typeof cap !== "number" || !Number.isFinite(cap) || cap <= 0) problems.push(`${key} has an own-code cap that is not a number above 0`);
    else {
      const { gzipped } = await measureOwn(source, dir);
      if (gzipped > cap) problems.push(`${key} own code is ${gzipped} bytes gzipped, which is ${gzipped - cap} over its own-code cap of ${cap}`);
    }
  }
  return problems;
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
