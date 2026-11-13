# Layout

`@hannasage/armature/layout` moves an element from where it was to where it is now. It has three parts. `createLayout` animates one element when the page changes. `createShared` moves one element into the place of another. `createPresence` keeps an element on the page until its exit is over.

```ts
import { createLayout, createPresence, createShared } from "@hannasage/armature/layout";

const layout = createLayout(card, { flavor });
layout.snapshot();          // measure the element now
card.classList.add("wide"); // change the page
layout.play();              // the element springs from the old box to the new one

const present = createPresence(modals, { flavor });
present.exit(modal);        // the modal stays until it rests, then it is removed

const shared = createShared({ flavor });
shared.leave("hero", thumbnail);          // measure the element that goes
const layoutOfPhoto = shared.enter("hero", photo); // the element that comes starts on that box
```

Every call needs a flavor with a `layout` part. See "The layout part" in `docs/flavors.md`.

## How a layout change works

A layout change has four steps. They are known as FLIP: first, last, invert, play.

1. `snapshot()` measures the element. This is the first box.
2. You change the page. The element lands in a new place.
3. `play()` measures the element again. This is the last box. It writes an offset that puts the element back on the first box. This is the invert step. The element does not move on screen.
4. The offset springs to zero. The element moves to its new place.

The offset is four numbers, in pixels: the shift of the center in x and y, and the difference in width and height. Each one is a spring. They rest together, and then the offset is removed.

The controller writes the individual CSS properties `translate` and `scale`, and never `transform`. The scale is about the center of the element, so the element must keep the default `transform-origin`.

## What the controllers own, and their limits

The controllers own `translate` and `scale` on the element, and on its children when you give the option `children`. Do not set them from other code while a move runs. One exception is made for `translate`, because a drag writes it:

- When a move starts, the controller reads the inline `translate` of the element, with `getStyle` of the environment. While it moves, it writes that offset plus the pose. When it rests, or is destroyed, it puts the text it read back. So a drag offset does not jump.
- `exit(element, { from: [x, y] })` gives the offset by hand, for an environment that cannot read a style. The pose of `to` is a shift from that offset.
- Only a `translate` in pixels is read. Any other text counts as 0, and it is put back as it was. A `scale` set by other code is replaced, and it is removed at rest.

The inversion is exact only under these conditions:

- No ancestor of the element has a transform (or a `zoom`, a `perspective`, or a filter that makes a containing block) while you take the snapshot and while you play. A box is measured in the viewport, and a transformed ancestor scales it.
- The element has no rotation. The pose has no angle, so a rotated element does not land on its first box.
- The element keeps the default `transform-origin`.
- Call `snapshot()` and `play()` in the same frame, with the change of the page between them. The first box and the speed are read at `snapshot`. If frames run in between, the element has moved on.
- A box of all zeros, which a detached element or an element with `display: none` measures, has no layout. The move is skipped, one line is logged, and the element rests.

## A change in flight

Call `snapshot()` while an element still moves. The first box is where the element is now, with its offset. The speed of each part of the offset goes on. The new spring starts from that position with that speed. A fixed-duration animation would stop and start over. A spring keeps its momentum.

## Take a first box from the caller

`snapshot(first, velocity)` takes the box the element had, in place of a measure. This is how a shared element works. `first` is `{ x, y, width, height }`, in pixels. `velocity` is four numbers in pixels per second: x, y, width, height. Bad input throws a `TypeError`.

## Children and scale distortion

A scale stretches the children of an element. A card that scales to half its width shows its text at half its width too.

The option `children` fixes this. Give it a list of elements, or a function that returns one. The function is called at `play`, after the change. While the parent scales, each child gets the inverse scale, so it keeps its shape.

The package could have animated the size of the element instead of its scale. A size animation does not stretch anything, but the browser must lay out the page on every frame. `docs/baseline.md`, section "G6 build", has the numbers from a real browser. Counter-scale did 0.02 layouts per frame, and a size animation did 1.01, one on every frame. A size animation did more work in every case that was measured. Counter-scale costs more as the children grow in number, so give only the children that need it.

## Shared elements

Two elements with the same key, one leaving and one entering, move as one.

- `leave(key, element)` measures the element that goes, and keeps the box under the key. A key is a text that is not empty, or a finite number. A second leave with the same key replaces the first.
- `enter(key, element)` returns the layout of the element that comes. If the key has a box, the layout starts on that box with the speed of the leaving element, and moves to the place of the new element. A key is used once. If the key has no box, the layout is at rest.
- `cancel(key)` forgets the box of a key.
- `getState()` gives `pending`, the number of keys that wait, `layouts`, `destroyed`, and `failed`.
- `destroy()` stops every layout it tracks and forgets every key.

The leaving element is measured and never written to. Remove it or hide it in the same change. When the leaving element was itself made by `enter` and still moves, its speed goes to the next element, and its layout is released with `release()`: it stops where it is and writes nothing.

- A key that waits expires after `ttl` milliseconds on the clock of the environment (2,000 by default), but only when the shared object is next used. Call `cancel(key)` for a key that will not be entered. A leave that fails, or that measures a box of all zeros, removes the key it was given, so an earlier box never stays. One line is logged for each different failure, and `getState().failed` holds the last error.
- A layout is tracked only while it moves. When it rests, it belongs to you, and you destroy it. `getState().layouts` counts the tracked ones.
- A second `enter` on an element that still moves destroys its layout first, when a key waits. With no key waiting, it returns the layout that moves.

## Presence

An element that is removed from the page stays until its exit is over. `present.exit(element)` springs the element to an exit pose. When all of it is at rest, the element is unmounted and the `exit` listeners are called.

The default pose is `scale: 0`. Give another with `exit(element, { to: { x, y, scale } })`. `x` and `y` are pixels. A scale is 0 or more. A value that is not finite, or a negative scale, throws a `TypeError`. A scale never goes below 0 on screen, even when the spring overshoots.

- The container is the parent the elements leave. The browser environment removes the element from it. A framework gives its own removal with the option `unmount(element)`. It may return `false` when the element was not removed. After a function of your own, the pose is taken off the element, so a node that stays does not keep scale 0.
- An element that is already exiting is left alone, and its first pose stays. `exit` after `destroy` unmounts the element at once.
- A watchdog unmounts an exit that has not rested after 5 seconds, for a tab whose frames stopped. It needs `after` in the environment.
- A failure of a measure, a write, or an unmount fails that element only. It is unmounted at once, one line is logged, and the presence goes on. Presence does not fire `exit` for it. If the unmount itself fails, the element is listed in `getState().leftMounted`, and a later `exit` of it tries again.
- `getState()` gives `exiting`, `destroyed`, `listenerErrors`, `failed` (the first error), and `leftMounted`.
- `on("exit", fn)` calls `fn(element)` after an exit has unmounted the element. It does not fire for a failure, for `destroy`, or when `unmount` returned `false`. It returns the function that removes the listener.
- `destroy()` unmounts every element that is leaving, at once. It calls no listener. It logs only when an unmount fails.

## Reduced motion

Under `prefers-reduced-motion: reduce`, `play` snaps: no offset is written, and the element is on its new box. An exit unmounts at once. The controllers check the setting on every frame too. A reader who turns it on in the middle of a move sees the jump to the end.

## The fixed step

Layouts run on the shared frame scheduler in `/frame`, in whole slices of 1/120 s. A 30, 60, or 144 Hz screen gives the same positions. Pass `scheduler` to run several controllers on one scheduler. They do not change each other's frames. Without it, a controller makes its own scheduler and destroys it with `destroy`. `createShared` passes its scheduler to every layout it makes.

## State and events

`layout.getState()` gives `moving`, `offset` and `velocity` (four numbers each), `scaleX`, `scaleY`, `destroyed`, `listenerErrors`, and `failed`. `on("update", fn)` is called after each write. `on("rest", fn)` is called when the element has reached its place. Both return the function that removes the listener. A listener that throws is logged once for that listener, and the others still run.

`destroy()` stops the motion, puts back the styles it replaced, and ignores every later call. It logs nothing. If a write fails, it tries again at `destroy`. Safe to call twice. `release()` does the same but writes nothing, for an element that is going away.

## Failures and input

A measure or a write that throws counts as a failure. A box from the environment with a number that is not finite, or a size below 0, is a failure too. The controller then logs one line, stops, and sets `getState().failed`. It does not throw into the page. A presence that fails on an element unmounts that element, without an `exit` event. The label of the line is the label of the flavor.

Bad input to a call throws a `TypeError` before anything is measured or written. A number written is cut to 1,000,000,000, rounded to 3 decimals for pixels and 5 for a scale, so no exponent text reaches CSS. A natural size of 0 has no scale.

## The environment

`LayoutEnvironment` has `requestFrame`, `cancelFrame`, `now`, `setStyle(target, property, value | null)`, `measure(target)`, and optional `matchMedia`, `tabHidden`, `onVisibilityChange`, `getStyle(target, property)`, `after(ms, callback)`, and `unmount(container, target)`. `createBrowserLayoutEnvironment()` is the real one. It reads no `window` until a method runs, so a server render touches no `window`. Its `setStyle` throws a `TypeError` for `transform` and for any vendor name of it, such as `-webkit-transform`.

`measure` returns the box as it shows now, in viewport pixels, with any `translate` and `scale` applied. Take the snapshot and the play at the same scroll position. The type `ArmatureEnvironment` in the engine has an optional `measure` with the same shape. The engine itself does not use it.

A test passes a fake that returns scripted boxes, and steps the scheduler by hand with `advance`.

## The flavor part

A flavor adds spring keys and rest limits in pixels. See "The layout part" in `docs/flavors.md`. A flavor without it stays valid. `createLayout`, `createPresence`, `createShared`, and `requireLayout` check the part. `validateFlavor` does not, because the spring-only entry has no room for it. The tech lead decided option A for the layout part on 2026-11-13, for the same reason as G5 (the timeline part).

## Size

See `docs/baseline.md`, section "G6 build". The cap of `/layout` was approved by the tech lead on 2026-11-13.
