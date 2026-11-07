# Changelog

This file lists the changes in each version of `@hannasage/armature`.
The versions follow semantic versioning, with one note for prereleases: the API can still change between prereleases.

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
