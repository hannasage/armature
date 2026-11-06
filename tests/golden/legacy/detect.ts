/**
 * What the browser can do, read without asking CSS.
 *
 * Refraction needs `backdrop-filter: url(#filter)`. Only Chromium draws it. Safari answers "supported" to
 * `@supports (backdrop-filter: url(#x))` and then draws nothing (WebKit bug 245510), so this module never
 * uses `@supports`. It reads the browser brand instead, and says "no" when it is not sure.
 */

export interface DetectionEnvironment {
  navigator?: {
    userAgent?: string;
    userAgentData?: { brands?: ReadonlyArray<{ brand: string; version?: string }> };
  };
  /** The document root. Its `data-lqg-refraction="on|off"` attribute overrides detection. */
  root?: { getAttribute(name: string): string | null } | null;
  matchMedia?: (query: string) => { matches: boolean };
}

export type RefractionSetting = boolean | "on" | "off" | "auto";

export interface DetectionOptions {
  /** An explicit choice. It beats the attribute and the browser. `"auto"` or `undefined` means detect. */
  refraction?: RefractionSetting;
}

export interface Preferences {
  reducedMotion: boolean;
  reducedTransparency: boolean;
  forcedColors: boolean;
}

/** The attribute on the root that forces refraction on or off. */
export const REFRACTION_ATTRIBUTE = "data-lqg-refraction";

const CHROMIUM_BRANDS = new Set(["chromium", "google chrome", "microsoft edge"]);
// Chrome, Firefox, and Edge on iOS all run WebKit. Their agents say CriOS, FxiOS, and EdgiOS. Old Edge says Edge/.
const WEBKIT_IMPOSTORS = /\b(?:CriOS|FxiOS|EdgiOS|OPiOS|Firefox)\b|\bEdge\/\d/;
const CHROMIUM_AGENT = /\b(?:Chrome|Chromium)\/\d/;

function fromSetting(setting: RefractionSetting | undefined): boolean | null {
  if (setting === true || setting === "on") return true;
  if (setting === false || setting === "off") return false;
  return null;
}

function fromBrowser(navigator: DetectionEnvironment["navigator"]): boolean {
  if (!navigator) return false;
  const brands = navigator.userAgentData?.brands;
  if (Array.isArray(brands) && brands.length > 0) {
    return brands.some((entry) => typeof entry?.brand === "string" && CHROMIUM_BRANDS.has(entry.brand.toLowerCase()));
  }
  const agent = navigator.userAgent;
  if (typeof agent !== "string" || agent === "") return false;
  return CHROMIUM_AGENT.test(agent) && !WEBKIT_IMPOSTORS.test(agent);
}

/**
 * True when this browser draws `backdrop-filter: url(#svg-filter)`. Order: the `refraction` option, then the
 * root attribute, then the browser brand. False when unsure.
 */
export function detectRefraction(env: DetectionEnvironment, options: DetectionOptions = {}): boolean {
  const explicit = fromSetting(options.refraction);
  if (explicit !== null) return explicit;
  let attribute: string | null = null;
  try {
    attribute = env.root?.getAttribute(REFRACTION_ATTRIBUTE) ?? null;
  } catch {
    attribute = null;
  }
  if (attribute === "on" || attribute === "off") return attribute === "on";
  return fromBrowser(env.navigator);
}

function matches(env: DetectionEnvironment, query: string): boolean {
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
export function readPreferences(env: Pick<DetectionEnvironment, "matchMedia">): Preferences {
  return {
    reducedMotion: matches(env, "(prefers-reduced-motion: reduce)"),
    reducedTransparency: matches(env, "(prefers-reduced-transparency: reduce)"),
    forcedColors: matches(env, "(forced-colors: active)"),
  };
}

/** The real browser, or an empty environment on the server. */
export function browserDetectionEnvironment(): DetectionEnvironment {
  if (typeof window === "undefined") return {};
  return {
    navigator: window.navigator as DetectionEnvironment["navigator"],
    root: typeof document === "undefined" ? null : document.documentElement,
    matchMedia: typeof window.matchMedia === "function" ? (query) => window.matchMedia(query) : undefined,
  };
}
