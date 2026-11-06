# Projection flavor

This folder holds the second Armature flavor. It is the Projection UI flavor with the Mechanical movement language.
It exists to test whether the engine is free of glass assumptions.
In Milestone 3 it moves into the Projection UI repository.

## Rules

The file `flavor.ts` imports only from `@hannasage/armature`, `@hannasage/armature/dom`, and `@hannasage/armature/react`.
It never imports a deep path or a relative path into Armature.
A test in `tests/boundary/examples.test.ts` enforces this for every file under `examples/`.
In this repository, `tsconfig.json` and `vitest.config.ts` map those three names to the source entries.

## The prefix is `pui`

Every variable, attribute, and class this flavor writes starts with `pui`.
For example, a thumb follower writes `--pui-thumb`, and a surface carries `data-pui`.

Projection UI names its own tokens with `--ui-*` and its theme attribute with `data-ui-theme`.
The prefix `pui` was chosen so that it cannot collide with those names.
A search of the Projection UI source, tests, docs, scripts, design package, and stories found no `--pui-` and no `data-pui`.

## Springs

- `mechanical`: stiffness 600, damping 30, mass 1. It overshoots a little. It drives press, release, the thumbs, and the toast enter.
- `settle`: stiffness 600, critical damping, mass 1. It never overshoots. It drives exits and the modal dialog.

The numbers and the measured overshoot and settle times are in `docs/projection-flavor.md`.

## Parts

- `surface`: the Button press and release. Only the press scale is used. The flex, the neighbor share, and the hover glow are 0. The engine cannot switch the specular glint or the glow off, so it still writes `--pui-glow`, and it writes `--pui-spec-x` and `--pui-spec-y` when the pointer moves. The Projection stylesheet never reads them.
- `follower`: four named followers.
  - `thumb`: the Toggle thumb and the Slider thumb, on `mechanical`.
  - `enter`: the Toast and the Modal backdrop coming in, on `mechanical`.
  - `exit`: anything leaving, on `settle`.
  - `dialog`: the Modal dialog, in and out, on `settle`. This follower was added because the dialog uses `settle` for both directions, and `enter` uses `mechanical`.
- No `lens` part and no `reveal` part. Projection UI has neither a travelling indicator nor a scroll reveal.

## Values to confirm

The Button press scale is 0.96. This number was not set by the brief. Hanna can change it in `flavor.ts`.
