// DESIGN "Themes and rendering": Wyrm's table is "an obsidian slab with a geometric scale relief and ember-lit seams";
// Assets: "Ornament stays geometric (scales, knotwork, runes) so it can be generated procedurally". The slab's maps are
// computed by themes/wyrm/scales.ts: these tests hold it to a tileable, deterministic scale relief whose glow lives in
// the seams only.
import { describe, expect, it } from 'vitest';
import { DEFAULT_SCALE_OPTIONS, generateScaleMaps, hash01, scaleHeat, scaleMaps } from '../../../../src/themes/wyrm/scales';

const SIZE = 128;
const maps = generateScaleMaps({ size: SIZE });
const at = (i: number, j: number) => j * SIZE + i;

describe('Wyrm scale relief', () => {
  it('is deterministic: the same options give the same bytes', () => {
    const again = generateScaleMaps({ size: SIZE });
    for (const k of ['albedo', 'normal', 'orm', 'emissive'] as const) expect(Buffer.from(again[k]).equals(Buffer.from(maps[k])), k).toBe(true);
    const other = generateScaleMaps({ size: SIZE, seed: 99 });
    // Another seed changes which scales run hot, not the relief.
    expect(Buffer.from(other.emissive).equals(Buffer.from(maps.emissive))).toBe(false);
    expect(Array.from(other.height)).toEqual(Array.from(maps.height));
  });

  it('gives every pixel to a scale, with cols × 2·cols scales per tile, each of them showing', () => {
    const cols = DEFAULT_SCALE_OPTIONS.cols;
    const seen = new Set<number>();
    for (const o of maps.owner) {
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThan(cols * 2 * cols);
      seen.add(o);
    }
    expect(seen.size).toBe(cols * 2 * cols);
    expect(maps.heat).toHaveLength(cols * 2 * cols);
  });

  it('tiles seamlessly: the relief across the wrap is as smooth as inside the tile', () => {
    // The largest height step between horizontal (vertical) neighbours, inside and across the tile edge.
    let insideX = 0;
    let insideY = 0;
    let wrapX = 0;
    let wrapY = 0;
    for (let j = 0; j < SIZE; j++) for (let i = 0; i + 1 < SIZE; i++) insideX = Math.max(insideX, Math.abs(maps.height[at(i + 1, j)]! - maps.height[at(i, j)]!));
    for (let j = 0; j + 1 < SIZE; j++) for (let i = 0; i < SIZE; i++) insideY = Math.max(insideY, Math.abs(maps.height[at(i, j + 1)]! - maps.height[at(i, j)]!));
    for (let j = 0; j < SIZE; j++) wrapX = Math.max(wrapX, Math.abs(maps.height[at(0, j)]! - maps.height[at(SIZE - 1, j)]!));
    for (let i = 0; i < SIZE; i++) wrapY = Math.max(wrapY, Math.abs(maps.height[at(i, 0)]! - maps.height[at(i, SIZE - 1)]!));
    expect(wrapX).toBeLessThanOrEqual(insideX + 1e-6);
    expect(wrapY).toBeLessThanOrEqual(insideY + 1e-6);
    // The owner across the wrap continues the pattern: a pixel's right neighbour across the edge is a scale it borders.
    let same = 0;
    for (let j = 0; j < SIZE; j++) if (maps.owner[at(0, j)] === maps.owner[at(SIZE - 1, j)]) same++;
    expect(same / SIZE).toBeGreaterThan(0.5);
  });

  it('is a relief: grooves at the seams, raised scale faces, normals of unit length leaning out of the grooves', () => {
    let seamH = 0;
    let seamN = 0;
    let faceH = 0;
    let faceN = 0;
    for (let p = 0; p < maps.height.length; p++) {
      if (maps.seam[p]! > 0.9) {
        seamH += maps.height[p]!;
        seamN++;
      } else if (maps.seam[p] === 0) {
        faceH += maps.height[p]!;
        faceN++;
      }
      const n = [0, 1, 2].map((c) => maps.normal[p * 4 + c]! / 127.5 - 1);
      expect(Math.hypot(...n)).toBeCloseTo(1, 1);
      expect(n[2]).toBeGreaterThan(0);
    }
    expect(seamN).toBeGreaterThan(0);
    expect(faceN).toBeGreaterThan(seamN);
    expect(seamH / seamN).toBeLessThan(0.15);
    expect(faceH / faceN).toBeGreaterThan(0.4);
    // Seams are lines, not areas: a small part of the tile.
    expect(seamN / maps.height.length).toBeLessThan(0.15);
  });

  it('glows only in the seams, and some seams run much hotter than others (ember-lit)', () => {
    let lit = 0;
    const seamGlow: number[] = [];
    for (let p = 0; p < maps.seam.length; p++) {
      const e = maps.emissive[p * 4]! + maps.emissive[p * 4 + 1]! + maps.emissive[p * 4 + 2]!;
      if (e > 0) {
        lit++;
        expect(maps.seam[p], `pixel ${p} glows outside a seam`).toBeGreaterThan(0);
      }
      if (maps.seam[p]! > 0.9) seamGlow.push(e);
    }
    expect(lit).toBeGreaterThan(0);
    seamGlow.sort((a, b) => a - b);
    const p10 = seamGlow[Math.floor(seamGlow.length * 0.1)]!;
    const p95 = seamGlow[Math.floor(seamGlow.length * 0.95)]!;
    expect(p95).toBeGreaterThan(3 * Math.max(1, p10));
    // Embers are warm: red over green over blue wherever there is glow.
    for (let p = 0; p < maps.seam.length; p += 7) {
      const [r, g, b] = [maps.emissive[p * 4]!, maps.emissive[p * 4 + 1]!, maps.emissive[p * 4 + 2]!];
      if (r + g + b > 30) expect(r >= g && g >= b).toBe(true);
    }
  });

  it('is obsidian: near-black albedo, glossy faces, rough seams, no metal', () => {
    let sum = 0;
    for (let p = 0; p < maps.seam.length; p++) {
      const [r, g, b] = [maps.albedo[p * 4]!, maps.albedo[p * 4 + 1]!, maps.albedo[p * 4 + 2]!];
      expect(Math.max(r, g, b)).toBeLessThan(40);
      sum += r + g + b;
      expect(maps.orm[p * 4 + 2]).toBe(0);
      if (maps.seamDistance[p]! > 0.1) expect(maps.orm[p * 4 + 1]! / 255).toBeLessThan(0.3);
      if (maps.seam[p]! > 0.95) expect(maps.orm[p * 4 + 1]! / 255).toBeGreaterThan(0.5);
    }
    expect(sum / (3 * maps.seam.length)).toBeLessThan(30);
  });

  it('heat is in 0..1, varied, and wraps with the tile; the hash is stable', () => {
    const h = scaleHeat(8, 7);
    expect(Math.min(...h)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...h)).toBeLessThanOrEqual(1);
    expect(Math.max(...h) - Math.min(...h)).toBeGreaterThan(0.5);
    expect(hash01(3, 4, 5)).toBe(hash01(3, 4, 5));
    expect(hash01(3, 4, 5)).not.toBe(hash01(4, 3, 5));
  });

  it('rejects radii that would leave holes, and computes a tile once', () => {
    expect(() => generateScaleMaps({ size: 16, radius: 0.5 })).toThrow();
    expect(() => generateScaleMaps({ size: 4 })).toThrow();
    expect(scaleMaps({ size: 32 })).toBe(scaleMaps({ size: 32 }));
    // The page cache keeps only the four byte maps, the same bytes generateScaleMaps computes.
    const cached = scaleMaps({ size: 32 });
    expect(Object.keys(cached).sort()).toEqual(['albedo', 'emissive', 'normal', 'options', 'orm']);
    const full = generateScaleMaps({ size: 32 });
    for (const k of ['albedo', 'normal', 'orm', 'emissive'] as const) expect(cached[k]).toEqual(full[k]);
  });
});
