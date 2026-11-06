import { SHIFT_REFERENCE, computeDisplacementMap, computeSpecularMap, type MapGeometry, type SpecularGeometry } from "./displacement";
import { pngDataUri } from "./png";

/** The most pixels a map gets. A larger element gets a smaller map, stretched by the browser. */
const DEFAULT_MAP_PIXELS = 16_000;
const MAX_SCALE = 400;
const DEFAULT_DISPERSION = 0.08;
const MAX_DISPERSION = 0.5;
const ID_PATTERN = /^[A-Za-z][\w-]*$/;

export interface SpecularOptions {
  /** Direction toward the light in degrees from +x, y down. Default -135, the top left. */
  angle?: number;
  /** Brightness. Default 0.7. */
  strength?: number;
}

export interface GlassFilterOptions {
  /** The element's width in CSS pixels. A positive whole number. */
  width: number;
  /** The element's height in CSS pixels. A positive whole number. */
  height: number;
  /** The element's corner radius in CSS pixels. */
  radius: number;
  /** The feDisplacementMap scale. Animate this one. Default: full strength for the depth. */
  scale?: number;
  /** Glass height at the rim in pixels. Default 40 percent of the short side, between 4 and 40. */
  depth?: number;
  /** Width of the curved rim in pixels. Default 85 percent of half the short side. */
  bevel?: number;
  /** Default 1.5. 1 means no refraction. */
  refractiveIndex?: number;
  /** `true` splits red, green, and blue by 8 percent of the scale. A number sets the fraction, 0 to 0.5. */
  dispersion?: boolean | number;
  /** A lit rim. On by default. `false` leaves it out. */
  specular?: boolean | SpecularOptions;
  /** Use your own id, for example so server and client markup match. Otherwise a counter makes one. */
  id?: string;
  /** Cap on map pixels. Default 16000. */
  mapPixels?: number;
}

export interface GlassFilter {
  readonly id: string;
  /** For `backdrop-filter` or `filter`: `url(#id)`. */
  readonly url: string;
  /** A hidden `<svg>` holding the `<filter>`. Insert it once in the document. */
  readonly markup: string;
  /** The current feDisplacementMap scale. */
  readonly scale: number;
  readonly displacementUri: string;
  readonly specularUri: string | null;
  readonly options: Readonly<ResolvedGlassOptions>;
  /** The same filter with a new scale. It builds no map. */
  withScale(scale: number): GlassFilter;
}

export interface ResolvedGlassOptions {
  width: number;
  height: number;
  radius: number;
  depth: number;
  bevel: number;
  refractiveIndex: number;
  dispersion: number;
  specular: { angle: number; strength: number } | null;
  mapPixels: number;
  id: string;
  scale: number;
}

/** The two map builders. A test can pass spies to count rebuilds. */
export interface GlassFilterEngine {
  computeDisplacementMap(geometry: MapGeometry): Uint8ClampedArray;
  computeSpecularMap(geometry: SpecularGeometry): Uint8ClampedArray;
}

const defaultEngine: GlassFilterEngine = { computeDisplacementMap, computeSpecularMap };

let idCounter = 0;
const nextId = () => `lqg-glass-${(idCounter += 1)}`;

const finite = (value: number | undefined): value is number => typeof value === "number" && Number.isFinite(value);
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const format = (value: number) => String(Number(value.toFixed(3)));

function resolveOptions(options: GlassFilterOptions): ResolvedGlassOptions {
  const { width, height } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError("Glass filter size must be positive whole numbers.");
  }
  const id = options.id ?? nextId();
  if (!ID_PATTERN.test(id)) throw new RangeError("Glass filter id must start with a letter and use only letters, digits, - and _.");
  const half = Math.min(width, height) / 2;
  const radius = finite(options.radius) ? clamp(options.radius, 0, half) : 0;
  const depth = finite(options.depth) && options.depth > 0 ? options.depth : clamp(Math.min(width, height) * 0.4, 4, 40);
  const bevel = finite(options.bevel) && options.bevel > 0 ? options.bevel : Math.max(1, half * 0.85);
  const refractiveIndex = finite(options.refractiveIndex) ? Math.max(1, options.refractiveIndex) : 1.5;
  const dispersionRaw = options.dispersion === true ? DEFAULT_DISPERSION : typeof options.dispersion === "number" && Number.isFinite(options.dispersion) ? options.dispersion : 0;
  const light: SpecularOptions = typeof options.specular === "object" && options.specular !== null ? options.specular : {};
  const specular = options.specular === false ? null : {
    angle: finite(light.angle) ? light.angle : -135,
    strength: finite(light.strength) ? Math.max(0, light.strength) : 0.7,
  };
  const full = Math.round(2 * depth * SHIFT_REFERENCE * 10) / 10;
  return {
    width,
    height,
    radius,
    depth,
    bevel,
    refractiveIndex,
    dispersion: clamp(dispersionRaw, 0, MAX_DISPERSION),
    specular,
    mapPixels: finite(options.mapPixels) && options.mapPixels > 0 ? options.mapPixels : DEFAULT_MAP_PIXELS,
    id,
    scale: finite(options.scale) ? clamp(options.scale, 0, MAX_SCALE) : clamp(full, 0, MAX_SCALE),
  };
}

/** Everything that decides the map pixels. A change in any of these needs new maps. */
function geometryKey(o: ResolvedGlassOptions): string {
  const s = o.specular ? `${o.specular.angle},${o.specular.strength}` : "none";
  return [o.width, o.height, o.radius, o.depth, o.bevel, o.refractiveIndex, o.mapPixels, s].join("|");
}

function buildMaps(o: ResolvedGlassOptions, engine: GlassFilterEngine) {
  const ratio = o.width * o.height > o.mapPixels ? Math.sqrt(o.mapPixels / (o.width * o.height)) : 1;
  const width = Math.max(1, Math.round(o.width * ratio));
  const height = Math.max(1, Math.round(o.height * ratio));
  const geometry: MapGeometry = {
    width,
    height,
    radius: o.radius * ratio,
    bevel: o.bevel * ratio,
    depth: o.depth * ratio,
    refractiveIndex: o.refractiveIndex,
  };
  const displacementUri = pngDataUri(width, height, engine.computeDisplacementMap(geometry));
  const specularUri = o.specular
    ? pngDataUri(width, height, engine.computeSpecularMap({ ...geometry, angle: o.specular.angle, strength: o.specular.strength }))
    : null;
  return { displacementUri, specularUri };
}

const CHANNELS = [
  { name: "r", values: "1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" },
  { name: "g", values: "0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" },
  { name: "b", values: "0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 0 1 0" },
] as const;

function displacement(scale: number, factor: number, result: string): string {
  return `<feDisplacementMap in="SourceGraphic" in2="lqg-map" scale="${format(scale * factor)}" xChannelSelector="R" yChannelSelector="G" data-lqg-scale-factor="${format(factor)}" result="${result}"/>`;
}

function render(o: ResolvedGlassOptions, uris: { displacementUri: string; specularUri: string | null }): string {
  const image = (href: string, result: string) =>
    `<feImage href="${href}" x="0" y="0" width="${o.width}" height="${o.height}" preserveAspectRatio="none" result="${result}"/>`;
  const body: string[] = [image(uris.displacementUri, "lqg-map")];
  if (o.dispersion > 0) {
    const factors = [1 + o.dispersion, 1, 1 - o.dispersion];
    CHANNELS.forEach((channel, index) => {
      body.push(displacement(o.scale, factors[index], `lqg-${channel.name}`));
      body.push(`<feColorMatrix in="lqg-${channel.name}" type="matrix" values="${channel.values}" result="lqg-${channel.name}c"/>`);
    });
    body.push('<feBlend in="lqg-rc" in2="lqg-gc" mode="screen" result="lqg-rg"/>');
    body.push('<feBlend in="lqg-rg" in2="lqg-bc" mode="screen" result="lqg-lens"/>');
  } else {
    body.push(displacement(o.scale, 1, "lqg-lens"));
  }
  if (uris.specularUri) {
    body.push(image(uris.specularUri, "lqg-spec"));
    body.push('<feBlend in="lqg-spec" in2="lqg-lens" mode="normal"/>');
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute" data-lqg-filter="${o.id}">`,
    "<defs>",
    `<filter id="${o.id}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">`,
    ...body,
    "</filter>",
    "</defs>",
    "</svg>",
  ].join("");
}

function assemble(o: ResolvedGlassOptions, uris: { displacementUri: string; specularUri: string | null }): GlassFilter {
  const filter: GlassFilter = {
    id: o.id,
    url: `url(#${o.id})`,
    markup: render(o, uris),
    scale: o.scale,
    displacementUri: uris.displacementUri,
    specularUri: uris.specularUri,
    options: Object.freeze(o),
    withScale(scale: number) {
      if (!finite(scale)) return filter;
      return assemble({ ...o, scale: clamp(scale, 0, MAX_SCALE) }, uris);
    },
  };
  return filter;
}

/**
 * Builds the SVG filter that makes a lens. The result is markup plus the pieces to change it cheaply.
 * Building computes the maps, which costs a few milliseconds. Do it again only when width, height,
 * or radius change; for `scale`, use `withScale` or `applyFilterScale`.
 */
export function createGlassFilter(options: GlassFilterOptions, engine: GlassFilterEngine = defaultEngine): GlassFilter {
  const resolved = resolveOptions(options);
  return assemble(resolved, buildMaps(resolved, engine));
}

/**
 * Applies a change to a filter. Maps are rebuilt only if something that shapes them changed
 * (width, height, radius, depth, bevel, index, specular). Otherwise the maps are reused.
 * Returns the same object when nothing changed.
 */
export function updateGlassFilter(filter: GlassFilter, patch: Partial<GlassFilterOptions>, engine: GlassFilterEngine = defaultEngine): GlassFilter {
  const previous = filter.options;
  const merged: GlassFilterOptions = {
    width: previous.width,
    height: previous.height,
    radius: previous.radius,
    depth: previous.depth,
    bevel: previous.bevel,
    refractiveIndex: previous.refractiveIndex,
    dispersion: previous.dispersion,
    specular: previous.specular ?? false,
    mapPixels: previous.mapPixels,
    id: previous.id,
    scale: previous.scale,
    ...patch,
  };
  const next = resolveOptions(merged);
  if (geometryKey(next) === geometryKey(previous)) {
    const same = (Object.keys(next) as Array<keyof ResolvedGlassOptions>).every((key) => JSON.stringify(next[key]) === JSON.stringify(previous[key]));
    if (same) return filter;
    return assemble(next, { displacementUri: filter.displacementUri, specularUri: filter.specularUri });
  }
  return assemble(next, buildMaps(next, engine));
}

/** What `applyFilterScale` needs from a document, shadow root, or element. */
export interface ScaleRoot {
  querySelectorAll(selector: string): Iterable<{ getAttribute(name: string): string | null; setAttribute(name: string, value: string): void }>;
}

/**
 * Sets the scale on a filter that is already in the page. This is the per-frame call: it touches only the
 * `scale` attribute of the displacement elements, and keeps dispersion's red and blue offsets in step.
 */
export function applyFilterScale(root: ScaleRoot, id: string, scale: number): void {
  if (!finite(scale) || !ID_PATTERN.test(id)) return;
  const value = clamp(scale, 0, MAX_SCALE);
  for (const node of root.querySelectorAll(`[data-lqg-filter="${id}"] feDisplacementMap`)) {
    const factor = Number(node.getAttribute("data-lqg-scale-factor"));
    node.setAttribute("scale", format(value * (Number.isFinite(factor) && factor > 0 ? factor : 1)));
  }
}
