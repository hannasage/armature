# Flavors

A flavor is the data that makes the engine feel like one product.
The engine holds the physics and the browser plumbing.
A flavor holds the names, the numbers, and the spring presets.

The engine never names a flavor. Every DOM controller and every generic React hook takes the flavor as a required argument. A call that leaves it out ends in one of two ways.

- The DOM controllers throw a clear `TypeError`. These are `createSurface`, `attachSurface`, `createLens`, `createFollower`, `installDelegation`, and `createScrollReveal`. The pure helpers, such as `velocityBlend`, throw the same error. The error is clear when the call has an options object. A call with no options object at all fails with the plain JavaScript error for reading a property of `undefined`.
- The React hooks, `ArmatureProvider`, `mountScrollReveal`, `startScrollReveal`, and `guardedSetup` do not throw. They log the failure with the label `[armature]` and skip the start, so a mistake cannot reach a React error boundary. A hook called with no options object counts as a call with no flavor.

The glass flavor is `glassFlavor`, exported from `@hannasage/armature/glass`. It is the one complete example.

## How names work

Every name in a flavor is a suffix. The flavor has one prefix, and two helpers build the full names.

- `cssVar(flavor, "press")` gives `--lqg-press` for a flavor with the prefix `lqg`.
- `dataAttr(flavor, "group")` gives `data-lqg-group`.
- `dataAttr(flavor, "")` gives the bare `data-lqg`.
- `logTag(flavor)` gives `[liquid-glass]` for the glass flavor.

The prefix is lowercase letters, digits, and hyphens, and it starts with a letter. `validateFlavor` checks this.

## Flavors are validated once and must not change

`validateFlavor` checks a flavor once and remembers the result. A change made after that check goes unseen. So a flavor must not change after it is made.

`defineFlavor(flavor)` makes this safe. It validates the flavor, freezes it at every level, and returns it. After that, a change throws a `TypeError` in strict code. A function inside the flavor, such as the `start` of a personality, is not frozen. The glass flavor is already frozen. Use `defineFlavor` for your own flavor.

## A flavor has seven parts

Only the top level is needed by every flavor. The other six parts are optional. A controller asks for the part it needs. If the part is missing, the controller throws a `TypeError` that names the flavor.

- Top level: `name`, `prefix`, `logLabel`, and `springs`.
- `surface`: read by the surface and by delegation.
- `lens`: read by the lens.
- `reveal`: read by the scroll reveal and by the attribute builders.
- `followers`: read by the follower. Added in Milestone 2, after the Projection flavor needed it.
- `gesture`: read by `createDrag`. Added in G4. See "The gesture part" below.
- `timeline`: read by `createTimeline`. Added in G5. See "The timeline part" below.

## Top level fields

- `name` is a short word for messages. `validateFlavor` and the require helpers put it in their errors. The React hooks use it in the context of a logged failure, such as `glass surface`.
- `prefix` starts every CSS variable and data attribute. `cssVar` and `dataAttr` read it, and every controller calls those two helpers.
- `logLabel` starts every logged error, in brackets. `logTag` reads it. The guard (`guardedSetup`) and the scroll reveal use it for their default log lines.
- `springs` is a map of named spring presets. `springOf` reads it. The surface and the lens look up their springs here by key. `validateFlavor` checks that every key named in the `surface`, `lens`, `followers`, and `gesture` parts exists in this map.

## The surface part

The surface is the press, the glint, and the glow. `createSurface`, `attachSurface`, and `installDelegation` read this part. In the list below, "the surface" means `dom/surface.ts` and "delegation" means `dom/delegate.ts`.

- `specular` and `glow` are optional switches, both true by default. `specular: false` turns off the glint: the surface writes no glint variable, follows no pointer position, and asks for no frame on a pointer move. `glow: false` turns off the glow for the surface and for its neighbors: the surface writes no glow variable, measures no neighbor, and asks for no frame because of a hover or a press. With both off, only the press and flex variables are written. `validateFlavor` checks that a switch is a boolean. The surface reads them.
- `vars` holds the suffixes of the five CSS variables the surface writes: `press`, `flex`, `specX`, `specY`, and `glow`. The surface reads it. When a switch is off, the names it covers stay required and are never written.
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
- `rest` holds the rest thresholds merged under both lens springs. Pixels only need to look still. It is a `RestLimits`, the same shape as the surface rest and the follower rest. The old name `pixelRest` throws a `TypeError` that says to use `rest`.
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

## The followers part

The part was named `follower` in `1.0.0-beta.0`. A flavor that still uses the old name throws a `TypeError` that says to use `followers`.

A follower springs one number toward a target and writes it as a CSS variable. A toggle thumb, a toast that slides in, and a slider thumb are followers. `createFollower` reads this part. Unlike the other parts, this one holds many entries, because a component often needs more than one number.

The part is a record from a follower name to a spec. `requireFollower(flavor, name)` returns one spec, or throws a `TypeError` that names the flavor.

- `var` is the suffix of the CSS variable the follower writes. The value is a bare number. The stylesheet decides the unit. The suffix is lowercase letters, digits, and hyphens, and starts with a letter. It is unique across followers, and no surface, lens, or reveal variable uses the same suffix. `validateFlavor` checks this.
- `springKey` names the spring in the `springs` map. `validateFlavor` checks that it exists.
- `rest` is required. It is a `RestLimits`: `restDelta` and `restSpeed`, both finite numbers above 0. They are merged under the spring, so a spring that sets its own thresholds keeps them.

A follower keeps its position and its velocity when the target changes in flight. It snaps to the target under reduced motion. This holds while it is moving too: the follower checks the setting on every frame, so it jumps to its target and stops its frame loop when the reader turns reduced motion on in the middle of a move. It stops its frame loop when the spring is at rest. It uses the engine's fixed step, so a 30, 60, and 144 Hz screen land in the same place. It ignores a target that is `NaN` or `Infinity`, and logs one line for the first such value of each follower.

```ts
import { createFollower } from "@hannasage/armature/dom";

const thumb = createFollower(thumbElement, { flavor: projection, name: "thumb" });
thumb.setTarget(1); // springs toward 1 and writes --pui-thumb
thumb.setTarget(0); // turns in flight and keeps its velocity
thumb.snap(0); // jumps with no travel
thumb.destroy();
```

A React component uses `useArmatureFollower` from `@hannasage/armature/react`. It makes the follower when the element mounts and destroys it on unmount. The handle has `setTarget`, `snap`, and `getState`, and no `destroy`. Before the element mounts, and on the server, `getState` gives the initial state. A flavor with no `followers` part logs one line and the hook skips the start.

```tsx
const thumb = useArmatureFollower(ref, { flavor: projection, name: "thumb", initial: 0 });
thumb.setTarget(1);
```

A move can name its own spring. `thumb.setTarget(1, { springKey: "mechanical" })` switches the follower to that spring and then retargets. Position, velocity, and target stay, so a turn in flight keeps its speed. The follower keeps the chosen spring for later moves that name none. The `springKey` in the follower spec is the default. A key that is not in `springs` throws the `TypeError` of `springOf`, and the follower changes nothing. The rest limits of the follower still apply under the chosen spring. Under reduced motion the follower still snaps, whatever spring the move names.

A call can replace the spring with the `spring` option. The rest limits of the flavor still apply. If the environment throws while the follower writes its variable, the follower logs one line that starts with the flavor's label, stops its frame loop, and rests on its target. It does not throw into the page. A key of the `spring` option that is `undefined` is skipped, so it does not erase a rest limit. `createFollower` throws a `TypeError` that names the follower and the flavor when the element is missing or when `initial` is not a finite number.

## The gesture part

`createDrag` from `@hannasage/armature/gesture` reads this part. `requireGesture(flavor)` returns it, or throws a `TypeError` that names the flavor. A flavor with no `gesture` part stays valid. Only a drag asks for it. The part names no CSS variable and no attribute, because a drag writes the individual property `translate`.

- `friction` is the constant c in the decay `v' = -c v`, per second. A larger number stops the element sooner. It is a finite number above 0.
- `rubberBand` has `stiffness` and `reach`, both finite numbers above 0. `stiffness` is the stiffness of the pull back at the bound. A band at distance d is `1 + d / reach` times as stiff. `reach` is also the most overshoot a pointer can show, in pixels.
- `swipe` has `velocity` (pixels per second) and `distance` (pixels), both finite numbers above 0. A release fires a swipe when it reaches both.
- `springKeys` has `snap`, the key of the spring a release uses to reach a snap point. `validateFlavor` checks that the key is in `springs`.
- `rest` is required. It is a `RestLimits`. The decay stops when its speed is below `restSpeed`. A spring uses both limits, under any limit it sets itself.

The part has no names, so it adds nothing to the rule that names are unique across parts.

## The timeline part

`createTimeline` from `@hannasage/armature/timeline` reads this part. `requireTimeline(flavor)` returns it, or throws a `TypeError` that names the flavor. A flavor with no `timeline` part stays valid. Every piece of the part is optional, and the empty part is valid.

- `curves` is a record from a name to the four control points `[x1, y1, x2, y2]` of a cubic-bezier. Each number is finite, and x1 and x2 are from 0 to 1.
- `defaultCurve` is a key in `curves`. A key that names no step takes this curve. Without it the step is a straight line.
- `sequences` is a record from a name to `{ keys }`. Each key is `[time in ms, value, step?]`. A step is the name of a curve or the key of a spring in `springs`. The times never go back. A track uses a sequence with `sequence: "name"` in place of `keys`.

A name is lowercase letters, digits, and hyphens, and starts with a letter. A curve name must not be the key of a spring, because a step names one or the other.

`validateFlavor` does not check this part. The spring-only entry has no room under its cap of 4,000 bytes for it. `createTimeline` and `requireTimeline` check it, so a bad part fails when a timeline is made. This differs from the rule of the amendment that `validateFlavor` checks every new part. The maintainer chose this on 2026-11-12, and `docs/baseline.md`, section "G5 build", records it.

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
import { defineFlavor, type Flavor } from "@hannasage/armature";

export const acme: Flavor = defineFlavor({
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
});
```

Then pass it to a controller.

```ts
import { attachSurface } from "@hannasage/armature/dom";

attachSurface(button, { flavor: acme });
```

A flavor with only a `surface` part is complete for a surface. A call that needs the `lens`, `reveal`, or `followers` part on this flavor throws a `TypeError` that says the flavor has no such part.

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
