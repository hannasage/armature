# Timeline

`@hannasage/armature/timeline` runs keyframes in order. A timeline holds tracks. A track animates one value. You can play, pause, reverse, seek, and scrub it.

```ts
import { createBrowserTimelineEnvironment, createTimeline } from "@hannasage/armature/timeline";
import { easing } from "@hannasage/armature/curves";

const env = createBrowserTimelineEnvironment();
const tl = createTimeline(env, {
  tracks: [{ target: card, value: "opacity", keys: [[0, 0], [300, 1, easing("ease-out")], [800, 0.4, { stiffness: 170, damping: 26 }]] }],
});
tl.play();
tl.seek(250);
tl.reverse();
tl.destroy();
```

A timeline is time-driven, not force-driven. The value of a track at a time depends on that time and nothing else. A spring or a decay step is run through at build, slice by slice, so it follows the same rule.

## Tracks

A track has these fields.

- `target` is what the environment writes to. In the browser it is an element.
- `value` is the individual CSS property to write: `opacity`, `translate`, `scale`, `rotate`, or a custom property such as `--glow`. A timeline never writes `transform`, and `transform` throws a `TypeError`.
- `keys` is a list of keys. Or use `sequence`, the name of a sequence in the flavor. Give one of the two, not both.
- `offset` is milliseconds added to every key time of the track. The default is 0.
- `unit` is text written after the number, such as `"px"`.
- `format` is a function from the value to the text to write. It replaces the number and the unit. It gets the value cut to 1,000,000,000 at most.

A track writes one number. For a property with two numbers, such as `translate`, use `format`.

## Keys

A key is `[time, value, step?]`. The time is in milliseconds. Times are finite, 0 or more, and never go back. The track holds the first value before the first key and the last value after the last key.

A key describes the segment that ends at it. The step says how the track gets there.

- No step, or a curve: a tween. It runs from the previous key to this key and ends on this key at this time. A curve is any function from progress to a number, such as `easing("ease-out")` from `/curves`. With a flavor, a key with no step takes the default curve of the flavor.
- A spring, such as `{ stiffness: 170, damping: 26 }`: the spring starts at the time of the previous key. It starts from where the track is, with the speed the track has, and aims at the value. This is a retarget at a time. A key after it cuts the spring at that key's time. The next step then takes over with the position and the speed of the spring. As the last key, the spring runs until it rests, and the timeline lasts that long. A spring that has not rested after 10 seconds stops there.
- A decay, `{ decay: { velocity, friction, rest: { restSpeed } } }`: the value slot holds `null`, because the decay decides where it stops. The track keeps its speed and slows by friction, `v' = -c v`, until its speed is under `restSpeed`. This is the decay of `/gesture`. Without `velocity` the decay takes the speed of the step before it.
- A name: with a flavor, the name of a curve in its `timeline` part or of a spring in its `springs`.

Two keys at one time make a jump.

## Place the tracks

- `place: "together"` is the default. Track i starts at `i * stagger` milliseconds, plus its own `offset`.
- `place: "sequence"`: a track starts at the end of the one before it. `stagger` adds a gap, and so does its own `offset`. The end of a track counts the time a spring needs to rest.

Give a list of tracks and a `stagger` to stagger a list of elements.

## Control

- `play()` writes the pose, then plays in the current direction. At the end of its travel it starts again from the other end.
- `pause()` stops the frame and keeps the time.
- `reverse()` turns the direction round and plays. At the end of the new direction it only completes.
- `seek(ms)` moves to a time, cut to the length of the timeline, and writes the pose. A timeline that plays keeps playing. A time that is not finite is ignored.
- `scrub(progress)` pauses and moves to a share of the length, from 0 to 1.
- `on("update", fn)` calls `fn(time)` after each write. `on("complete", fn)` fires at the end of the travel of a play. Both return the function that removes the listener. A listener that throws is logged once for that listener, and the others still run.
- `getState()` gives `time`, `duration`, `playing`, `reversed`, `destroyed`, `values` (one per track), and `failed`.
- `destroy()` stops the frame and ignores every later call. The values stay where they are, and it logs nothing. Safe to call twice.

A new timeline writes nothing. It writes at `play`, `seek`, and `scrub`, and on each frame.

## The fixed step

The timeline runs on the shared frame scheduler in `/frame`, in whole slices of 1/120 s. A 30, 60, or 144 Hz screen gives the same values. Pass `scheduler` to run several timelines on one scheduler. They do not change each other's frames. Without it, a timeline makes its own scheduler and destroys it with `destroy`.

Seek to a time gives the value that playing to it gives, to within one slice. A reverse gives back the values of the forward run, slice by slice.

## Reduced motion

Under `prefers-reduced-motion: reduce`, `play` and `reverse` go straight to the end of the direction, write it, and complete. No frame runs. The timeline checks the setting on every frame too. A reader who turns it on in the middle of a play sees the jump to the end. `seek` and `scrub` stay, because the reader asked for them.

## Failures and input

Three things count as a failure: a write that throws, a format function that throws, and a curve that returns a number that is not finite. The timeline then logs one line, stops, and sets `getState().failed`. It does not throw into the page. The label of the line is the label of the flavor, or `[armature]`.

Bad input throws a `TypeError` before anything is written. These are bad: a time or a value that is not finite, keys that go back in time, a name with no flavor, an offset or stagger below 0, and a property that is not a name. A written number is cut to 1,000,000,000 and rounded to 4 decimals, so no exponent text reaches CSS.

## The environment

`TimelineEnvironment` has `requestFrame`, `cancelFrame`, `now`, `setStyle(target, property, value | null)`, and optional `matchMedia`, `tabHidden`, and `onVisibilityChange`. `createBrowserTimelineEnvironment()` is the real one. It reads no `window` until a method runs. A test passes a fake and steps the scheduler by hand with `advance`.

## The flavor part

A flavor can add named curves, a default curve, and named sequences. See "The timeline part" in `docs/flavors.md`. A flavor without it stays valid.

## Size

See `docs/baseline.md`, section "G5 build". The cap of `/timeline` there is a proposal. The maintainer has not approved it.
