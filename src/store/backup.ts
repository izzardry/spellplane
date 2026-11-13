/**
 * Export and import of decks and saved tables (PLAN Milestone 5, owner decisions, Installable on iPad: "lets decks and
 * saved tables be exported to a file and imported again"; DESIGN "Pre-game", Local deck library: exportable and
 * importable as files). File shape: store/types.ts BackupFile. Contracts: M5-C. Implementer: M5-P3.
 *
 * The file is the player's own copy of their own data, so it may hold their secret stores and key pair (as JWK); it is
 * never sent anywhere by the app (CLAUDE.md: hidden information never leaves its owner's browser except through the
 * design's reveal paths — saving a file the owner keeps is not a send).
 */
import type { LocalStores } from './stores';
import type { BackupFile, BackupImport } from './types';

/** What to put in a backup file (M5-P3). Added by M5-C. */
export interface BackupOptions {
  decks: boolean;
  /** Room ids of the saved tables to include, or 'all'. Tables imply the identity. */
  tables: string[] | 'all';
  settings: boolean;
}

/** How to restore (M5-P3). Added by M5-C. */
export interface RestoreOptions {
  /** Replace this browser's identity with the file's (needed to reclaim the file's seats). */
  replaceIdentity: boolean;
  /** Overwrite decks and tables that already exist here (otherwise they are skipped with a message). */
  overwrite: boolean;
}

/** Build a backup file from the stores (no I/O beyond IndexedDB). Implementer: M5-P3. Added by M5-C. */
export function exportBackup(_stores: LocalStores, _opts: BackupOptions, _now: number): Promise<BackupFile> {
  return Promise.reject(new Error('not implemented: M5-P3'));
}

/** Read a parsed file (a BackupFile, or a deck-only LibraryFile) without writing anything. Implementer: M5-P3. Added by M5-C. */
export function readBackup(_json: unknown): BackupImport {
  throw new Error('not implemented: M5-P3');
}

/** Write what `readBackup` returned into the stores. Implementer: M5-P3. Added by M5-C. */
export function restoreBackup(_stores: LocalStores, _data: BackupImport, _opts: RestoreOptions): Promise<{ errors: BackupImport['errors'] }> {
  return Promise.reject(new Error('not implemented: M5-P3'));
}
