/**
 * IndexedDB schema v1 (DESIGN "Specification: network protocol and secrecy", Local persistence). Implemented by M0-C.
 * Database `spellplane`, or `spellplane-<profile>` with ?profile= (store/profile.ts).
 */
import { openDB, type IDBPDatabase } from 'idb';
import { dbName } from './profile';
import type { SpellplaneDB } from './types';

/** Current schema version (DESIGN "Local persistence"). */
export const DB_VERSION = 1;

/** The eight store names of schema v1 (DESIGN "Local persistence"). */
export const STORE_NAMES = ['identity', 'settings', 'tables', 'log', 'secrets', 'decks', 'cards', 'sets'] as const;

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
    },
  });
}
