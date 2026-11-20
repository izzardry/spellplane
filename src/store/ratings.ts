/**
 * The `ratings` store, key RatingKey (matchmaking.md 2.10): `get` answers null before the first ranked game of a key.
 * M8-P7.
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
