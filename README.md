# Armature

Armature is a physics motion engine for the web.
It has one engine and many flavors.
The engine holds the spring solver and the browser plumbing.
A flavor is a named movement language. It sets the spring constants, the names of the attributes the engine reads, and the CSS variables the engine writes.

Status: pre-release. It is published on the npm `beta` tag as 1.0.0-beta.0. The API can still change.

The first flavor is liquid glass. It is in this package. The second flavor will live in Projection UI. A third, Tide, is an example in `examples/tide`: the motion of a bottom sheet, built with a follower, a gesture, a timeline, and a layout part.

## Install

```bash
npm install @hannasage/armature@beta
```

React, Vue, and Svelte are optional peers. The engine and the DOM controllers need none of them.
Install React 18 or later only if you use the React entries. Install Vue 3.5 or later within 3.x only if you use `@hannasage/armature/vue`, and Svelte 5 or later only if you use `@hannasage/armature/svelte`.

## The fifteen subpaths

The package has fifteen JavaScript entries and one stylesheet.
The package is ESM only. Each entry has a `types` file and an `import` file, and there is no CommonJS build.
Each entry loads only what it needs.
Every entry except `glass` and `glass/react` holds no glass code.

- `@hannasage/armature` is the engine. It has the spring solver, the browser environments, the scroll velocity tracker, the reduced-motion check, and the flavor contract with its types.
- `@hannasage/armature/frame` holds the shared frame scheduler. One frame loop steps every task in fixed slices, so a 30, 60, or 144 Hz screen runs the same slices. It pauses while the tab is hidden, and a manual `advance` runs it in a test.
- `@hannasage/armature/values` holds the value layer: the number, vector, color, path, and 3D transform kinds, a spring over a vector, and `createValue`, a spring controller that runs on the scheduler.
- `@hannasage/armature/curves` holds the cubic-bezier evaluator, named easings as data, the tween with the same step interface as the spring, a tween controller that runs on the scheduler, and a bezier fitting aid that reports its error.
- `@hannasage/armature/linear` writes a spring or a curve as a CSS `linear()` string within a tolerance. It checks that the browser supports `linear()`, and it falls back to a fitted cubic-bezier.
- `@hannasage/armature/gesture` holds drag with a rubber band past the bounds, decay on release, snap to the nearest point with the release velocity, and swipe. It also holds the pointer environment and the pointer velocity tracker. `createDrag` takes a flavor with a `gesture` part. See `docs/gesture.md`.
- `@hannasage/armature/timeline` holds timelines: tracks that animate one value each along keyframes, placed together, in sequence, or staggered. A step is a curve, a spring, or a decay. A timeline plays, pauses, reverses, seeks, and scrubs on the shared scheduler. See `docs/timeline.md`.
- `@hannasage/armature/layout` holds layout animation (FLIP), shared elements, and presence. An element is measured before and after a change, put back where it was with `translate` and `scale`, and sprung to zero. A change in flight keeps its speed. Two elements with one key move as one, and an exiting element stays until it rests. `createLayout`, `createShared`, and `createPresence` take a flavor with a `layout` part. See `docs/layout.md`.
- `@hannasage/armature/dom` holds the DOM controllers: surface, lens, follower, delegation, and scroll reveal. Each one takes a flavor.
- `@hannasage/armature/react` holds the generic React hooks and providers, such as `useArmatureSurface`, `useArmatureFollower`, and `ArmatureProvider`. Each one takes a flavor.
- `@hannasage/armature/css` returns CSS as strings, with no DOM and no environment. `cssLinear` writes a spring or a curve as `linear()`. `cssKeyframes` writes a timeline as `@keyframes` text. `cssFlavor` writes the variables and attributes of a flavor as a stylesheet. It runs on a server, in a build step, or in a test. See `docs/css.md`.
- `@hannasage/armature/vue` holds one Vue composable for each DOM controller: `useArmatureSurface`, `useArmatureFollower`, `useArmatureDrag`, and `useArmatureLayout`. Each makes the controller when the component mounts and destroys it when the component unmounts. See `docs/adapters.md`.
- `@hannasage/armature/svelte` holds one Svelte action for each of the same controllers: `surface`, `follow`, `drag`, and `layout`. They work with the `use:` directive. See `docs/adapters.md`.
- `@hannasage/armature/glass` holds the glass flavor, `glassFlavor`, with the refraction filter, the PNG encoder, the browser check, and the glass names.
- `@hannasage/armature/glass/react` holds the glass React wrappers: `LqgProvider`, `LqgFilter`, `useLqgSurface`, `useLqgLens`, `useLqgReveal`, and `LqgRevealProvider`. They use the glass flavor unless you pass another.
- `@hannasage/armature/styles.css` is the glass stylesheet.

Every CSS class, custom property, and data attribute of the glass flavor starts with `lqg`.

## Engine example

The engine alone needs no flavor. This steps a spring toward 1.
The step size does not change the result, so a 30, 60, or 144 Hz screen lands in the same place.

```ts
import { createSpring, retarget, stepSpring } from "@hannasage/armature";

let spring = retarget(createSpring({ stiffness: 170, damping: 26 }, 0), 1);

function frame(seconds: number): number {
  spring = stepSpring(spring, 1, seconds);
  return spring.value;
}
```

The DOM controllers and the generic React layer take the flavor as a required argument. They have no default.

## Glass example

Install the provider once, near the top of the app.
It listens on the document, so any element with `data-lqg` presses, glints, and glows.
It also sets `data-lqg-mode` on the root, so the stylesheet can pick refraction or plain blur.

```tsx
// app/layout.tsx
import "@hannasage/armature/styles.css";
import { LqgProvider } from "@hannasage/armature/glass/react";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LqgProvider>{children}</LqgProvider>
      </body>
    </html>
  );
}

// Anywhere, even in a server component:
<button className="lqg-surface" data-lqg="">Send</button>
```

## Documents

- `docs/flavors.md` explains the flavor contract: each field, and which engine code reads it.
- `docs/glass-how-it-works.md` explains the numbers of the glass flavor: the spring, the displacement map, and the filter.
- `docs/liquid-glass-readme.md` is the original guide to the glass package, from before the engine was split out. Its import paths are the old ones.
- `docs/flavor-authoring.md` builds a flavor step by step: the Tide flavor, with its springs, a follower, a gesture, a timeline, and a layout part.
- `docs/contract-review.md` records which parts of the flavor contract are stable and which stay experimental, and why.
- `docs/kinds.md` explains the kinds: color (and why it blends in OKLab), path, and 3D transform, with the rule that nothing writes `transform`.
- `docs/curves.md` explains the bezier, the named easings, the tween, the bezier fit, and the `linear()` exporter.
- `docs/gesture.md`, `docs/timeline.md`, and `docs/layout.md` explain drag, timelines, and layout animation.
- `docs/css.md` explains the CSS output, and `docs/adapters.md` explains the Vue and Svelte adapters.
- `docs/baseline.md` records the measurements taken at each milestone.
- `docs/releasing.md` lists the steps to publish a prerelease.
- `CHANGELOG.md` lists the changes in each version.

## Scripts

- `npm run typecheck` checks the types.
- `npm run lint` runs ESLint.
- `npm test` runs the tests.
- `npm run build` builds `dist`, checks the `"use client"` lines, and checks every subpath of the exports map.
- `npm run check:readme` fails when the README disagrees with `package.json` on the status, the version, the install command, or the subpaths.
- `npm run size` prints the minified and gzipped size of every entry. `npm run check:size` fails when an entry is over its cap in `size-budget.json` or has no cap.
- `npm run check:pack` packs the package, installs the tarball into a clean project, and checks the files, the size, the imports, and the types. Run `npm run build` first.
- `npm run release -- <status|preflight|gates|dry-run|publish|verify|tag|retire|claims>` runs one step of the release in `docs/releasing.md`. `publish` and `retire` only print commands for a person. Add `--json` for machine output.
- `npm run gates`, `npm run pr-open -- --title ... --body-file ... --base ...`, and `npm run tree-clean -- <tree>` run the tools in `tools/`. `tools/manifest.json` lists them, and its `mcp_exposure` field says which ones a later MCP server may list (only the read-only ones that change nothing). `docs/workflow-audit.md` says why.

## Development

Developing this package needs Node 22.12 or newer. That is the range Vitest 5.0.5 declares for its own use.
It was read from the tool metadata and was not run on Node 22. The built package has no Node requirement, because it is browser code.

## License

MIT. See `LICENSE`.
