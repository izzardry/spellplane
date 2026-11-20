/**
 * The `ratings` store (matchmaking.md 2.10). Stub by M8-C: `get` answers null (no rated game yet), writes are kept;
 * M8-P7 owns the file.
 */
import type { IDBPDatabase } from 'idb';
import type { RatingStore, SpellplaneDB } from './types';

/** The ratings store on `db` (matchmaking.md 2.10). */
export function createRatingStore(db: IDBPDatabase<SpellplaneDB>): RatingStore {
  return {
    async get(key) {
      return (await db.get('ratings', key)) ?? null;
    },
    async put(record) {
      await db.put('ratings', structuredClone(record));
    },
    list() {
      return db.getAll('ratings');
    },
  };
}
