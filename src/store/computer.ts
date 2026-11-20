/**
 * The `computer` store, key roomId (computer.md 10.1). Basics by M8-C; M8-P6 owns the file and adds
 * `prefixedTableStore` and `isBotTable` (computer.md section 3).
 */
import type { IDBPDatabase } from 'idb';
import type { ComputerStore, SpellplaneDB } from './types';

/** The computer store on `db` (computer.md 10.1). */
export function createComputerStore(db: IDBPDatabase<SpellplaneDB>): ComputerStore {
  return {
    async get(roomId) {
      return (await db.get('computer', roomId)) ?? null;
    },
    async put(record) {
      await db.put('computer', structuredClone(record));
    },
    async delete(roomId) {
      await db.delete('computer', roomId);
    },
    list() {
      return db.getAll('computer');
    },
  };
}
