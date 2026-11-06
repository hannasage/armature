# Baseline for Milestone 0

Date: 2026-11-06 (UTC).
Source: `packages/liquid-glass` in the sage-web worktree, pinned at commit `4c7b59b`.
The import is verbatim. No source file and no test was edited.

## Test results

- Test files: 17 (`tests/*.test.ts` and `tests/*.test.tsx`).
- `it(` blocks: 349.
- Vitest run in Node (environment `node`, Vitest 5.0.5):

```
 Test Files  17 passed (17)
      Tests  349 passed (349)
```

No test failed. The count of 349 matches the number in the spec.
The React tests render to a string with `react-dom/server`, so they need no DOM.

## The integrator

`docs/how-it-works.md` (now `docs/glass-how-it-works.md`) names it in one sentence:

> The solver uses semi-implicit Euler. It updates the velocity first, then the position with the new velocity.

The same file says the solver steps in slices of exactly 1/120 s.
It also says Euler is first order, and that the worst error against a critically damped closed-form spring is 3.8 percent of the travel, at 83 ms.

## Dev dependencies

Installed versions, as locked in `package-lock.json`:

- `typescript` 6.0.3 (same as the source package)
- `@types/react` 19.3.0 (same as the source package)
- `@types/node` ^24.19.0, installed 24.19.2 (range same as the source package)
- `vitest` 5.0.5 (same as sage-web)
- `@vitejs/plugin-react` 6.1.1 (same as sage-web)
- `react` 19.3.0 (same as sage-web)
- `react-dom` 19.3.0 (same as sage-web)
- `@types/react-dom` 19.3.0 (same as sage-web)
- `vite` 8.3.6 (latest on 2026-11-06 per `npm view`. Vitest 5.0.5 and plugin-react 6.1.1 need Vite as a peer, and the build uses it directly.)
- `eslint` 10.14.0 (latest on 2026-11-06 per `npm view`)
- `@eslint/js` 10.0.1 (latest on 2026-11-06 per `npm view`)
- `typescript-eslint` 8.72.1 (latest on 2026-11-06 per `npm view`. Its peer range allows ESLint 10 and TypeScript below 6.1.)

`npm audit` reports moderate findings in the `minimatch` chain under ESLint 10. They are dev-only.
The suggested fix is a downgrade to ESLint 9.39.5, which was not applied.

## Build tool and why

The build uses Vite in library mode (Rolldown inside), with `preserveModules`, plus `tsc` for the type declarations.

Evidence:

- The source uses extensionless relative imports. One example is `import { createSpring } from "./spring"` in `src/core/surface.ts`. The entry file uses `export * from "./core/spring"`.
- Plain `tsc` output keeps those specifiers as written. A test run of that output under Node 24 ESM failed with `ERR_MODULE_NOT_FOUND` on `./core/spring`. So `tsc` alone cannot build a package that Node ESM loads.
- The Vite build writes `.js` specifiers. Both `dist/index.js` and `dist/react/index.js` load under Node 24 ESM. The first exposes 105 exports. The second exposes the seven React exports.
- The source has `"use client"` at the top of exactly five React files: `LqgProvider.tsx`, `LqgRevealProvider.tsx`, `useLqgLens.ts`, `useLqgReveal.ts`, and `useLqgSurface.ts`. `LqgFilter.tsx` has none, so it can render on the server.
- A single-file bundle would drop or hoist those lines. `preserveModules` keeps one output file per source file. The five files keep the line at the top. No other file gains it.
- `scripts/postbuild.mjs` checks this on every build. It compares the set of source files that start with `"use client"` to the set of output files that do. The build fails if the sets differ.
- Rolldown prints a `MODULE_LEVEL_DIRECTIVE` warning for each of the five files. The config silences it, because the post-build check is the stronger test.

## Bundle size

Measured with esbuild 0.28.2 (`npx esbuild --bundle --minify --format=esm`, then `gzip -c | wc -c`).
esbuild is not a dependency of this package. `npx` fetched it for the measurement.

- Engine pieces alone: `src/core/spring.ts`, `env.ts`, `guard.ts`, and `scroll-velocity.ts`, re-exported from one entry file. Minified 3,663 bytes. Minified and gzipped 1,690 bytes.
- Whole `src/index.ts`: minified 35,314 bytes. Minified and gzipped 13,815 bytes.

`src/index.ts` does not import React. The React entry is not in this number.
These are the figures that Milestone 5 uses to set the size budget.

## Rival glass packages

A research agent read two packages on 2026-11-05 or 2026-11-06 from the npm registry, READMEs, and some source files. The read dates were not rechecked.

`@avenra/liquid-glass` 1.2.0 (MIT, one maintainer, 1,116 downloads in the week of 2026-10-29):

- Refraction works in Chromium only. Other browsers get a blur fallback.
- Its spring uses semi-implicit Euler at a hard-coded 1/60 s with no clamping. It is not a fixed-step solver.
- It has no scroll reveal, no navigation lens, and no reduced-motion handling.
- It ships ready-made controls and 11 Node tests.

`liquid-glass-js` 0.1.0, now renamed `vitrio` (MIT, one maintainer, 457 downloads in the same week):

- Refraction works in Chrome, Edge, and Firefox. Safari and iOS get an approximation, per its README.
- It has no springs, no tests, and no accessibility handling.
- It has React and Vue wrappers.

Neither package covers the Armature glass flavor. The one gap is browser reach: the Armature glass flavor refracts in Chromium only. The vitrio source was not read.

## Milestone 1

Date: 2026-11-06 (UTC).
The engine is split from the glass flavor.
The layout is `src/engine`, `src/dom`, `src/react`, and `src/glass`, and the tests mirror it.

### Test results

- Test files: 31.
- Vitest run in Node (Vitest 5.0.5):

```
 Test Files  31 passed (31)
      Tests  521 passed (521)
```

- The 349 `it(` blocks of Milestone 0 are all still there. A script compared each of the 17 old test files with its Milestone 0 version, ignoring import lines. It found no other difference.
- The golden test compares the frozen legacy copy with the ported code, frame by frame, and passes.
- The boundary test scans `src/engine`, `src/dom`, and `src/react`. No file there imports from `src/glass`.

### Bundle size

Measured the same way as before: esbuild 0.28.2 (`npx esbuild --bundle --minify --format=esm`, then `gzip -c | wc -c`), run on the entry source files. React is not in these numbers.

- Engine entry, `src/index.ts`: minified 7,172 bytes. Minified and gzipped 2,909 bytes. It holds no glass code.
- Full glass entry, `src/glass/index.ts`: minified 17,374 bytes. Minified and gzipped 7,014 bytes. It includes the engine and DOM code that the glass flavor needs.
- The engine, DOM, and glass entries together: minified 41,779 bytes. Minified and gzipped 15,976 bytes. The Milestone 0 figure for the whole of `src/index.ts` was 35,314 and 13,815. The flavor contract and its checks add the difference.

The engine entry is larger than the Milestone 0 engine pieces (3,663 and 1,690) because it now also holds the flavor helpers and the preferences reader.
Milestone 5 sets the size budget from these figures.

### Exports map

Each subpath has a `types` file and an `import` file. `scripts/check-exports.mjs` runs at the end of `npm run build`. It imports every subpath by package name under Node ESM, checks the public names, checks that the type files resolve, and checks that the generic entries pull in no glass code.

- `.` is the engine: `dist/index.js` and `dist/index.d.ts`.
- `./dom` is the DOM controllers: `dist/dom/index.js` and `dist/dom/index.d.ts`.
- `./react` is the generic React layer: `dist/react/index.js` and `dist/react/index.d.ts`.
- `./glass` is the glass flavor: `dist/glass/index.js` and `dist/glass/index.d.ts`.
- `./glass/react` is the glass React wrappers: `dist/glass/react/index.js` and `dist/glass/react/index.d.ts`.
- `./styles.css` is `dist/styles.css`, copied from `src/glass/styles.css`. The `sideEffects` entry stays.

The `"use client"` line is on exactly ten files, the ones that use a hook. Five are the generic files in `src/react`: `ArmatureProvider`, `ArmatureRevealProvider`, `useArmatureLens`, `useArmatureReveal`, and `useArmatureSurface`. Five are the glass wrappers in `src/glass/react`: `LqgProvider`, `LqgRevealProvider`, `useLqgLens`, `useLqgReveal`, and `useLqgSurface`. `LqgFilter` has none. The build checks this.
The type files carry the `.js` extension on every relative import, so TypeScript with Node16 or NodeNext resolution can follow them.
