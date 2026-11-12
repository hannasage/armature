// The public API of each subpath. scripts/check-exports.mjs checks the build against it, and scripts/check-pack.mjs checks the installed tarball.

/**
 * The public API of each subpath. `values` is the full list of run-time names, and the import must have exactly these:
 * a missing name fails the build, and so does a name that is not on the list, such as a leaked internal.
 * `types` are names that exist only in the declaration files.
 */
export const API = {
  ".": {
    values: [
      "FIXED_STEP", "MAX_FRAME", "REDUCED_MOTION_QUERY", "VELOCITY_MAX", "VELOCITY_REST", "VELOCITY_SMOOTHING_MS",
      "createBrowserEnvironment", "createBrowserScrollEnvironment", "createScrollVelocity", "createSpring", "criticalDamping", "cssVar",
      "dataAttr", "defineFlavor", "guardedSetup", "isAtRest", "logTag", "personalityOf", "prefersReducedMotion", "readPreferences", "reconfigure",
      "requireFollower", "requireLens", "requireReveal", "requireSurface", "retarget", "springOf", "stepSpring", "validateFlavor"
    ],
    types: [
      "Flavor", "SurfaceFlavor", "LensFlavor", "RevealFlavor", "FollowerSpec", "FollowerFlavor", "RestLimits", "PersonalitySpec", "RevealStart", "StartContext", "StartInput", "FeelOptions",
      "SpringConfig", "SpringState", "ArmatureEnvironment", "ArmatureTarget", "ArmatureScrollEnvironment", "Preferences",
    ],
    generic: true,
  },
  "./frame": {
    values: ["createScheduler"],
    types: ["FrameEnvironment", "FrameTask", "Scheduler"],
    generic: true,
  },
  "./values": {
    values: [
      "colorKind", "createValue", "createVectorSpring", "isVectorAtRest", "numberKind", "pathKind", "reconfigureVector", "retargetVector",
      "stepVectorSpring", "transform3dKind", "transform3dStyles", "vectorKind"
    ],
    types: ["Kind", "Transform3D", "Transform3DStyles", "Value", "ValueMove", "ValueOptions", "ValueState", "VectorSpringState"],
    generic: true,
  },
  "./curves": {
    values: ["bezier", "createTween", "createTweenValue", "easing", "easings", "fitBezier", "isTweenDone", "retargetTween", "stepTween"],
    types: [
      "BezierFit", "BezierPoints", "Curve", "Easing", "EasingName", "TweenMove", "TweenState", "TweenValue", "TweenValueOptions", "TweenValueState"
    ],
    generic: true,
  },
  "./linear": {
    values: ["fitLinear", "supportsLinear", "toEasing", "toLinear"],
    types: ["EasingOptions", "EasingResult", "LinearFit", "LinearOptions", "SupportsProbe"],
    generic: true,
  },
  "./dom": {
    values: [
      "REST_POSE", "attachSurface", "belowFold", "createFollower", "createLens", "createScrollReveal", "createSurface", "dragAttributes", "dragTarget",
      "installDelegation", "mountScrollReveal", "parseDelay", "parseDepth", "parsePersonality", "revealAttributes",
      "revealGroupAttributes", "revealLineAttributes", "revealPose", "revealRootMargin", "revealSpring", "revealStart",
      "scrollDirection", "staggerDelayFor", "startScrollReveal", "velocityBlend"
    ],
    types: ["SurfaceOptions", "LensOptions", "FollowerOptions", "FollowerState", "FollowerMove", "Follower", "DelegateOptions", "ScrollRevealOptions", "ScrollRevealController", "MountScrollRevealOptions", "ArmatureRevealAttributes"],
    generic: true,
  },
  "./react": {
    values: [
      "ArmatureProvider", "ArmatureRevealProvider", "useArmatureFollower", "useArmatureLens", "useArmatureReveal", "useArmatureSurface"
    ],
    types: ["ArmatureProviderProps", "ArmatureRevealProviderProps", "FollowerHandle", "FollowerMove", "LensHandle", "UseArmatureRevealOptions"],
    generic: true,
  },
  "./glass": {
    values: [
      "DEPTH_ATTRIBUTE", "DEPTH_DEFAULT", "DEPTH_MAX", "DEPTH_MIN", "DRAG_ATTRIBUTE", "DRAG_FULL_VELOCITY", "DRAG_ROTATE_MAX",
      "DRAG_SHIFT_MAX", "DROP_SCALE", "FADE_RISE", "FAST_VELOCITY", "FEELS", "FEEL_ATTRIBUTE", "FOLD_PERCENT", "GROUP_ATTRIBUTE",
      "LINE_ATTRIBUTE", "LQG_LINE", "LQG_PREFIX", "LQG_REVEAL_GROUP", "MASK_HEIGHT_FALLBACK", "MASK_HEIGHT_MAX", "MASK_RISE_FAST",
      "MASK_RISE_SLOW", "OFFSET_FAST", "OFFSET_SLOW", "REFRACTION_ATTRIBUTE", "REVEALED_ATTRIBUTE", "REVEAL_ATTRIBUTE",
      "REVEAL_DELAY_ATTRIBUTE", "REVEAL_DELAY_PROPERTY", "REVEAL_GROUP_ATTRIBUTE", "REVEAL_MAX_DELAY_MS", "REVEAL_MAX_STEPS",
      "REVEAL_PERSONALITIES", "REVEAL_STAGGER_MS", "ROOT_MARGIN", "SAFETY_MS", "SHIFT_REFERENCE", "SIDE_ATTRIBUTE", "SLIDE_FAST",
      "SLIDE_RISE_FAST", "SLIDE_RISE_SLOW", "SLIDE_SLOW", "SLOW_VELOCITY", "SURFACE_ATTRIBUTE", "TILT_ATTRIBUTE", "TILT_FAST",
      "TILT_LIMIT", "TILT_SLOW", "adler32", "applyFilterScale", "browserDetectionEnvironment", "computeDisplacementMap",
      "computeSpecularMap", "crc32", "createGlassFilter", "detectRefraction", "dragSpring", "encodePng", "gentle", "glassFlavor",
      "lensWidth", "lensX", "lqgDrag", "lqgReveal", "pngDataUri", "press", "release", "revealCalm", "revealFast", "revealSlow",
      "staggerDelay", "stiff", "toBase64", "updateGlassFilter"
    ],
    types: ["GlassFlavor", "RevealPersonality", "GlassSpringKey", "GlassFilter", "DetectionEnvironment"],
  },
  "./glass/react": {
    values: [
      "LqgFilter", "LqgProvider", "LqgRevealProvider", "MODE_ATTRIBUTE", "useLqgLens", "useLqgReveal", "useLqgSurface"
    ],
    types: ["LqgProviderProps", "LqgRevealProviderProps", "LensHandle", "UseLqgRevealOptions"],
  },
};
