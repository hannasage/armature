# @hannasage/liquid-glass

Physics-based "liquid glass" motion for the web. It has springs, a lens that refracts what is behind it, a
travelling indicator for navigation rows, and a pressable surface. It is source-only TypeScript, MIT licensed,
and the core has no runtime dependencies.

Status: version 0.0.0, private, inside the sage-web repository. It is not published.

## What is in it

- **Springs.** A damped spring solver that gives the same result at any frame rate.
- **Glass filter.** An SVG filter that bends the backdrop like a thick glass rim. A pure function builds the
  displacement map, and a small PNG encoder turns it into a data URI. No canvas is needed.
- **Lens.** A controller for an indicator under the current item of a row. It springs, stretches with speed,
  and keeps its velocity when you change the target mid-flight.
- **Surface.** A controller that presses in, springs back with overshoot, follows the pointer with a glint,
  and spreads a glow to its neighbours.
- **Scroll physics.** A scroll velocity tracker, a spring reveal with four personalities that reads how fast the page
  scrolls, and a drag that makes revealed elements trail the scroll like cloth.
- **React bindings.** Two providers and three hooks.
- **styles.css.** A small generic baseline with the three fallbacks.

Every CSS class, custom property, and data attribute this package ships starts with `lqg`.

## Install from the workspace

The repository root lists the package as a workspace and as a dependency:

```json
{
  "workspaces": ["packages/*"],
  "dependencies": { "@hannasage/liquid-glass": "0.0.0" }
}
```

Run `npm install` once. Next.js compiles workspace packages by itself, so the package needs no
`transpilePackages` entry and no path alias.

```ts
import "@hannasage/liquid-glass/styles.css";
import { createGlassFilter, createLens, attachSurface, createScrollReveal } from "@hannasage/liquid-glass";
import { LqgProvider, LqgFilter, LqgRevealProvider, useLqgLens, useLqgSurface, useLqgReveal } from "@hannasage/liquid-glass/react";
```

Tests live in `packages/liquid-glass/tests`. The root `npm test` runs them, in Node, with no browser.

## Quick start

### A pressable button, rendered on the server

Mount the provider once. Then any element with `data-lqg` gets the surface behaviour, with no client wrapper
around it. With no script, the element simply stays still.

```tsx
// app/layout.tsx (a server component)
import "@hannasage/liquid-glass/styles.css";
import { LqgProvider } from "@hannasage/liquid-glass/react";

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
<button className="lqg-surface" data-lqg="" data-lqg-group="actions">Send</button>
```

Elements with the same `data-lqg-group` light each other: the glow fades with distance.

An element can move more quietly with `data-lqg-feel="calm"`: a press to 0.985 instead of 0.97, a release that
overshoots less, and a glow that reaches a neighbour at half strength (the `neighborShare` surface option, 0 to 1,
default 1). An unknown feel name is ignored. The presets are exported as `FEELS`.

### A travelling lens under the current item

```tsx
"use client";
import { useEffect, useRef } from "react";
import { useLqgLens } from "@hannasage/liquid-glass/react";

export function Row({ activeKey }: { activeKey: string }) {
  const row = useRef<HTMLDivElement>(null);
  const lens = useLqgLens(row, {
    measure() {
      const item = row.current?.querySelector<HTMLElement>("[aria-current]");
      if (!item) return null;
      return { x: item.offsetLeft, y: item.offsetTop, w: item.offsetWidth, h: item.offsetHeight };
    },
  });
  useEffect(() => lens.update(), [activeKey, lens]);
  return (
    <div ref={row} style={{ position: "relative" }}>
      <span className="lqg-lens" />
      {/* links */}
    </div>
  );
}
```

Pass `{ keyboard: true }` to `update` when a key press caused the change. The lens then jumps instead of
travelling.

### A refracting lens

```tsx
import { createGlassFilter } from "@hannasage/liquid-glass";
import { LqgFilter } from "@hannasage/liquid-glass/react";

const filter = createGlassFilter({ width: 160, height: 56, radius: 28, id: "lqg-nav", dispersion: true });
// <LqgFilter filter={filter} />        puts the hidden <svg> in the page
// --lqg-backdrop-refract: url(#lqg-nav) blur(8px)    in CSS, on the element
```

Where the browser draws refraction, the provider sets `data-lqg-mode="refract"` on the root. Elsewhere it sets
`blur`. `styles.css` uses `--lqg-backdrop-refract` only in `refract` mode.

## API

### Core: `@hannasage/liquid-glass`

**Springs.** A spring state holds `value`, `velocity`, `target`, and its config. Every function returns a new
state.

- `createSpring(config, initial = 0)`
- `stepSpring(state, target, dt)` where `dt` is in seconds
- `retarget(state, newTarget)` keeps position and velocity
- `reconfigure(state, config)` swaps the constants and keeps the motion
- `isAtRest(state, config?)`
- `criticalDamping(stiffness, mass = 1)` is `2 sqrt(k m)`
- `FIXED_STEP`, which is 1/120 s
- Presets: `lensX` (210, 20), `lensWidth` (180, 12), `press` (170, 26), `gentle` (120, 14), `stiff` (210, 20),
  and `release` (300, 14). Each is stiffness, then damping, with mass 1.

The solver steps in fixed slices of 1/120 s and keeps the leftover time. A frame of 8 ms, 16.7 ms, or 33 ms
therefore lands in the same place. `NaN`, `Infinity`, a zero `dt`, and a negative `dt` never reach the state.

**Glass filter.**

- `createGlassFilter(options)` returns `{ id, url, markup, scale, displacementUri, specularUri, options, withScale }`.
  Options: `width`, `height`, `radius`, `scale`, `depth`, `bevel`, `refractiveIndex` (1.5), `dispersion`,
  `specular`, `id`, `mapPixels`.
- `filter.withScale(n)` returns the same filter with a new `scale`. It builds no map.
- `updateGlassFilter(filter, patch)` rebuilds the maps only when the size, radius, depth, bevel, index, or
  specular settings change.
- `applyFilterScale(root, id, scale)` sets `scale` on a filter that is already in the page. Call it each frame
  to animate.
- `computeDisplacementMap(geometry)` and `computeSpecularMap(geometry)` are the pure map functions. They return
  a `Uint8ClampedArray` of RGBA. In the displacement map, 128 means no shift.
- `encodePng`, `pngDataUri`, `crc32`, `adler32`, `toBase64`

Ids come from a counter. Pass `id` yourself when server and client markup must match.

**Detection.**

- `detectRefraction(env, { refraction })` is true for Chromium-based browsers. It reads
  `navigator.userAgentData.brands` first, then the user agent. It is false when unsure. An explicit
  `refraction` option beats the `data-lqg-refraction="on|off"` attribute on the root, which beats the browser.
- `readPreferences(env)` returns `{ reducedMotion, reducedTransparency, forcedColors }`.
- `browserDetectionEnvironment()`

**Lens.** `createLens({ container, measure, env?, jumpRules?, springs?, stretchVelocity?, maxStretch? })`
returns `update(change?)`, `jump()`, `refit()`, `getState()`, and `destroy()`. It writes `--lqg-lens-x`, `-y`,
`-w`, `-h`, `-sx`, and `-sy` on the container, and `data-lqg-lens="ready"` once it has a place. It stretches
by `1 + min(|vx| / stretchVelocity, 0.12)` along x, and by the inverse along y.

**Surface.** `attachSurface(element, options)` returns `addNeighbor`, `removeNeighbor`, `setNeighbors`,
`getState`, and `destroy`. It writes `--lqg-press`, `--lqg-flex`, `--lqg-spec-x`, `--lqg-spec-y`, and
`--lqg-glow`. `createSurface` is the same without listeners, and `installDelegation(root, options)` is the
document-level listener the provider uses. A surface option `neighborShare` scales the glow a neighbour receives.

**Environment.** Every controller takes an `env` with `requestFrame`, `cancelFrame`, `now`, `matchMedia`,
`setCSSVariable`, `setAttribute`, and an optional `observeResize`. The default is the real browser. A test passes
a fake, which is how the controllers run in Node. The scroll controllers take an `LqgScrollEnvironment` instead:
the same frame functions, plus `scrollY`, `viewportHeight`, `onScroll`, `tabHidden`, `onVisibilityChange`,
`setStyle`, `createIntersectionObserver`, `watch`, `onFocusIn`, and timers.

### Scroll physics

Four pieces, all in the core, all running on an injected environment (`LqgScrollEnvironment`), so Node tests drive
them with fakes. `createBrowserScrollEnvironment()` is the real browser.

**`createScrollVelocity(env, { smoothingMs?, onWake? })`** reads the speed of window scroll in pixels per second,
signed (positive while the page scrolls down). It returns `read()`, `subscribe(listener)`, `sample(time)`,
`active`, and `destroy()`. A scroll event wakes it. Then, one animation frame at a time, it turns the distance
since the last sample into a raw speed and moves a smoothed speed toward it (time constant 70 ms, so any frame
rate gives the same result). When the page stops, the speed decays and is set to exactly 0 below 12 px per second,
and the frames stop. It never reads more than 12,000. With `onWake` it is driven: it requests no frame of its own,
and the host calls `sample(time)` from its own loop.

**`createScrollReveal({ root, env?, selector?, groupSelector?, dragSelector?, revealedAttribute?, personalityOf?,
delayOf?, accepts?, onArm?, onDisarm? })`** returns `start()`, `stop()`, `armed`, `velocity()`, `phase(element)`,
and `pose(element)`. The elements to reveal carry `data-lqg-reveal`:

- Nothing is hidden until `start()` arms it. The server markup, a page with no script, and reduced motion show
  everything. When it arms, an element in view (or above it) is shown at once with no entry, and one in the lowest
  8 percent of the viewport or below waits hidden (opacity 0 and its start offset).
- When a waiting element enters the viewport, a spring runs it in. It writes only the individual CSS properties
  `translate`, `scale`, `rotate`, and `opacity` (and `clip-path` for a `mask`), plus a `will-change` hint while it
  runs. Never `transform`, blur, or a shadow, so a card's own hover transform keeps working. At rest every property
  is removed, so the rest pose is exactly translate 0, scale 1, rotate 0, opacity 1. An element reveals once.
- Speed sets the start and the spring. A slow scroll (400 px per second or less) starts 28 px away and settles
  softly: stiffness 120, damping 16, an overshoot of 3.5 percent of the travel. A fast scroll (3,200 px per second
  or more) starts up to 110 px away and rings more: stiffness 180, damping 15, an overshoot of 12.0 percent.
  Between the two, both blend. The offset flips sign with the scroll direction, so scrolling up brings content in
  from above.
- Personalities, by the value of `data-lqg-reveal`:
  - `drop`: rises from below, scale 0.94 to 1, and a tilt that settles to 0 (0.6 degrees slow, 1.5 degrees fast; the
    sign follows the scroll direction; `data-lqg-tilt` raises the limit, up to 4).
  - `mask`: for headings. The box opens through a clip (`clip-path`) with the spring, and the lines rise through it
    one after another, 60 ms apart. Mark each line with `data-lqg-line` and give it `display: block`.
  - `slide`: slides in from the side, 40 px (slow) to 120 px (fast), left for an even index in its group and right
    for an odd one. `data-lqg-side="left|right"` names the side instead, so the two cards of a row can move apart
    and never cross.
  - `fade`: opacity and a 12 px rise. Its spring is overdamped, so a form field never overshoots.
  - Anything else is `drop`.
- Siblings that arrive together inside a `data-lqg-reveal-group` parent start 60 ms apart in reading order, capped
  at 6 steps (360 ms). `data-lqg-reveal-delay` adds milliseconds.
- Safety. 2.5 seconds after arming, anything still hidden and in view is shown. A node added later (a streamed
  section) is picked up, born hidden, and revealed when it lands. Keyboard focus on a waiting element shows it at
  once. A hidden tab pauses the frame loop. Turning reduced motion on stops the controller and shows everything;
  turning it off again does not re-arm it.
- Cost. One `IntersectionObserver`, one scroll listener that wakes the loop, and one frame loop that runs only
  while a reveal runs, the speed is not 0, or a drag has not settled. A frame reads no layout. Geometry is read once,
  when an element enters.

**Drag.** An element with `data-lqg-drag` that has been revealed trails the scroll while the page moves, like cloth.
It shifts up to 6 px and turns up to 0.8 degrees in the scroll direction, in proportion to the speed (full at 1,600
px per second), scaled by `data-lqg-depth` (0.4 to 1, default 0.7), so layers at different depths move by
different amounts. When the scroll stops, a spring (stiffness 170, damping 22) settles it back to exactly 0, in
about 0.7 to 0.8 s measured in a browser. Only elements in the viewport drag.

**`startScrollReveal(create, { context?, report? })`** makes and starts a controller and never throws. If making it
or starting it throws (no `matchMedia`, an old Safari without `addEventListener` on a media query list, a
`MutationObserver` that cannot be made), it stops the controller, so every element is visible and the armed class
is removed, and it logs the error with its context.

**`mountScrollReveal(host, options)`** is that, for an element, plus an `armedClass` the host wears while armed. It
returns the function that unmounts. **`lqgReveal(personality, { delayMs?, tilt?, side? })`**, **`lqgDrag(depth)`**,
`LQG_REVEAL_GROUP`, and `LQG_LINE` build the attributes for server markup.

```tsx
<LqgRevealProvider className="page">
  <h2 data-lqg-reveal="mask"><span data-lqg-line>Two lines,</span> <span data-lqg-line>one heading</span></h2>
  <div data-lqg-reveal-group>
    <article data-lqg-reveal="drop" data-lqg-drag data-lqg-depth="1">...</article>
    <article data-lqg-reveal="slide" data-lqg-drag data-lqg-depth="0.7">...</article>
  </div>
</LqgRevealProvider>
```

A site that keeps its own attribute names passes `selector`, `groupSelector`, `revealedAttribute`, `personalityOf`,
and `delayOf`; sage-web does this to keep its `data-reveal` markup (SPEC.md GI-67).

### React: `@hannasage/liquid-glass/react`

React is an optional peer dependency. Every file that needs the browser starts with `"use client"`.

- `LqgProvider` installs one listener set on the document and sets `data-lqg-mode`.
- `useLqgSurface(ref, options)` attaches a surface to one element. Use it or the provider for an element, not both.
- `useLqgLens(ref, options)` returns a stable `{ update, jump, refit }`.
- `LqgFilter` renders a filter's hidden `<svg>`. It works in a server component.
- `useLqgReveal(ref, options)` mounts the spring scroll reveal on one element and unmounts it. `LqgRevealProvider`
  is that on a `div` that wraps its children. Options are read once, when the element mounts.

### Styles: `@hannasage/liquid-glass/styles.css`

Classes: `.lqg-surface`, `.lqg-lens`. Attributes: `data-lqg`, `data-lqg-group`, `data-lqg-lens`,
`data-lqg-mode`, `data-lqg-refraction`. Theme it through these custom properties: `--lqg-blur`, `--lqg-fill`,
`--lqg-rim`, `--lqg-spec-strength`, `--lqg-glow-radius`, `--lqg-glow-strength`, `--lqg-fallback-fill`,
`--lqg-backdrop`, and `--lqg-backdrop-refract`. The file carries no site colors.

## Browser support

- **Refraction runs only in Chromium-based browsers** (Chrome, Edge, and others built on Chromium). It needs
  `backdrop-filter: url(#filter)`.
- **Safari reports that it supports** `backdrop-filter: url()` and then draws nothing (WebKit bug 245510). So
  this package never asks CSS whether it is supported. It reads the browser brand instead.
- **Firefox does not do SVG backdrop refraction.**
- **Safari and Firefox get** the blur, the rim, the specular glint, the glow, and every spring. Only the bend
  of the backdrop is missing.
- Chrome and Firefox on iOS are WebKit underneath, so they behave like Safari.
- `@property` makes the variables non-inheriting where it is supported. Without it the `var()` defaults apply.

## Accessibility

- **Reduced motion.** The surface does nothing: no press, no overshoot, no specular tracking, no glow. It snaps
  any motion in flight to rest. The lens jumps instead of travelling. `styles.css` also removes the surface
  transform under `prefers-reduced-motion: reduce`.
- **Scroll physics.** Under reduced motion the reveal never arms, nothing is hidden or moved, and no drag runs. A
  page with no script shows everything, and so does a page whose reveal fails to arm. Keyboard focus is never hidden.
- **Reduced transparency.** `styles.css` swaps the glass for an opaque fill and removes the blur under
  `prefers-reduced-transparency: reduce`. Safari does not expose this setting, so nothing can detect it there.
- **Forced colors.** Under `forced-colors: active` the glass becomes the system `Canvas` fill with a real
  `CanvasText` border.
- **No backdrop-filter.** A browser with none gets the opaque fill.
- Set `--lqg-fallback-fill` to a color that keeps your text readable. The default is the system `Canvas` color.
- The package adds no content and no focus handling. Keep real controls (`button`, `a`) under it, so the
  keyboard and screen readers work as before.

## More

`docs/glass-how-it-works.md` explains the numbers: the spring, the displacement map, and the filter.

## License

MIT. Copyright (c) 2026 Hanna Sage. See `LICENSE`.
