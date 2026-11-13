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
import { MAX_IMAGE_ENTRIES } from './images';
import type { PersistApi } from './persist';

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

/** The origin's storage use, never throwing (unsupported parts read as null). Implementer: M5-P3. Added by M5-C. */
export function storageStatus(_api?: QuotaApi): Promise<StorageStatus> {
  return Promise.reject(new Error('not implemented: M5-P3'));
}

/** How many image entries to keep given the current status (IMAGE_CACHE_LIMITS; LRU eviction above it). Implementer: M5-P3. Added by M5-C. */
export function imageEntryLimit(_status: StorageStatus): number {
  throw new Error('not implemented: M5-P3');
}
