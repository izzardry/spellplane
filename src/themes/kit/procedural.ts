/**
 * Procedural drawing helpers shared by the three M7 looks (PLAN Milestone 7, M7-P1 Table worlds: "Procedural textures
 * only (no downloaded assets)"; DESIGN "Themes and rendering", Assets: ornament stays geometric so it can be generated).
 * Every function here is deterministic: the same seed gives the same picture in every browser, so a TextureSource keeps
 * its promise "same input, same picture" (util/texture.ts) and nothing is bundled as an image (docs/ASSETS.md).
 */
import type { Canvas2D } from '../../util/texture';

/** A small deterministic PRNG (mulberry32). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Tileable value noise on an n × n grid: `cellsX` × `cellsY` lattice cells (each dividing n into whole cells), smoothly
 * interpolated and wrapped, so the tile repeats without seams. Values 0..1. Stretch a grain by giving fewer cells along
 * it (wood: few cells along the plank, many across).
 */
export function valueNoise(n: number, cellsX: number, cellsY: number, seed: number): Float32Array {
  const rnd = prng(seed);
  const g = Array.from({ length: cellsX * cellsY }, () => rnd());
  const at = (x: number, y: number) => g[(((y % cellsY) + cellsY) % cellsY) * cellsX + (((x % cellsX) + cellsX) % cellsX)]!;
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const fx = (x / n) * cellsX;
      const fy = (y / n) * cellsY;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = smooth(fx - x0);
      const ty = smooth(fy - y0);
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
      out[y * n + x] = a + (b - a) * ty;
    }
  return out;
}

/** A weighted sum of fields of the same size, normalised to 0..1. */
export function mix(fields: readonly { field: Float32Array; weight: number }[]): Float32Array {
  const n = fields[0]!.field.length;
  const out = new Float32Array(n);
  for (const { field, weight } of fields) for (let i = 0; i < n; i++) out[i]! += field[i]! * weight;
  return normalise(out);
}

/** Stretch a field to 0..1 (a flat field becomes 0.5). */
export function normalise(f: Float32Array): Float32Array {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of f) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const span = hi - lo;
  for (let i = 0; i < f.length; i++) f[i] = span > 1e-9 ? (f[i]! - lo) / span : 0.5;
  return f;
}

/** Fill a w × h canvas pixel by pixel (opaque). */
export function putPixels(ctx: Canvas2D, w: number, h: number, pixel: (x: number, y: number) => readonly [number, number, number]): void {
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y);
      const i = (y * w + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
}

/** A tangent-space normal map (+z up, OpenGL convention) from a wrapped height field of an n × n tile. */
export function normalPixels(heights: Float32Array, n: number, strength: number): (x: number, y: number) => [number, number, number] {
  const at = (x: number, y: number) => heights[(((y % n) + n) % n) * n + (((x % n) + n) % n)]!;
  return (x, y) => {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1);
    return [Math.round(((-dx / len) * 0.5 + 0.5) * 255), Math.round(((-dy / len) * 0.5 + 0.5) * 255), Math.round(((1 / len) * 0.5 + 0.5) * 255)];
  };
}

/** sRGB channels 0..255 of a #rrggbb colour. */
export function rgb255(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `a` toward `b` by t (per channel, 0..255, rounded). */
export function lerpRgb(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [0, 1, 2].map((i) => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as [number, number, number];
}

/** A #rrggbb colour with every channel scaled by k (clamped). */
export function shade(hex: string, k: number): string {
  const c = rgb255(hex).map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** A rounded rectangle path (no reliance on CanvasRenderingContext2D.roundRect, which older Safari lacks). */
export function roundRect(ctx: Canvas2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
