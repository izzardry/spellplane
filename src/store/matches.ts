/** The `matches` store, key roomId (matchmaking.md 2.10). Basics by M8-C; M8-P7 owns the file. */
import type { IDBPDatabase } from 'idb';
import type { MatchStore, SpellplaneDB } from './types';

/** The matches store on `db` (matchmaking.md 2.10). */
export function createMatchStore(db: IDBPDatabase<SpellplaneDB>): MatchStore {
  return {
    async get(roomId) {
      return (await db.get('matches', roomId)) ?? null;
    },
    async put(record) {
      await db.put('matches', structuredClone(record));
    },
    list() {
      return db.getAll('matches');
    },
    async delete(roomId) {
      await db.delete('matches', roomId);
    },
  };
}
