/**
 * Stonetable's slab material, generated procedurally (DESIGN "Themes and rendering", Assets: stone from CC0 physically
 * based material libraries "or procedural"; Stonetable: "Carved stone slab with PBR materials"). One tileable height
 * field of weathered granite-like stone (fractal value noise, ridged veins, pits and speckles) gives the albedo,
 * tangent-space normal and roughness maps of a MaterialSpec, so nothing is bundled or fetched.
 *
 * Pure pixel maths up to `fillImage`: the same size and seed always give the same pixels, and every map tiles (its
 * left column continues its right one, its top row its bottom one), so the slab shows no seams at any table size.
 */
import type { Canvas2D, TextureSource } from '../../util/texture';

/** Size of the generated maps in pixels (square, tileable). */
export const STONE_MAP_PX = 512;

/** Millimetres of table covered by one tile of the maps (MaterialSpec.tileMm). */
export const STONE_TILE_MM = 640;

/** Darkest and lightest albedo of the stone (sRGB 0..255), between which the noise blends. */
export const STONE_DARK: readonly [number, number, number] = [54, 53, 51];
export const STONE_LIGHT: readonly [number, number, number] = [132, 128, 120];

/** Hash of integer lattice coordinates and a seed to 0..1 (deterministic, no Math.random). */
export function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);
const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Value noise on a lattice of `period` cells that wraps, sampled at (x, y) in cell units. */
export function periodicNoise(x: number, y: number, period: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const xa = mod(x0, period);
  const xb = mod(x0 + 1, period);
  const ya = mod(y0, period);
  const yb = mod(y0 + 1, period);
  const a = hash2(xa, ya, seed);
  const b = hash2(xb, ya, seed);
  const c = hash2(xa, yb, seed);
  const d = hash2(xb, yb, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal sum of periodic value noise over `u, v` in 0..1 (one tile), `octaves` octaves from `base` cells. */
export function fbm(u: number, v: number, base: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let period = base;
  for (let o = 0; o < octaves; o++) {
    sum += amp * periodicNoise(u * period, v * period, period, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

/** The stone's height field, 0..1, `size` × `size`, row-major (row 0 at the top of the image). */
export interface StoneField {
  size: number;
  height: Float32Array;
  /** Grain tone 0..1 (mineral colour, independent of the relief), for the albedo. */
  tone: Float32Array;
}

const fields = new Map<string, StoneField>();

/** The stone field of a size and seed (memoised: the albedo, normal and roughness maps share it). */
export function stoneField(size = STONE_MAP_PX, seed = 7): StoneField {
  const key = `${size}:${seed}`;
  const hit = fields.get(key);
  if (hit) return hit;
  const field = generateStoneField(size, seed);
  fields.set(key, field);
  return field;
}

/** Generate a stone field (pure: the same size and seed give the same field). */
export function generateStoneField(size: number, seed: number): StoneField {
  const height = new Float32Array(size * size);
  const tone = new Float32Array(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const u = c / size;
      const v = r / size;
      // Gentle undulation, mottling, fine grain, thin cracks (1 - |2n - 1| is sharp at the noise's mid-line, a high power
      // keeps only a hairline of it) and sparse pits: a dressed granite face, not a polished one.
      const broad = fbm(u, v, 2, 3, seed);
      const mid = fbm(u, v, 8, 3, seed + 17);
      const grain = fbm(u, v, 64, 2, seed + 29);
      const crack = Math.pow(1 - Math.abs(2 * fbm(u, v, 4, 4, seed + 31) - 1), 64);
      const pit = hash2(c, r, seed + 53) > 0.993 ? 1 : 0;
      const h = 0.3 * broad + 0.22 * mid + 0.38 * grain - 0.22 * crack - 0.12 * pit + 0.06;
      height[r * size + c] = Math.min(1, Math.max(0, h));
      const speck = hash2(c, r, seed + 71);
      const t = 0.42 * fbm(u, v, 5, 3, seed + 89) + 0.3 * mid + 0.2 * grain + (speck > 0.96 ? 0.22 : speck < 0.04 ? -0.18 : 0) - 0.12 * crack;
      tone[r * size + c] = Math.min(1, Math.max(0, t));
    }
  }
  return { size, height, tone };
}

/** RGBA pixels of a map, `size` × `size`, row-major. */
export type Pixels = Uint8ClampedArray;

/** Albedo: the grain tone blended between STONE_DARK and STONE_LIGHT, darkened in the hollows. */
export function albedoPixels(f: StoneField): Pixels {
  const out = new Uint8ClampedArray(f.size * f.size * 4);
  for (let i = 0; i < f.size * f.size; i++) {
    const k = Math.min(1, Math.max(0, f.tone[i]! * 0.85 + f.height[i]! * 0.3 - 0.05));
    for (let ch = 0; ch < 3; ch++) out[i * 4 + ch] = Math.round(STONE_DARK[ch]! + (STONE_LIGHT[ch]! - STONE_DARK[ch]!) * k);
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Tangent-space normal map (OpenGL convention, green up) of the height field, `strength` mm of relief per unit height. */
export function normalPixels(f: StoneField, strength = 8): Pixels {
  const n = f.size;
  const out = new Uint8ClampedArray(n * n * 4);
  const h = (c: number, r: number) => f.height[mod(r, n) * n + mod(c, n)]!;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      // Row 0 is the top of the image, v grows upward: dh/dv = -(dh/drow).
      const dx = ((h(c + 1, r) - h(c - 1, r)) / 2) * strength;
      const dy = (-(h(c, r + 1) - h(c, r - 1)) / 2) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (r * n + c) * 4;
      out[i] = Math.round((-dx / len) * 127.5 + 127.5);
      out[i + 1] = Math.round((-dy / len) * 127.5 + 127.5);
      out[i + 2] = Math.round((1 / len) * 127.5 + 127.5);
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Roughness: worn high spots are a little smoother than the hollows and veins (0.62..0.96). */
export function roughnessPixels(f: StoneField): Pixels {
  const out = new Uint8ClampedArray(f.size * f.size * 4);
  for (let i = 0; i < f.size * f.size; i++) {
    const g = Math.round(255 * (0.96 - 0.34 * Math.min(1, Math.max(0, f.height[i]! * 1.2 - 0.2))));
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = g;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** Copy pixels onto a 2D context, scaled when the canvas is not the map's size. */
export function fillImage(ctx: Canvas2D, w: number, h: number, size: number, pixels: Pixels): void {
  const img = ctx.createImageData(size, size);
  img.data.set(pixels);
  if (w === size && h === size) {
    ctx.putImageData(img, 0, 0);
    return;
  }
  // A canvas of another size: draw at the map's size, then let the context scale it (rare; the library uses ours).
  const tmp = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size) : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const t = tmp.getContext('2d') as Canvas2D | null;
  if (!t) return;
  t.putImageData(img, 0, 0);
  ctx.drawImage(tmp as CanvasImageSource, 0, 0, w, h);
}

const source = (id: string, pixels: () => Pixels): TextureSource => ({
  id,
  width: STONE_MAP_PX,
  height: STONE_MAP_PX,
  draw: (ctx, w, h) => fillImage(ctx, w, h, STONE_MAP_PX, pixels()),
});

/** The slab's albedo, normal and roughness maps as procedural texture sources. */
export const STONE_MAPS = {
  albedo: source('stonetable-stone-albedo', () => albedoPixels(stoneField())),
  normal: source('stonetable-stone-normal', () => normalPixels(stoneField())),
  roughness: source('stonetable-stone-roughness', () => roughnessPixels(stoneField())),
} as const;

/** Average sRGB colour (0..255) of RGBA pixels. */
export function averageColour(pixels: Pixels): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  const n = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    r += pixels[i]!;
    g += pixels[i + 1]!;
    b += pixels[i + 2]!;
  }
  return [r / n, g / n, b / n];
}
