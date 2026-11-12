/**
 * The `sets` store: trimmed MTGJSON sets with their fetched-at time (DESIGN "Specification: network protocol and
 * secrecy", Local persistence; "Card data and images", Caching). Contracts: M2-C (stub); implementer: M2-P1.
 */
import type { IDBPDatabase } from 'idb';
import { openDb } from './db';
import type { SetCache, SetRecord, SpellplaneDB } from './types';

/** The `sets` store of a database opened lazily (default: the current profile's), retried after a failed open. */
export class IdbSetCache implements SetCache {
  private dbp: Promise<IDBPDatabase<SpellplaneDB>> | null = null;

  constructor(private readonly open: () => Promise<IDBPDatabase<SpellplaneDB>> = () => openDb()) {}

  private db(): Promise<IDBPDatabase<SpellplaneDB>> {
    if (!this.dbp) {
      this.dbp = this.open();
      this.dbp.catch(() => {
        this.dbp = null;
      });
    }
    return this.dbp;
  }

  async get(code: string): Promise<SetRecord | null> {
    return (await (await this.db()).get('sets', code)) ?? null;
  }

  async put(record: SetRecord): Promise<void> {
    await (await this.db()).put('sets', record);
  }

  async codes(): Promise<string[]> {
    return (await this.db()).getAllKeys('sets');
  }
}

/** The SetCache on an open database (store/types.ts SetCache). */
export function createSetCache(db: IDBPDatabase<SpellplaneDB>): SetCache {
  return new IdbSetCache(() => Promise.resolve(db));
}

/** An in-memory SetCache, for pages without IndexedDB and for tests. */
export class MemorySetCache implements SetCache {
  readonly records = new Map<string, SetRecord>();
  async get(code: string): Promise<SetRecord | null> {
    return this.records.get(code) ?? null;
  }
  async put(record: SetRecord): Promise<void> {
    this.records.set(record.code, record);
  }
  async codes(): Promise<string[]> {
    return [...this.records.keys()].sort();
  }
}
