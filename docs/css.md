# CSS output

`@hannasage/armature/css` returns CSS as text.
It has four functions, and each one returns a string.
It reads no DOM, no `window`, and no environment.
So it runs on a server, in a build step, or in a test.

```ts
import { cssFlavor, cssKeyframes, cssKeyframesFit, cssLinear } from "@hannasage/armature/css";
```

A spring or a curve becomes `linear()`. A timeline becomes `@keyframes`. A flavor becomes a stylesheet.

## `cssLinear(source, options?)`

It writes a spring or a curve as a CSS `linear()` string.
It is `toLinear` from `@hannasage/armature/linear` under a name that says it returns CSS.
It does no sampling of its own, and it throws what `toLinear` throws.
The options are the options of `toLinear`: `tolerance` and `duration`.

```ts
cssLinear({ stiffness: 170, damping: 26 });
// linear(0, 0.0327 2.1505%, 0.0934 4.3011%, ... 1)
```

Use the string as an `animation-timing-function` or a `transition-timing-function`.
A browser that does not know `linear()` ignores it.
Check support first with `supportsLinear` or `toEasing` from `@hannasage/armature/linear`.

## `cssKeyframes(name, options)` and `cssKeyframesFit(name, options)`

They write a timeline as `@keyframes` text.
`cssKeyframesFit` also returns the duration, the number of stops, and `capped`.

```ts
const fit = cssKeyframesFit("pop", {
  tracks: [
    { property: "scale", keys: [[0, 0.5], [300, 1, { stiffness: 170, damping: 26 }]] },
    { property: "opacity", keys: [[0, 0], [150, 1]] },
  ],
  stepMs: 100,
});
```

`fit.css` is:

```css
@keyframes pop {
  0% { scale: 0.5; opacity: 0; }
  12.5% { scale: 0.6655; opacity: 0.5903; }
  25% { scale: 0.8424; opacity: 1; }
  ...
  100% { scale: 1; opacity: 1; }
}
```

`fit.duration` is in milliseconds. It can have decimals. Use it for the length of the animation: `animation: pop 709ms linear both`.
Write `linear` for the timing function, because the stops already hold the motion.

The numbers are not worked out in this function.
It builds a real timeline from `@hannasage/armature/timeline` on an environment that does nothing, and it reads the timeline at evenly spaced times.
So a curve step, a spring step, a decay step, `place`, `stagger`, and a flavor's named sequences all give the values the timeline gives.
A spring that is the last key runs until it rests, so `duration` can be longer than the last key.

The options:

- `tracks` is a list of tracks. A track is the same as a track of `createTimeline`, with `property` in place of `value` and no `target`. It takes `keys` or `sequence`, and `offset`, `unit`, and `format`.
- `place`, `stagger`, and `flavor` are the same as for `createTimeline`.
- `stepMs` is the most time between two stops. The default is 1000/60. It is a finite number of 1 or more. The stops are evenly spaced: the timeline is cut into the fewest equal steps that are each `stepMs` or shorter, so the first stop is at 0% and the last is on the end of the timeline. At most 5,000 stops are written, and the first and the last count. A timeline that needs more throws a `RangeError` that says how many stops it needs. Raise `stepMs` to fix it.

A timeline with no length throws a `RangeError`. A call with no tracks throws a `TypeError`.
The name cannot be `none`, `initial`, `inherit`, `unset`, `revert`, `revert-layer`, or `default`, in any case. These words cannot name a keyframes rule, so the call throws a `TypeError`.

`fit.capped` is `true` when a spring or a decay in the timeline was cut at 10 seconds without coming to rest, as `capped` of a timeline state says. The text then ends before that spring does.

### What a track may write

- `property` is an individual CSS property, such as `opacity`, `translate`, `scale`, `rotate`, or a custom property. It never writes `transform`. A name such as `-webkit-transform` is refused too.
- `unit` is letters or a percent sign, up to 12 characters. Anything else throws a `TypeError`.
- `format(value)` replaces the number and the unit. It gets the value rounded to 4 places, so it never gets a number such as `5.5e-17`. It must return text. The text may hold letters, digits, spaces, and these characters: `. , % ( ) # + - * /`. Its parentheses must balance. It may call only these functions: `calc`, `min`, `max`, `clamp`, `var`, the color functions (`rgb`, `rgba`, `hsl`, `hsla`, `hwb`, `lab`, `lch`, `oklab`, `oklch`, `color`, `color-mix`), the filter functions, and the shape functions. It cannot hold `;`, braces, quotes, a backslash, `<`, a comment, or a number written with an exponent. Text that breaks a rule throws a `TypeError`.
- Every number is cut to 1,000,000,000 and written with at most 4 decimals. No number reaches the CSS as exponent text.

## `cssFlavor(flavor)`

It writes the variables and the attributes of a flavor as a stylesheet.
The flavor must hold together, or it throws the `TypeError` of `validateFlavor`.

```ts
import { glassFlavor } from "@hannasage/armature/glass";
cssFlavor(glassFlavor);
```

gives:

```css
@property --lqg-press { syntax: "<number>"; inherits: false; initial-value: 1; }
@property --lqg-flex { syntax: "<number>"; inherits: false; initial-value: 0; }
@property --lqg-spec-x { syntax: "<percentage>"; inherits: false; initial-value: 50%; }
@property --lqg-spec-y { syntax: "<percentage>"; inherits: false; initial-value: 0%; }
@property --lqg-glow { syntax: "<number>"; inherits: false; initial-value: 0; }
@property --lqg-lens-x { syntax: "<length>"; inherits: true; initial-value: 0px; }
... (the other lens variables)
:where([data-lqg]) {
  --lqg-press: 1;
  --lqg-flex: 0;
  --lqg-spec-x: 50%;
  --lqg-spec-y: 0%;
  --lqg-glow: 0;
}
```

What it writes, in this order:

1. An `@property` rule for each of the five surface variables, with `inherits: false`. The surface controller writes them on the element, and the stylesheet reads them on that element. The start value is the surface at rest. The glint starts at the `specularRest` of the flavor.
2. An `@property` rule for each of the six lens variables, with `inherits: true`. The lens controller writes them on the row, and the stylesheet reads them on a child, so they must inherit. The four lengths start at `0px`, and the two scales start at `1`.
3. An `@property` rule for each follower. A follower is a number that starts at `0` and inherits, because a stylesheet usually reads it in the children of the element.
4. A `:where` rule on the surface attribute, which sets the five surface variables at rest. It is for a browser that does not know `@property`. `:where` has no specificity, so the inline values that a controller writes always win.

A flavor with none of these parts gives an empty string.

## A build step

```ts
import { writeFileSync } from "node:fs";
import { cssFlavor, cssKeyframes } from "@hannasage/armature/css";
import { myFlavor } from "./flavor.js";

writeFileSync("dist/flavor.css", cssFlavor(myFlavor) + cssKeyframes("enter", { flavor: myFlavor, tracks: [{ property: "opacity", sequence: "enter" }] }));
```

## Safe to write into a page

The text that a flavor or a caller gives is never trusted.

- Every name goes through an escape that follows the rule of `CSS.escape`. A variable name, an attribute name, and a keyframes name stay one name, whatever they hold. `press;}body{display:none` becomes `press\;\}body\{display\:none`.
- The escapes never write a literal `<`. They write it as `\3c `, so a sheet inside a `<style>` element cannot end the element.
- A unit and the text of a `format` function are checked, as described above.
- A number that is not finite throws a `TypeError`. A number that is very large is cut.
- The output never declares the property `transform`, with or without a vendor prefix.

A custom property whose name holds the word `transform`, such as `--demo-transform-x`, is a custom property and not the `transform` property, so it is allowed.
