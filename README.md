# Armature

Armature is a physics motion engine for the web.
It has one engine and many flavors.
The engine holds the spring solver and the browser plumbing.
A flavor is a named movement language. It sets the spring constants, the names of the attributes the engine reads, and the CSS variables the engine writes.

Status: pre-release. It is published on the npm `beta` tag as 1.0.0-beta.0. The API can still change.

The first flavor is liquid glass. It is in this package. The second flavor will live in Projection UI.

## Install

```bash
npm install @hannasage/armature@beta
```

React is an optional peer. The engine and the DOM controllers need no React.
Install React 18 or later only if you use the React entries.

## The five subpaths

The package has five JavaScript entries and one stylesheet.
The package is ESM only. Each entry has a `types` file and an `import` file, and there is no CommonJS build.
Each entry loads only what it needs.
The first three hold no glass code.

- `@hannasage/armature` is the engine. It has the spring solver, the browser environments, the scroll velocity tracker, the reduced-motion check, and the flavor contract with its types.
- `@hannasage/armature/dom` holds the DOM controllers: surface, lens, delegation, and scroll reveal. Each one takes a flavor.
- `@hannasage/armature/react` holds the generic React hooks and providers, such as `useArmatureSurface` and `ArmatureProvider`. Each one takes a flavor.
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
