# The Projection flavor: springs and measured motion

The Projection flavor lives in `examples/projection/flavor.ts`. It has two springs.

## Measured results

The numbers below come from `tests/helpers/measure-spring.ts`. It steps each spring from 0 to 1 with the real solver, in whole fixed slices of 1/120 s.
The settle time is the time after which the value stays inside 2 percent of the target.
It is found by linear interpolation between two slices, so it is not rounded to a slice.

- `mechanical` (stiffness 600, damping 30, mass 1): damping ratio 0.612, overshoot 6.5 percent, settle time 224 ms.
- `settle` (stiffness 600, damping 2 sqrt(600), mass 1): damping ratio 1, overshoot 0.0 percent, settle time 256 ms.
