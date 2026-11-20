/**
 * Procedural surface textures for the M7 table worlds (PLAN Milestone 7, M7-P1: "Procedural textures only"; the looks
 * of docs/design/m7-directions.html). Each factory returns TextureSources: deterministic canvas painters keyed by a
 * stable id (util/texture.ts), turned into tiled maps by the scene's material library (scene/materials.ts, `tileMm`).
 *
 * - woven cloth (Kitchen's linen playmat): warp and weft threads with slubs, a quiet mottling, and its normal map;
 * - planks (Kitchen's walnut, Codex's ebony desk): boards running along the table's y axis with stretched grain;
 * - grain (Graphite's slate, Codex's leather): fine material grain with optional dot grid or tooled lattice.
 *
 * Grey maps (cloth, grain) are multiplied by the material colour; plank and leather albedo maps carry their colour.
 */
import type { TextureSource } from '../../util/texture';
import { lerpRgb, mix, normalPixels, normalise, prng, putPixels, rgb255, valueNoise } from './procedural';

/** Heights 0..1 of a woven tile of n px with a thread every `pitch` px (n a multiple of 2·pitch). */
export function weaveHeights(n: number, pitch: number, seed: number): Float32Array {
  const rnd = prng(seed);
  const threads = Math.round(n / pitch);
  // Each thread is a little thicker or thinner (slubs), varying slowly along it.
  const warp = Array.from({ length: threads }, () => rnd());
  const weft = Array.from({ length: threads }, () => rnd());
  const slubA = valueNoise(n, 4, 12, seed + 1);
  const slubB = valueNoise(n, 12, 4, seed + 2);
  const h = new Float32Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const tx = Math.floor(x / pitch);
      const ty = Math.floor(y / pitch);
      const fx = (x % pitch) / pitch;
      const fy = (y % pitch) / pitch;
      // Plain weave: the warp is on top where (tx + ty) is even, the weft elsewhere.
      const warpTop = (tx + ty) % 2 === 0;
      const across = Math.sin(Math.PI * (warpTop ? fx : fy));
      const along = 0.75 + 0.25 * Math.sin(Math.PI * (warpTop ? fy : fx));
      const slub = warpTop ? 0.8 + 0.4 * warp[tx % threads]! * slubA[y * n + x]! : 0.8 + 0.4 * weft[ty % threads]! * slubB[y * n + x]!;
      h[y * n + x] = across * along * slub;
    }
  return normalise(h);
}

/** A woven cloth: a grey albedo in [lo, hi] (multiplied by the cloth colour) and its normal map. */
export function wovenCloth(o: { id: string; px: number; pitch: number; lo: number; hi: number; strength: number; seed: number }): { albedo: TextureSource; normal: TextureSource } {
  const field = (n: number) => {
    const weave = weaveHeights(n, o.pitch, o.seed);
    const mottle = valueNoise(n, 4, 4, o.seed + 9);
    return { weave, tone: mix([{ field: weave, weight: 0.7 }, { field: mottle, weight: 0.3 }]) };
  };
  return {
    albedo: {
      id: `${o.id}-albedo`,
      width: o.px,
      height: o.px,
      draw(ctx, w, h) {
        const n = Math.min(w, h);
        const { tone } = field(n);
        putPixels(ctx, w, h, (x, y) => {
          const v = Math.round(o.lo + (o.hi - o.lo) * tone[(y % n) * n + (x % n)]!);
          return [v, v, v];
        });
      },
    },
    normal: {
      id: `${o.id}-normal`,
      width: o.px,
      height: o.px,
      draw(ctx, w, h) {
        const n = Math.min(w, h);
        putPixels(ctx, w, h, normalPixels(field(n).weave, n, o.strength));
      },
    },
  };
}

/**
 * Wooden boards: `boards` planks side by side across the tile (along x), grain running along y, each board a little
 * lighter or darker, with a dark seam between them. Colours are the wood's own (the material colour stays white).
 */
export function planks(o: { id: string; px: number; boards: number; base: string; dark: string; light: string; seam: string; seed: number }): TextureSource {
  return {
    id: o.id,
    width: o.px,
    height: o.px,
    draw(ctx, w, h) {
      const n = Math.min(w, h);
      const rnd = prng(o.seed);
      const tone = Array.from({ length: o.boards }, () => rnd() - 0.5);
      const offset = Array.from({ length: o.boards }, () => Math.floor(rnd() * n));
      // Grain: long along y (few cells), fine across x (many cells), plus growth rings from a warped distance.
      const grain = mix([
        { field: valueNoise(n, 48, 3, o.seed + 1), weight: 0.6 },
        { field: valueNoise(n, 160, 6, o.seed + 2), weight: 0.4 },
      ]);
      const warp = valueNoise(n, 6, 2, o.seed + 3);
      const base = rgb255(o.base);
      const dark = rgb255(o.dark);
      const light = rgb255(o.light);
      const seam = rgb255(o.seam);
      const boardPx = n / o.boards;
      putPixels(ctx, w, h, (x, y) => {
        const b = Math.min(o.boards - 1, Math.floor(x / boardPx));
        const yy = (y + offset[b]!) % n;
        const fx = (x % boardPx) / boardPx;
        if (fx < 1 / boardPx || fx > 1 - 1 / boardPx) return seam;
        const g = grain[yy * n + x]!;
        const rings = 0.5 + 0.5 * Math.sin((fx * 9 + warp[yy * n + x]! * 4 + b) * Math.PI);
        const t = 0.55 * g + 0.25 * rings + tone[b]! * 0.5;
        return t < 0.5 ? lerpRgb(dark, base, Math.max(0, t * 2)) : lerpRgb(base, light, Math.min(1, (t - 0.5) * 2));
      });
    },
  };
}

/**
 * A fine material grain: grey albedo in [lo, hi] with an optional dot grid (`dots` per tile side, radius in px, lifted to
 * `dotGrey`), and its normal map (the grain only; the dots are printed, not raised).
 */
export function grain(o: { id: string; px: number; lo: number; hi: number; strength: number; seed: number; dots?: { perSide: number; radiusPx: number; grey: number } }): { albedo: TextureSource; normal: TextureSource } {
  const field = (n: number) =>
    mix([
      { field: valueNoise(n, 96, 96, o.seed), weight: 0.45 },
      { field: valueNoise(n, 24, 24, o.seed + 1), weight: 0.35 },
      { field: valueNoise(n, 4, 4, o.seed + 2), weight: 0.2 },
    ]);
  return {
    albedo: {
      id: `${o.id}-albedo`,
      width: o.px,
      height: o.px,
      draw(ctx, w, h) {
        const n = Math.min(w, h);
        const f = field(n);
        const step = o.dots ? n / o.dots.perSide : 0;
        putPixels(ctx, w, h, (x, y) => {
          let v = o.lo + (o.hi - o.lo) * f[(y % n) * n + (x % n)]!;
          if (o.dots) {
            // Distance to the nearest grid point (grid points at the half-steps, so the tile edge cuts no dot).
            const dx = ((x + 0.5) % step) - step / 2;
            const dy = ((y + 0.5) % step) - step / 2;
            const d = Math.hypot(dx, dy);
            const k = Math.max(0, Math.min(1, o.dots.radiusPx + 0.5 - d));
            v = v + (o.dots.grey - v) * k;
          }
          const c = Math.round(v);
          return [c, c, c];
        });
      },
    },
    normal: {
      id: `${o.id}-normal`,
      width: o.px,
      height: o.px,
      draw(ctx, w, h) {
        const n = Math.min(w, h);
        putPixels(ctx, w, h, normalPixels(field(n), n, o.strength));
      },
    },
  };
}

/**
 * Tooled leather: a pebbled grain in the leather's colours with a geometric lattice pressed in at ±45° every `pitchPx`
 * (n a multiple of it, so the lattice tiles), its grooves faintly gilt. Albedo in colour and a normal map.
 */
export function tooledLeather(o: { id: string; px: number; pitchPx: number; base: string; dark: string; light: string; line: string; lineMix: number; strength: number; seed: number }): { albedo: TextureSource; normal: TextureSource } {
  const fields = (n: number) => {
    const pebble = mix([
      { field: valueNoise(n, 64, 64, o.seed), weight: 0.6 },
      { field: valueNoise(n, 16, 16, o.seed + 1), weight: 0.25 },
      { field: valueNoise(n, 4, 4, o.seed + 2), weight: 0.15 },
    ]);
    const groove = new Float32Array(n * n);
    const p = o.pitchPx;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        // Distance in px to the nearest line of either diagonal family (x + y ≡ 0 and x − y ≡ 0 mod p).
        const a = (((x + y) % p) + p) % p;
        const b = (((x - y) % p) + p) % p;
        const d = Math.min(a, p - a, b, p - b) / Math.SQRT2;
        groove[y * n + x] = Math.max(0, 1 - d / 1.1);
      }
    return { pebble, groove };
  };
  return {
    albedo: {
      id: `${o.id}-albedo`,
      width: o.px,
      height: o.px,
      draw(ctx, w, h) {
        const n = Math.min(w, h);
        const { pebble, groove } = fields(n);
        const base = rgb255(o.base);
        const dark = rgb255(o.dark);
        const light = rgb255(o.light);
        const line = rgb255(o.line);
        putPixels(ctx, w, h, (x, y) => {
          const i = (y % n) * n + (x % n);
          const t = pebble[i]!;
          const c = t < 0.5 ? lerpRgb(dark, base, t * 2) : lerpRgb(base, light, (t - 0.5) * 2);
          return lerpRgb(c, line, groove[i]! * o.lineMix);
        });
      },
    },
    normal: {
      id: `${o.id}-normal`,
      width: o.px,
      height: o.px,
      draw(ctx, w, h) {
        const n = Math.min(w, h);
        const { pebble, groove } = fields(n);
        const height = new Float32Array(n * n);
        for (let i = 0; i < height.length; i++) height[i] = pebble[i]! * 0.5 - groove[i]! * 0.8;
        putPixels(ctx, w, h, normalPixels(height, n, o.strength));
      },
    },
  };
}
