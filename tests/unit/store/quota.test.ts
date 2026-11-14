/**
 * PLAN M5-P3: a storage estimate shown in settings, image cache limits with LRU eviction (store/quota.ts), and the
 * persistent-storage request (DESIGN "Card data and images", Caching: the app requests persistent storage but never
 * depends on it). The browser's StorageManager and CacheStorage are fakes.
 */
import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_ENTRIES } from '../../../src/store/images';
import { countImageEntries, formatBytes, IMAGE_CACHE_LIMITS, IMAGE_ENTRY_BYTES, imageEntryLimit, storageStatus, type CacheCounter, type QuotaApi, type StorageStatus } from '../../../src/store/quota';

function api(over: Partial<{ usage: unknown; quota: unknown; persisted: boolean; estimateFails: boolean; persistedFails: boolean }> = {}): QuotaApi {
  return {
    estimate: async () => {
      if (over.estimateFails) throw new Error('SecurityError');
      return { usage: over.usage, quota: over.quota } as StorageEstimate;
    },
    persisted: async () => {
      if (over.persistedFails) throw new Error('nope');
      return over.persisted ?? false;
    },
    persist: async () => true,
  };
}

function cachesWith(entries: Record<string, number>, fails = false): CacheCounter {
  return {
    has: async (name: string) => {
      if (fails) throw new DOMException('blocked', 'SecurityError');
      return Object.hasOwn(entries, name);
    },
    open: async (name: string) => ({ keys: async () => Array.from({ length: entries[name] ?? 0 }, (_, i) => new Request(`https://cards.scryfall.io/${i}.jpg`)) }) as unknown as Cache,
  };
}

const status = (s: Partial<StorageStatus>): StorageStatus => ({ usage: null, quota: null, persisted: false, imageEntries: null, ...s });

describe('storageStatus', () => {
  it('reports usage, quota, persistence and the image entries of the profile’s cache', async () => {
    const s = await storageStatus(api({ usage: 12_345_678, quota: 2_000_000_000, persisted: true }), cachesWith({ 'spellplane-images-a': 7 }), 'spellplane-images-a');
    expect(s).toEqual({ usage: 12_345_678, quota: 2_000_000_000, persisted: true, imageEntries: 7 });
  });

  it('counts only the named cache: another profile’s images are not this profile’s', async () => {
    const counter = cachesWith({ 'spellplane-images-a': 7, 'spellplane-images-b': 3 });
    expect((await storageStatus(api(), counter, 'spellplane-images-b')).imageEntries).toBe(3);
    // A profile that never cached an image has an empty cache, not an unknown one, and none is created by asking.
    expect((await storageStatus(api(), counter, 'spellplane-images-c')).imageEntries).toBe(0);
  });

  it('never throws: unsupported or failing parts read as null or false', async () => {
    expect(await storageStatus(undefined, undefined, 'x')).toEqual({ usage: null, quota: null, persisted: false, imageEntries: null });
    expect(await storageStatus(api({ estimateFails: true, persistedFails: true }), cachesWith({}, true), 'x')).toEqual({ usage: null, quota: null, persisted: false, imageEntries: null });
    // Estimates that are not finite non-negative numbers are unknown.
    expect(await storageStatus(api({ usage: -1, quota: Number.NaN }), undefined, 'x')).toMatchObject({ usage: null, quota: null });
    expect(await storageStatus(api({ usage: undefined, quota: 'lots' }), undefined, 'x')).toMatchObject({ usage: null, quota: null });
    // A StorageManager without estimate (old Safari) still says whether storage is persisted.
    expect(await storageStatus({ persisted: async () => true, persist: async () => true } as unknown as QuotaApi, undefined, 'x')).toMatchObject({ usage: null, persisted: true });
  });

  it('countImageEntries is null without the Cache API', async () => {
    expect(await countImageEntries(undefined, 'spellplane-images')).toBeNull();
  });
});

describe('imageEntryLimit', () => {
  const quota = 1_000_000_000;
  const share = quota * IMAGE_CACHE_LIMITS.quotaShare;

  it('keeps the entry limit while the origin uses at most its share of the quota', () => {
    expect(imageEntryLimit(status({ usage: 0, quota, imageEntries: 0 }))).toBe(MAX_IMAGE_ENTRIES);
    expect(imageEntryLimit(status({ usage: share, quota, imageEntries: 1500 }))).toBe(MAX_IMAGE_ENTRIES);
  });

  it('frees the overshoot when the origin uses more than its share', () => {
    // 10 MB over the share: 100 entries of IMAGE_ENTRY_BYTES go.
    const over = 100 * IMAGE_ENTRY_BYTES;
    expect(imageEntryLimit(status({ usage: share + over, quota, imageEntries: 1500 }))).toBe(1400);
    // A partial entry's worth still evicts a whole entry.
    expect(imageEntryLimit(status({ usage: share + 1, quota, imageEntries: 1500 }))).toBe(1499);
  });

  it('never goes below zero nor above the entry limit', () => {
    expect(imageEntryLimit(status({ usage: quota * 2, quota, imageEntries: 10 }))).toBe(0);
    expect(imageEntryLimit(status({ usage: share + IMAGE_ENTRY_BYTES, quota, imageEntries: MAX_IMAGE_ENTRIES + 500 }))).toBe(MAX_IMAGE_ENTRIES);
  });

  it('falls back to the entry limit when the browser does not say', () => {
    expect(imageEntryLimit(status({}))).toBe(MAX_IMAGE_ENTRIES);
    expect(imageEntryLimit(status({ usage: quota, quota: null, imageEntries: 5 }))).toBe(MAX_IMAGE_ENTRIES);
    expect(imageEntryLimit(status({ usage: quota, quota: 0, imageEntries: 5 }))).toBe(MAX_IMAGE_ENTRIES);
    expect(imageEntryLimit(status({ usage: quota, quota, imageEntries: null }))).toBe(MAX_IMAGE_ENTRIES);
  });
});

describe('formatBytes', () => {
  it('reads like a browser’s storage settings', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(12_345)).toBe('12.3 kB');
    expect(formatBytes(12_345_678)).toBe('12.3 MB');
    expect(formatBytes(250_000_000)).toBe('250 MB');
    expect(formatBytes(2_100_000_000)).toBe('2.1 GB');
  });
});
