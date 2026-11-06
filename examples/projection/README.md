# Projection flavor

This folder holds the second Armature flavor. It is the Projection UI flavor with the Mechanical movement language.

## The prefix is `pui`

Every variable, attribute, and class this flavor writes starts with `pui`.
For example, a thumb follower writes `--pui-thumb`, and a surface carries `data-pui`.

Projection UI names its own tokens with `--ui-*` and its theme attribute with `data-ui-theme`.
The prefix `pui` was chosen so that it cannot collide with those names.
A search of the Projection UI source, tests, docs, scripts, design package, and stories found no `--pui-` and no `data-pui`.
