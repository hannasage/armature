# Contract review after the second flavor

This review follows Milestone 2. The Projection flavor in `examples/projection/flavor.ts` was built on the public API only.
This page lists four things.
It lists what the flavor showed about the contract.
It lists what changed.
It lists what still looks like glass.
It ends with a view on whether the API is ready to be marked stable.

The API is not marked stable. Hanna decides that.

## What the second flavor exposed

These are the glass assumptions that the Projection flavor ran into.

### 1. The contract drove only three shapes

The contract had a `surface` part (press, glint, glow), a `lens` part (a travelling box), and a `reveal` part (scroll arrival).
Every controller wrote a fixed set of variables for one of those shapes.
Projection UI needs a Toggle thumb, a Toast enter, a Modal dialog, and a Slider thumb.
Each one is a single number that springs toward a target.
No existing part carries that. Forcing it through the lens or the surface writes glass variables.

Fix: the `follower` part and the `createFollower` controller. See "What was added".

### 2. The surface could not turn off the specular glint or the glow

`src/dom/surface.ts` ran three motions with no way to stop two of them: the press scale, the specular glint, and the glow.
The first Projection flavor set the flex, the neighbor share, and the hover glow to 0, and the engine still wrote the glint and glow variables.
One hover move wrote all three variables and, in the fake environment at 60 Hz, asked for 35 frames until the glint settled. The Projection stylesheet never reads them, so this was wasted work on every Button hover.

Fix: the surface part has two optional switches, `specular` and `glow`, both true by default.
When a switch is off, the surface writes none of that effect's variables and asks for no frame because of it.
The Projection flavor turns both off. A hover on its surface now asks for no frame, and a press writes only `--pui-press` and `--pui-flex`.
The glass flavor sets neither switch, and every earlier test passes unchanged.

One smaller point stays. The part still requires names for the glint and glow variables and numbers for their time constants.
A flavor that turns them off supplies values that are never used.
The values `specularTauMs`, `glowTauMs`, and `glowFalloff` need to be above 0, or the math divides by zero when they are on.

### 3. A follower has one spring for its whole life

The surface can switch springs on release with `reconfigure`.
A follower is created with one spring and keeps it.
A Modal dialog that enters and exits with the same follower can use one spring for both directions only.
The Projection flavor works around this: the `enter` follower uses `mechanical`, and a separate `dialog` follower uses `settle` for both directions.
The brief named three followers (`thumb`, `enter`, `exit`).
A fourth, `dialog`, was added to carry the Modal dialog on `settle`.

A cleaner fix lets `setTarget` take a spring for that move. That fix is not built.

### 4. The solver changes the feel, and the design formula does not warn about it

The brief asked for a measured overshoot of 8 to 10 percent for `mechanical`.
With damping 30 (ratio 0.612), the solver gave 6.5 percent and the closed-form answer is 8.8 percent.
Hanna chose damping 28 (ratio 0.572). The solver now measures 9.0 percent, and the closed-form answer is 11.2 percent.
The semi-implicit Euler slice of 1/120 s adds damping.
The slice cannot be changed per spring, because `src/engine/spring.ts` sets it from `FIXED_STEP`.

The same gap shows in the glass flavor.
The comment in `src/glass/flavor.ts` said `revealSlow` and `revealFast` "give 3.5 and 12.0 percent overshoot".
Those are closed-form numbers. The solver measures 2.6 and 10.9 percent.
The comment now says that these are the formula values and that the solver measures lower.

This is not a glass assumption, but it is the first thing a second flavor author trips over.
`docs/projection-flavor.md` records both numbers for each Projection spring.

### 5. A test helper hard-codes the glass attribute

`tests/helpers/fake-dom.ts` finds a surface with the selector `[data-lqg]`.
The engine itself is fine, because `tests/dom/flavor-delegate.test.ts` builds its own node for another prefix.
No Projection delegation test was written for this reason.

## What was added

- The optional `follower` part of `Flavor`: a record of named followers. Each has a variable suffix, a spring key, and rest limits. (`src/engine/flavor.ts`)
- `validateFlavor` checks each follower. `requireFollower(flavor, name)` returns one or throws a `TypeError` that names the flavor. (`src/engine/flavor.ts`)
- `createFollower`, in `src/dom/follower.ts`, with `setTarget`, `snap`, `getState`, and `destroy`.
  It keeps position and velocity when the target changes.
  It snaps under reduced motion.
  It stops its frame loop at rest.
  It uses the fixed step.
  It ignores `NaN` and `Infinity`.
  It takes an injected `env`.
- New public names: `requireFollower`, `defineFlavor`, `FollowerSpec`, and `FollowerFlavor` from `@hannasage/armature`, and `createFollower`, `FollowerOptions`, `FollowerState`, and `Follower` from `@hannasage/armature/dom`.
  The lists are in `scripts/check-exports.mjs`. The `.` entry now has 29 runtime names and 17 type names. The `./dom` entry has 25 runtime names and 10 type names.
- The optional `specular` and `glow` switches in the surface part (`src/engine/flavor.ts`, `src/dom/surface.ts`). They default to true. They add no public name.
- `docs/flavors.md` describes the follower part.
- The glass flavor has no follower part. All 527 earlier tests pass unchanged.
- Support for the example: path aliases in `tsconfig.json` and `vitest.config.ts`, and a boundary test that lets files under `examples/` import only the public names.

The engine has no branch on a flavor name. A search of `src/engine`, `src/dom`, and `src/react` for `lqg`, `glass`, and `liquid` finds comments only, listed below.

## What still feels glass-shaped

- The surface part. Its vocabulary is press, flex, specular, glow, and neighbors. The switches in item 2 let a flavor drop the glint and the glow, but the press, flex, and neighbor model is still the glass one.
  Its doc comment in `src/dom/surface.ts` still says "Makes an element feel like glass".
- The comments in `src/engine/flavor.ts` that name the specular glint, and one in `src/dom/reveal.ts` that quotes the glass fold of 8 percent.
- The lens part is built for a row indicator that stretches with speed: six variables, a ready attribute, and a stretch rule.
  Only the glass flavor and a synthetic test flavor use it. Nobody has tested it against a real second design.
- The reveal part has the nine data attributes, the drag block, and the four-personality shape.
  The `PersonalitySpec` traits (`clips`, `scaleRotate`, `hiddenTranslate`) describe what the glass personalities needed.
- The rest limits had three shapes: `surface.rest`, `lens.pixelRest`, and `follower[name].rest`.
  Closed in G1 (amendment 2, item 3). All three are now `rest`, and all three use the type `RestLimits`.
- The part was named `follower` (singular) and holds many followers.
  Closed in G1 (amendment 2, item 3). The part is now `followers`. The old names throw a clear `TypeError` in the beta window.

## What the second flavor did not test

- No lens. The Projection flavor has no `lens` part, so the lens contract ran against glass and a synthetic flavor only.
- No reveal. The same holds for the scroll reveal, personalities, drag, and stagger.
- No React layer. The flavor never calls `ArmatureProvider` or a hook.
  There is also no follower hook. Projection UI is a React library, so Milestone 3 needs one, for example `useArmatureFollower`.
  The `./react` entry has hooks for the surface, the lens, and the reveal only.
- No delegation with a real second attribute set. See item 5.
- No browser. Every test uses the fake environment. No frame, style write, or `matchMedia` change ran in a real browser.
- Live change of the reduced-motion setting is tested for the follower only. A follower checks the setting on every frame and at each call of `setTarget`, and it jumps to its target when the setting turns on in flight.
  The surface and the lens check it on pointer events and on `update` calls, and no test flips the setting in the middle of a move for them.
- No server render of a follower. A follower needs an element, so a server cannot run it.
  Only the initial variable matters on the server, and the Projection stylesheet sets its own default.
- No real Projection UI component. The five Milestone 3 candidates (Toggle, Button, Toast, Modal, Slider) were not changed.
  The flavor is tested against the engine and not against Projection UI markup.
- No spring pair tested for retargeting between two springs. See item 3.

## Solver accuracy

The semi-implicit Euler solver at 1/120 s measures a lower overshoot than the closed form gives. At damping 30, the solver measured 6.5 percent against 8.8 percent from the closed form. At damping 28 it measures 9.0 percent against 11.2 percent. So the docs must show solver-measured numbers, and the formula alone is not enough to choose a spring. An exact per-step solution of the linear spring is an open option for a later version. It would remove the gap, but it would change the glass numbers that the golden test pins, so it needs its own decision and a new golden run.

## Recommendation

Do not mark the API stable yet. The follower part works and has tests, but three things are open.
Each is small. Each changes a public name or a shape. Settle them before a stable mark.

1. Add a follower hook to `@hannasage/armature/react`, since Milestone 3 needs it. Closed in G1 (amendment 2, item 1): `useArmatureFollower`.
2. Let a follower change its spring per move, so one follower can enter on one spring and leave on another, and `dialog` can go. Closed in G1 (amendment 2, item 2): `setTarget(target, { springKey })`.
3. Settle one shape for rest limits, and settle `follower` or `followers`. Closed in G1 (amendment 2, item 3): `RestLimits`, `rest`, and `followers`.
After those three, the lens and the reveal still have only one real flavor.
A reasonable path is to mark `follower` and the engine stable, and to leave the `lens` and `reveal` parts marked unstable until a real flavor uses them.

## Review after the third flavor

This review follows G8 of amendment 1. The third flavor is Tide, the motion of a bottom sheet, in `examples/tide/flavor.ts`. It was built on the public API only, with a follower, a gesture, a timeline, and a layout part. `docs/flavor-authoring.md` builds it step by step, and `tests/examples/tide.test.ts` runs it through every controller.

The rule of the stamped spec: a part of the contract is marked stable only after a second real flavor uses it. A real flavor is one built for a product: glass, Projection, and Tide. The flavors in `tests/helpers` are made for single tests and do not count. `tests/docs/contract-review.test.ts` works out from the three flavors which parts each one uses, and checks the list below against it.

Stable here means that the rule is met. It does not freeze the API. The change policy for 1.0, and the choice of what 1.0 freezes, belong to Hanna.

### The status of each part

- `name`, `prefix`, `logLabel`, and `springs`: stable. Used by glass, projection, and tide.
- `surface`: stable. Used by glass and projection.
- `lens`: experimental. Used by glass only.
- `reveal`: experimental. Used by glass only.
- `followers`: stable. Used by projection and tide.
- `gesture`: experimental. Used by tide only.
- `timeline`: experimental. Used by tide only.
- `layout`: experimental. Used by tide only.

Why each part has its status:

- The top level holds in all three flavors. No flavor needed a new top-level field.
- The surface is stable by the rule. The point of the first review stays: a flavor that turns the glint and the glow off must still give their names and time constants.
- The lens and the reveal have one real flavor each, as at the first review. Tide has no travelling indicator and no scroll reveal, so it did not test them.
- The followers part now has its second real flavor. Tide uses a follower on a spring that its layout part also uses, and the names stayed unique across parts.
- The gesture, timeline, and layout parts have one real flavor each: Tide. Each needs a second real flavor before it is marked stable. The next candidate is Projection UI in Milestone 3, whose Modal needs presence from the layout part.

The type `Flavor` in `src/engine/flavor.ts` marks each experimental part with `@experimental`, so an editor shows the status. A test checks that the marks match the list above.

### What the third flavor exposed

- The contract needed no change. Tide uses only names and numbers that the existing parts already define. No engine file names Tide.
- A drag has no listener for its position. A follower cannot track the height of a dragged sheet without a read of `getState` on every frame. The sheet dims on open and on close only. A position listener on the drag is an open option for a later version.
- A timeline track writes one number. A sequence of the flavor holds the numbers of a move, and the code of the component holds the format, such as `0px ${y}px` for `translate`. The unit of a sequence is not part of the flavor.
- `validateFlavor` does not check the timeline and layout parts, by the decisions of G5 and G6. `defineFlavor(tide)` would accept a bad timeline or layout part, and the error shows when the controller is made. The guide says so.
- Presence takes the offset of a dragged element with the option `from`, so a drag and an exit hand over with no jump. In the browser, `getStyle` reads the offset, and the option is not needed.
- The snap heights and the bounds of a drag belong to the call, not to the flavor, because they depend on the size of the sheet. This held. The gesture part carries only the feel.

### Recommendation

Mark the top level, `surface`, and `followers` stable. Leave `lens`, `reveal`, `gesture`, `timeline`, and `layout` experimental until a second real flavor uses each. This is the record. Hanna decides what 1.0 freezes.
