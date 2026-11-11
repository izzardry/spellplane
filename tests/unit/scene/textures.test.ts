// Texture tiers and cache, DESIGN "Specification: geometry, layout and motion" (Texture tiers).
import { describe, expect, it } from 'vitest';
import { TEXTURE_CAP_BYTES, TextureLru, tierBytes, tierForScreenHeight, type CacheEntry } from '../../../src/scene/textures';

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
