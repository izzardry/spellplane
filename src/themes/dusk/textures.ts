/**
 * Dusk's procedural textures (DESIGN "Themes and rendering", Assets: felt and similar surfaces may come from CC0
 * libraries, ornament stays geometric so it can be generated; nothing is bundled). Every texture is a TextureSource:
 * a deterministic function that paints a canvas, so the same id always gives the same picture (util/texture.ts) and
 * Dusk ships no image files (docs/ASSETS.md lists these as procedural).
 *
 * - FELT_ALBEDO: a tileable grey fibre pattern around 0.92, multiplied by the felt colour of the table material.
 * - FELT_NORMAL: a tileable normal map of the same nap, so the lamp's light breaks softly on the cloth.
 * - DUSK_BACK: Dusk's neutral card back (no official back, no Wizards artwork): a night-blue field, a brass double
 *   frame and an eight-pointed lamp star, all geometric.
 */
import type { Canvas2D, TextureSource } from '../../util/texture';

/** A small deterministic PRNG (mulberry32): textures look the same on every load and in every browser. */
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

/** Size of the felt tiles in px; the material repeats them every FELT_TILE_MM of table. */
export const FELT_TEXTURE_PX = 256;
export const FELT_TILE_MM = 180;

/**
 * Tileable nap heights 0..1 of an n × n tile: value noise on two octaves plus short fibres in random directions, all
 * wrapped at the edges so the tile repeats without seams.
 */
export function feltHeights(n: number, seed = 7): Float32Array {
  const rnd = prng(seed);
  const h = new Float32Array(n * n);
  const octave = (cells: number, amp: number) => {
    const g = Array.from({ length: cells * cells }, () => rnd());
    const at = (x: number, y: number) => g[(((y % cells) + cells) % cells) * cells + (((x % cells) + cells) % cells)]!;
    const s = (t: number) => t * t * (3 - 2 * t);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const fx = (x / n) * cells;
        const fy = (y / n) * cells;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = s(fx - x0);
        const ty = s(fy - y0);
        const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
        const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
        h[y * n + x]! += amp * (a + (b - a) * ty);
      }
  };
  octave(8, 0.35);
  octave(32, 0.25);
  // Fibres: short strokes in random directions, wrapped around the tile.
  const fibres = Math.round(n * n * 0.012);
  for (let i = 0; i < fibres; i++) {
    const x = rnd() * n;
    const y = rnd() * n;
    const a = rnd() * Math.PI * 2;
    const len = 3 + rnd() * 7;
    const v = (rnd() - 0.5) * 0.5;
    for (let t = 0; t < len; t++) {
      const px = Math.floor(x + Math.cos(a) * t);
      const py = Math.floor(y + Math.sin(a) * t);
      const k = (((py % n) + n) % n) * n + (((px % n) + n) % n);
      h[k]! += v;
    }
  }
  // Normalise to 0..1.
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of h) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  const span = hi - lo || 1;
  for (let i = 0; i < h.length; i++) h[i] = (h[i]! - lo) / span;
  return h;
}

function putPixels(ctx: Canvas2D, w: number, h: number, pixel: (x: number, y: number) => [number, number, number]): void {
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

/** Lowest and highest grey of the felt albedo (0..255): a quiet nap that never changes the felt's hue. */
export const FELT_ALBEDO_RANGE = [214, 250] as const;

/** The felt's albedo: grey nap, multiplied by the table material's felt colour (themes/dusk/table.ts). */
export const FELT_ALBEDO: TextureSource = {
  id: 'dusk-felt-albedo',
  width: FELT_TEXTURE_PX,
  height: FELT_TEXTURE_PX,
  draw(ctx, w, h) {
    const n = Math.min(w, h);
    const hs = feltHeights(n);
    const [lo, hi] = FELT_ALBEDO_RANGE;
    putPixels(ctx, w, h, (x, y) => {
      const v = Math.round(lo + (hi - lo) * hs[(y % n) * n + (x % n)]!);
      return [v, v, v];
    });
  },
};

/** The felt's normal map (tangent space, +z up), from the same nap heights with wrapped central differences. */
export const FELT_NORMAL: TextureSource = {
  id: 'dusk-felt-normal',
  width: FELT_TEXTURE_PX,
  height: FELT_TEXTURE_PX,
  draw(ctx, w, h) {
    const n = Math.min(w, h);
    const hs = feltHeights(n);
    const at = (x: number, y: number) => hs[(((y % n) + n) % n) * n + (((x % n) + n) % n)]!;
    const strength = 2.2;
    putPixels(ctx, w, h, (x, y) => {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      return [Math.round(((-dx / len) * 0.5 + 0.5) * 255), Math.round(((-dy / len) * 0.5 + 0.5) * 255), Math.round(((1 / len) * 0.5 + 0.5) * 255)];
    });
  },
};

/** Colours of Dusk's card back. */
export const BACK_COLOURS = { field: '#141a2e', inner: '#1c2440', brass: '#c9a46a', glow: '#f3d7a0' } as const;

/** An eight-pointed star path centred at (cx, cy). */
function star(ctx: Canvas2D, cx: number, cy: number, outer: number, inner: number): void {
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 8;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Dusk's neutral card back: geometric only, no official back (DESIGN "Themes and rendering", Card dressing and Assets). */
export const DUSK_BACK: TextureSource = {
  id: 'dusk-back',
  width: 488,
  height: 680,
  draw(ctx, w, h) {
    const c = BACK_COLOURS;
    ctx.fillStyle = c.field;
    ctx.fillRect(0, 0, w, h);
    // A warm pool of light in the middle, as under the lamp.
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, h * 0.5);
    g.addColorStop(0, '#3a3550');
    g.addColorStop(0.55, c.inner);
    g.addColorStop(1, c.field);
    ctx.fillStyle = g;
    ctx.fillRect(w * 0.06, h * 0.045, w * 0.88, h * 0.91);
    // Brass double frame.
    ctx.strokeStyle = c.brass;
    ctx.lineWidth = w * 0.014;
    ctx.strokeRect(w * 0.08, h * 0.06, w * 0.84, h * 0.88);
    ctx.lineWidth = w * 0.006;
    ctx.strokeRect(w * 0.115, h * 0.085, w * 0.77, h * 0.83);
    // Corner lozenges.
    ctx.fillStyle = c.brass;
    for (const [x, y] of [
      [0.115, 0.085],
      [0.885, 0.085],
      [0.115, 0.915],
      [0.885, 0.915],
    ] as const) {
      const s = w * 0.03;
      ctx.beginPath();
      ctx.moveTo(w * x, h * y - s);
      ctx.lineTo(w * x + s, h * y);
      ctx.lineTo(w * x, h * y + s);
      ctx.lineTo(w * x - s, h * y);
      ctx.closePath();
      ctx.fill();
    }
    // The lamp star: a filled eight-pointed star in a ring.
    ctx.lineWidth = w * 0.01;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.25, 0, Math.PI * 2);
    ctx.stroke();
    star(ctx, w / 2, h / 2, w * 0.21, w * 0.085);
    ctx.fillStyle = c.brass;
    ctx.fill();
    star(ctx, w / 2, h / 2, w * 0.1, w * 0.04);
    ctx.fillStyle = c.glow;
    ctx.fill();
    // Rays toward the frame.
    ctx.lineWidth = w * 0.004;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(w / 2 + Math.cos(a) * w * 0.27, h / 2 + Math.sin(a) * w * 0.27);
      ctx.lineTo(w / 2 + Math.cos(a) * w * 0.36, h / 2 + Math.sin(a) * w * 0.36);
      ctx.stroke();
    }
  },
};
