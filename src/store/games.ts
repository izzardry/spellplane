/**
 * The `games` store: one GameSummary per game for History and re-entry (persistence.md section 3; contracts.md Part E).
 * M8-C lands the basics (create, put, get, list, remove, restore); M8-P2 owns the file and finishes purge in one
 * transaction with tables, log and secrets, and `endOlderSolo`.
 */
import type { IDBPDatabase } from 'idb';
import type { GameStore, GameSummary, SpellplaneDB } from './types';

/** A complete summary from the launcher's meta (persistence.md section 3: `GameStore.create` before the session opens). */
export function blankSummary(meta: Parameters<GameStore['create']>[0], now: number): GameSummary {
  return {
    seat: null,
    players: [],
    stage: 'lobby',
    game: 0,
    turn: 1,
    active: null,
    seq: 0,
    hash: '',
    knownHead: null,
    handLost: false,
    recoveries: 0,
    takeovers: 0,
    createdAt: now,
    lastPlayedAt: now,
    savedAt: now,
    bytes: 0,
    actions: 0,
    ...meta,
  };
}

/** The games store on `db` (persistence.md section 3). `now` is injected for tests. */
export function createGameStore(db: IDBPDatabase<SpellplaneDB>, now: () => number = () => Date.now()): GameStore {
  return {
    async create(meta) {
      const existing = await db.get('games', meta.code);
      if (existing) return;
      await db.put('games', blankSummary(meta, now()));
    },
    async put(summary) {
      await db.put('games', structuredClone(summary));
    },
    async get(code) {
      return (await db.get('games', code)) ?? null;
    },
    async list() {
      const all = await db.getAllFromIndex('games', 'lastPlayedAt');
      return all.filter((g) => g.deletedAt === undefined).reverse();
    },
    async remove(code, at) {
      const g = await db.get('games', code);
      if (g) await db.put('games', { ...g, deletedAt: at });
    },
    async restore(code) {
      const g = await db.get('games', code);
      if (!g) return;
      const copy = { ...g };
      delete copy.deletedAt;
      await db.put('games', copy);
    },
    async purge(code) {
      // M8-P2: also the tables, log and secrets records of the code, in one transaction (persistence.md section 3).
      await db.delete('games', code);
    },
    endOlderSolo() {
      // M8-P2 (contracts.md Part G "History" item 1); the stub changes nothing.
      return Promise.resolve();
    },
  };
}
