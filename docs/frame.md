# Frame scheduler

`@hannasage/armature/frame` holds the shared frame scheduler. One frame loop serves every task on it. A task is a spring, a tween, a timeline, or a layout. The scheduler steps every task in the same fixed slices. So a 30, 60, or 144 Hz screen gives the same slices.

`createValue` from `/values` and `createTweenValue` from `/curves` take a scheduler as their first argument. A timeline and the layout controllers take one with the option `scheduler`. Without it, each of those makes its own.

## Make a scheduler

`createScheduler(env)` makes one. The environment gives it the frame loop and the clock. In the browser, the scroll environment of the engine fits, and it also lets the scheduler pause while the tab is hidden:

```ts
import { createBrowserScrollEnvironment } from "@hannasage/armature";
import { createScheduler } from "@hannasage/armature/frame";
import { colorKind, createValue } from "@hannasage/armature/values";

const scheduler = createScheduler(createBrowserScrollEnvironment());
const fill = createValue(scheduler, colorKind, "#336699", { spring: { stiffness: 170, damping: 26 } });
```

`createBrowserScrollEnvironment` reads `window` at once. So make it in the browser only, for example in an effect. On the server, make no scheduler.

Make one scheduler for a page, and pass it to every controller. Then one frame loop runs, however many things move.

## The environment

`FrameEnvironment` has three methods and an optional pair:

- `requestFrame(callback)` asks for the next frame. The callback gets the frame time in milliseconds.
- `cancelFrame(id)` cancels a frame that was asked for.
- `now()` gives the time in milliseconds, on the same clock as the frame time.
- `tabHidden()` and `onVisibilityChange(listener)` are optional. Give both or neither. One without the other throws a `TypeError`. Without the pair, the scheduler never pauses.

## Tasks

A task has `step(dt)` and an optional `frame()`.

- `step(dt)` runs once per slice. `dt` is always the length of a slice in seconds. If `step` returns `false`, the task leaves the scheduler after that slice.
- `frame()` runs once per frame, after the slices, for each task that was waiting at the start of the frame. A task writes to the page here, once per frame and not once per slice.

`add(task)` adds a task and returns the function that removes the task. If the frame loop is idle, `add` starts it. A task added twice is added once. With no task left, the loop stops.

If a task throws, the scheduler logs one line and removes that task. The other tasks go on.

## The fixed step

Every slice is 1/120 s long. The time of each frame is added to a carry, and the scheduler runs as many whole slices as the carry holds. The rest waits for the next frame. So the number of slices depends on the time that passed, and not on the number of frames.

A frame time is clamped to 0.1 s. A frame of 250 ms, for example after the browser was busy, runs 12 slices, and the rest of the time is dropped. A long stall then does not throw a spring across the screen.

## Hidden tab

While the tab is hidden, the scheduler asks for no frame. When the tab shows again, the clock starts from that moment, so the hidden time does not count. The tasks go on from where they were.

## Tests

`advance(seconds)` runs time by hand, with the same code as a frame, so a Node test pins every slice with no browser. It clamps to 0.1 s as a frame does. A time of 0, below 0, or not finite does nothing. A call of `advance` from inside a task is ignored and logged once, because the outer run is still going.

```ts
import { createScheduler } from "@hannasage/armature/frame";

const scheduler = createScheduler({ requestFrame: () => 0, cancelFrame: () => undefined, now: () => 0 });
scheduler.add({ step: () => undefined });
scheduler.advance(1 / 60); // two slices
```

`size` is the number of tasks waiting. `destroy()` cancels the frame, drops every task, and ignores every later call. It is safe to call twice.

## Size

The size of `/frame` and its cap are in `docs/baseline.md`, section "G8 build".
