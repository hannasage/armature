# Changelog

This file lists the changes in each version of `@hannasage/armature`.
The versions follow semantic versioning, with one note for prereleases: the API can still change between prereleases.

## Unreleased

Changes for the next beta. They are not published.

- New guide `docs/flavor-authoring.md`: it builds the Tide flavor step by step, with its springs, a follower, a gesture, a timeline, and a layout part. Its code blocks are cut from `examples/tide`, and a test checks them.
- New example flavor Tide in `examples/tide`: the motion of a bottom sheet, and a sheet that uses it. It is the third flavor of the stamped Milestone 4. It is not published.
- New page `docs/curves.md` for `/curves` and `/linear`, with a figure of the named easings drawn from their own samples.
- Every number in the prose and the inline code of `docs/frame.md`, `docs/kinds.md`, `docs/curves.md`, `docs/gesture.md`, `docs/timeline.md`, `docs/layout.md`, `docs/css.md`, `docs/adapters.md`, and `docs/flavor-authoring.md` is checked by a test in `tests/docs` that works it out from the code, a run of the code, or a saved measure. Three pages changed as a result: `docs/gesture.md` now gives the measured peak of a hard flick into the band, `docs/css.md` says to round the duration up, and `docs/kinds.md` shows a compact path that parses.
- New page `docs/frame.md` for `/frame`: how to make a scheduler, the environment, tasks, the fixed step, the clamp of a long frame, and the pause while the tab is hidden.
- `npm run check:pack` also checks that the declaration file of the engine marks the same parts of `Flavor` `@experimental` as the source. `--out <file>` saves the size and the file count of the tarball as JSON.
- The contract review after the third flavor, in `docs/contract-review.md`. The top level, `surface`, and `followers` are stable by the rule of the stamped spec. `lens`, `reveal`, `gesture`, `timeline`, and `layout` stay experimental, and the type `Flavor` marks them with `@experimental`.
- New entry `@hannasage/armature/css`: functions that return CSS text, with no DOM and no environment. `cssLinear` writes a spring or a curve as `linear()`. `cssKeyframes` and `cssKeyframesFit` write a timeline as `@keyframes` text, with the values of a real timeline. `cssFlavor` writes the variables and attributes of a flavor as a stylesheet. Every name is escaped, and every number is cut and written with no exponent. The output never declares `transform`. See `docs/css.md`.
- New entry `@hannasage/armature/vue`: the composables `useArmatureSurface`, `useArmatureFollower`, `useArmatureDrag`, and `useArmatureLayout`. Each makes its controller when the component mounts, and destroys it when the component unmounts. Each returns `{ controller, failed }`. See `docs/adapters.md`.
- New entry `@hannasage/armature/svelte`: the actions `surface`, `follow`, `drag`, and `layout`, for the `use:` directive. They take `onReady` and `onError` beside the options of the controller. See `docs/adapters.md`.
- Vue (`^3.5.0`) and Svelte (`^5.0.0`) are optional peer dependencies, as React is.
- New entry `@hannasage/armature/layout`: layout animation (FLIP), shared elements, and presence. `createLayout(el, { flavor })` has `snapshot()` and `play()`: the element is measured, put back where it was with `translate` and `scale` (never `transform`), and sprung to zero. A change in flight starts from where the element is now and keeps its speed. The option `children` counter-scales the children of a scaled element, so they keep their shape. `createShared({ flavor })` moves two elements with one key as one. `createPresence(container, { flavor })` keeps an element mounted until its `exit` rests, and then unmounts it. A server render touches no `window`. See `docs/layout.md`.
- New optional flavor part `layout`: spring keys and a rest threshold in pixels. `createLayout`, `createPresence`, `createShared`, and `requireLayout` check it, and `validateFlavor` does not. The tech lead decided option A for the layout part on 2026-11-13, for the same reason as G5. A flavor with no `layout` part stays valid.
- The type `ArmatureEnvironment` has an optional `measure(target)` that returns a box. It adds no code to the spring-only entry.
- New entry `@hannasage/armature/timeline`: `createTimeline`, with tracks, keyframes, place together, in sequence, or staggered, and play, pause, reverse, seek, and scrub on the shared scheduler. A step is a curve, a spring, or a decay. It adds the optional `timeline` part to the flavor contract (named curves, a default curve, named sequences), checked by `createTimeline` and `requireTimeline`.
- New entry `@hannasage/armature/frame`: a shared frame scheduler. It steps tasks in fixed slices of 1/120 s, clamps a long frame to `MAX_FRAME`, pauses while the tab is hidden, and has a manual `advance` for tests.
- New entry `@hannasage/armature/values`: the number kind and the vector kind, a spring over a vector that matches the scalar spring component by component, and `createValue`, a spring controller that runs on the scheduler.
- New entry `@hannasage/armature/curves`: `bezier`, which evaluates a cubic-bezier and writes its CSS string, named `easings` as data (with the Projection UI curve), `createTween` and `stepTween` with the step interface of the spring, `createTweenValue` on the scheduler, and `fitBezier`, which fits a bezier to samples and reports the error.
- New entry `@hannasage/armature/linear`: `toLinear` writes a spring or a curve as a CSS `linear()` string within a stated tolerance. `supportsLinear` checks browser support, and `toEasing` falls back to a fitted `cubic-bezier()` and reports `degraded` when the fit is further off than the tolerance. `fitLinear` returns the stops with the error and `truncated`. A spring that does not rest within 10 seconds or 20,000 steps makes `toLinear` throw a RangeError, and `toEasing` returns `truncated: true`.
- New entry `@hannasage/armature/gesture`: `createDrag(element, { flavor, axis, bounds, snap })` and `drag.onSwipe(listener)`. The element follows the pointer on one or two axes and writes `translate`, never `transform`. Past the bounds it shows a rubber band, which pulls back on a spring that is stiffer the farther it is. A release decays by `v' = -c v` and stops at the rest speed, or springs to the nearest snap point with the release velocity, or fires a swipe. Under reduced motion a release goes straight to its end point. The entry also has the pointer environment (`createBrowserPointerEnvironment`) and `createPointerVelocity`. See `docs/gesture.md`.
- New optional flavor part `gesture`: `friction`, `rubberBand`, `swipe`, `springKeys`, and `rest`. `validateFlavor` checks it. A flavor with no `gesture` part stays valid. `requireGesture` is in `@hannasage/armature/gesture`. The type `GestureFlavor` is in `@hannasage/armature`.
- New kinds in `@hannasage/armature/values`, so a spring or a tween can move more than a number:
  - `colorKind` reads hex, `rgb()`, `hsl()`, and the CSS color names. It blends in OKLab, so the hue takes the short way, and it writes `#rrggbb` or `#rrggbbaa`.
  - `pathKind(template)` blends SVG path data between paths that have the same commands in the same order. A path with another structure throws a `TypeError`. There is no resampler.
  - `transform3dKind` holds a translation, a rotation, a scale, and a perspective. A rotation takes the short way. It writes only `translate`, `rotate`, and `scale`, never `transform`. `transform3dStyles` splits them from the `perspective` of the parent.
- A kind can have an optional `align` method. `createValue` calls it before a move, so a spring picks the nearest of two equal targets.
- A kind can have an optional `restDelta`. `createValue` uses it when the spring sets none, so each kind rests at its own scale. The color kind sets 0.0002 and the 3D transform kind 0.0005.
- `getState().velocity` is the raw list of numbers for every kind except one that sets the `scalar` flag, which only the number kind does. `Kind` and `Value` take a second type parameter for it.
- A move spring with no `restDelta` inherits the explicit one of the base spring, then the kind default. A `restDelta` that is not finite and above 0 counts as unset. `pathKind(template, { restDelta })` sets the rest distance of a path, for example on a unit viewBox.
- The kinds check their input in every method and throw a `TypeError` for a number that is not finite. The path kind keeps full precision and rounds to 6 decimals when it writes text.
- New hook `useArmatureFollower` in `@hannasage/armature/react`.
- A follower move can name its own spring: `follower.setTarget(1, { springKey: "settle" })`. Position, velocity, and target stay.

- Breaking, for flavor authors: the lens rest limits are now `lens.rest` and not `lens.pixelRest`. The follower part is now `followers` and not `follower`. A flavor with an old name throws a `TypeError` that says the new name. The type `RestLimits` names the shape of every rest limit.

## 1.0.0-beta.0

This is the first beta. It is meant for the npm `beta` tag. Install it with `npm install @hannasage/armature@beta`, and pin the exact version.

It replaces `1.0.0-next.0`, which is deprecated. The code is the same. Only the version, the npm tag, and the README text changed. Every product that is not proven yet uses the `beta` tag, so the `next` tag is retired.

The API can still change between betas.

## 1.0.0-next.0

This is the first prerelease. It is meant for the npm `next` tag. Install it with `npm install @hannasage/armature@next`, and pin the exact version.

### What is in this version

- The engine. It has the spring solver, the browser environments, the scroll velocity tracker, the reduced-motion check, and the flavor contract with its types.
  The solver steps in fixed slices of 1/120 s, so a 30, 60, or 144 Hz screen lands in the same place.
  The engine reads no global and never names a flavor.
- Flavors. A flavor is a named movement language. It sets the spring constants, the names of the attributes the engine reads, and the CSS variables the engine writes.
  A flavor has up to five parts: the top level, `surface`, `lens`, `reveal`, and `follower`.
  `defineFlavor` checks a flavor and freezes it.
- The follower. It is one number that springs toward a target and is written as a CSS variable. `createFollower`, in `@hannasage/armature/dom`, makes one.
  It keeps position and velocity when the target changes, snaps under reduced motion, and stops its frame loop at rest.
- The glass flavor, `glassFlavor`. It is the liquid glass look: the press, glint, and glow surface, the travelling lens, and the scroll reveal.
  It brings the refraction filter, the PNG encoder, and the browser check. Refraction works in Chromium. Other browsers get a blur.
  Every CSS class, custom property, and data attribute of the glass flavor starts with `lqg`.
- The Projection example flavor. It is the second flavor, and it is a proof that a flavor can live outside the engine.
  It is in the repository at `examples/projection/flavor.ts`. It is not part of the package, and the package does not export it.
  It uses only the public Armature entries.

### The five subpaths and the stylesheet

The package is ESM only. Each entry has a `types` file and an `import` file. There is no CommonJS build.

- `@hannasage/armature`: the engine.
- `@hannasage/armature/dom`: the DOM controllers (surface, lens, delegation, scroll reveal, follower). Each one takes a flavor.
- `@hannasage/armature/react`: the generic React hooks and providers. Each one takes a flavor.
- `@hannasage/armature/glass`: the glass flavor.
- `@hannasage/armature/glass/react`: the glass wrappers for React, such as `LqgProvider`.
- `@hannasage/armature/styles.css`: the glass stylesheet.

### Stability

The API can still change before 1.0.0.
The flavor contract is not marked stable.
`docs/contract-review.md` lists the open items: a follower hook for React, a spring chosen per move for a follower, and one shape for the rest limits together with the name of the `follower` part.
The `lens` and `reveal` parts have been used by the glass flavor only.
A prerelease version is not a promise. Pin the exact version if you install it.

### Changes for glass users

These come from the split of the engine and the glass flavor. Everything else behaves as before, and a frame-by-frame test checks it.

1. An unknown personality name from a custom `personalityOf` now gets the fallback `drop` pose, and it writes `scale` and `rotate`. The old code gave the `drop` start pose but wrote no `scale` and no `rotate`.
2. The surface and lens hooks now run inside the guard. A failure is logged and skipped. It no longer reaches a React error boundary.
3. `guardedSetup`, `startScrollReveal`, `createSurface`, and `installDelegation` now need an explicit flavor. The glass wrappers pass the glass flavor for you.
4. The four types `LqgEnvironment`, `LqgScrollEnvironment`, `LqgTarget`, and `LqgRevealAttributes` are now `ArmatureEnvironment`, `ArmatureScrollEnvironment`, `ArmatureTarget`, and `ArmatureRevealAttributes`.
5. The generic hooks need a client wrapper in Next.js, because a flavor holds functions and a server component cannot pass it as a prop. The glass wrappers are that wrapper for the glass flavor.

### Not in this version

- A hook for the follower in `@hannasage/armature/react`.
- A spring-to-`linear()` exporter.
- A written change policy and a bundle size budget. The measured size is in `docs/baseline.md`.
