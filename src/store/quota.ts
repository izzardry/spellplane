/**
 * Storage quota, persistence and image-cache limits (DESIGN "Card data and images", Caching: "All caches are
 * rebuildable; the app requests persistent storage but never depends on it"; "Specification: geometry, layout and
 * motion", Texture tiers; PLAN M5-P3: "image cache limits with LRU eviction, storage-persistence prompt"; PLAN Milestone
 * 5, owner decisions, Installable on iPad: "requests persistent storage"). Contracts: M5-C. Implementer: M5-P3.
 *
 * LRU order (DECISIONS [M5-C]): the image cache is the Cache API cache of store/images.ts, whose keys come back in
 * insertion order. A cache hit re-inserts its entry (put again), so insertion order is least-recently-used order and
 * eviction keeps deleting from the front, as `trimCache` does today. No extra IndexedDB store is needed.
 */
import { imageCacheName, MAX_IMAGE_ENTRIES } from './images';
import { isStoragePersisted, type PersistApi } from './persist';

/** Storage use as the settings' storage section and the debug hook show it (DESIGN "Card data and images", Caching). Added by M5-C. */
export interface StorageStatus {
  /** Bytes used by this origin, null when the browser does not say (StorageManager.estimate). */
  usage: number | null;
  /** Bytes this origin may use, null when unknown. */
  quota: number | null;
  /** Whether the browser granted persistent storage (store/persist.ts). */
  persisted: boolean;
  /** Entries in this profile's image cache, null without the Cache API. */
  imageEntries: number | null;
}

/** The part of StorageManager this module uses; injectable for tests. Added by M5-C. */
export type QuotaApi = PersistApi & Pick<StorageManager, 'estimate'>;

/**
 * Limits of the image cache (PLAN M5-P3: "image cache limits with LRU eviction"). The cache evicts least recently used
 * entries while it holds more than `maxEntries` or, when the quota is known, more than `quotaShare` of the quota is in
 * use by this origin. Values chosen by M5-C; M5-P3 may tune them. Added by M5-C.
 */
export const IMAGE_CACHE_LIMITS = {
  /** Same as store/images.ts MAX_IMAGE_ENTRIES (about 100–200 MB of normal-tier images). */
  maxEntries: MAX_IMAGE_ENTRIES,
  /** Share of the origin's quota the app lets its caches fill before evicting images. */
  quotaShare: 0.5,
} as const;

/**
 * What one cached image is assumed to cost when the quota forces eviction (M5-P3): a normal-tier JPG is 50–100 kB and a
 * large one up to 150 kB, so 100 kB per entry frees roughly what the overshoot needs without a size per entry.
 */
export const IMAGE_ENTRY_BYTES = 100_000;

/** The Cache API part `storageStatus` counts image entries with; injectable for tests. */
export type CacheCounter = Pick<CacheStorage, 'has' | 'open'>;

function defaultQuotaApi(): QuotaApi | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.storage;
}

function defaultCaches(): CacheCounter | undefined {
  return typeof caches === 'undefined' ? undefined : caches;
}

/** A finite, non-negative number, else null. */
function bytes(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/** Entries in the image cache named `name`, 0 when it does not exist yet, null without the Cache API. Never throws. */
export async function countImageEntries(cacheStorage: CacheCounter | undefined = defaultCaches(), name: string = imageCacheName(typeof location === 'undefined' ? null : location.href)): Promise<number | null> {
  if (!cacheStorage) return null;
  try {
    // `open` would create the cache; a profile that never cached an image has none.
    if (!(await cacheStorage.has(name))) return 0;
    return (await (await cacheStorage.open(name)).keys()).length;
  } catch {
    return null;
  }
}

/**
 * The origin's storage use, never throwing (unsupported parts read as null). `cacheStorage` and `cacheName` choose the
 * image cache to count (default: this page's profile). Implementer: M5-P3. Added by M5-C.
 */
export async function storageStatus(api: QuotaApi | undefined = defaultQuotaApi(), cacheStorage: CacheCounter | undefined = defaultCaches(), cacheName?: string): Promise<StorageStatus> {
  let usage: number | null = null;
  let quota: number | null = null;
  if (api && typeof api.estimate === 'function') {
    try {
      const e = await api.estimate();
      usage = bytes(e.usage);
      quota = bytes(e.quota);
    } catch {
      // Unknown: shown as "not reported by this browser".
    }
  }
  const [persisted, imageEntries] = await Promise.all([isStoragePersisted(api), cacheName === undefined ? countImageEntries(cacheStorage) : countImageEntries(cacheStorage, cacheName)]);
  return { usage, quota, persisted, imageEntries };
}

/**
 * How many image entries to keep given the current status (IMAGE_CACHE_LIMITS; LRU eviction above it): never more than
 * `maxEntries`; when usage and quota are known and the origin uses more than `quotaShare` of its quota, the entries
 * that cover the overshoot (at IMAGE_ENTRY_BYTES each) go as well, down to none. Implementer: M5-P3. Added by M5-C.
 */
export function imageEntryLimit(status: StorageStatus): number {
  const max = IMAGE_CACHE_LIMITS.maxEntries;
  const { usage, quota, imageEntries } = status;
  if (usage === null || quota === null || quota <= 0 || imageEntries === null) return max;
  const over = usage - quota * IMAGE_CACHE_LIMITS.quotaShare;
  if (over <= 0) return max;
  const keep = imageEntries - Math.ceil(over / IMAGE_ENTRY_BYTES);
  return Math.max(0, Math.min(max, keep));
}

/** "12.3 MB" style size for the storage section (decimal units, as browsers report quotas). */
export function formatBytes(n: number): string {
  if (n < 1000) return `${Math.round(n)} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let v = n / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
