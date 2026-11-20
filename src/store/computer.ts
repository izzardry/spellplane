/**
 * The `computer` store, key roomId (computer.md 10.1), and the bot's table store (computer.md section 3): Sparring's
 * session saves through `prefixedTableStore(tables, BOT_TABLE_PREFIX)`, so its table, log and secrets live beside the
 * human's under `bot~<roomId>` and never mix with them. History lists tables with `!isBotTable(roomId)`.
 * Basics by M8-C; M8-P6 owns the file.
 */
import type { IDBPDatabase } from 'idb';
import type { SecretStore } from '../core/types';
import type { ComputerGameRecord, ComputerStore, LoadedTable, LogRecord, SpellplaneDB, TableRecord, TableStore } from './types';

/** The prefix of the bot's saved tables (computer.md section 3). */
export const BOT_TABLE_PREFIX = 'bot~';

/** Whether a stored room id is a bot's copy of a computer game (History hides these). */
export function isBotTable(roomId: string): boolean {
  return roomId.startsWith(BOT_TABLE_PREFIX);
}

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

/** A computer store in memory (storage blocked, tests). */
export function memoryComputerStore(): ComputerStore {
  const rows = new Map<string, ComputerGameRecord>();
  return {
    get: (roomId) => Promise.resolve(rows.has(roomId) ? structuredClone(rows.get(roomId)!) : null),
    put: (record) => {
      rows.set(record.roomId, structuredClone(record));
      return Promise.resolve();
    },
    delete: (roomId) => {
      rows.delete(roomId);
      return Promise.resolve();
    },
    list: () => Promise.resolve([...rows.values()].map((r) => structuredClone(r))),
  };
}

/**
 * Wrap a TableStore so that every room id going in gets `prefix` (also inside the records it writes) and every one
 * coming out loses it (computer.md section 3). `listTables()` returns only the prefixed rows, unprefixed.
 */
export function prefixedTableStore(inner: TableStore, prefix: string): TableStore {
  const into = (roomId: string): string => prefix + roomId;
  const outOf = (roomId: string): string => (roomId.startsWith(prefix) ? roomId.slice(prefix.length) : roomId);
  const recIn = (t: TableRecord): TableRecord => ({ ...t, roomId: into(t.roomId) });
  const recOut = (t: TableRecord): TableRecord => ({ ...t, roomId: outOf(t.roomId) });
  const logIn = (l: LogRecord): LogRecord => ({ ...l, roomId: into(l.roomId) });
  const logOut = (l: LogRecord): LogRecord => ({ ...l, roomId: outOf(l.roomId) });
  return {
    saveAction(roomId: string, entry: LogRecord, table: TableRecord, secrets: SecretStore | null) {
      return inner.saveAction(into(roomId), logIn(entry), recIn(table), secrets);
    },
    saveSnapshot(table: TableRecord, secrets: SecretStore | null) {
      return inner.saveSnapshot(recIn(table), secrets);
    },
    async loadTable(roomId: string): Promise<LoadedTable | null> {
      const t = await inner.loadTable(into(roomId));
      return t ? { table: recOut(t.table), log: t.log.map(logOut), secrets: t.secrets } : null;
    },
    async loadLog(roomId: string, afterSeq?: number) {
      return (await inner.loadLog(into(roomId), afterSeq)).map(logOut);
    },
    saveSecrets(roomId: string, secrets: SecretStore) {
      return inner.saveSecrets(into(roomId), secrets);
    },
    async listTables() {
      return (await inner.listTables()).filter((t) => t.roomId.startsWith(prefix)).map(recOut);
    },
    deleteTable(roomId: string) {
      return inner.deleteTable(into(roomId));
    },
  };
}
