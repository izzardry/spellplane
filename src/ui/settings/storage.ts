/**
 * The settings' storage section and the "storage full" state (DESIGN "Card data and images", Caching: "All caches are
 * rebuildable; the app requests persistent storage but never depends on it"; "Local persistence"; PLAN M5-P5: error
 * and empty states, storage full). The numbers come from store/quota.ts `storageStatus` (M5-P3); a browser that does
 * not say, or a build where it is unavailable, shows "unknown" instead of failing.
 */
import type { StorageStatus } from '../../store/quota';

/** How full this origin's storage is. */
export type StorageLevel = 'ok' | 'nearlyFull' | 'full' | 'unknown';

/** Shares of the quota at which the section warns and calls the storage full. */
export const STORAGE_NEARLY_FULL = 0.9;
export const STORAGE_FULL = 0.98;

export function storageLevel(s: StorageStatus | null): StorageLevel {
  if (!s || s.usage === null || s.quota === null || s.quota <= 0) return 'unknown';
  const share = s.usage / s.quota;
  if (share >= STORAGE_FULL) return 'full';
  if (share >= STORAGE_NEARLY_FULL) return 'nearlyFull';
  return 'ok';
}

/** Bytes as people read them: 0 B, 12 KB, 3.4 MB, 1.2 GB. */
export function formatBytes(n: number | null): string {
  if (n === null || !Number.isFinite(n) || n < 0) return 'unknown';
  if (n < 1000) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

/** Whether an error is the browser refusing a write for lack of space (IndexedDB, Cache API, localStorage). */
export function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return typeof e === 'string' && QUOTA_TEXT.test(e);
  const err = e as { name?: unknown; code?: unknown; message?: unknown };
  if (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  if (err.code === 22 || err.code === 1014) return true;
  return typeof err.message === 'string' && QUOTA_TEXT.test(err.message);
}

/** Words browsers use when a write fails for lack of space. */
const QUOTA_TEXT = /quota|storage (is )?full|disk (is )?full|not enough (disk )?space|no space left/i;

/**
 * Whether a log line reports a save that failed for lack of space: the sessions write "Could not save the table: <the
 * browser's error>" as a warning (session/persist.ts).
 */
export function isStorageFullLine(entry: { kind: string; level?: string; text?: string }): boolean {
  return entry.kind === 'system' && entry.level === 'warn' && typeof entry.text === 'string' && /could not save/i.test(entry.text) && QUOTA_TEXT.test(entry.text);
}

/** The storage section's summary line. */
export function storageSummary(s: StorageStatus | null): string {
  if (!s) return 'This browser does not report how much storage Spellplane uses.';
  const used = s.usage === null ? null : formatBytes(s.usage);
  const quota = s.quota === null ? null : formatBytes(s.quota);
  const use = used && quota ? `${used} of ${quota} used` : used ? `${used} used` : 'Storage use unknown';
  const images = s.imageEntries === null ? '' : `; ${s.imageEntries} card image${s.imageEntries === 1 ? '' : 's'} cached`;
  const kept = s.persisted ? 'Storage is persistent: the browser keeps it.' : 'Storage is not persistent: the browser may clear it when space runs low.';
  return `${use}${images}. ${kept}`;
}
