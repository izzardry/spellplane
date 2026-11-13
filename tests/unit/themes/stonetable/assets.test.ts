// Stonetable's procedural assets (PLAN M4-P5: "every asset is listed in docs/ASSETS.md with a CC0 source or is
// procedural"; DESIGN "Themes and rendering", Assets: stone from PBR materials, rune effects generated, "Ornament stays
// geometric (scales, knotwork, runes) so it can be generated procedurally. No Wizards artwork, logos or the official card
// back are bundled"). The slab maps must tile seamlessly (the slab repeats them across every table size), be the same on
// every build, and the normal map must be a valid tangent-space map.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BAND_RUNES, GLYPHS, RUNE_BAND, STONE_BACK, glyphProblems } from '../../../../src/themes/stonetable/runes';
import {
  STONE_DARK,
  STONE_LIGHT,
  STONE_MAPS,
  STONE_MAP_PX,
  albedoPixels,
  fbm,
  generateStoneField,
  normalPixels,
  periodicNoise,
  roughnessPixels,
  stoneField,
  type Pixels,
} from '../../../../src/themes/stonetable/stone';
import { numbers, recordingContext } from './helpers';

const ROOT = path.resolve(__dirname, '../../../..');
const field = stoneField();
const N = field.size;

/** Mean absolute difference of channel `ch` between columns (or rows) a and b. */
function seam(p: Pixels, a: number, b: number, axis: 'col' | 'row', ch = 0): number {
  let sum = 0;
  for (let k = 0; k < N; k++) {
    const i = axis === 'col' ? (k * N + a) * 4 : (a * N + k) * 4;
    const j = axis === 'col' ? (k * N + b) * 4 : (b * N + k) * 4;
    sum += Math.abs(p[i + ch]! - p[j + ch]!);
  }
  return sum / N;
}

describe('procedural stone', () => {
  it('noise is periodic: one tile continues into the next', () => {
    for (const [x, y] of [[0.3, 0.7], [2.9, 1.1], [5.5, 0]]) {
      expect(periodicNoise(x! + 8, y!, 8, 3)).toBeCloseTo(periodicNoise(x!, y!, 8, 3), 12);
      expect(periodicNoise(x!, y! + 8, 8, 3)).toBeCloseTo(periodicNoise(x!, y!, 8, 3), 12);
    }
    expect(fbm(0, 0.25, 4, 4, 1)).toBeCloseTo(fbm(1, 0.25, 4, 4, 1), 12);
  });

  it('is deterministic (same pixels on every build, no randomness) and seeded', () => {
    const a = generateStoneField(64, 7);
    const b = generateStoneField(64, 7);
    expect(a.height).toEqual(b.height);
    expect(albedoPixels(a)).toEqual(albedoPixels(b));
    expect(generateStoneField(64, 8).height).not.toEqual(a.height);
    // The maps share one memoised field.
    expect(stoneField()).toBe(field);
  });

  it.each([
    ['albedo', albedoPixels(field)],
    ['normal', normalPixels(field)],
    ['roughness', roughnessPixels(field)],
  ] as const)('%s map tiles without a seam (wrap edge no rougher than the inside)', (_name, p) => {
    for (const ch of [0, 1, 2]) {
      // Typical neighbour difference inside the tile, against the difference across the wrap.
      let inside = 0;
      for (let c = 0; c < N - 1; c++) inside += seam(p, c, c + 1, 'col', ch);
      inside /= N - 1;
      expect(seam(p, N - 1, 0, 'col', ch)).toBeLessThan(inside * 2.5 + 1);
      let insideRows = 0;
      for (let r = 0; r < N - 1; r++) insideRows += seam(p, r, r + 1, 'row', ch);
      insideRows /= N - 1;
      expect(seam(p, N - 1, 0, 'row', ch)).toBeLessThan(insideRows * 2.5 + 1);
    }
  });

  it('albedo stays between the dark and light stone, opaque, with visible grain', () => {
    const p = albedoPixels(field);
    let min = 255;
    let max = 0;
    for (let i = 0; i < p.length; i += 4) {
      for (let ch = 0; ch < 3; ch++) {
        expect(p[i + ch]!).toBeGreaterThanOrEqual(STONE_DARK[ch]!);
        expect(p[i + ch]!).toBeLessThanOrEqual(STONE_LIGHT[ch]!);
      }
      expect(p[i + 3]).toBe(255);
      min = Math.min(min, p[i]!);
      max = Math.max(max, p[i]!);
    }
    expect(max - min).toBeGreaterThan(25);
  });

  it('normal map holds unit normals facing out of the slab, with real relief', () => {
    const p = normalPixels(field);
    let tilted = 0;
    for (let i = 0; i < p.length; i += 4) {
      const v = [0, 1, 2].map((k) => p[i + k]! / 127.5 - 1);
      expect(Math.hypot(...v)).toBeGreaterThan(0.97);
      expect(Math.hypot(...v)).toBeLessThan(1.03);
      expect(v[2]).toBeGreaterThan(0.3);
      if (v[2]! < 0.97) tilted++;
    }
    // Carved, not polished: a good share of the surface tilts by more than ~14°.
    expect(tilted / (N * N)).toBeGreaterThan(0.05);
  });

  it('roughness is grey (the same in every channel) and rough like stone', () => {
    const p = roughnessPixels(field);
    for (let i = 0; i < p.length; i += 4) {
      expect(p[i]).toBe(p[i + 1]);
      expect(p[i]).toBe(p[i + 2]);
      expect(p[i]! / 255).toBeGreaterThanOrEqual(0.6);
      expect(p[i]! / 255).toBeLessThanOrEqual(0.97);
    }
  });

  it('maps are small (at most 1K, the asset rule for theme materials) and drawn through image data', () => {
    for (const src of Object.values(STONE_MAPS)) {
      expect(src.width).toBe(STONE_MAP_PX);
      expect(src.height).toBe(STONE_MAP_PX);
      expect(src.width).toBeLessThanOrEqual(1024);
      const { ctx, calls } = recordingContext();
      src.draw(ctx, src.width, src.height);
      const put = calls.find((c) => c.name === 'putImageData')!;
      expect(put).toBeDefined();
      expect((put.args[0] as ImageData).data.length).toBe(STONE_MAP_PX * STONE_MAP_PX * 4);
    }
    expect(new Set(Object.values(STONE_MAPS).map((s) => s.id)).size).toBe(3);
  });
});

describe('procedural runes', () => {
  it('the alphabet is sixteen distinct straight-stroke glyphs inside their cells', () => {
    expect(glyphProblems()).toEqual([]);
    expect(GLYPHS).toHaveLength(16);
    expect(new Set(GLYPHS.map((g) => JSON.stringify(g))).size).toBe(GLYPHS.length);
    expect(glyphProblems([[[[0, 0]]], [[[0, 0], [1.2, 0]]], []])).toEqual(['glyph 0 has a stroke with fewer than two points', 'glyph 1 leaves the unit cell at 1.2,0', 'glyph 2 has no strokes']);
  });

  it('the rune band draws every rune inside its strip, on a transparent ground', () => {
    const { ctx, calls } = recordingContext();
    RUNE_BAND.draw(ctx, RUNE_BAND.width, RUNE_BAND.height);
    expect(calls[0]!.name).toBe('clearRect');
    expect(calls.filter((c) => c.name === 'fillRect')).toEqual([]);
    for (const c of calls.filter((x) => x.name === 'moveTo' || x.name === 'lineTo')) {
      const [x, y] = numbers(c);
      expect(x).toBeGreaterThanOrEqual(-RUNE_BAND.height * 0.1);
      expect(x).toBeLessThanOrEqual(RUNE_BAND.width + RUNE_BAND.height * 0.1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(RUNE_BAND.height);
    }
    // Groove, halo and core per rune: three strokes each, plus the frame and the lozenges.
    expect(calls.filter((c) => c.name === 'stroke').length).toBeGreaterThanOrEqual(BAND_RUNES * 3);
    // Tiles are wider than tall, so runes repeat along the band without stretching (BAND_ASPECT).
    expect(RUNE_BAND.width / RUNE_BAND.height).toBe(16);
  });

  it('the card back is opaque (fills the whole card first) and stays inside it', () => {
    const { ctx, calls } = recordingContext();
    STONE_BACK.draw(ctx, STONE_BACK.width, STONE_BACK.height);
    expect(calls[0]).toEqual({ name: 'fillRect', args: [0, 0, STONE_BACK.width, STONE_BACK.height] });
    for (const c of calls.filter((x) => x.name === 'moveTo' || x.name === 'lineTo' || x.name === 'arc')) {
      const [x, y] = numbers(c);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(STONE_BACK.width);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(STONE_BACK.height);
    }
  });
});

describe('docs/ASSETS.md lists Stonetable', () => {
  const md = fs.readFileSync(path.join(ROOT, 'docs', 'ASSETS.md'), 'utf8');
  const section = md.split(/^## /m).find((s) => s.startsWith('Stonetable'))!;
  const rows = section
    .split('\n')
    .filter((l) => l.startsWith('| `'))
    .map((l) => l.replace(/^\||\|$/g, '').split('|').map((x) => x.trim()));

  it('with a row per generating module, each procedural', () => {
    const listed = rows.map((r) => r[0]!.replace(/`/g, ''));
    for (const f of ['src/themes/stonetable/stone.ts', 'src/themes/stonetable/runes.ts', 'src/themes/stonetable/motes.ts', 'src/themes/stonetable/sounds.ts']) expect(listed).toContain(f);
    for (const r of rows) {
      expect(r).toHaveLength(6);
      expect(fs.existsSync(path.join(ROOT, r[0]!.replace(/`/g, '')))).toBe(true);
      expect(r[3]).toBe('procedural');
      expect(['texture', 'shader', 'sound']).toContain(r[2]);
    }
  });

  it('and bundles no asset files of its own (nothing to license, nothing fetched)', () => {
    const files = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String) : []);
    const binary = /\.(png|jpe?g|webp|avif|ktx2|basis|hdr|exr|glb|gltf|bin|mp3|ogg|opus|wav)$/i;
    expect(files(path.join(ROOT, 'src', 'themes', 'stonetable')).filter((f) => binary.test(f))).toEqual([]);
    expect(files(path.join(ROOT, 'public', 'themes', 'stonetable')).filter((f) => binary.test(f))).toEqual([]);
  });
});
