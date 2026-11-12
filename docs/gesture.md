# Gesture

`@hannasage/armature/gesture` moves an element with a pointer. The element follows the pointer, stretches against its bounds, keeps its speed on release, and settles.

```ts
import { createDrag } from "@hannasage/armature/gesture";

const drag = createDrag(card, { flavor, axis: "x", bounds: [0, 300], snap: [0, 150, 300] });
drag.onSwipe((direction) => console.log(direction)); // "left", "right", "up", or "down"
drag.destroy();
```

The flavor needs a `gesture` part. See "The gesture part" in `docs/flavors.md`. The entry has no flavor of its own.

## What it writes

A drag writes two properties on the element: `translate` and `touch-action`. It never writes `transform`. While the drag lives, it owns `translate`. `translate` holds the position as `<x>px <y>px`, measured from where the element sits with no `translate`. A drag on one axis writes 0 for the other. `touch-action` tells the browser which pan to leave alone: `pan-y` for an x drag, `pan-x` for a y drag, and `none` for both. `destroy` gives `touch-action` back as it was before the drag: the value the author had set, or none. A position is never written larger than 1,000,000,000 px, so no number is written as exponent text.

A drag writes nothing to `translate` until the pointer moves.

## Options

- `flavor` is required.
- `axis` is `"x"`, `"y"`, or `"both"`. The default is `"both"`.
- `bounds` is a pair `[min, max]` for one axis. For `"both"` it is an object `{ x?, y? }` of such pairs. The default is no bounds.
- `snap` is a list of positions for one axis. For `"both"` it is a list of `[x, y]` points. An empty list means no snap.
- `env` is the environment. The default is the real browser. A test passes a fake.

A snap point must lie inside the bounds of the axes that have bounds, or the drag throws. The drag copies the snap points, so a later change of the caller's list does nothing. A bad option throws a `TypeError` before the drag writes anything or adds a listener.

## The rubber band

Past a bound, the pointer pulls the element on a band. The element shows an overshoot of `d / (1 + d / reach)` for a pointer overshoot of d. The rule is exact: the shown overshoot stays below `reach` in every case. This holds under the pointer, in a decay that meets a bound, and on a spring, even at the speed ceiling of 12,000 px per second. The code keeps it at 0.999 times `reach` at most, so a press can take hold of an element at that distance with no jump.

On release, a band spring pulls the element back to the bound. Its stiffness is `stiffness * (1 + d / reach)`, so it is stiffer the farther the element is. The band steps in whole slices of 1/120 s and takes its stiffness again at each slice, so a 30, 60, or 144 Hz screen returns at the same pace. The spring is critically damped, so it does not oscillate. The speed of the release is scaled by the slope of the band, so a hard flick outward does not shoot far past the reach.

## What a release does

Each case below applies in this order.

1. Snap points. The element springs to the nearest snap point to where it is at the release. The release position decides, and the velocity does not: the code does not project the flick forward. The release velocity goes into the spring, so a flick keeps its speed. The spring is the flavor spring named by `springKeys.snap`.
2. Out of the bounds, with no snap points. The band spring takes the element back to the bound.
3. Inside the bounds, with no snap points. The element keeps its velocity and slows by friction, `v' = -c v`. The decay steps in the engine's fixed slices of 1/120 s. It stops when its speed is below `rest.restSpeed`, and the speed is then exactly 0. A decay that crosses a bound is caught by the band spring on that step.
4. A release slower than `rest.restSpeed` stays where it is. It asks for no frame.

A snap spring and a band spring rest on their target exactly.

## Swipe

A release fires a swipe when the pointer speed on an axis is at least `swipe.velocity` and the pointer travelled at least `swipe.distance` on that axis. Both come from the flavor. On two axes, the axis with the greater speed picks the direction. A swipe fires after the release starts its motion, and it fires under reduced motion too.

A listener that throws is logged once for that listener, and the other listeners still run.

## Reduced motion

Under `prefers-reduced-motion: reduce`, a release has no inertia. The element goes straight to its end point: the nearest snap point, else the nearest point inside the bounds, else where it is. No frame runs. The drag checks the setting on every frame too. When the reader turns it on in the middle of a flight, the element jumps to its end point and stops.

## A cancelled pointer

A cancelled pointer ends the drag with no swipe and no velocity. The element settles as a release at rest would: it goes to the nearest snap point, or back to the bound, or stays where it is.

A new press during a flight stops the motion. The drag carries on from where the element is.

The browser environment treats a lost pointer capture as a cancel, because the release will not arrive. It ignores a press of a pointer that is not the primary one, such as a second finger. A press of another primary pointer while one is held means the end of the first press never arrived, so the new press takes over from where the element is. If the pointer cannot be captured, the environment tells the drag, and the drag logs one warning with the label of the flavor.

## Destroy

`destroy` stops the frame, removes the listeners, and ignores every later call. It logs nothing. The element stays where it is. An element out of the bounds goes to the bound, so a stretched band is not left behind. Safe to call twice.

If the environment throws while the drag writes, the drag logs one line that starts with the flavor's label and stops. It removes its listeners and gives `touch-action` back, each as its own step. `getState().failed` holds the error, so a caller can tell this stop from its own `destroy`. After a destroy of its own, `failed` is not set.

## The pointer environment

A React hook for the drag comes at G7. Until then, call `createDrag` in an effect and call `destroy` in its cleanup.

The drag reads the browser only through `ArmaturePointerEnvironment`. It is the pointer twin of the scroll environment: `requestFrame`, `cancelFrame`, `now`, `matchMedia`, `setStyle`, `getStyle` (optional), and `onPointer`. A pointer sample is `{ id, x, y, time }`, with `time` in milliseconds on the engine clock.

`createBrowserPointerEnvironment()` is the real one. It reads no `window` until a method runs, so it is safe to import on a server. A press captures its pointer, so the move and the release reach the element when the pointer leaves it. It ignores a press of a mouse button other than the main one.

A test passes a fake environment and calls the handlers itself. The tests of this package do so with a manual clock and a manual frame queue. No test needs a browser. The pinned frames in the tests are regression pins: they are the numbers the code gave when it was written, and only the first frame of each run was checked by hand.

## The pointer velocity tracker

`createPointerVelocity()` smooths the pointer speed on two axes, in pixels per second, with the same time constant as the scroll velocity tracker: 70 ms, and a ceiling of 12,000 px per second. It has `add(x, y, time)`, `read(time)`, and `reset()`.

- The first speed it reads is taken as it is. A short flick reads its real speed.
- A read later than the last sample is the speed times `exp(-idle / 70 ms)`, so a pointer that held still before the release reads close to 0.
- Two samples less than 4 ms apart count as one.
- A sample that is not finite, or that goes back in time, is ignored.

## Size

The entry measured 5,158 gzipped bytes at G4. The amendment proposed 3.0 KB. Two engine files are part of it: the flavor check, about 1.8 KB, because `requireGesture` calls `validateFlavor`, and the spring solver, about 0.7 KB. The gesture files are about 2.6 KB. The cap in `size-budget.json` is a proposal. See `docs/baseline.md`, section "G4 build".

The drag is not exported from `/dom`. The size of `/dom` would pass its cap.
