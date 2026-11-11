/**
 * All local stores on one database connection (DESIGN "Specification: network protocol and secrecy", Local
 * persistence). The database is `spellplane`, or `spellplane-<profile>` with ?profile= (store/profile.ts).
 */
import type { IDBPDatabase } from 'idb';
import { openDb } from './db';
import { createDeckStore } from './decks';
import { createIdentityStore } from './identity';
import { dbName } from './profile';
import { createSettingsStore } from './settings';
import { createTableStore } from './tables';
import type { DeckStore, IdentityStore, SettingsStore, SpellplaneDB, TableStore } from './types';

/** The stores M0-P5 implements, sharing one connection. */
export interface LocalStores {
  db: IDBPDatabase<SpellplaneDB>;
  identity: IdentityStore;
  settings: SettingsStore;
  decks: DeckStore;
  tables: TableStore;
  close(): void;
}

/** Open the profile's database (or `name`) and create every store on it. */
export async function openStores(name: string = dbName()): Promise<LocalStores> {
  const db = await openDb(name);
  return {
    db,
    identity: createIdentityStore(db),
    settings: createSettingsStore(db),
    decks: createDeckStore(db),
    tables: createTableStore(db),
    close: () => db.close(),
  };
}
