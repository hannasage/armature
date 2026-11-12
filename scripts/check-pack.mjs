// Packs the package and checks the tarball the way a user gets it. Run it after `npm run build`.
//
//   1. `npm pack` builds the tarball in a temp folder outside the repo.
//   2. Only dist, README.md, LICENSE, and package.json may be inside, and every target of the exports map must be inside.
//   3. The tarball may not be larger than 1.5 times the size measured in scripts/pack-rules.mjs.
//   4. The tarball is installed into a clean temp project, with React as the peer for the react entries. There it checks:
//        a. every subpath imports by package name under Node ESM, and exports exactly the names in scripts/public-api.mjs,
//        b. a small consumer file type-checks against every subpath with `tsc --noEmit`, under nodenext and under bundler,
//        c. the stylesheet resolves by package name and holds the glass styles.
// The check fails with a list of every problem found. Pass `--keep` to keep the temp folder for a look.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { API } from "./public-api.mjs";
import { childEnv, disallowedFiles, missingExportTargets, sizeLimit, withinSizeBudget } from "./pack-rules.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const keep = process.argv.includes("--keep");
const problems = [];
const problem = (text) => problems.push(text);

/** Runs a command and returns its output. A failure is recorded with the command output, and the result has `ok: false`. */
function run(label, command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env: childEnv(process.env), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const ok = result.status === 0 && result.error === undefined;
  if (!ok) {
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    problem(`${label} failed (exit ${result.status ?? result.signal ?? result.error?.message})${output ? `:\n${output.split("\n").map((line) => `      ${line}`).join("\n")}` : ""}`);
  }
  return { ok, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// What the consumer project holds. The versions of React and its types are the ones the repository tests against.
const dev = pkg.devDependencies ?? {};
const peers = [`react@${dev.react}`, `@types/react@${dev["@types/react"]}`];

const CONSUMER_SOURCE = `import { createSpring, defineFlavor, retarget, stepSpring, type Flavor, type SpringState } from "@hannasage/armature";
import { createScheduler, type Scheduler } from "@hannasage/armature/frame";
import { colorKind, createValue, numberKind, pathKind, transform3dKind, transform3dStyles, type Transform3D, type Value } from "@hannasage/armature/values";
import { bezier, createTween, createTweenValue, easing, stepTween, type Easing, type TweenState } from "@hannasage/armature/curves";
import { fitLinear, toEasing, toLinear, type EasingResult } from "@hannasage/armature/linear";
import { createFollower, type Follower } from "@hannasage/armature/dom";
import { ArmatureProvider, useArmatureSurface } from "@hannasage/armature/react";
import { createGlassFilter, glassFlavor, type GlassFlavor } from "@hannasage/armature/glass";
import { LqgFilter, LqgProvider, useLqgSurface } from "@hannasage/armature/glass/react";
import { useRef } from "react";

const demo: Flavor = defineFlavor({ name: "demo", prefix: "demo", logLabel: "demo", springs: { soft: { stiffness: 170, damping: 26 } } });
let spring: SpringState = retarget(createSpring({ stiffness: 170, damping: 26 }, 0), 1);
spring = stepSpring(spring, 1, 1 / 60);
const glass: GlassFlavor = glassFlavor;
const filter = createGlassFilter({ width: 120, height: 48, radius: 24 });

export function track(scheduler: Scheduler): Value<number> {
  return createValue(scheduler, numberKind, 0, { spring: { stiffness: 170, damping: 26 } });
}
export const hue: string = colorKind.interpolate("hsl(350 100% 50%)", "hsl(10 100% 50%)", 0.5);
export const outline: string = pathKind("M0 0 L10 10 Z").interpolate("M0 0 L10 10 Z", "M5 5 L20 20 Z", 0.5);
export const turn: Transform3D = transform3dKind.parse({ rotate: { axis: [0, 0, 1], angle: 45 }, perspective: 500 });
export const styles: string = transform3dStyles(turn).parent.perspective;
export const scheduler: Scheduler = createScheduler({ requestFrame: () => 0, cancelFrame: () => undefined, now: () => 0 });

export const slide = createTweenValue(scheduler, numberKind, 0, { duration: 0.3, curve: easing("ease-out") });
export const ease: Easing = bezier(0.22, 1, 0.36, 1);
export const tween: TweenState = stepTween(createTween(0, 1, 0.5, easing("projection")), 1 / 60);
export const css: string = toLinear({ stiffness: 170, damping: 26 }, { tolerance: 0.005 });
export const fit: number = fitLinear(ease).count;
export const picked: EasingResult = toEasing({ stiffness: 170, damping: 26 }, { supports: () => false });

export function follow(element: HTMLElement): Follower {
  return createFollower(element, { flavor: demo, name: "thumb" });
}

export function Demo() {
  const ref = useRef<HTMLButtonElement>(null);
  useArmatureSurface(ref, { flavor: glass });
  useLqgSurface(ref);
  return (
    <LqgProvider>
      <LqgFilter filter={filter} />
      <ArmatureProvider flavor={glass}>
        <button ref={ref}>Send</button>
      </ArmatureProvider>
    </LqgProvider>
  );
}

// A path that is not in the exports map must not resolve.
// @ts-expect-error The package does not export its dist folder.
export type Deep = typeof import("@hannasage/armature/dist/index.js");
export { spring };
`;

const RUNTIME_SCRIPT = `import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { name, api } = JSON.parse(readFileSync(new URL("./expected.json", import.meta.url), "utf8"));
const problems = [];

for (const [subpath, expected] of Object.entries(api)) {
  const specifier = subpath === "." ? name : name + "/" + subpath.slice(2);
  let namespace;
  try {
    namespace = await import(specifier);
  } catch (error) {
    problems.push('import("' + specifier + '") failed: ' + (error instanceof Error ? error.message : String(error)));
    continue;
  }
  const actual = Object.keys(namespace);
  for (const value of expected.values) if (!actual.includes(value)) problems.push('import("' + specifier + '") has no export "' + value + '"');
  for (const value of actual) if (!expected.values.includes(value)) problems.push('import("' + specifier + '") exports "' + value + '", which is not on the list of public names');
}

try {
  const url = import.meta.resolve(name + "/styles.css");
  const text = readFileSync(fileURLToPath(url), "utf8");
  if (text.trim() === "") problems.push("the stylesheet resolves and is empty");
  else if (!text.includes("--lqg-")) problems.push("the stylesheet resolves and holds no --lqg- property");
} catch (error) {
  problems.push("the stylesheet does not resolve: " + (error instanceof Error ? error.message : String(error)));
}

if (problems.length > 0) {
  for (const text of problems) console.error(text);
  process.exit(1);
}
console.log("ok");
`;

const COMPILER = { target: "es2022", lib: ["dom", "es2022"], strict: true, noEmit: true, jsx: "react-jsx", skipLibCheck: false, types: [] };
const TSCONFIGS = {
  nodenext: { compilerOptions: { ...COMPILER, module: "nodenext", moduleResolution: "nodenext" }, include: ["consumer.tsx"] },
  bundler: { compilerOptions: { ...COMPILER, module: "esnext", moduleResolution: "bundler" }, include: ["consumer.tsx"] },
};

const work = mkdtempSync(join(tmpdir(), "armature-pack-"));
try {
  // ---- 1 and 2 and 3: pack and inspect ----
  const packDir = join(work, "pack");
  mkdirSync(packDir);
  const packed = run("npm pack", "npm", ["pack", "--json", "--pack-destination", packDir], root);
  let tarball = null;
  let tarballSize = 0;
  if (packed.ok) {
    const info = JSON.parse(packed.stdout)[0];
    tarball = join(packDir, info.filename);
    tarballSize = statSync(tarball).size;
    const paths = info.files.map((file) => file.path);
    const extra = disallowedFiles(paths);
    if (extra.length > 0) problem(`the tarball holds ${extra.length} file${extra.length === 1 ? "" : "s"} outside dist, README.md, LICENSE, and package.json:\n${extra.map((path) => `      ${path}`).join("\n")}`);
    const missing = missingExportTargets(pkg.exports ?? {}, paths);
    if (missing.length > 0) problem(`the tarball lacks ${missing.length} export target${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`);
    if (!withinSizeBudget(tarballSize)) problem(`the tarball is ${tarballSize} bytes, above the limit of ${sizeLimit()} bytes (1.5 times the measured size)`);
    console.log(`Packed ${paths.length} files, ${tarballSize} bytes (limit ${sizeLimit()}).`);
  }

  // ---- 4: install into a clean consumer ----
  if (tarball !== null) {
    const consumer = join(work, "consumer");
    mkdirSync(consumer);
    writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "armature-pack-consumer", version: "0.0.0", private: true, type: "module" }, null, 2));
    const installed = run("npm install of the tarball", "npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", tarball, ...peers], consumer);
    if (installed.ok) {
      writeFileSync(join(consumer, "expected.json"), JSON.stringify({ name: pkg.name, api: API }));
      writeFileSync(join(consumer, "check-runtime.mjs"), RUNTIME_SCRIPT);
      writeFileSync(join(consumer, "consumer.tsx"), CONSUMER_SOURCE);
      for (const [mode, config] of Object.entries(TSCONFIGS)) writeFileSync(join(consumer, `tsconfig.${mode}.json`), JSON.stringify(config, null, 2));

      // a and c: import every subpath under Node ESM, and resolve the stylesheet.
      run("the import and stylesheet check in the installed package", process.execPath, ["check-runtime.mjs"], consumer);

      // b: type-check the consumer file under both module resolutions, with the TypeScript of this repository.
      const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
      if (!existsSync(tsc)) problem(`TypeScript is not installed at ${tsc}. Run npm ci first.`);
      else for (const mode of Object.keys(TSCONFIGS)) run(`tsc --noEmit under ${mode} resolution`, process.execPath, [tsc, "-p", `tsconfig.${mode}.json`], consumer);
    }
  }
} finally {
  if (keep) console.log(`Kept ${work}`);
  else rmSync(work, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error(`The package tarball has ${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
  for (const text of problems) console.error(`  - ${text}`);
  process.exit(1);
}
console.log(`Package tarball checked: contents, size, imports of ${Object.keys(API).length} subpaths, types under nodenext and bundler, and the stylesheet.`);
