// The looks' procedural textures (PLAN M7-P1: "Procedural textures only (no downloaded assets)"; DESIGN "Themes and
// rendering", Assets: no Wizards artwork, logos or the official card back; util/texture.ts: "same input, same
// picture"; tiled maps repeat every `tileMm`, so a tile must meet itself without a seam). Painted into a pixel-buffer
// stand-in of a 2D canvas (no canvas in Node).
import { describe, expect, it } from 'vitest';
import { CODEX_BACK, EBONY, LEATHER } from '../../../../src/themes/codex/textures';
import { GRAPHITE_BACK, DOT_PITCH_MM, PLINTH, SLATE, SLATE_TILE_MM } from '../../../../src/themes/graphite/textures';
import { valueNoise } from '../../../../src/themes/kit/procedural';
import { weaveHeights } from '../../../../src/themes/kit/surfaces';
import { KITCHEN_BACK, LINEN, WALNUT } from '../../../../src/themes/kitchen/textures';
import type { Canvas2D, TextureSource } from '../../../../src/util/texture';
import { recordingContext } from '../stonetable/helpers';

/** Paint a source and return its pixels (RGBA) and the canvas calls it made. */
function paint(src: TextureSource): { data: Uint8ClampedArray; w: number; h: number; calls: string[] } {
  const { ctx, calls } = recordingContext();
  let data: Uint8ClampedArray = new Uint8ClampedArray(0);
  const c = ctx as unknown as Record<string, unknown>;
  c.putImageData = (img: { data: Uint8ClampedArray }) => {
    data = img.data;
  };
  src.draw(ctx as Canvas2D, src.width, src.height);
  return { data, w: src.width, h: src.height, calls: calls.map((x) => x.name) };
}

const MAPS: TextureSource[] = [LINEN.albedo, LINEN.normal, WALNUT, SLATE.albedo, SLATE.normal, PLINTH.albedo, PLINTH.normal, LEATHER.albedo, LEATHER.normal, EBONY];
const BACKS: TextureSource[] = [KITCHEN_BACK, GRAPHITE_BACK, CODEX_BACK];

/** Mean absolute difference between neighbouring columns across the tile's wrap and inside it (red channel). */
function seam(p: { data: Uint8ClampedArray; w: number; h: number }): { wrap: number; inside: number } {
  const at = (x: number, y: number) => p.data[(y * p.w + x) * 4]!;
  let wrap = 0;
  let inside = 0;
  for (let y = 0; y < p.h; y++) {
    wrap += Math.abs(at(0, y) - at(p.w - 1, y));
    inside += Math.abs(at(p.w / 2, y) - at(p.w / 2 - 1, y));
  }
  return { wrap: wrap / p.h, inside: inside / p.h };
}

describe('surface maps', () => {
  it.each(MAPS.map((m) => [m.id, m] as const))('%s paints the same picture every time (deterministic)', (_id, src) => {
    const a = paint(src);
    const b = paint(src);
    expect(a.data.length).toBe(src.width * src.height * 4);
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
  });

  it.each(MAPS.map((m) => [m.id, m] as const))('%s tiles without a seam: its wrap differs no more than its neighbouring columns do', (_id, src) => {
    const s = seam(paint(src));
    expect(s.wrap).toBeLessThanOrEqual(s.inside * 2.5 + 4);
  });

  it('keeps grey maps quiet: the linen and slate albedos stay within their grey range, so the material colour sets the hue', () => {
    for (const src of [LINEN.albedo, SLATE.albedo, PLINTH.albedo]) {
      const { data } = paint(src);
      for (let i = 0; i < data.length; i += 4 * 97) {
        expect(data[i]).toBe(data[i + 1]);
        expect(data[i]).toBe(data[i + 2]);
        expect(data[i]!).toBeGreaterThanOrEqual(190);
      }
    }
  });

  it('prints Graphite’s dot grid every DOT_PITCH_MM: bright dots at the grid points, grain between them', () => {
    const { data, w } = paint(SLATE.albedo);
    const pxPerMm = w / SLATE_TILE_MM;
    const step = DOT_PITCH_MM * pxPerMm;
    const at = (x: number, y: number) => data[(Math.round(y) * w + Math.round(x)) * 4]!;
    for (let i = 0; i < SLATE_TILE_MM / DOT_PITCH_MM; i++) {
      const c = step / 2 + i * step - 0.5;
      expect(at(c, c)).toBeGreaterThan(240);
      expect(at(c + step / 2, c)).toBeLessThan(232);
    }
  });

  it('normal maps point up on average (a gentle relief, not a slope)', () => {
    for (const src of [LINEN.normal, SLATE.normal, LEATHER.normal]) {
      const { data } = paint(src);
      let r = 0;
      let g = 0;
      let b = 0;
      const n = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]!;
        g += data[i + 1]!;
        b += data[i + 2]!;
      }
      expect(Math.abs(r / n - 127.5)).toBeLessThan(6);
      expect(Math.abs(g / n - 127.5)).toBeLessThan(6);
      expect(b / n).toBeGreaterThan(220);
    }
  });

  it('weaves threads and value noise that wrap exactly', () => {
    const n = 64;
    const h = weaveHeights(n, 8, 3);
    expect(Math.min(...h)).toBe(0);
    expect(Math.max(...h)).toBe(1);
    const v = valueNoise(n, 4, 4, 5);
    for (let y = 0; y < n; y++) expect(Math.abs(v[y * n]! - v[y * n + n - 1]!)).toBeLessThan(0.2);
  });
});

describe('card backs', () => {
  it.each(BACKS.map((m) => [m.id, m] as const))('%s is geometric canvas drawing only: no images, no text, card-shaped', (_id, src) => {
    const { calls } = paint(src);
    expect(calls).not.toContain('drawImage');
    expect(calls).not.toContain('fillText');
    expect(calls).not.toContain('strokeText');
    expect(calls.length).toBeGreaterThan(5);
    expect(src.width / src.height).toBeCloseTo(63 / 88, 2);
  });

  it('gives each look its own back, apart from the others and from the game’s neutral back', () => {
    expect(new Set(BACKS.map((b) => b.id)).size).toBe(3);
    for (const b of BACKS) expect(b.id).not.toBe('mtg-back');
  });
});
