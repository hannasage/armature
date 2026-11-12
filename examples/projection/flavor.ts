/**
 * The Projection UI flavor, with the Mechanical movement language.
 *
 * This file imports only from the public Armature entries. It stands in for a flavor that lives in the Projection UI
 * repository, so it must not reach into Armature's source or build folders.
 *
 * The prefix is `pui`. Projection UI names its own tokens `--ui-*` and its theme attribute `data-ui-theme`, so the two
 * sets of names cannot meet.
 */
import { criticalDamping, defineFlavor, type Flavor, type FollowerFlavor, type SurfaceFlavor } from "@hannasage/armature";

// ---- springs ----

/** Press, release, thumb, toast enter, and slider thumb. Underdamped (ratio about 0.57), so the solver measures an overshoot of about 9 percent. */
const mechanical = Object.freeze({ stiffness: 600, damping: 28, mass: 1 });
/** Exits and the modal dialog. Critically damped, so nothing bounces on the way out. */
const settle = Object.freeze({ stiffness: 600, damping: criticalDamping(600, 1), mass: 1 });

// ---- surface ----

/**
 * The Button press and release. Only the press scale is used.
 *
 * The specular glint and the glow are switched off with `specular: false` and `glow: false`. The surface then writes only
 * `--pui-press` and `--pui-flex`, and a hover asks for no frame. The flex default is 0, so the surface does not squash.
 * The names and the numbers for the glint and the glow stay in the part because the contract still requires them. They are never used.
 */
const surface: SurfaceFlavor = {
  specular: false,
  glow: false,
  vars: { press: "press", flex: "flex", specX: "spec-x", specY: "spec-y", glow: "glow" },
  attributes: { surface: "", group: "group", feel: "feel" },
  springKeys: { press: "mechanical", release: "mechanical" },
  rest: { restDelta: 0.0005, restSpeed: 0.01 },
  defaults: { pressScale: 0.96, flex: 0, glowFalloff: 160, neighborShare: 0, specularRest: { x: 50, y: 50 } },
  specularTauMs: 90,
  glowTauMs: 140,
  hoverGlow: 0,
  feels: {},
};

// ---- followers ----

/** A fraction from 0 to 1 needs to look still, not to be exact. */
const rest = { restDelta: 0.001, restSpeed: 0.01 } as const;

/**
 * `thumb`: the Toggle thumb and the Slider thumb.
 * `enter`: the Toast and the Modal backdrop coming in.
 * `exit`: anything leaving.
 * `dialog`: the Modal dialog, in and out.
 */
const followers: FollowerFlavor = {
  thumb: { var: "thumb", springKey: "mechanical", rest },
  enter: { var: "enter", springKey: "mechanical", rest },
  exit: { var: "exit", springKey: "settle", rest },
  dialog: { var: "dialog", springKey: "settle", rest },
};

/** There is no lens part and no reveal part. Projection UI has neither a travelling indicator nor a scroll reveal. */
export const projection = defineFlavor<Flavor & { surface: SurfaceFlavor; followers: FollowerFlavor }>({
  name: "projection",
  prefix: "pui",
  logLabel: "projection-ui",
  springs: { mechanical, settle },
  surface,
  followers,
});
