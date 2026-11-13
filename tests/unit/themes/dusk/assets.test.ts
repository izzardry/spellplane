// Dusk's assets (PLAN M4-P3: "every asset is listed in docs/ASSETS.md with a CC0 source or is procedural"; DESIGN
// "Themes and rendering", Assets: procedural or CC0, "No Wizards artwork, logos or the official card back"; CLAUDE.md:
// no bundled card images or official back). Dusk bundles no files: textures, card back and sounds are code.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FELT_ALBEDO, FELT_NORMAL, FELT_TEXTURE_PX, DUSK_BACK, FELT_ALBEDO_RANGE, feltHeights, prng } from '../../../../src/themes/dusk/textures';
import { dusk } from '../../../../src/themes/dusk/index';
import { FELT, RAIL } from '../../../../src/themes/dusk/table';
import type { Canvas2D } from '../../../../src/util/texture';

/** A 2D context stand-in that records calls and keeps ImageData written with putImageData. */
function recordingContext(): { ctx: Canvas2D; calls: string[]; image: () => { data: Uint8ClampedArray; width: number; height: number } | null } {
  const calls: string[] = [];
  let image: { data: Uint8ClampedArray; width: number; height: number } | null = null;
  const gradient = { addColorStop: () => undefined };
  const ctx = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'createImageData') return (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
        if (prop === 'putImageData')
          return (img: { data: Uint8ClampedArray; width: number; height: number }) => {
            calls.push(prop);
            image = img;
          };
        if (prop === 'createRadialGradient' || prop === 'createLinearGradient')
          return () => {
            calls.push(prop);
            return gradient;
          };
        return (..._args: unknown[]) => {
          calls.push(prop);
        };
      },
      set: () => true,
    },
  ) as unknown as Canvas2D;
  return { ctx, calls, image: () => image };
}

describe('Dusk ships no files', () => {
  it('has no public/themes/dusk files that docs/ASSETS.md does not list', () => {
    const dir = path.join('public', 'themes', 'dusk');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String) : [];
    const manifest = fs.readFileSync(path.join('docs', 'ASSETS.md'), 'utf8');
    for (const f of files) expect(manifest, f).toContain(`public/themes/dusk/${f}`);
  });

  it('uses only procedural maps', () => {
    const specs = [FELT, RAIL, dusk.cardDressing.sleeveMaterial!];
    for (const s of specs) for (const m of Object.values(s.maps ?? {})) expect(m.kind).toBe('procedural');
  });

  it('lists its procedural modules in docs/ASSETS.md under Dusk, with no placeholder left', () => {
    const manifest = fs.readFileSync(path.join('docs', 'ASSETS.md'), 'utf8');
    const section = manifest.split(/^## /m).find((s) => s.startsWith('Dusk'))!;
    expect(section).toBeDefined();
    expect(section).not.toContain('To be filled');
    for (const mod of ['src/themes/dusk/textures.ts', 'src/themes/dusk/sounds.ts', 'src/themes/dusk/table.ts']) expect(section).toContain(mod);
    expect(section).toContain('procedural');
  });
});

describe('procedural textures', () => {
  it('use a deterministic generator', () => {
    const a = prng(42);
    const b = prng(42);
    const xs = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(xs);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('give the felt a nap in 0..1 that tiles without a seam', () => {
    const n = 64;
    const h = feltHeights(n);
    expect(feltHeights(n)).toEqual(h);
    for (const v of h) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // The step across the wrap (last column to first, last row to first) is no bigger than a step inside the tile.
    let inside = 0;
    let seam = 0;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n - 1; x++) inside += Math.abs(h[y * n + x + 1]! - h[y * n + x]!);
      seam += Math.abs(h[y * n]! - h[y * n + n - 1]!);
    }
    for (let x = 0; x < n; x++) seam += Math.abs(h[x]! - h[(n - 1) * n + x]!);
    const insideMean = inside / (n * (n - 1));
    const seamMean = seam / (2 * n);
    expect(seamMean).toBeLessThan(insideMean * 1.6);
  });

  it('draw the felt albedo grey, so the nap never changes the felt’s hue', () => {
    const r = recordingContext();
    FELT_ALBEDO.draw(r.ctx, FELT_TEXTURE_PX, FELT_TEXTURE_PX);
    const img = r.image()!;
    expect(img.width).toBe(FELT_TEXTURE_PX);
    const [lo, hi] = FELT_ALBEDO_RANGE;
    for (let i = 0; i < img.data.length; i += 4) {
      expect(img.data[i]).toBe(img.data[i + 1]);
      expect(img.data[i]).toBe(img.data[i + 2]);
      expect(img.data[i]!).toBeGreaterThanOrEqual(lo);
      expect(img.data[i]!).toBeLessThanOrEqual(hi);
      expect(img.data[i + 3]).toBe(255);
    }
  });

  it('draw a normal map of unit normals pointing up', () => {
    const r = recordingContext();
    FELT_NORMAL.draw(r.ctx, 64, 64);
    const img = r.image()!;
    for (let i = 0; i < img.data.length; i += 4) {
      const [x, y, z] = [0, 1, 2].map((k) => (img.data[i + k]! / 255) * 2 - 1) as [number, number, number];
      expect(z).toBeGreaterThan(0.5);
      expect(Math.hypot(x, y, z)).toBeGreaterThan(0.97);
      expect(Math.hypot(x, y, z)).toBeLessThan(1.03);
    }
  });

  it('draw the card back with geometry only, no image (no official back)', () => {
    const r = recordingContext();
    DUSK_BACK.draw(r.ctx, DUSK_BACK.width, DUSK_BACK.height);
    expect(r.calls).not.toContain('drawImage');
    expect(r.calls).not.toContain('fillText');
    expect(r.calls.filter((c) => c === 'fill' || c === 'fillRect').length).toBeGreaterThan(3);
    expect(r.calls).toContain('stroke');
  });
});
