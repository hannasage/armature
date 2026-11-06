# Flavors

A flavor is the data that makes the engine feel like one product.
The engine holds the physics and the browser plumbing.
A flavor holds the names, the numbers, and the spring presets.

The engine never names a flavor. Every DOM controller and every generic React hook takes the flavor as a required argument. A call that leaves it out ends in one of two ways.

- The DOM controllers throw a clear `TypeError`. These are `createSurface`, `attachSurface`, `createLens`, `installDelegation`, and `createScrollReveal`. The pure helpers, such as `velocityBlend`, throw the same error. The error is clear when the call has an options object. A call with no options object at all fails with the plain JavaScript error for reading a property of `undefined`.
- The React hooks, `ArmatureProvider`, `mountScrollReveal`, `startScrollReveal`, and `guardedSetup` do not throw. They log the failure with the label `[armature]` and skip the start, so a mistake cannot reach a React error boundary. A hook called with no options object counts as a call with no flavor.

The glass flavor is `glassFlavor`, exported from `@hannasage/armature/glass`. It is the one complete example.

## How names work

Every name in a flavor is a suffix. The flavor has one prefix, and two helpers build the full names.

- `cssVar(flavor, "press")` gives `--lqg-press` for a flavor with the prefix `lqg`.
- `dataAttr(flavor, "group")` gives `data-lqg-group`.
- `dataAttr(flavor, "")` gives the bare `data-lqg`.
- `logTag(flavor)` gives `[liquid-glass]` for the glass flavor.

The prefix is lowercase letters, digits, and hyphens, and it starts with a letter. `validateFlavor` checks this.

## A flavor has four parts

Only the top level is needed by every flavor. The other three parts are optional. A controller asks for the part it needs. If the part is missing, the controller throws a `TypeError` that names the flavor.

- Top level: `name`, `prefix`, `logLabel`, and `springs`.
- `surface`: read by the surface and by delegation.
- `lens`: read by the lens.
- `reveal`: read by the scroll reveal and by the attribute builders.

## Top level fields

- `name` is a short word for messages. `validateFlavor` and the require helpers put it in their errors. The React hooks use it in the context of a logged failure, such as `glass surface`.
- `prefix` starts every CSS variable and data attribute. `cssVar` and `dataAttr` read it, and every controller calls those two helpers.
- `logLabel` starts every logged error, in brackets. `logTag` reads it. The guard (`guardedSetup`) and the scroll reveal use it for their default log lines.
- `springs` is a map of named spring presets. `springOf` reads it. The surface and the lens look up their springs here by key. `validateFlavor` checks that every key named in the `surface` and `lens` parts exists in this map.

## The surface part

The surface is the press, the glint, and the glow. `createSurface`, `attachSurface`, and `installDelegation` read this part. In the list below, "the surface" means `dom/surface.ts` and "delegation" means `dom/delegate.ts`.

- `vars` holds the suffixes of the five CSS variables the surface writes: `press`, `flex`, `specX`, `specY`, and `glow`. The surface reads it.
- `attributes` holds the suffixes of the data attributes `surface`, `group`, and `feel`. Delegation reads it. An empty suffix gives the bare `data-<prefix>`.
- `springKeys` names the press spring and the release spring in the `springs` map. The surface reads it.
- `rest` holds the rest thresholds, `restDelta` and `restSpeed`, that are merged under both surface springs. The surface reads it.
- `defaults` holds the press scale, the flex, the glow falloff, the neighbor share, and the resting place of the glint. The surface reads it. An option on the call beats each default.
- `specularTauMs` and `glowTauMs` are the time constants, in milliseconds, of the glint and the glow as they follow the pointer. The surface reads them.
- `hoverGlow` is the glow level while the pointer hovers. The surface reads it.
- `feels` is a map of named feels. The value of the feel attribute picks one. Delegation reads it and passes the chosen options to the surface it makes.

## The lens part

The lens is the travelling indicator under the current item of a row. `createLens` reads this part.

- `vars` holds the suffixes of the six CSS variables the lens writes: `x`, `y`, `w`, `h`, `sx`, and `sy`.
- `readyAttribute` and `readyValue` name the attribute that says the lens is showing, and the value it takes.
- `springKeys` names the position spring and the width spring in the `springs` map.
- `pixelRest` holds the rest thresholds merged under both lens springs. Pixels only need to look still.
- `stretchVelocity` is the speed, in pixels per second, that adds 100 percent of stretch.
- `maxStretch` is the most the lens stretches along x, as a fraction.

## The reveal part

The reveal is the spring that brings elements into view as the page scrolls, and the drag that makes revealed elements trail the scroll. The reveal controller (`createScrollReveal`) reads this part. The pure helpers in `dom/reveal-motion.ts` and the attribute builders in `dom/reveal-attrs.ts` read the same fields.

- `attributes` holds the suffixes of the nine data attributes: `reveal`, `group`, `delay`, `revealed`, `drag`, `depth`, `tilt`, `side`, and `line`. The controller reads them. The attribute builders write `reveal`, `delay`, `tilt`, `side`, `drag`, `depth`, `group`, and `line`.
- `delayProperty` is the suffix of the CSS variable that records the stagger a piece started with. The controller writes it.
- `personalities` is a map from a name to a personality. `revealStart` asks the personality for its start pose. See the next section.
- `fallback` is the personality used for a name the flavor does not know. `parsePersonality` and `personalityOf` read it. `validateFlavor` checks that it is one of the personalities.
- `velocity` holds `slow` and `fast`, the scroll speeds in pixels per second. At or below `slow` a scroll is slow. At or above `fast` it is fast. `velocityBlend` reads them, and everything that blends by speed builds on that.
- `springs` holds the `slow`, `fast`, and `calm` reveal springs. `revealSpring` blends `slow` and `fast` by speed. The controller uses `calm` for a personality whose spring is `calm`.
- `stagger` holds `stepMs`, `maxSteps`, and `maxDelayMs`. `staggerDelayFor` reads the first two. `parseDelay` and the attribute builder read the third.
- `foldPercent` is how far up from the bottom of the viewport an element must be to count as in view. `belowFold` and `revealRootMargin` read it.
- `safetyMs` is the time after which a timer shows anything still hidden and in view. The controller reads it.
- `tiltLimit` is the largest tilt that a markup attribute can ask for, in degrees. The attribute builder reads it.
- `opacityDone` is the progress at which opacity reaches 1. `revealPose` reads it.
- `clipSide` is how far a clip extends past the box on each side, as a CSS length. The controller reads it to write `clip-path`.
- `hints` holds the `will-change` values while a piece moves: `move`, `clip`, and `drag`. The controller reads them.
- `drag` holds the drag numbers: `shiftMax`, `rotateMax`, `fullVelocity`, the `depth` range with its `fallback`, and the drag `spring`. `dragTarget` and `parseDepth` read the numbers. The controller reads the spring. The `dragAttributes` builder reads the depth range.

## Personalities

A personality is one way of arriving. The engine never asks for a personality by name. It asks the personality for its traits, so a flavor can add a new personality without any change in the engine.

- `start(input, context)` returns the start pose at progress 0: `x`, `y`, `scale`, and `rotate`. `revealStart` calls it. The context carries the speed blend `t` and the scroll direction.
- `spring` is `"speed"` or `"calm"`. `"speed"` follows the scroll speed. `"calm"` always uses the calm spring. The controller reads it.
- `clips` says whether the piece is revealed through a clip. The controller reads it. For a clipped piece, the box is hidden and its lines move.
- `scaleRotate` says whether the piece writes `scale` and `rotate` along with `translate`. The controller reads it.
- `hiddenTranslate` says whether a waiting piece is hidden with its start offset as well as with zero opacity. The controller reads it.

The glass flavor has four personalities: `drop`, `mask`, `slide`, and `fade`.

## Write your own

A flavor is a plain object. Start from the type.

```ts
import type { Flavor } from "@hannasage/armature";

export const acme: Flavor = {
  name: "acme",
  prefix: "acme",
  logLabel: "acme-motion",
  springs: {
    tap: { stiffness: 200, damping: 20 },
    letgo: { stiffness: 260, damping: 12 },
  },
  surface: {
    vars: { press: "squeeze", flex: "give", specX: "shine-x", specY: "shine-y", glow: "halo" },
    attributes: { surface: "", group: "cluster", feel: "mood" },
    springKeys: { press: "tap", release: "letgo" },
    rest: { restDelta: 0.001, restSpeed: 0.02 },
    defaults: { pressScale: 0.9, flex: 0.4, glowFalloff: 120, neighborShare: 1, specularRest: { x: 50, y: 0 } },
    specularTauMs: 45,
    glowTauMs: 100,
    hoverGlow: 0.5,
    feels: {},
  },
};
```

Then pass it to a controller.

```ts
import { attachSurface } from "@hannasage/armature/dom";

attachSurface(button, { flavor: acme });
```

A flavor with only a `surface` part is complete for a surface. A call that needs the `lens` or `reveal` part on this flavor throws a `TypeError` that says the flavor has no such part.

## Write your own wrapper

A flavor holds functions, such as the `start` function of a personality. A Next.js server component cannot pass a value like that as a prop to a client component.

So the consumer writes one small client file that fixes the flavor. The glass wrappers in `@hannasage/armature/glass/react` do the same.

```tsx
"use client";
import type { ReactNode } from "react";
import { ArmatureProvider } from "@hannasage/armature/react";
import { acme } from "./acme-flavor";
export const AcmeProvider = ({ children }: { children?: ReactNode }) => <ArmatureProvider flavor={acme}>{children}</ArmatureProvider>;
```

A server component can then render `<AcmeProvider>`. It passes no flavor.
