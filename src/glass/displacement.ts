/**
 * The maps behind the glass filter, as pure functions of a rounded rectangle.
 *
 * Displacement map: the glass has a convex rim (a squircle profile) that rises from the edge to a flat top.
 * A ray falling straight down meets the rim at an angle, bends by Snell's law (air 1.0, glass `refractiveIndex`),
 * and lands a little sideways. That sideways shift is stored in red (x) and green (y), where 128 means no shift.
 * The shift points toward the center of the glass, so the rim shows content from further in.
 *
 * Specular map: white with alpha, brightest where the rim faces the light.
 */

export interface MapGeometry {
  /** Pixels. A positive whole number. */
  width: number;
  /** Pixels. A positive whole number. */
  height: number;
  /** Corner radius in pixels. Larger than half the short side is clamped to a pill. */
  radius: number;
  /** How far the rim reaches in from the edge, in pixels. */
  bevel: number;
  /** The height of the glass at the rim, in pixels. It sets how far light is thrown sideways. */
  depth: number;
  refractiveIndex: number;
}

export interface SpecularGeometry extends Omit<MapGeometry, "refractiveIndex"> {
  /** Not used by the highlight. Accepted so one geometry object can feed both maps. */
  refractiveIndex?: number;
  /** Direction toward the light, in degrees from the +x axis, with y pointing down. -135 is the top left. */
  angle: number;
  /** 0 to 1 or more. Scales the brightness. */
  strength: number;
}

/**
 * The largest shift is `depth * SHIFT_REFERENCE` pixels, which a refractive index of 1.5 reaches at the very
 * edge (tan(90 degrees - asin(1 / 1.5)) = 1.118). A filter's `scale` is twice that, because feDisplacementMap
 * moves a pixel by `scale * (channel - 0.5)`.
 */
export const SHIFT_REFERENCE = 1.2;

const SPECULAR_SHININESS = 4;
const SPECULAR_GAIN = 1.6;
const LIGHT_HEIGHT = 0.6;
const OPPOSITE_LIGHT = 0.4;

interface Resolved {
  width: number;
  height: number;
  radius: number;
  bevel: number;
  depth: number;
  index: number;
}

function resolve(geometry: Omit<MapGeometry, "refractiveIndex"> & { refractiveIndex?: number }): Resolved {
  const { width, height } = geometry;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError("Map size must be positive whole numbers.");
  }
  const half = Math.min(width, height) / 2;
  const radius = Number.isFinite(geometry.radius) ? Math.min(Math.max(geometry.radius, 0), half) : 0;
  const bevel = Number.isFinite(geometry.bevel) && geometry.bevel > 0 ? geometry.bevel : Math.max(1, half * 0.85);
  const depth = Number.isFinite(geometry.depth) && geometry.depth > 0 ? geometry.depth : Math.max(1, half * 0.8);
  const raw = typeof geometry.refractiveIndex === "number" && Number.isFinite(geometry.refractiveIndex) ? geometry.refractiveIndex : 1.5;
  return { width, height, radius, bevel, depth, index: Math.max(1, raw) };
}

/** Signed distance to the rounded rectangle, positive inside, plus the outward unit normal. */
function sample(x: number, y: number, r: Resolved): { inside: number; nx: number; ny: number } {
  const px = x + 0.5 - r.width / 2;
  const py = y + 0.5 - r.height / 2;
  const qx = Math.abs(px) - (r.width / 2 - r.radius);
  const qy = Math.abs(py) - (r.height / 2 - r.radius);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const outside = Math.hypot(ox, oy);
  const signed = outside + Math.min(Math.max(qx, qy), 0) - r.radius;
  const sx = px < 0 ? -1 : 1;
  const sy = py < 0 ? -1 : 1;
  let nx: number;
  let ny: number;
  if (outside > 0) {
    nx = (sx * ox) / outside;
    ny = (sy * oy) / outside;
  } else if (qx > qy) {
    nx = sx;
    ny = 0;
  } else {
    nx = 0;
    ny = sy;
  }
  return { inside: -signed, nx, ny };
}

/** Slope of the rim's height against distance from the edge, in pixels per pixel. 0 beyond the bevel. */
function rimSlope(inside: number, r: Resolved): number {
  const t = inside / r.bevel;
  if (t >= 1) return 0;
  const s = 1 - t;
  const s4 = s * s * s * s;
  // h(t) = (1 - (1 - t)^4)^(1/4), so dh/dt = (1 - t)^3 / (1 - (1 - t)^4)^(3/4).
  const slopeInT = (s * s * s) / Math.pow(Math.max(1 - s4, 1e-9), 0.75);
  return (r.depth / r.bevel) * slopeInT;
}

/** How far a ray is thrown sideways, as a fraction of the largest throw. 0 to 1. */
function throwFraction(slope: number, r: Resolved): number {
  if (slope <= 0 || r.index <= 1) return 0;
  const incidence = Math.atan(slope);
  const refracted = Math.asin(Math.min(1, Math.sin(incidence) / r.index));
  const bend = incidence - refracted;
  return Math.min(1, (r.depth * Math.tan(bend)) / (r.depth * SHIFT_REFERENCE));
}

/** RGBA, row by row. 128 in red and green is no shift. Alpha is always 255. */
export function computeDisplacementMap(geometry: MapGeometry): Uint8ClampedArray {
  const r = resolve(geometry);
  const out = new Uint8ClampedArray(r.width * r.height * 4);
  for (let y = 0; y < r.height; y += 1) {
    for (let x = 0; x < r.width; x += 1) {
      const at = (y * r.width + x) * 4;
      out[at + 3] = 255;
      const { inside, nx, ny } = sample(x, y, r);
      let red = 128;
      let green = 128;
      if (inside > 0 && inside < r.bevel) {
        const u = throwFraction(rimSlope(inside, r), r);
        red = 128 - Math.round(127 * u * nx);
        green = 128 - Math.round(127 * u * ny);
      }
      out[at] = red;
      out[at + 1] = green;
      out[at + 2] = 128;
    }
  }
  return out;
}

function normalize(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

/** The half-vector between a light in direction (x, y) and a viewer looking straight down. */
function halfVector(x: number, y: number): [number, number, number] {
  const [lx, ly, lz] = normalize(x, y, LIGHT_HEIGHT);
  return normalize(lx, ly, lz + 1);
}

/** RGBA, white with the highlight in alpha. */
export function computeSpecularMap(geometry: SpecularGeometry): Uint8ClampedArray {
  const r = resolve(geometry);
  const angle = (Number.isFinite(geometry.angle) ? geometry.angle : -135) * (Math.PI / 180);
  const strength = Number.isFinite(geometry.strength) && geometry.strength > 0 ? geometry.strength : 0;
  const lx = Math.cos(angle);
  const ly = Math.sin(angle);
  const main = halfVector(lx, ly);
  const back = halfVector(-lx, -ly);
  const out = new Uint8ClampedArray(r.width * r.height * 4);
  for (let y = 0; y < r.height; y += 1) {
    for (let x = 0; x < r.width; x += 1) {
      const at = (y * r.width + x) * 4;
      out[at] = 255;
      out[at + 1] = 255;
      out[at + 2] = 255;
      const { inside, nx, ny } = sample(x, y, r);
      if (strength === 0 || inside <= 0 || inside >= r.bevel) continue;
      const slope = rimSlope(inside, r);
      const [sx, sy, sz] = normalize(nx * slope, ny * slope, 1);
      const lit = Math.max(0, sx * main[0] + sy * main[1] + sz * main[2]);
      const lit2 = Math.max(0, sx * back[0] + sy * back[1] + sz * back[2]);
      const spec = Math.pow(lit, SPECULAR_SHININESS) + OPPOSITE_LIGHT * Math.pow(lit2, SPECULAR_SHININESS);
      // The center of the bevel faces straight up and would otherwise glow a little. Only a tilted rim shines.
      const tilt = Math.min(1, slope * 4);
      out[at + 3] = Math.round(255 * Math.min(1, Math.max(0, SPECULAR_GAIN * strength * spec * tilt)));
    }
  }
  return out;
}
