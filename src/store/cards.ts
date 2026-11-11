/**
 * Card JSON cache in the IndexedDB store `cards` (DESIGN "Card data and images", Caching; "Specification: network
 * protocol and secrecy", Local persistence): trimmed card object and fetched-at time, keyed by Scryfall id.
 * Implementer: M0-P2. The cache is rebuildable; data/ refreshes entries older than 30 days in the background.
 */
import type { IDBPDatabase } from 'idb';
import { openDb } from './db';
import type { CardCache, CardRecord, SpellplaneDB } from './types';

/** Age after which a cached card is refreshed in the background (DESIGN: 30 days). */
export const CARD_REFRESH_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export class IdbCardCache implements CardCache {
  private dbp: Promise<IDBPDatabase<SpellplaneDB>> | null = null;

  constructor(private readonly open: () => Promise<IDBPDatabase<SpellplaneDB>> = () => openDb()) {}

  private db(): Promise<IDBPDatabase<SpellplaneDB>> {
    if (!this.dbp) {
      this.dbp = this.open();
      // A failed open (private mode, blocked storage) is retried on the next call instead of being cached.
      this.dbp.catch(() => {
        this.dbp = null;
      });
    }
    return this.dbp;
  }

  async get(sid: string): Promise<CardRecord | null> {
    return (await (await this.db()).get('cards', sid)) ?? null;
  }

  /** Records for the ids that are cached, in the order asked; missing ids are skipped. */
  async getMany(sids: string[]): Promise<CardRecord[]> {
    if (sids.length === 0) return [];
    const tx = (await this.db()).transaction('cards', 'readonly');
    const found = await Promise.all(sids.map((sid) => tx.store.get(sid)));
    await tx.done;
    return found.filter((r): r is CardRecord => r !== undefined);
  }

  async put(records: CardRecord[]): Promise<void> {
    if (records.length === 0) return;
    const tx = (await this.db()).transaction('cards', 'readwrite');
    await Promise.all([...records.map((r) => tx.store.put(r)), tx.done]);
  }

  async stale(olderThan: number): Promise<string[]> {
    const db = await this.db();
    return db.getAllKeysFromIndex('cards', 'fetchedAt', IDBKeyRange.upperBound(olderThan, true));
  }
}

/** The card cache of the current profile's database. */
export function createCardCache(open?: () => Promise<IDBPDatabase<SpellplaneDB>>): CardCache {
  return new IdbCardCache(open);
}

/** An in-memory CardCache, for pages without IndexedDB and for tests. */
export class MemoryCardCache implements CardCache {
  readonly records = new Map<string, CardRecord>();
  async get(sid: string): Promise<CardRecord | null> {
    return this.records.get(sid) ?? null;
  }
  async getMany(sids: string[]): Promise<CardRecord[]> {
    return sids.map((s) => this.records.get(s)).filter((r): r is CardRecord => r !== undefined);
  }
  async put(records: CardRecord[]): Promise<void> {
    for (const r of records) this.records.set(r.id, r);
  }
  async stale(olderThan: number): Promise<string[]> {
    return [...this.records.values()].filter((r) => r.fetchedAt < olderThan).map((r) => r.id);
  }
}
