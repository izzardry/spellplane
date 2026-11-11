/**
 * Table persistence (DESIGN "Specification: network protocol and secrecy", Local persistence; "Multiplayer
 * architecture", Resume): the `tables`, `log` and `secrets` stores, keyed by room id. The solo table uses roomId 'solo'.
 */
import type { IDBPDatabase } from 'idb';
import type { SecretStore } from '../core/types';
import { atomicWrite } from './tx';
import type { LoadedTable, LogRecord, SpellplaneDB, TableRecord, TableStore } from './types';

/** Room id of the solo table (store/types.ts TableRecord). */
export const SOLO_ROOM_ID = 'solo';

/** All log keys of one room: [roomId, -inf] .. [roomId, +inf]. Array keys compare element by element. */
function roomLogRange(roomId: string, afterSeq = -Infinity): IDBKeyRange {
  return IDBKeyRange.bound([roomId, afterSeq], [roomId, Infinity], true, true);
}

function checkRoom(roomId: string, what: string, actual: string): void {
  if (actual !== roomId) throw new TypeError(`${what} belongs to room '${actual}', not '${roomId}'`);
}

/** The TableStore on an open database (store/types.ts TableStore). */
export function createTableStore(db: IDBPDatabase<SpellplaneDB>): TableStore {
  return {
    async saveAction(roomId: string, entry: LogRecord, table: TableRecord, secrets: SecretStore | null): Promise<void> {
      checkRoom(roomId, 'log entry', entry.roomId);
      checkRoom(roomId, 'table record', table.roomId);
      const tx = db.transaction(['log', 'tables', 'secrets'], 'readwrite');
      await atomicWrite(tx, (t, track) => {
        track(t.objectStore('log').put(entry));
        track(t.objectStore('tables').put(table));
        if (secrets) track(t.objectStore('secrets').put({ roomId, secrets }));
      });
    },

    async saveSnapshot(table: TableRecord, secrets: SecretStore | null): Promise<void> {
      const tx = db.transaction(['tables', 'secrets'], 'readwrite');
      await atomicWrite(tx, (t, track) => {
        track(t.objectStore('tables').put(table));
        if (secrets) track(t.objectStore('secrets').put({ roomId: table.roomId, secrets }));
      });
    },

    async loadTable(roomId: string): Promise<LoadedTable | null> {
      // One read-only transaction: a consistent view of all three stores.
      const tx = db.transaction(['tables', 'log', 'secrets'], 'readonly');
      const table = await tx.objectStore('tables').get(roomId);
      if (!table) {
        await tx.done;
        return null;
      }
      const [log, secrets] = await Promise.all([
        tx.objectStore('log').getAll(roomLogRange(roomId, table.snapshotSeq)),
        tx.objectStore('secrets').get(roomId),
      ]);
      await tx.done;
      return { table, log, secrets: secrets?.secrets ?? null };
    },

    async listTables(): Promise<TableRecord[]> {
      const all = await db.getAll('tables');
      return all.sort((a, b) => b.updatedAt - a.updatedAt || (a.roomId < b.roomId ? -1 : a.roomId > b.roomId ? 1 : 0));
    },

    async deleteTable(roomId: string): Promise<void> {
      const tx = db.transaction(['log', 'tables', 'secrets'], 'readwrite');
      await atomicWrite(tx, (t, track) => {
        track(t.objectStore('log').delete(roomLogRange(roomId)));
        track(t.objectStore('tables').delete(roomId));
        track(t.objectStore('secrets').delete(roomId));
      });
    },
  };
}
