/**
 * The reader's accessibility settings, read through `matchMedia`. It needs no flavor and no DOM.
 */

export interface Preferences {
  reducedMotion: boolean;
  reducedTransparency: boolean;
  forcedColors: boolean;
}

/** The one part of the browser this module asks. Any object with a `matchMedia` fits, and so does an empty one. */
export interface PreferencesEnvironment {
  matchMedia?: (query: string) => { matches: boolean };
}

function matches(env: PreferencesEnvironment, query: string): boolean {
  try {
    return env.matchMedia?.(query)?.matches === true;
  } catch {
    return false;
  }
}

/**
 * The reader's accessibility settings. Safari has no `prefers-reduced-transparency`, so
 * `reducedTransparency` is always false there; nothing can detect it.
 */
export function readPreferences(env: PreferencesEnvironment): Preferences {
  return {
    reducedMotion: matches(env, "(prefers-reduced-motion: reduce)"),
    reducedTransparency: matches(env, "(prefers-reduced-transparency: reduce)"),
    forcedColors: matches(env, "(forced-colors: active)"),
  };
}

