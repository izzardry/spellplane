/**
 * The `games` store: one GameSummary per game for History and re-entry (persistence.md section 3; contracts.md Part E).
 * M8-C landed the basics; M8-P2 finishes them: `purge` removes the code's rows in games, tables, log and secrets in one
 * transaction; `endOlderSolo` keeps the newest unfinished solo games resumable (contracts.md Part G "History and
 * saving" item 1); at most `GAMES_KEPT` games are kept and an unfinished networked game is never removed automatically
 * (persistence.md section 4).
 */
import type { IDBPDatabase } from 'idb';
import { atomicWrite } from './tx';
import type { GameStore, GameSummary, SpellplaneDB } from './types';

/** History keeps 50 games (persistence.md D5). */
export const GAMES_KEPT = 50;

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

/** Whether a game has ended (a result, replaced by a newer solo game, or `endedAt` set). */
export function isEnded(g: GameSummary): boolean {
  return g.endedAt !== undefined || g.ended !== undefined;
}

/** The log rows of one room (key `[roomId, seq]`). */
function roomLogRange(code: string): IDBKeyRange {
  return IDBKeyRange.bound([code, -Infinity], [code, Infinity]);
}

/** Newest first by lastPlayedAt (ties: newest created first, then code), as History shows them. */
export function newestFirst(a: GameSummary, b: GameSummary): number {
  return b.lastPlayedAt - a.lastPlayedAt || b.createdAt - a.createdAt || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
}

/** The games store on `db` (persistence.md section 3). `now` is injected for tests. */
export function createGameStore(db: IDBPDatabase<SpellplaneDB>, now: () => number = () => Date.now()): GameStore & GameStoreExtras {
  async function purge(code: string): Promise<void> {
    const tx = db.transaction(['games', 'tables', 'log', 'secrets'], 'readwrite');
    await atomicWrite(tx, (t, track) => {
      track(t.objectStore('games').delete(code));
      track(t.objectStore('tables').delete(code));
      track(t.objectStore('log').delete(roomLogRange(code)));
      track(t.objectStore('secrets').delete(code));
    });
  }

  async function all(): Promise<GameSummary[]> {
    return (await db.getAll('games')).sort(newestFirst);
  }

  /** Over the cap: purge the oldest ended games (never an unfinished networked one; an unfinished solo game only once it is ended). */
  async function trim(): Promise<void> {
    const games = (await all()).filter((g) => g.deletedAt === undefined);
    let over = games.length - GAMES_KEPT;
    if (over <= 0) return;
    for (const g of [...games].reverse()) {
      if (over <= 0) break;
      if (!isEnded(g)) continue;
      await purge(g.code);
      over--;
    }
  }

  return {
    async create(meta) {
      const existing = await db.get('games', meta.code);
      if (existing) return;
      await db.put('games', blankSummary(meta, now()));
      await trim();
    },
    async put(summary) {
      await db.put('games', structuredClone(summary));
    },
    async get(code) {
      return (await db.get('games', code)) ?? null;
    },
    async list() {
      return (await all()).filter((g) => g.deletedAt === undefined);
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
    purge,
    async endOlderSolo(keep) {
      const solo = (await all()).filter((g) => g.kind === 'solo' && g.deletedAt === undefined && !isEnded(g));
      const at = now();
      for (const g of solo.slice(Math.max(0, keep))) await db.put('games', { ...g, ended: 'replaced', endedAt: at });
    },
    async purgeRemoved() {
      for (const g of await db.getAll('games')) if (g.deletedAt !== undefined) await purge(g.code);
    },
  };
}

/** Members beyond the contract (M8-P2): purge what a previous page soft-deleted (persistence.md section 3: "or at the next start"). */
export interface GameStoreExtras {
  purgeRemoved(): Promise<void>;
}
