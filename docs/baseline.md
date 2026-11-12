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
      Tests  527 passed (527)
```

- The 349 `it(` blocks of Milestone 0 are all still there. A script compared each of the 17 old test files with its Milestone 0 version, ignoring import lines. It found no other difference.
- The golden test compares the frozen legacy copy with the ported code, frame by frame, and passes.
- The boundary test scans `src/engine`, `src/dom`, and `src/react`. No file there imports from `src/glass`.

### Bundle size

Measured the same way as before: esbuild 0.28.2 (`npx esbuild --bundle --minify --format=esm`, then `gzip -c | wc -c`), run on the entry source files. React is not in these numbers.

- Engine entry, `src/index.ts`: minified 7,172 bytes. Minified and gzipped 2,910 bytes. It holds no glass code.
- Full glass entry, `src/glass/index.ts`: minified 17,374 bytes. Minified and gzipped 7,014 bytes. It includes the engine and DOM code that the glass flavor needs.
- The engine, DOM, and glass entries together: minified 41,779 bytes. Minified and gzipped 15,976 bytes. The Milestone 0 figure for the whole of `src/index.ts` was 35,314 and 13,815. The flavor contract and its checks add the difference.

The engine entry is larger than the Milestone 0 engine pieces (3,663 and 1,690) because it now also holds the flavor helpers and the preferences reader.
Milestone 5 sets the size budget from these figures.

### Changes for the glass flavor

These are the differences a glass user can see after Milestone 1. Everything else behaves as before, and the golden test checks it frame by frame.

1. An unknown personality name from a custom `personalityOf` now gets the fallback `drop` pose, and it writes `scale` and `rotate`. The old code gave the `drop` start pose but wrote no `scale` and no `rotate`.
2. The surface and lens hooks now run inside the guard. A failure is logged and skipped. It no longer reaches a React error boundary.
3. `guardedSetup`, `startScrollReveal`, `createSurface`, and `installDelegation` now need an explicit flavor. The glass wrappers and the test helper pass the glass flavor for you.
4. The four types `LqgEnvironment`, `LqgScrollEnvironment`, `LqgTarget`, and `LqgRevealAttributes` are now `ArmatureEnvironment`, `ArmatureScrollEnvironment`, `ArmatureTarget`, and `ArmatureRevealAttributes`.
5. The generic hooks need a client wrapper in Next.js, because a flavor holds functions and a server component cannot pass it as a prop. The glass wrappers are that wrapper for the glass flavor.

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

## First prerelease: 1.0.0-next.0

Date: 2026-11-06 (UTC).
This records the size of the package as npm packs it, measured with `npm pack --json` after `npm run build`.

- Tarball: 137,293 bytes.
- Unpacked: 476,884 bytes in 122 files.
- By kind: 254,318 bytes of sourcemaps (36 files), 131,540 bytes of JavaScript, 79,516 bytes of type declarations.
- The tarball holds `dist`, `README.md`, `LICENSE`, and `package.json`, and nothing else.

`npm run check:pack` fails when the tarball is larger than 1.5 times this size, which is 205,939 bytes.
G4 build, 2026-11-12 (UTC): `MEASURED_SIZE` is now 222,018 bytes, and it is approved by the maintainer. The limit is 333,027 bytes, still 1.5 times. The 137,293 above is the earlier baseline. The current measure after review round 4 is a tarball of 222,132 bytes, unpacked 748,454 bytes, in 196 files, measured with `npm pack --json` after `npm run build`. The measures before that were 218,694 bytes at the first build, 221,140 after round 1, 222,023 after round 2, and 222,018 after round 3. The maintainer also approved the `/gesture` cap of 5,850.
The measured size is the constant `MEASURED_SIZE` in `scripts/pack-rules.mjs`. Change it only when a maintainer accepts a new size and records the new number here.
The same check lists the tarball files, installs the tarball into a clean project with React as the peer, imports every subpath by package name, type-checks a consumer file under `nodenext` and `bundler`, and resolves the stylesheet.

The sourcemaps carry the full source text. They are a little over half of the unpacked size. A maintainer may drop them from `dist` by turning off `build.sourcemap` in `vite.config.ts`. That would shrink the tarball and would stop the package from shipping its source text.

## First beta: 1.0.0-beta.0

Date: 2026-11-06 (UTC).
`1.0.0-beta.0` has the same package contents as `1.0.0-next.0`. `npm run check:pack` passes on it with the same 122 files and the same limit of 205,939 bytes.
The tarball measured 137,494 bytes and 477,306 bytes unpacked, with `npm pack --json --dry-run`. That is 201 bytes more than the first prerelease. The extra bytes come from the new version string and the changed README text.

## G0

Date: 2026-11-11 (UTC).
Source: commit `679bf07`, which is the published 1.0.0 state. The G0 scripts change no file under `src`.
Tool: esbuild 0.28.2, now an exact dev dependency. The same version measured Milestone 1.
Method: `node scripts/size.mjs`. It runs esbuild with `bundle`, `minify`, and the `esm` format on the source file of each entry, then gzips the output. React is external. Each entry is measured alone, with every file it imports.
The measure ran in Node 24.21.0.

| Entry | Source | Minified (bytes) | Gzipped (bytes) |
| --- | --- | ---: | ---: |
| `@hannasage/armature` | `src/index.ts` | 10,001 | 3,632 |
| `@hannasage/armature/dom` | `src/dom/index.ts` | 30,033 | 11,058 |
| `@hannasage/armature/react` | `src/react/index.ts` | 28,860 | 10,706 |
| `@hannasage/armature/glass` | `src/glass/index.ts` | 19,821 | 7,655 |
| `@hannasage/armature/glass/react` | `src/glass/react/index.ts` | 33,750 | 12,461 |
| `@hannasage/armature/styles.css` | `src/glass/styles.css` | 2,437 | 749 |

What the table shows:

- `/dom` and `/react` alone were never measured before. Their numbers are above. Each one includes the engine code it imports, so a user of `/dom` pays 11,058 bytes gzipped and a user of `/react` pays 10,706. The two are not additive.
- The engine entry grew from 2,910 gzipped at Milestone 1 to 3,632. The source changed after Milestone 1 (the follower and the Projection flavor in Milestone 2). This amendment did not trace which file adds the 722 bytes.
- The glass entry grew from 7,014 gzipped at Milestone 1 to 7,655.
- The stylesheet is measured as CSS, minified by esbuild. Milestone 1 did not measure it.
- The Milestone 1 figure for the engine, DOM, and glass entries together (15,976 gzipped) is not an entry. G0 does not repeat it.

Caps are in `size-budget.json`. Each cap is the gzipped size above plus 10 percent, rounded up to the next 10 bytes:

- `@hannasage/armature`: 4,000.
- `/dom`: 12,170.
- `/react`: 11,780.
- `/glass`: 8,430.
- `/glass/react`: 13,710.
- `/styles.css`: 830.

`npm run check:size` fails when an entry is over its cap or has no cap. `npm run check:readme` fails when the README disagrees with `package.json` on the status, the version, the install command, or the list of subpaths. CI runs both.

## G1 trace

Date: 2026-11-12 (UTC).
Question: the `.` entry grew from 2,910 gzipped bytes at Milestone 1 to 3,632 at G0. Which files and commits add the 722 bytes?
Nothing is trimmed and no cap changed. A maintainer decides on any trim.

Method: esbuild 0.28.2 with `bundle`, `minify`, the `esm` format, React external, and `metafile`. Entry `src/index.ts`. The source of each commit came from `git archive`. The per-file number is `bytesInOutput` from the metafile, which counts minified bytes. The gzipped number is the whole output run through Node `gzipSync`, the same call as `scripts/size-lib.mjs`.

Two commits:
- Milestone 1: `0df2676`, the last commit of the Milestone 1 branch. Its minified size is 7,172 bytes, which matches this file.
- G0: `f0a01e4`, the head of `main` when G1 started. Its figures match the G0 table (10,001 and 3,632).

A note on the Milestone 1 gzipped figure. This file says 2,910. Node `gzipSync` gives 2,902 for the same bundle, and the `gzip -c` command gives 2,905. The 8 byte gap has no known cause. The like-for-like growth is 730 bytes (3,632 minus 2,902), not 722.

### Bytes per input file

| File | `0df2676` minified | `f0a01e4` minified | Change |
| --- | ---: | ---: | ---: |
| `src/engine/flavor.ts` | 1,732 | 4,514 | +2,782 |
| `src/engine/spring.ts` | 1,517 | 1,519 | +2 |
| `src/engine/scroll-env.ts` | 1,612 | 1,612 | 0 |
| `src/engine/scroll-velocity.ts` | 779 | 779 | 0 |
| `src/engine/env.ts` | 518 | 518 | 0 |
| `src/engine/preferences.ts` | 262 | 262 | 0 |
| `src/engine/guard.ts` | 207 | 207 | 0 |
| `src/index.ts` | 0 | 0 | 0 |
| Output, minified | 7,172 | 10,001 | +2,829 |
| Output, gzipped | 2,902 | 3,632 | +730 |

One file explains the growth. `src/engine/flavor.ts` adds 2,782 of the 2,829 minified bytes. The other seven files are the same, except for 2 bytes in `spring.ts`.

### Bytes per commit

Each row is the entry measured at that commit. Five commits touch `src/engine`. The other commits between the two points change no file that the `.` entry imports.

| Commit | What it does | Minified | Gzipped | Gzipped change |
| --- | --- | ---: | ---: | ---: |
| `0df2676` | Milestone 1 | 7,172 | 2,902 | |
| `0d8c7f2` | Adds the optional follower part to the flavor contract | 7,757 | 3,060 | +158 |
| `9d34451` | Adds the `specular` and `glow` switches and their boolean check | 7,925 | 3,124 | +64 |
| `1b7cca4` | Validates the numbers in a flavor (`checkSpring`, `checkRest`) | 9,062 | 3,396 | +272 |
| `b3b5929` | Validates follower variable names | 9,812 | 3,576 | +180 |
| `1921598` | Adds `defineFlavor` and `deepFreeze` | 10,001 | 3,632 | +56 |

The sum of the five changes is 730 bytes. Of that, 572 bytes (the last four rows) come from validation code and its error messages. The follower part itself (the first row) adds 158 bytes, and a share of that is its first validation lines.

### Where the bytes sit now

`validateFlavor` and what it calls hold most of them. These are one-at-a-time measures. Each one removes a piece from the `f0a01e4` source in a scratch copy and measures the `.` entry again. The pieces overlap, so the savings do not add up.

| Piece removed | Minified | Gzipped | Saved (gzipped) |
| --- | ---: | ---: | ---: |
| Nothing (`f0a01e4`) | 10,001 | 3,632 | |
| `defineFlavor` and `deepFreeze` | 9,812 | 3,576 | 56 |
| The `specular` and `glow` boolean check | 9,833 | 3,570 | 62 |
| The number checks (`checkSpring` and `checkRest` bodies) | 9,095 | 3,409 | 223 |
| The follower checks in `validateFlavor` | 8,683 | 3,337 | 295 |
| Every error message in `validateFlavor` cut to a short code (16 messages) | 8,856 | 3,368 | 264 |
| All validation (`validateFlavor` only asserts an object, and `defineFlavor` is gone) | 6,579 | 2,674 | 958 |

### Trim proposal

Each item lists an estimate from the table above. No item is done. The savings overlap, so a pair saves less than the sum.

1. Move the checks to their own entry, for example `@hannasage/armature/flavor`. `defineFlavor`, `validateFlavor`, `checkSpring`, `checkRest`, and `deepFreeze` go there. The `.` entry keeps the types and the small helpers. The estimate is up to 958 bytes gzipped, which brings `.` to about 2,674. The cost is a behavior change. The `require*` helpers call `validateFlavor` today, so a flavor that skips `defineFlavor` would no longer be checked at first use. Tests that rely on that check would change. This is the largest saving and the largest change.
2. Shorten the 16 error messages in `validateFlavor`. The estimate is up to 264 bytes gzipped. That figure is a ceiling, because it replaces each message with a bare code. A message that still names the flavor and the field saves less. The cost is less help for a person who reads the error.
3. Move only `defineFlavor` and `deepFreeze` to the new entry. The estimate is 56 bytes. The cost is that a flavor author imports from a second entry to freeze a flavor.
4. Drop the number checks. The estimate is 223 bytes. The cost is that a flavor with `NaN` or a negative stiffness is no longer caught at start-up. This item loses a safety check, so it is the weakest of the five.
5. Drop the follower checks. The estimate is 295 bytes. The cost is that a duplicate or reserved follower variable is no longer caught. This item also loses a safety check.
6. Raise the cap instead and trim nothing. The `.` cap is 4,000 bytes in `size-budget.json` today, and the measured size is 3,632. The amendment 1 proposal was 3.5 KB (3,500 bytes). No change to the cap is made here.

Amendment 2 item 3 adds clear errors for the old names `pixelRest` and `follower` to `validateFlavor`. That adds a few lines to the `.` entry. The G1 build measures the real figure and reports it.

## G1 build

Date: 2026-11-12 (UTC).
Source: branch `task/g1-engine-trace-and-contract`. G1 adds two entries, `/frame` and `/values`, and three changes from amendment 2: a React follower hook, one spring per follower move, and one shape for rest limits with the names `rest` and `followers`.
Method: `node scripts/size.mjs`, the same as G0. esbuild 0.28.2, `bundle`, `minify`, `esm`, React external, then gzip. Node 24 in Docker.

### New entries

| Entry | Source | Minified (bytes) | Gzipped (bytes) |
| --- | --- | ---: | ---: |
| `@hannasage/armature/frame` | `src/frame/index.ts` | 1,444 | 807 |
| `@hannasage/armature/values` | `src/values/index.ts` | 4,003 | 1,656 |

Each cap is the measured size plus 10 percent, rounded up to the next 10 bytes. The amendment 1 proposal sits beside each cap.

| Entry | Measured (gzipped) | Cap | Amendment 1 proposal |
| --- | ---: | ---: | --- |
| `/frame` | 807 | 890 | 1.0 KB |
| `/values` | 1,656 | 1,830 | 4.0 KB (path: about 1.5 KB, alone) |

The proposals are larger because they were written for the full plan. `/values` holds only the number kind, the vector kind, and the value controller today. Color, path, and 3D transform arrive in G3 and raise the figure. `/values` carries the spring solver, because the vector spring runs it. `/frame` carries only the two step constants of `src/engine/spring.ts`, because esbuild drops the rest of that file.
The caps of the new entries, as bullets:

- `/frame`: 890.
- `/values`: 1,830.

### Changes to existing entries

- `.` grew from 3,632 to 3,688 gzipped bytes (minified 10,001 to 10,211). The 56 bytes come from the clear errors for the old names `pixelRest` and `follower` in `validateFlavor` (amendment 2, item 3). The `/frame` and `/values` code adds nothing to it, and a test checks that the entry reaches no file of either one. The cap of 4,000 is unchanged.
- `/dom` is 11,140 gzipped bytes, against 11,058 at G0 and a cap of 12,170. The cap is unchanged. The change comes from the spring switch of a follower move (amendment 2, item 2).
- `/react` is 11,496 gzipped bytes, against 10,706 at G0 and a cap of 11,780. The cap is unchanged. The change comes from `useArmatureFollower` (amendment 2, item 1), which pulls the follower code into the entry. The room left under the cap is 284 bytes.
- `/glass` is 7,706 gzipped bytes, against 7,655 at G0 and a cap of 8,430. `/glass/react` is 12,504, against 12,461 and a cap of 13,710.

### The `"use client"` files

The `"use client"` line is now on eleven files. The new one is `src/react/useArmatureFollower.ts`, the follower hook. `scripts/postbuild.mjs` lists the eleven and fails the build when the set differs.

### Review rounds 1 to 3

The review fixes added error handling to `/frame` and `/values`, so the two sizes above are the ones after round 3. The caps of the two new entries are derived from them by the stated rule. No cap of an entry that existed at G0 changed. The sizes of the other entries after round 3 are `.` 3,686, `/dom` 11,138, `/react` 11,494, `/glass` 7,705, and `/glass/react` 12,501 gzipped bytes, all under their caps. The two new caps wait for the maintainer's approval.

## G2 build

Date: 2026-11-12 (UTC).
Source: branch `task/g2-curves-tween-linear`. G2 adds two entries, `/curves` and `/linear`. It adds no React hook and changes no existing entry.
Method: `node scripts/size.mjs`, the same as G0 and G1. esbuild 0.28.2, `bundle`, `minify`, `esm`, React external, then gzip. Node 24 in Docker.

### New entries

| Entry | Source | Minified (bytes) | Gzipped (bytes) |
| --- | --- | ---: | ---: |
| `@hannasage/armature/curves` | `src/curves/index.ts` | 4,634 | 2,270 |
| `@hannasage/armature/linear` | `src/linear/index.ts` | 7,790 | 3,351 |

Each cap is the measured size plus 10 percent, rounded up to the next 10 bytes. The amendment 1 proposal sits beside each cap. The `/curves` figure is the first G2 measure. The `/linear` figure is the measure after the round 2 follow-up, which built the longer error messages and the `restSpeed` and `restDelta` check. The first `/linear` measure was 2,998 with a cap of 3,300.

| Entry | Measured (gzipped) | Cap | Amendment 1 proposal |
| --- | ---: | ---: | --- |
| `/curves` | 2,270 | 2,500 | 1.5 KB |
| `/linear` | 3,351 | 3,690 | 1.0 KB |

The caps of the new entries, as bullets (approved by the maintainer, 2026-11-12):

- `/curves`: 2,500.
- `/linear`: 3,690.
- `/react`: 12,650.

Both entries are over their proposals. The proposals were written before the code. Three parts cost the most:

- The bezier fitting aid is the largest part of `/curves`. It is about 1.4 KB gzipped alone. It holds a grid search and a least-squares fit.
- `/linear` carries the spring solver, because it samples a spring with the solver's own steps. The solver is about 1.2 KB gzipped.
- `/linear` also carries the fitting aid, because `toEasing` falls back to a fitted bezier.

A consumer that imports only `bezier` or only `toLinear` pays less. The build keeps one file per module, so a bundler drops what the consumer does not use. The numbers above are the whole entry.

### The `/react` entry

`/react` is 11,494 gzipped bytes. G2 adds no React hook and `/react` did not change in G2. Its old cap was 11,780, which left 286 bytes of room. The maintainer approved option A on 2026-11-12: re-derive the cap by the stated rule. The new cap is 12,650, which is the measured size plus 10 percent, rounded up to the next 10 bytes. No trim was made. The cap of no other entry changed.

| Entry | Source | Minified (bytes) | Gzipped (bytes) |
| --- | --- | ---: | ---: |
| `@hannasage/armature/react` | `src/react/index.ts` | 31,618 | 11,494 |

The engine entry `.` is 3,686 against a cap of 4,000, and a test checks that it reaches no file of `/curves` or `/linear`.

### After review

The review fixes added checks and flags. `size-budget.json` keeps the size after review as `measuredAfterReview`. The `/react` entry did not change.

| Entry | First measure (gzipped) | First cap | After review (gzipped) | Cap now | Room |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/curves` | 2,270 | 2,500 | 2,363 | 2,500 | 137 |
| `/linear` | 2,998 | 3,300 | 3,351 | 3,690 | 339 |

Round 2 asked for four more items on `/linear`: the `maxError` message names the kind and the value, the "tolerance is too small" message names the tolerance, the duration message says "finite and above 0", and `restSpeed` and `restDelta` are checked as finite and above 0, with a TypeError. They did not fit under the cap of 3,300. The maintainer chose option B on 2026-11-12: build them and re-derive the cap. The condition was a measure of 3,362 or less, and the measure is 3,351. The rule gives a cap of 3,690, which is under the 3,700 the maintainer named, so 3,690 is the cap.

### Approval

The maintainer approved the `/curves` cap of 2,500, the `/linear` cap of 3,700 at most (set to 3,690 by the rule), and the `/react` cap of 12,650. The approval is "approved by the maintainer, 2026-11-12". `size-budget.json` records it on each of the three entries.

### Public names beyond the spec

`fitLinear` and `LinearFit` are public beyond the spec. Amendment 1 names only `toLinear`. The builder chose to export the fit because it carries the error, the duration, the stop count, and the `truncated` flag, which a string cannot carry.

### Truncation and fallback flags

- A spring that does not come to rest within 10 seconds or 20,000 steps is cut short. `fitLinear` and `toEasing` return `truncated: true`. `toLinear` throws a RangeError that names the cap.
- The `toEasing` fallback returns `degraded: true` when the fitted bezier is further from the solver than the tolerance. The option `maxError` turns that into a RangeError.

## G3 build

Date: 2026-11-12 (UTC).
Source: branch `task/g3-kinds`. G3 adds three kinds to `/values`: color, path, and 3D transform. It adds no entry and no subpath. It adds one small hook to the kind interface, the optional `align`, and one line to `createValue` that calls it.
Method: `node scripts/size.mjs`, the same as G0, G1, and G2. esbuild 0.28.2, `bundle`, `minify`, `esm`, React external, then gzip. Node 24 in Docker.

### The `/values` entry

| Entry | Source | Minified (bytes) | Gzipped (bytes) |
| --- | --- | ---: | ---: |
| `@hannasage/armature/values` | `src/values/index.ts` | 13,594 | 6,244 |

The cap is the measured size plus 10 percent, rounded up to the next 10 bytes. The maintainer approved the cap of 6,870, with all 148 color names and no subpath split (approved by the maintainer, 2026-11-12). The amendment 1 proposal sits beside it.

| Entry | Measured (gzipped) | Cap | Cap before G3 | Amendment 1 proposal |
| --- | ---: | ---: | ---: | --- |
| `/values` | 6,244 | 6,870 | 1,830 | 4.0 KB (path: about 1.5 KB, alone) |

The cap of `/values`, as a bullet (approved by the maintainer, 2026-11-12):

- `/values`: 6,870.

The entry is over the 4.0 KB proposal. The path kind is part of the entry, because it sits in `/values` as the package layout says. Where the bytes sit:

| Part | Gzipped (bytes), each file alone |
| --- | ---: |
| Path kind, `src/values/path.ts` | 1,131 |
| Color kind with its name table | 2,870 |
| The name table alone, `src/values/color-names.ts` | 1,332 |
| 3D transform kind | 1,332 |
| Before G3: number, vector, and the controller | 1,656 |

- Without the path kind, `/values` would be 5,410. That is 1,410 over the 4.0 KB proposal, and the name table is 1,332 of it.
- The path kind alone is 1,131, under the proposal of about 1.5 KB. It is its own file, so a bundler drops it from a consumer that does not use it.
- The 148 CSS color names cost 1,332 gzipped bytes, because names do not compress. A shorter list of the 17 basic names would save about 1.1 KB. That is a choice for the maintainer.
- A path, a color, or a 3D transform is a small step for the code and a large step for the size, because the kinds carry their own matrices and parsers.

### After review rounds 1 and 2

The review fixes added checks for finite numbers, a rest scale per kind, full precision in the path kind, the `scalar` flag, and the rest order of a move spring. The `/values` entry is now 6,615 gzipped bytes (minified 14,767), against the cap of 6,870. The room is 255 bytes. The cap did not change.

| Part | Gzipped (bytes), each file alone |
| --- | ---: |
| Path kind | 1,283 |
| Color kind with its name table | 3,025 |
| 3D transform kind | 1,421 |
| `/values` without the path kind | 5,648 |

### Other entries

The caps of the other entries did not change. The measures after G3: `.` 3,686 (cap 4,000), `/frame` 807, `/curves` 2,363, `/linear` 3,351, `/dom` 11,138, `/react` 11,494, `/glass` 7,705, `/glass/react` 12,501, and `styles.css` 749 gzipped bytes. The engine entry `.` did not grow, and a test checks that it reaches no file of `/values`.

### Public names

`/values` adds `colorKind`, `pathKind`, `transform3dKind`, `transform3dStyles`, and the types `Transform3D` and `Transform3DStyles`.
`transform3dStyles` is public beyond the spec. Amendment 1 says only that the output is the properties `translate`, `rotate`, and `scale`, with `perspective` on the parent. A kind turns a value into one string, and one string cannot say which property goes on the parent. So `transform3dStyles` returns the element properties and the parent property apart.

## G4 build

Date: 2026-11-12 (UTC).
Source: branch `task/g4-gesture`. G4 adds the entry `@hannasage/armature/gesture`: the pointer environment, the pointer velocity tracker, and `createDrag` with the rubber band, decay, snap, and swipe. It adds the optional `gesture` part to the flavor contract.
Method: `node scripts/size.mjs`, the same as G0 to G3. esbuild 0.28.2, `bundle`, `minify`, `esm`, React external, then gzip. Node 24 in Docker.

### The `/gesture` entry

| Entry | Source | Minified (bytes) | Gzipped (bytes) |
| --- | --- | ---: | ---: |
| `@hannasage/armature/gesture` | `src/gesture/index.ts` | 13,605 | 5,316 |

The cap is the measured size plus 10 percent, rounded up to the next 10 bytes. The maintainer approved the cap of 5,850 (approved by the maintainer, 2026-11-12). The amendment 1 proposal sits beside it. The measure above is the one the cap came from, at review round 2. After review round 4 the entry is 5,332 gzipped bytes (minified 13,677), so the room under the cap is 518 bytes.

| Entry | Measured (gzipped) | Cap | Amendment 1 proposal |
| --- | ---: | ---: | --- |
| `/gesture` | 5,316 | 5,850 | 3.0 KB |

The cap of `/gesture`, as a bullet (approved by the maintainer, 2026-11-12):

- `/gesture`: 5,850.

The entry is 2,316 bytes over the 3.0 KB proposal. Where the bytes sit, each file bundled alone:

| Part | Gzipped (bytes) |
| --- | ---: |
| `src/engine/flavor.ts`, pulled in by `requireGesture` through `validateFlavor` | 1,824 |
| `src/engine/spring.ts` | 733 |
| `src/gesture/drag.ts`, engine external | 3,650 |
| `src/gesture/pointer-env.ts`, engine external | 477 |
| `src/gesture/pointer-velocity.ts`, engine external | 421 |

- The gesture files add about 2.8 KB to the engine files in the bundle. That is under the 3.0 KB proposal. The engine files that `/gesture` must carry make up the rest.
- `requireGesture` calls `validateFlavor`, as the other require helpers do. That keeps a bad `gesture` part from reaching the drag. A drag that skipped the check would save about 1.8 KB, and a bad part would then fail late.

### Other entries

The caps of the other entries did not change. The measures after G4: `.` 3,854 (cap 4,000), `/frame` 807, `/values` 6,615, `/curves` 2,363, `/linear` 3,351, `/dom` 11,310 (cap 12,170), `/react` 11,663 (cap 12,650), `/glass` 7,881 (cap 8,430), `/glass/react` 12,668 (cap 13,710), and `styles.css` 749 gzipped bytes.

Note that the maintainer approved the `.` entry at 3,854 (the cap of 4,000 is unchanged). The check of the new `gesture` part in `validateFlavor` grew `.` from 3,686 to 3,854, `/dom` from 11,138 to 11,310, `/react` from 11,494 to 11,663, `/glass` from 7,705 to 7,881, and `/glass/react` from 12,501 to 12,668. Each stays under its cap.

### Not exported from `/dom`

The package layout section of amendment 1 says the new controllers are exported from `/dom`. `createDrag` is not, at G4. The drag, the pointer environment, and the tracker add about 2.8 KB to `/dom`, which has 860 bytes of room under its cap of 12,170. The cap rule forbids raising it, so `createDrag` is exported from `/gesture` only. Exporting it from `/dom` needs a decision on the `/dom` cap.

### Public names

`/gesture` exports `createDrag`, `createPointerVelocity`, `createBrowserPointerEnvironment`, `requireGesture`, and the types `ArmaturePointerEnvironment`, `Drag`, `DragBounds`, `DragOptions`, `DragState`, `PointerHandlers`, `PointerSample`, `PointerVelocity`, `PointerVelocityOptions`, and `SwipeDirection`. The engine entry exports the type `GestureFlavor`.
The public names beyond the spec are `createPointerVelocity`, `createBrowserPointerEnvironment`, and `requireGesture`. The spec names the pointer environment and the tracker as parts of the milestone and gives no function names for them.


## G5 build

Date: 2026-11-12 (UTC).
Source: branch `task/g5-timeline`. G5 adds the entry `@hannasage/armature/timeline`: `createTimeline` with tracks, keyframes, place together or in sequence, stagger, and play, pause, reverse, seek, and scrub. A step is a curve, a spring, or a decay. It adds the optional `timeline` part to the flavor contract.
Method: `node scripts/size.mjs`, the same as G0 to G4. esbuild 0.28.2, `bundle`, `minify`, `esm`, React external, then gzip. Node 24 in Docker.

### The `/timeline` entry

| Entry | Source | Minified (bytes) | Gzipped (bytes) |
| --- | --- | ---: | ---: |
| `@hannasage/armature/timeline` | `src/timeline/index.ts` | 13,611 | 5,562 |

The cap is the measured size plus 10 percent, rounded up to the next 10 bytes. The cap is not approved: the maintainer has not seen it. The amendment 1 proposal sits beside it.

| Entry | Measured (gzipped) | Cap (not approved) | Amendment 1 proposal |
| --- | ---: | ---: | --- |
| `/timeline` | 5,562 | 6,120 | 4.0 KB |

The cap of `/timeline`, as a bullet (not approved):

- `/timeline`: 6,120.

The entry is 1,562 bytes over the 4.0 KB proposal. Where the bytes sit, in minified bytes of the bundle:

| File | Minified (bytes) |
| --- | ---: |
| `src/timeline/timeline.ts` | 7,633 |
| `src/timeline/flavor.ts` | 2,191 |
| `src/engine/spring.ts` | 1,457 |
| `src/frame/scheduler.ts` | 1,381 |
| `src/curves/bezier.ts` | 759 |
| `src/engine/env.ts` | 117 |

The engine files are the spring solver, the scheduler, and the bezier evaluator. The timeline needs each one, so none can go. The entry does not bundle `src/engine/flavor.ts`: it runs its own check of the timeline part, which saves about 1.8 KB.

### Other entries

No cap moved. The measures after G5: `.` 3,853 (cap 4,000), `/frame` 807, `/values` 6,615, `/curves` 2,363, `/linear` 3,351, `/gesture` 5,346 (cap 5,850), `/dom` 11,325, `/react` 11,678, `/glass` 7,892, `/glass/react` 12,677, and `styles.css` 749 gzipped bytes. The entry `.` did not grow: G5 adds only types to `src/engine/flavor.ts`.

### The tarball

`npm run check:pack` passed. The tarball is 241,927 bytes in 205 files, under the limit of 333,027 (1.5 times the approved MEASURED_SIZE of 222,018). MEASURED_SIZE did not change.

### Decision for the maintainer: `validateFlavor` does not check the timeline part

Amendment 1 says `validateFlavor` checks the new flavor parts. At G5 it does not check the `timeline` part. The `.` entry is 3,853 bytes against a cap of 4,000, and a check of the part adds more than the 147 bytes of room. A registry that `/timeline` fills when its module loads would cost `.` about 9 bytes. It was tried and dropped, for two reasons. It is a side effect of loading a module, and the package declares `styles.css` as its only file with side effects. And `defineFlavor` in a file that never imports `/timeline` would skip the check anyway.

What holds instead: `createTimeline` and `requireTimeline` run the check, so a bad part fails when a timeline is made. A flavor with no `timeline` part stays valid.

Variants for the maintainer:
- A. Keep it as it is.
- B. Raise the `.` cap and check the part inline in `validateFlavor`. The cap rule forbids this without approval.
- C. Bring back the registry, and accept the side effect on module load.

### Public names

`/timeline` exports `createTimeline`, `createBrowserTimelineEnvironment`, `requireTimeline`, and the types `DecayStep`, `Keyframe`, `Timeline`, `TimelineEnvironment`, `TimelineOptions`, `TimelineState`, `TimelineStep`, and `TrackSpec`. The engine entry exports the types `TimelineFlavor` and `TimelineSequence`. The names beyond the spec are `createBrowserTimelineEnvironment` and `requireTimeline`.
