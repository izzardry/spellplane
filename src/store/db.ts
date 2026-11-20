/**
 * IndexedDB schema v2 (DESIGN "Specification: network protocol and secrecy", Local persistence). Implemented by M0-C.
 * Database `spellplane`, or `spellplane-<profile>` with ?profile= (store/profile.ts).
 */
import { openDB, type IDBPDatabase } from 'idb';
import { dbName } from './profile';
import type { SpellplaneDB } from './types';

/** Current schema version (DESIGN "Local persistence"). 2: M8's games, ratings, matches and computer stores (PLAN M8-C Store row). */
export const DB_VERSION = 2;

/** The eight store names of schema v1 (DESIGN "Local persistence"). */
export const STORE_NAMES = ['identity', 'settings', 'tables', 'log', 'secrets', 'decks', 'cards', 'sets'] as const;

/** The four stores schema v2 adds (M8-C; persistence.md section 3, matchmaking.md 2.10, computer.md 10.1). */
export const M8_STORE_NAMES = ['games', 'ratings', 'matches', 'computer'] as const;

/** Open (and on first use create) the profile's database (DESIGN "Local persistence"). */
export function openDb(name: string = dbName()): Promise<IDBPDatabase<SpellplaneDB>> {
  return openDB<SpellplaneDB>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('identity', { keyPath: 'id' });
        db.createObjectStore('settings', { keyPath: 'name' });
        db.createObjectStore('tables', { keyPath: 'roomId' });
        db.createObjectStore('log', { keyPath: ['roomId', 'seq'] });
        db.createObjectStore('secrets', { keyPath: 'roomId' });
        db.createObjectStore('decks', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
        db.createObjectStore('cards', { keyPath: 'id' }).createIndex('fetchedAt', 'fetchedAt');
        db.createObjectStore('sets', { keyPath: 'code' });
      }
      // M8-C: one upgrade step to version 2; the version 1 stores and their data are untouched.
      if (oldVersion < 2) {
        db.createObjectStore('games', { keyPath: 'code' }).createIndex('lastPlayedAt', 'lastPlayedAt');
        db.createObjectStore('ratings', { keyPath: 'key' });
        db.createObjectStore('matches', { keyPath: 'roomId' });
        db.createObjectStore('computer', { keyPath: 'roomId' });
      }
    },
  });
}
