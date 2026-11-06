// The rules that scripts/check-pack.mjs applies to the packed tarball. They are plain functions, so a test can run them
// without packing anything.

/** The packed size, in bytes, that was measured when this rule was set. See docs/baseline.md. */
export const MEASURED_SIZE = 137293;
/** The tarball may grow to this many times the measured size. A larger one fails the check. */
export const SIZE_FACTOR = 1.5;

const ROOT_FILES = new Set(["README.md", "LICENSE", "package.json"]);

/** True when a tarball path may ship: a file under dist, the README, the license, or package.json. */
export function isAllowedPackFile(path) {
  if (typeof path !== "string" || path === "") return false;
  if (ROOT_FILES.has(path)) return true;
  if (!path.startsWith("dist/") || path.length === "dist/".length) return false;
  return !path.split("/").some((part) => part === ".." || part === "." || part === "");
}

/** The paths that may not ship, in the order given. */
export function disallowedFiles(paths) {
  return paths.filter((path) => !isAllowedPackFile(path));
}

/** The largest tarball size, in bytes, that passes. */
export function sizeLimit(measured = MEASURED_SIZE) {
  return Math.floor(measured * SIZE_FACTOR);
}

/** True when the size is a positive finite number and is not above the limit. */
export function withinSizeBudget(size, measured = MEASURED_SIZE) {
  return Number.isFinite(size) && size > 0 && size <= sizeLimit(measured);
}

/** The export targets of the package that are not in the tarball. Targets are "./dist/x" paths, and the tarball lists "dist/x". */
export function missingExportTargets(exportsMap, paths) {
  const present = new Set(paths);
  const targets = [];
  const visit = (value) => {
    if (typeof value === "string") targets.push(value.replace(/^\.\//, ""));
    else if (value !== null && typeof value === "object") for (const inner of Object.values(value)) visit(inner);
  };
  visit(exportsMap);
  return targets.filter((target) => !present.has(target));
}

/**
 * The environment for the npm commands that the check runs. `npm publish --dry-run` sets npm_config_dry_run for its scripts,
 * and a child `npm pack` would then write no tarball. The check must always write its own tarball, so it turns the dry run off.
 */
export function childEnv(env) {
  return { ...env, npm_config_dry_run: "false" };
}
