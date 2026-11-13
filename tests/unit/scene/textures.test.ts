// Texture tiers and cache, DESIGN "Specification: geometry, layout and motion" (Texture tiers).
import { describe, expect, it } from 'vitest';
import { MIP_FACTOR, TEXTURE_CAP_BYTES, TextureLru, grownLayers, tierBytes, tierForScreenHeight, type CacheEntry } from '../../../src/scene/textures';

describe('texture tiers', () => {
  it('146x204 below 160 px, 488x680 up to 560 px, 672x936 above', () => {
    expect(tierForScreenHeight(10)).toBe('small');
    expect(tierForScreenHeight(159.9)).toBe('small');
    expect(tierForScreenHeight(160)).toBe('normal');
    expect(tierForScreenHeight(560)).toBe('normal');
    expect(tierForScreenHeight(560.1)).toBe('large');
    expect(tierBytes('small')).toBe(146 * 204 * 4);
    expect(tierBytes('normal')).toBe(488 * 680 * 4);
    expect(tierBytes('large')).toBe(672 * 936 * 4);
  });
});

describe('decoded texture cache', () => {
  const entry = (key: string, tier: CacheEntry['tier'], frame: number, pinned = false): CacheEntry => ({ key, tier, bytes: tierBytes(tier), pinned, lastDrawn: frame, slot: 0 });

  it('caps decoded textures at 400 MB, evicting the least recently drawn first', () => {
    expect(TEXTURE_CAP_BYTES).toBe(400 * 1024 * 1024);
    const lru = new TextureLru();
    const per = tierBytes('large');
    const fit = Math.floor(TEXTURE_CAP_BYTES / per);
    for (let i = 0; i < fit; i++) {
      const r = lru.makeRoom('large', per, 1000, false);
      expect(r).toEqual({ ok: true, evicted: [] });
      lru.add(entry(`c${i}`, 'large', i));
    }
    expect(lru.bytes).toBeLessThanOrEqual(TEXTURE_CAP_BYTES);
    lru.touch(lru.get('c0', 'large')!, 999); // c0 drawn recently: c1 is now the oldest
    const r = lru.makeRoom('large', per, 1000, false);
    expect(r.ok).toBe(true);
    expect(r.evicted.map((e) => e.key)).toEqual(['c1']);
    expect(lru.get('c1', 'large')).toBeUndefined();
  });

  it('never evicts thumbnails (pinned) nor textures drawn in the current frame', () => {
    const lru = new TextureLru(tierBytes('normal') * 2);
    lru.add(entry('thumb', 'small', 0, true));
    lru.add(entry('now', 'normal', 5));
    const r = lru.makeRoom('normal', tierBytes('normal'), 5, false);
    expect(r.ok).toBe(false);
    expect(lru.get('thumb', 'small')).toBeDefined();
    expect(lru.get('now', 'normal')).toBeDefined();
  });

  it('a full tier frees a slot from the same tier', () => {
    const lru = new TextureLru();
    lru.add(entry('a', 'small', 1));
    lru.add(entry('b', 'normal', 2));
    lru.add(entry('c', 'normal', 3));
    const r = lru.makeRoom('normal', tierBytes('normal'), 10, true);
    expect(r.evicted.map((e) => `${e.tier}:${e.key}`)).toEqual(['normal:b']);
  });

  it('pinned thumbnails may exceed the cap rather than fail', () => {
    const lru = new TextureLru(tierBytes('small'));
    lru.add(entry('t1', 'small', 0, true));
    expect(lru.makeRoom('small', tierBytes('small'), 1, false, true).ok).toBe(true);
  });
});

describe('face array growth under the texture cap (PLAN M4 Performance: texture memory under 400 MB)', () => {
  const MB = 1024 * 1024;
  it('doubles while it fits, grows only as far as the budget allows, and never shrinks', () => {
    const a = { layers: 2, maxLayers: 64, layerBytes: 15 * MB };
    expect(grownLayers(a, 0, 400 * MB)).toBe(4);
    // 20 MB per layer with mip-maps: 100 MB of room holds 5 layers, so 4 → 5, not 8.
    expect(grownLayers({ ...a, layers: 4 }, 300 * MB, 400 * MB)).toBe(5);
    // No room left: stays.
    expect(grownLayers({ ...a, layers: 4 }, 390 * MB, 400 * MB)).toBe(4);
    expect(grownLayers({ ...a, layers: 4 }, 500 * MB, 400 * MB)).toBe(4);
    // The array's own maximum stands.
    expect(grownLayers({ ...a, layers: 3, maxLayers: 5 }, 0, 4000 * MB)).toBe(5);
  });
  it('whatever the start, the grown arrays stay within the budget', () => {
    const budget = 384 * MB;
    const layerBytes = [14.6 * MB, 16 * MB, 15.2 * MB];
    const layers = [1, 1, 1];
    for (let step = 0; step < 60; step++) {
      const i = 1 + (step % 2);
      const others = layers.reduce((n, l, j) => (j === i ? n : n + l * layerBytes[j]! * MIP_FACTOR), 0);
      layers[i] = grownLayers({ layers: layers[i]!, maxLayers: 64, layerBytes: layerBytes[i]! }, others, budget);
    }
    const total = layers.reduce((n, l, j) => n + l * layerBytes[j]! * MIP_FACTOR, 0);
    expect(total).toBeLessThanOrEqual(budget);
    expect(layers[1]! + layers[2]!).toBeGreaterThan(10);
  });
});
