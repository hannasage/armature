# The Projection flavor: springs and measured motion

The Projection flavor is the second Armature flavor. It lives in `examples/projection/flavor.ts`.
It carries the Mechanical movement language for Projection UI.
This page shows the math of its two springs and what the solver measures.

The component work happens in Milestone 3. Until then, no Projection UI component uses these springs.

## The equation

Every Armature spring obeys one equation:

```
m x'' + c x' + k x = 0
```

- `x` is the distance from the target.
- `m` is the mass.
- `c` is the damping.
- `k` is the stiffness.
- `x'` is the velocity and `x''` is the acceleration.

The solver steps this equation in fixed slices of 1/120 s with semi-implicit Euler.
It updates the velocity first, and then the position with the new velocity.

## Natural frequency and damping ratio

The natural frequency is how fast the spring swings when it has no damping:

```
ω0 = sqrt(k / m)
```

For both Projection springs, `k` is 600 and `m` is 1, so `ω0` is 24.5 radians per second. That is 3.9 swings per second.

The damping ratio compares the damping to the damping that returns fastest without overshoot:

```
ζ = c / (2 sqrt(k m))
```

- Below 1 the spring is underdamped. It overshoots the target and rings.
- At 1 the spring is critically damped. It returns fastest and never overshoots.
- Above 1 the spring is overdamped. It creeps back with no overshoot.

The function `criticalDamping(k, m)` in the engine returns `2 sqrt(k m)`.

## The two springs

### mechanical

- Constants: stiffness 600, damping 30, mass 1.
- Damping ratio 0.612. It is underdamped.
- Closed-form overshoot: 8.8 percent.
- Measured overshoot: 6.5 percent.
- Measured settle time: 224 ms.
- Closed-form settle time: 244 ms.

### settle

- Constants: stiffness 600, damping 2 sqrt(600), mass 1. The damping is 49.0.
- Damping ratio 1.000. It is critically damped.
- Closed-form overshoot: 0.0 percent.
- Measured overshoot: 0.0 percent.
- Measured settle time: 256 ms.
- Closed-form settle time: 238 ms.

## How the numbers were measured

The test helper `tests/helpers/measure-spring.ts` steps each spring from 0 to 1 with the real solver.
It uses whole slices of 1/120 s and rest limits so small that the solver never snaps to rest early.

- The overshoot is the largest value minus 1.
- The settle time is the time after which the value stays inside 2 percent of the target.
  The helper finds it by linear interpolation between the two slices where the curve enters the band.
- The closed-form numbers come from the exact solution of the equation, scanned every 10 microseconds.

A test in `tests/examples/projection-springs.test.ts` checks that this page holds the numbers the helper measures.
If the solver or a spring changes, that test fails until this page is updated.

## The solver changes the feel a little

The measured overshoot for `mechanical` is 6.5 percent, and the exact answer is 8.8 percent.
The cause is the solver, not the spring.

Each 1/120 s slice multiplies the velocity by `1 - c h / m`, which is 0.75 for `mechanical`.
The exact decay over one slice is `exp(-c h / m)`, which is 0.78.
The solver therefore removes slightly more energy than the exact spring removes. The swing is smaller, and the spring settles sooner than the exact curve.
For `settle`, the same extra damping makes the return a little slower than the exact curve.

This is a property of the Armature solver, and every flavor shares it.
Choose a spring from the measured numbers on this page, not from the formula alone.

## Which Projection UI component uses which spring

- Button press and release: the `surface` part with press scale 0.96. Spring: `mechanical`.
- Toggle thumb: the `thumb` follower. Spring: `mechanical`.
- Slider thumb: the `thumb` follower. Spring: `mechanical`.
- Toast enter: the `enter` follower. Spring: `mechanical`.
- Modal backdrop enter: the `enter` follower. Spring: `mechanical`.
- Any exit, such as a Toast leaving: the `exit` follower. Spring: `settle`.
- Modal dialog, in and out: the `dialog` follower. Spring: `settle`.

An opacity cannot go above 1. A stylesheet that uses an `enter` value for opacity clamps it.

The Skeleton and the spinner are constant loops and use no spring.
