// Runs at the end of the build. It checks that the package works the way a user will load it.
//
// For every subpath in the "exports" map it:
//   1. checks that the "types" file and the "import" file exist in dist,
//   2. imports the subpath by package name under Node ESM, and checks that each public runtime name is there,
//   3. reads the type declaration files and checks that each public name (runtime and type) is exported there,
//      and that every relative import in those files resolves to a file.
// It also checks that the generic entries pull in no glass code, in the JavaScript and in the type declarations,
// and that the stylesheet export exists.
// The build fails with a list of every problem found.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const problems = [];
const problem = (text) => problems.push(text);

/**
 * The public API of each subpath. `values` is the full list of run-time names, and the import must have exactly these:
 * a missing name fails the build, and so does a name that is not on the list, such as a leaked internal.
 * `types` are names that exist only in the declaration files.
 */
const API = {
  ".": {
    values: [
      "FIXED_STEP", "MAX_FRAME", "REDUCED_MOTION_QUERY", "VELOCITY_MAX", "VELOCITY_REST", "VELOCITY_SMOOTHING_MS",
      "createBrowserEnvironment", "createBrowserScrollEnvironment", "createScrollVelocity", "createSpring", "criticalDamping", "cssVar",
      "dataAttr", "guardedSetup", "isAtRest", "logTag", "personalityOf", "prefersReducedMotion", "readPreferences", "reconfigure",
      "requireFollower", "requireLens", "requireReveal", "requireSurface", "retarget", "springOf", "stepSpring", "validateFlavor"
    ],
    types: [
      "Flavor", "SurfaceFlavor", "LensFlavor", "RevealFlavor", "FollowerSpec", "FollowerFlavor", "PersonalitySpec", "RevealStart", "StartContext", "StartInput", "FeelOptions",
      "SpringConfig", "SpringState", "ArmatureEnvironment", "ArmatureTarget", "ArmatureScrollEnvironment", "Preferences",
    ],
    generic: true,
  },
  "./dom": {
    values: [
      "REST_POSE", "attachSurface", "belowFold", "createFollower", "createLens", "createScrollReveal", "createSurface", "dragAttributes", "dragTarget",
      "installDelegation", "mountScrollReveal", "parseDelay", "parseDepth", "parsePersonality", "revealAttributes",
      "revealGroupAttributes", "revealLineAttributes", "revealPose", "revealRootMargin", "revealSpring", "revealStart",
      "scrollDirection", "staggerDelayFor", "startScrollReveal", "velocityBlend"
    ],
    types: ["SurfaceOptions", "LensOptions", "FollowerOptions", "FollowerState", "Follower", "DelegateOptions", "ScrollRevealOptions", "ScrollRevealController", "MountScrollRevealOptions", "ArmatureRevealAttributes"],
    generic: true,
  },
  "./react": {
    values: [
      "ArmatureProvider", "ArmatureRevealProvider", "useArmatureLens", "useArmatureReveal", "useArmatureSurface"
    ],
    types: ["ArmatureProviderProps", "ArmatureRevealProviderProps", "LensHandle", "UseArmatureRevealOptions"],
    generic: true,
  },
  "./glass": {
    values: [
      "DEPTH_ATTRIBUTE", "DEPTH_DEFAULT", "DEPTH_MAX", "DEPTH_MIN", "DRAG_ATTRIBUTE", "DRAG_FULL_VELOCITY", "DRAG_ROTATE_MAX",
      "DRAG_SHIFT_MAX", "DROP_SCALE", "FADE_RISE", "FAST_VELOCITY", "FEELS", "FEEL_ATTRIBUTE", "FOLD_PERCENT", "GROUP_ATTRIBUTE",
      "LINE_ATTRIBUTE", "LQG_LINE", "LQG_PREFIX", "LQG_REVEAL_GROUP", "MASK_HEIGHT_FALLBACK", "MASK_HEIGHT_MAX", "MASK_RISE_FAST",
      "MASK_RISE_SLOW", "OFFSET_FAST", "OFFSET_SLOW", "REFRACTION_ATTRIBUTE", "REVEALED_ATTRIBUTE", "REVEAL_ATTRIBUTE",
      "REVEAL_DELAY_ATTRIBUTE", "REVEAL_DELAY_PROPERTY", "REVEAL_GROUP_ATTRIBUTE", "REVEAL_MAX_DELAY_MS", "REVEAL_MAX_STEPS",
      "REVEAL_PERSONALITIES", "REVEAL_STAGGER_MS", "ROOT_MARGIN", "SAFETY_MS", "SHIFT_REFERENCE", "SIDE_ATTRIBUTE", "SLIDE_FAST",
      "SLIDE_RISE_FAST", "SLIDE_RISE_SLOW", "SLIDE_SLOW", "SLOW_VELOCITY", "SURFACE_ATTRIBUTE", "TILT_ATTRIBUTE", "TILT_FAST",
      "TILT_LIMIT", "TILT_SLOW", "adler32", "applyFilterScale", "browserDetectionEnvironment", "computeDisplacementMap",
      "computeSpecularMap", "crc32", "createGlassFilter", "detectRefraction", "dragSpring", "encodePng", "gentle", "glassFlavor",
      "lensWidth", "lensX", "lqgDrag", "lqgReveal", "pngDataUri", "press", "release", "revealCalm", "revealFast", "revealSlow",
      "staggerDelay", "stiff", "toBase64", "updateGlassFilter"
    ],
    types: ["GlassFlavor", "RevealPersonality", "GlassSpringKey", "GlassFilter", "DetectionEnvironment"],
  },
  "./glass/react": {
    values: [
      "LqgFilter", "LqgProvider", "LqgRevealProvider", "MODE_ATTRIBUTE", "useLqgLens", "useLqgReveal", "useLqgSurface"
    ],
    types: ["LqgProviderProps", "LqgRevealProviderProps", "LensHandle", "UseLqgRevealOptions"],
  },
};

const exportsMap = pkg.exports ?? {};
for (const subpath of Object.keys(API)) if (!(subpath in exportsMap)) problem(`exports map has no "${subpath}" entry`);
for (const subpath of Object.keys(exportsMap)) if (subpath !== "./styles.css" && !(subpath in API)) problem(`exports map has "${subpath}", which this check does not know`);

// ---- files ----

const distPath = (target) => resolve(root, target);

// ---- declaration files ----

const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** The relative specifiers a declaration file points at. */
function relativeSpecifiers(text) {
  return [...strip(text).matchAll(/\b(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']*)["']/g)].map((match) => match[1]);
}

function resolveDeclaration(from, specifier) {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [`${base}.d.ts`, join(base, "index.d.ts"), base.replace(/\.js$/, ".d.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every file a declaration entry reaches. Unresolved specifiers go to `problem`. */
function declarationGraph(entry) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of relativeSpecifiers(readFileSync(file, "utf8"))) {
      if (!/\.js$/.test(specifier)) problem(`${relative(root, file)} imports "${specifier}" with no ".js" extension, so Node16 and NodeNext cannot follow it`);
      const target = resolveDeclaration(file, specifier);
      if (target === null) problem(`${relative(root, file)} imports "${specifier}", which has no declaration file`);
      else visit(target);
    }
  };
  visit(entry);
  return seen;
}

/** The names a declaration file exports, following `export *` and `export { } from`. */
function declaredExports(file, seen = new Set()) {
  if (seen.has(file)) return new Set();
  seen.add(file);
  const text = strip(readFileSync(file, "utf8"));
  const names = new Set();
  for (const match of text.matchAll(/\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:interface|type|function|const|let|var|class|enum)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1]);
  for (const match of text.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}(?:\s*from\s*["']([^"']+)["'])?/g)) {
    for (const part of match[1].split(",")) {
      const piece = part.trim().replace(/^type\s+/, "");
      if (piece === "") continue;
      const alias = piece.split(/\s+as\s+/);
      names.add((alias[1] ?? alias[0]).trim());
    }
  }
  for (const match of text.matchAll(/\bexport\s*\*\s*from\s*["'](\.{1,2}\/[^"']*)["']/g)) {
    const target = resolveDeclaration(file, match[1]);
    if (target === null) problem(`${relative(root, file)} re-exports "${match[1]}", which has no declaration file`);
    else for (const name of declaredExports(target, seen)) names.add(name);
  }
  return names;
}

// ---- JavaScript graph ----

function scriptGraph(entry) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (!existsSync(file)) {
      problem(`${relative(root, file)} is imported by the JavaScript of an entry and does not exist`);
      return;
    }
    for (const match of readFileSync(file, "utf8").matchAll(/\b(?:from|import)\s*["'](\.{1,2}\/[^"']*)["']/g)) visit(resolve(dirname(file), match[1]));
  };
  visit(entry);
  return seen;
}

const insideGlass = (file) => relative(join(root, "dist"), file).split(/[\\/]/)[0] === "glass";

// ---- run ----

for (const [subpath, api] of Object.entries(API)) {
  const target = exportsMap[subpath];
  if (!target || typeof target !== "object") {
    problem(`"${subpath}" must be an object with "types" and "import"`);
    continue;
  }
  const typesFile = target.types ? distPath(target.types) : null;
  const importFile = target.import ? distPath(target.import) : null;
  if (!typesFile) problem(`"${subpath}" has no "types"`);
  else if (!existsSync(typesFile)) problem(`"${subpath}" types file ${target.types} does not exist`);
  if (!importFile) problem(`"${subpath}" has no "import"`);
  else if (!existsSync(importFile)) problem(`"${subpath}" import file ${target.import} does not exist`);
  if (!typesFile || !importFile || !existsSync(typesFile) || !existsSync(importFile)) continue;

  // Run time: import by package name, as a user does.
  const specifier = subpath === "." ? pkg.name : `${pkg.name}/${subpath.slice(2)}`;
  let namespace;
  try {
    namespace = await import(specifier);
  } catch (error) {
    problem(`import("${specifier}") failed: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  const actualNames = Object.keys(namespace);
  for (const name of api.values) if (!actualNames.includes(name)) problem(`import("${specifier}") has no export "${name}"`);
  for (const name of actualNames) if (!api.values.includes(name)) problem(`import("${specifier}") exports "${name}", which is not on the list of public names`);

  // Types: every public name is declared, and every relative import resolves.
  const graph = declarationGraph(typesFile);
  const declared = declaredExports(typesFile);
  for (const name of [...api.values, ...api.types]) if (!declared.has(name)) problem(`the types of "${specifier}" declare no export "${name}"`);

  // The generic entries pull in no glass code.
  if (api.generic) {
    for (const file of scriptGraph(importFile)) if (insideGlass(file)) problem(`"${specifier}" loads glass code: ${relative(root, file)}`);
    for (const file of graph) if (insideGlass(file)) problem(`the types of "${specifier}" reach glass code: ${relative(root, file)}`);
  }
}

const styles = exportsMap["./styles.css"];
if (typeof styles !== "string") problem(`"./styles.css" must be a path`);
else if (!existsSync(distPath(styles)) || statSync(distPath(styles)).size === 0) problem(`"./styles.css" points at ${styles}, which is missing or empty`);

if (problems.length > 0) {
  console.error(`The package exports have ${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
  for (const text of problems) console.error(`  - ${text}`);
  process.exit(1);
}
console.log(`Package exports checked: ${Object.keys(API).length} subpaths and the stylesheet.`);
