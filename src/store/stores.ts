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
import { createGameStore } from './games';
import { createRatingStore } from './ratings';
import { createMatchStore } from './matches';
import { createComputerStore } from './computer';
import type { ComputerStore, DeckStore, GameStore, IdentityStore, MatchStore, RatingStore, SettingsStore, SpellplaneDB, TableStore } from './types';

/** The stores M0-P5 implements, sharing one connection. */
export interface LocalStores {
  db: IDBPDatabase<SpellplaneDB>;
  identity: IdentityStore;
  settings: SettingsStore;
  decks: DeckStore;
  tables: TableStore;
  /** Added by M8-C: History summaries (persistence.md section 3). */
  games: GameStore;
  /** Added by M8-C: ratings (matchmaking.md 2.10). */
  ratings: RatingStore;
  /** Added by M8-C: formed matches (matchmaking.md 2.10). */
  matches: MatchStore;
  /** Added by M8-C: computer games (computer.md 10.1). */
  computer: ComputerStore;
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
    games: createGameStore(db),
    ratings: createRatingStore(db),
    matches: createMatchStore(db),
    computer: createComputerStore(db),
    close: () => db.close(),
  };
}
