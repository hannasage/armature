# Tide flavor

This folder holds the third Armature flavor. Tide is the motion of a bottom sheet.
It exists to test the parts that amendment 1 added to the flavor contract: a follower, a gesture, a timeline, and a layout part.
It is not a copy of glass or Projection. It has its own prefix, its own springs, and none of their parts.

## Files

- `flavor.ts` is the flavor.
- `sheet.ts` is a bottom sheet that uses it, with a follower, a drag, a timeline, and the layout controllers.

## Rules

The files import only the public Armature entries, and `sheet.ts` imports `./flavor`.
A test in `tests/boundary/examples.test.ts` enforces this for every file under `examples/`.
`tests/examples/tide.test.ts` runs the flavor through every controller on fake environments.

## The prefix is `tide`

Every variable the flavor writes starts with `--tide-`. The dim of the page behind the sheet is `--tide-dim`.

## The guide

`docs/flavor-authoring.md` builds this flavor step by step. It shows the springs with the numbers the solver measures, and a figure of each spring.
