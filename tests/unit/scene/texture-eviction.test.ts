/**
 * PLAN M5-P6 performance pass on texture eviction. DESIGN "Specification: geometry, layout and motion", Texture tiers:
 * at most 400 MB of decoded textures, least recently drawn evicted first, thumbnails pinned; PLAN M4 Performance:
 * texture memory under 400 MB. Asserted on the cache's own bookkeeping (no timing): which texture goes, how many entries
 * the cache looks at to find it, and the bytes it and the face arrays hold under an ego-rig workload.
 */
import { describe, expect, it } from 'vitest';
import type { ImageTier } from '../../../src/data/types';
import { layerBytesOf, slotsPerLayer } from '../../../src/scene/atlas';
import { FACE_BUDGET_HEADROOM, MIP_FACTOR, TEXTURE_CAP_BYTES, TIERS, TextureLru, grownLayers, tierBytes, type CacheEntry } from '../../../src/scene/textures';
import { mulberry32 } from '../../../src/util/prng';

const entry = (key: string, tier: ImageTier, frame: number, pinned = false): CacheEntry => ({ key, tier, bytes: tierBytes(tier), pinned, lastDrawn: frame, slot: 0 });

describe('the LRU picks the least recently drawn texture (reference model)', () => {
  it('matches a full scan over random adds, draws and evictions', () => {
    const rand = mulberry32(5);
    const lru = new TextureLru(tierBytes('large') * 40);
    let frame = 1;
    let n = 0;
    for (let step = 0; step < 4000; step++) {
      if (rand() < 0.3) frame++;
      const r = rand();
      const all = lru.all();
      if (r < 0.45 && all.length > 0) {
        lru.touch(all[Math.floor(rand() * all.length)]!, frame);
        continue;
      }
      const tier = TIERS[Math.floor(rand() * 3)]!;
      const pinned = tier === 'small' && rand() < 0.5;
      const tierFull = rand() < 0.2;
      // What a full scan would evict first: the oldest evictable entry (of the tier when the tier is full).
      const evictable = (t?: ImageTier) => lru.all().filter((e) => !e.pinned && e.lastDrawn < frame && (!t || e.tier === t));
      const oldestOf = (t?: ImageTier) => Math.min(...evictable(t).map((e) => e.lastDrawn));
      const expectFirst = tierFull ? oldestOf(tier) : lru.bytes + tierBytes(tier) > lru.cap ? oldestOf() : null;
      const room = lru.makeRoom(tier, tierBytes(tier), frame, tierFull, pinned);
      if (room.evicted.length > 0) expect(room.evicted[0]!.lastDrawn).toBe(expectFirst);
      for (const e of room.evicted) {
        expect(e.pinned).toBe(false);
        expect(e.lastDrawn).toBeLessThan(frame);
      }
      if (room.ok) lru.add(entry(`k${n++}`, tier, frame, pinned));
      if (!pinned && room.ok) {
        const unpinned = lru.all().filter((e) => !e.pinned).reduce((b, e) => b + e.bytes, 0);
        const pinnedBytes = lru.bytes - unpinned;
        expect(lru.bytes).toBeLessThanOrEqual(Math.max(lru.cap, pinnedBytes + tierBytes(tier)));
      }
    }
  });
});

describe('eviction looks at a bounded number of entries, whatever the cache holds', () => {
  it.each([200, 2000])('%i cached textures: each eviction looks at no more than one entry per tier', (count) => {
    const lru = new TextureLru(tierBytes('normal') * count);
    for (let i = 0; i < count; i++) lru.add(entry(`n${i}`, 'normal', i));
    for (let i = 0; i < 300; i++) lru.add(entry(`t${i}`, 'small', 0, true));
    // The table keeps drawing: each frame touches a moving window of 60 of them.
    let evictions = 0;
    const before = lru.examined;
    for (let frame = count; frame < count + 200; frame++) {
      for (let k = 0; k < 60; k++) {
        const e = lru.get(`n${(frame * 7 + k) % count}`, 'normal');
        if (e) lru.touch(e, frame);
      }
      const room = lru.makeRoom('normal', tierBytes('normal'), frame, false);
      expect(room.ok).toBe(true);
      evictions += room.evicted.length;
      lru.add(entry(`m${frame}`, 'normal', frame));
    }
    expect(evictions).toBeGreaterThan(150);
    // At most one look per tier for each victim, plus one per tier for the check that ends the loop.
    expect((lru.examined - before) / evictions).toBeLessThanOrEqual(2 * TIERS.length);
  });
});

/**
 * A model of scene/faces.ts FaceTextures.pump (the GPU arrays are the only part left out): each tier's array grows by
 * doubling up to what the face budget allows (scene/textures.ts grownLayers), a full array frees a slot of its own tier,
 * and the decoded cache evicts the least recently drawn texture under the cap.
 */
class FaceModel {
  readonly lru = new TextureLru(TEXTURE_CAP_BYTES);
  readonly layers: Record<ImageTier, number> = { small: 1, normal: 1, large: 1 };
  readonly used: Record<ImageTier, number> = { small: 0, normal: 0, large: 0 };
  constructor(readonly budget: number) {}

  gpuBytes(tier?: ImageTier): number {
    return (tier ? [tier] : TIERS).reduce((b, t) => b + this.layers[t] * layerBytesOf(t) * MIP_FACTOR, 0);
  }

  private growTarget(tier: ImageTier): number {
    if (tier === 'small') return this.layers.small * 2;
    const others = TIERS.filter((t) => t !== tier).reduce((b, t) => b + this.gpuBytes(t), 0);
    return grownLayers({ layers: this.layers[tier], maxLayers: 64, layerBytes: layerBytesOf(tier) }, others, this.budget);
  }

  upload(key: string, tier: ImageTier, frame: number): boolean {
    if (this.lru.get(key, tier)) return true;
    let free = this.used[tier] < this.layers[tier] * slotsPerLayer(tier);
    if (!free) {
      const to = this.growTarget(tier);
      if (to > this.layers[tier]) {
        this.layers[tier] = to;
        free = true;
      }
    }
    const room = this.lru.makeRoom(tier, tierBytes(tier), frame, !free, tier === 'small');
    for (const e of room.evicted) this.used[e.tier]--;
    if (!room.ok) return false;
    this.used[tier]++;
    this.lru.add(entry(key, tier, frame, tier === 'small'));
    return true;
  }

  /** Draw `key` wanting `tier`: touch the best resident tier (and the thumbnail). */
  draw(key: string, tier: ImageTier, frame: number): ImageTier | null {
    for (let i = TIERS.indexOf(tier); i >= 0; i--) {
      const e = this.lru.get(key, TIERS[i]!);
      if (e) {
        this.lru.touch(e, frame);
        return TIERS[i]!;
      }
    }
    return null;
  }
}

describe('the ego rig under the 400 MB cap (texture eviction with the face budget headroom)', () => {
  /** A theme's own textures (environment, shadow maps, bloom targets) taken from the cap, as a lit theme has. */
  const THEME_BYTES = 48 * 1024 * 1024;
  const budget = TEXTURE_CAP_BYTES - THEME_BYTES - FACE_BUDGET_HEADROOM;

  it('300 cards, the near ones in the large tier as the view sweeps the table: memory stays under the cap and the near cards stay sharp', () => {
    const model = new FaceModel(budget);
    const CARDS = 300;
    // The ego view: the near row (about two dozen cards) at the large tier, the middle distance at normal, the rest
    // thumbnails; the view sweeps across the whole table twice.
    const NEAR = 24;
    const MID = 60;
    let frame = 0;
    let sharpFrames = 0;
    let sampled = 0;
    for (let sweep = 0; sweep < 2; sweep++) {
      for (let at = 0; at < CARDS; at += 3) {
        const want = (i: number): ImageTier => (Math.abs(i - at) < NEAR / 2 ? 'large' : Math.abs(i - at) < MID / 2 ? 'normal' : 'small');
        // The view rests a moment every 15 cards (the player looks); otherwise it keeps moving.
        const rest = at % 15 === 12 ? 12 : 1;
        for (let r = 0; r < rest; r++) {
          frame++;
          for (let i = 0; i < CARDS; i++) model.draw(`c${i}`, want(i), frame);
          // Uploads for what is missing, as FaceTextures requests them (thumbnails first), a bounded number per frame.
          let budgetLeft = 12;
          for (let i = 0; i < CARDS && budgetLeft > 0; i++) if (!model.lru.get(`c${i}`, 'small') && model.upload(`c${i}`, 'small', frame)) budgetLeft--;
          for (let i = 0; i < CARDS && budgetLeft > 0; i++) {
            const t = want(i);
            if (t !== 'small' && !model.lru.get(`c${i}`, t) && model.upload(`c${i}`, t, frame)) budgetLeft--;
          }
          // The cap holds every frame: decoded textures (thumbnails pinned) and the arrays' GPU bytes with mip-maps.
          expect(model.lru.bytes).toBeLessThanOrEqual(TEXTURE_CAP_BYTES);
          expect(model.gpuBytes('normal') + model.gpuBytes('large')).toBeLessThanOrEqual(budget);
          expect(model.gpuBytes() + THEME_BYTES).toBeLessThan(TEXTURE_CAP_BYTES);
        }
        // Once the view rests (and the thumbnails of the first frames are in), every near card is drawn at the large
        // tier: the budget leaves room for the near row.
        const thumbs = Array.from({ length: CARDS }, (_, i) => i).every((i) => model.lru.get(`c${i}`, 'small'));
        if (rest > 1 && thumbs) {
          sampled++;
          const near = Array.from({ length: CARDS }, (_, i) => i).filter((i) => want(i) === 'large');
          if (near.every((i) => model.lru.get(`c${i}`, 'large'))) sharpFrames++;
        }
      }
    }
    expect(sampled).toBeGreaterThan(20);
    expect(sharpFrames).toBe(sampled);
    // Every card always has its thumbnail: a texture that does not fit shows a smaller tier, never nothing.
    for (let i = 0; i < CARDS; i++) expect(model.lru.get(`c${i}`, 'small')).toBeDefined();
  });

  it('the near row alone fits the large tier within the budget, with the thumbnails of a full four-player table beside it', () => {
    // Thumbnails of 300 cards plus a near row of large faces and a middle distance of normal ones.
    const thumbs = Math.ceil(300 / slotsPerLayer('small')) * layerBytesOf('small') * MIP_FACTOR;
    const nearRow = Math.ceil(24 / slotsPerLayer('large')) * layerBytesOf('large') * MIP_FACTOR;
    const middle = Math.ceil(60 / slotsPerLayer('normal')) * layerBytesOf('normal') * MIP_FACTOR;
    expect(thumbs + nearRow + middle).toBeLessThan(budget);
  });
});
