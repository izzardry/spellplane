/**
 * Storage persistence request (DESIGN "Card data and images", Caching: the app requests persistent storage but never
 * depends on it). Never throws; resolves to whether storage is persistent.
 */

/** The part of StorageManager used here; injectable for tests. */
export type PersistApi = Pick<StorageManager, 'persist' | 'persisted'>;

function defaultApi(): PersistApi | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.storage;
}

/** Whether the browser already granted persistent storage (false if unsupported). */
export async function isStoragePersisted(api: PersistApi | undefined = defaultApi()): Promise<boolean> {
  try {
    return (await api?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}

/** Ask for persistent storage; skips the request when already granted. Resolves false when unsupported or refused. */
export async function requestPersistentStorage(api: PersistApi | undefined = defaultApi()): Promise<boolean> {
  if (!api || typeof api.persist !== 'function') return false;
  if (await isStoragePersisted(api)) return true;
  try {
    return await api.persist();
  } catch {
    return false;
  }
}
