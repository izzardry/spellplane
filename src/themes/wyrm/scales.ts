/**
 * Wyrm's obsidian slab, computed (DESIGN "Themes and rendering", theme table: "Obsidian slab with a geometric scale
 * relief and ember-lit seams"; Assets: "Ornament stays geometric (scales, knotwork, runes) so it can be generated
 * procedurally"). Pure: no DOM, no Three.js, no randomness; the same options give the same bytes.
 *
 * The relief is overlapping round scales laid like roof tiles: rows half a scale apart, every other row shifted by half
 * a scale, each scale a circle of radius `radius` (in scale widths) partly covered by the row above it, so what shows
 * is its lower crescent with a free rim. Seams are the grooves where scales meet: along a scale's own rim, along the
 * rim of the scale overlapping it, and where two scales of one row touch. The seams glow like embers, hotter in some
 * scales than others. One tile is `cols` scales wide and `rows` rows deep (square: rows = 2 × cols) and wraps
 * seamlessly in both directions, so the slab repeats it every `tileMm` of table space.
 *
 * Output: RGBA byte maps for the slab's material (albedo and emissive in sRGB; normal, and ambient occlusion /
 * roughness / metalness packed as three's aoMap R, roughnessMap G, metalnessMap B), plus the fields they were made
 * from, for tests.
 */

/** Options of one tile. */
export interface ScaleOptions {
  /** Pixels per side (square). */
  size: number;
  /** Scales across the tile; the tile is `2 × cols` rows deep, so it stays square. */
  cols: number;
  /** Scale radius in scale widths; > 0.56 so every point lies on some scale. */
  radius: number;
  /** Width of the glowing seam in scale widths. */
  seamWidth: number;
  /** Depth of the relief in mm (normal map strength). */
  reliefMm: number;
  /** Tile size in table mm. */
  tileMm: number;
  /** Varies which scales run hot. */
  seed: number;
}

export const DEFAULT_SCALE_OPTIONS: ScaleOptions = { size: 768, cols: 8, radius: 0.62, seamWidth: 0.035, reliefMm: 1.2, tileMm: 288, seed: 7 };

/** A computed tile. */
export interface ScaleMaps {
  options: ScaleOptions;
  /** RGBA, sRGB: dark obsidian, charred seams. */
  albedo: Uint8Array;
  /** RGBA, tangent-space normal (x = +u, y = +v). */
  normal: Uint8Array;
  /** RGBA: R ambient occlusion, G roughness, B metalness (three's aoMap / roughnessMap / metalnessMap channels). */
  orm: Uint8Array;
  /** RGBA, sRGB: ember glow in the seams, black elsewhere. */
  emissive: Uint8Array;
  /** Relief height 0..1 per pixel. */
  height: Float32Array;
  /** Seam mask 0..1 per pixel (1 in the middle of a seam). */
  seam: Float32Array;
  /** Distance to the nearest seam line in scale widths per pixel. */
  seamDistance: Float32Array;
  /** Index of the scale (row × cols + col, wrapped) each pixel belongs to. */
  owner: Int32Array;
  /** Heat 0..1 of each scale, by owner index. */
  heat: Float32Array;
}

/** Deterministic hash of integers to [0, 1). */
export function hash01(a: number, b: number, seed: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const mod = (a: number, n: number): number => ((a % n) + n) % n;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Heat 0..1 of every scale of a tile: a per-scale hash blended with a slow wave that wraps with the tile. */
export function scaleHeat(cols: number, seed: number): Float32Array {
  const rows = 2 * cols;
  const heat = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = (c + 0.5 * (r % 2)) / cols;
      const v = r / rows;
      const wave = 0.5 + 0.3 * Math.sin(2 * Math.PI * (u + 2 * v) + seed) + 0.2 * Math.cos(2 * Math.PI * (2 * u - v));
      heat[r * cols + c] = clamp01(0.6 * hash01(r, c, seed) + 0.4 * clamp01(wave));
    }
  }
  return heat;
}

/** sRGB byte of a 0..255 value, clamped and rounded. */
const byte = (x: number): number => (x <= 0 ? 0 : x >= 255 ? 255 : Math.round(x));

/** Compute one tile (see the module comment). */
export function generateScaleMaps(partial: Partial<ScaleOptions> = {}): ScaleMaps {
  const o: ScaleOptions = { ...DEFAULT_SCALE_OPTIONS, ...partial };
  const { size: n, cols, radius: R, seamWidth } = o;
  if (!(n >= 8) || !(cols >= 1) || !(R > 0.56 && R < 1)) throw new Error('generateScaleMaps: size ≥ 8, cols ≥ 1 and 0.56 < radius < 1');
  const rows = 2 * cols;
  // Tile extent in scale widths: cols across, rows × 0.5 deep (= cols).
  const span = cols;
  const heat = scaleHeat(cols, o.seed);
  const height = new Float32Array(n * n);
  const seam = new Float32Array(n * n);
  const seamDistance = new Float32Array(n * n);
  const owner = new Int32Array(n * n);
  const albedo = new Uint8Array(n * n * 4);
  const orm = new Uint8Array(n * n * 4);
  const emissive = new Uint8Array(n * n * 4);
  const groove = 0.07;
  // Scratch space for the candidate scales of one pixel (at most 3 per row, a handful of rows).
  const maxCand = 3 * (Math.ceil((2 * R) / 0.5) + 3);
  const candR = new Int32Array(maxCand);
  const candK = new Int32Array(maxCand);
  const candD = new Float64Array(maxCand);
  const candDx = new Float64Array(maxCand);

  for (let j = 0; j < n; j++) {
    const v = ((j + 0.5) / n) * span;
    const r0 = Math.floor((v - R) / 0.5);
    const r1 = Math.ceil((v + R) / 0.5);
    for (let i = 0; i < n; i++) {
      const u = ((i + 0.5) / n) * span;
      // Candidate scales near the point: up to three per row.
      let m = 0;
      for (let r = r0; r <= r1; r++) {
        const off = 0.5 * (r & 1);
        const dy = v - r * 0.5;
        const k0 = Math.round(u - off);
        for (let k = k0 - 1; k <= k0 + 1; k++) {
          const dx = u - (k + off);
          candR[m] = r;
          candK[m] = k;
          candDx[m] = dx;
          candD[m] = Math.sqrt(dx * dx + dy * dy);
          m++;
        }
      }
      // The owning scale: the front-most row (largest r) whose circle holds the point; within a row the nearest.
      let own = -1;
      for (let c = 0; c < m; c++) {
        const d = candD[c]!;
        if (d >= R) continue;
        if (own < 0 || candR[c]! > candR[own]! || (candR[c] === candR[own] && d < candD[own]!)) own = c;
      }
      const ownR = candR[own]!;
      const ownK = candK[own]!;
      const ownD = candD[own]!;
      const ownDx = candDx[own]!;
      // Distance to the nearest seam line: the own rim, the rim of a scale in front, the line between two neighbours of one row.
      let sd = R - ownD;
      for (let c = 0; c < m; c++) {
        if (c === own) continue;
        const d = candD[c]!;
        if (candR[c]! > ownR) sd = Math.min(sd, d - R);
        else if (candR[c] === ownR && d < R) sd = Math.min(sd, (d * d - ownD * ownD) / 2);
      }
      sd = Math.max(0, sd);
      const p = j * n + i;
      const idx = mod(ownR, rows) * cols + mod(ownK, cols);
      const t = ownD / R;
      const keel = 0.12 * Math.max(0, 1 - Math.abs(ownDx) / 0.3) * (1 - t);
      const g = smoothstep(0, groove, sd);
      const h = (0.35 + 0.5 * t + keel) * g;
      const s = 1 - smoothstep(0, seamWidth, sd);
      height[p] = h;
      seam[p] = s;
      seamDistance[p] = sd;
      owner[p] = idx;

      const hs = heat[idx]!;
      const tone = hash01(idx, 17, o.seed);
      // Obsidian: near black with a cool-warm shift per scale; seams charred darker.
      const base = 20 + 8 * tone;
      const q = p * 4;
      albedo[q] = byte((base + 3) * (1 - 0.55 * s));
      albedo[q + 1] = byte((base - 3) * (1 - 0.6 * s));
      albedo[q + 2] = byte((base - 2) * (1 - 0.6 * s));
      albedo[q + 3] = 255;
      orm[q] = byte(255 * (0.45 + 0.55 * g));
      orm[q + 1] = byte(255 * (0.16 + 0.06 * tone + 0.6 * (1 - g)));
      orm[q + 2] = 0;
      orm[q + 3] = 255;
      // Embers: dark red when cool, orange-gold when hot.
      const glow = s * (0.12 + 0.88 * hs * hs * hs * hs);
      emissive[q] = byte(glow * (110 + 145 * hs));
      emissive[q + 1] = byte(glow * (20 + 130 * hs * hs));
      emissive[q + 2] = byte(glow * (4 + 46 * hs * hs * hs));
      emissive[q + 3] = 255;
    }
  }

  // Normals from the height field, wrapping at the tile edges so the tile repeats without a crease.
  const normal = new Uint8Array(n * n * 4);
  const pixelMm = o.tileMm / n;
  const k = o.reliefMm / (2 * pixelMm);
  for (let j = 0; j < n; j++) {
    const jm = mod(j - 1, n) * n;
    const jp = mod(j + 1, n) * n;
    for (let i = 0; i < n; i++) {
      const im = mod(i - 1, n);
      const ip = mod(i + 1, n);
      const dx = (height[j * n + ip]! - height[j * n + im]!) * k;
      const dy = (height[jp + i]! - height[jm + i]!) * k;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const q = (j * n + i) * 4;
      normal[q] = byte((-dx / len) * 127.5 + 127.5);
      normal[q + 1] = byte((-dy / len) * 127.5 + 127.5);
      normal[q + 2] = byte((1 / len) * 127.5 + 127.5);
      normal[q + 3] = 255;
    }
  }
  return { options: o, albedo, normal, orm, emissive, height, seam, seamDistance, owner, heat };
}

/** What the slab's material needs of a tile: the four byte maps (the analysis fields stay with generateScaleMaps). */
export type SlabMaps = Pick<ScaleMaps, 'options' | 'albedo' | 'normal' | 'orm' | 'emissive'>;

const cache = new Map<string, SlabMaps>();

/**
 * generateScaleMaps, computed once per option set (a rebuild for another seat or quality level reuses it). The page
 * keeps only the four byte maps (≈ 9 MB at 768 px); the float and index fields used by tests are dropped.
 */
export function scaleMaps(partial: Partial<ScaleOptions> = {}): SlabMaps {
  const key = JSON.stringify({ ...DEFAULT_SCALE_OPTIONS, ...partial });
  let m = cache.get(key);
  if (!m) {
    const { options, albedo, normal, orm, emissive } = generateScaleMaps(partial);
    m = { options, albedo, normal, orm, emissive };
    cache.set(key, m);
  }
  return m;
}
