/**
 * M0-P5 acceptance: schema v1 has every store of the design's persistence table with the right keys; profile
 * namespacing gives separate databases (DESIGN "Specification: network protocol and secrecy", Local persistence:
 * database `spellplane`, or `spellplane-<profile>` in tests).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DB_VERSION, openDb, STORE_NAMES } from '../../../src/store/db';
import { imageCacheName } from '../../../src/store/images';
import { cacheName, dbName } from '../../../src/store/profile';
import { openStores, type LocalStores } from '../../../src/store/stores';
import { SOLO_ROOM_ID } from '../../../src/store/tables';
import { logEntry, sampleSecrets, sampleState, tableRecord, uniqueDbName } from './helpers';

const open: LocalStores[] = [];
afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

/** The design's persistence table: store name and key. */
const DESIGN_TABLE: Record<string, string | string[]> = {
  identity: 'id', // key 'me'
  settings: 'name',
  tables: 'roomId',
  log: ['roomId', 'seq'],
  secrets: 'roomId',
  decks: 'id',
  cards: 'id', // Scryfall id
  sets: 'code',
};

describe('schema v1', () => {
  it('has exactly the eight stores of the persistence table, out-of-line keys nowhere, no auto-increment', async () => {
    const db = await openDb(uniqueDbName('schema'));
    try {
      expect(db.version).toBe(1);
      expect(DB_VERSION).toBe(1);
      expect([...db.objectStoreNames].sort()).toEqual(Object.keys(DESIGN_TABLE).sort());
      expect([...STORE_NAMES].sort()).toEqual(Object.keys(DESIGN_TABLE).sort());
      const tx = db.transaction(STORE_NAMES, 'readonly');
      for (const [name, keyPath] of Object.entries(DESIGN_TABLE)) {
        const store = tx.objectStore(name as (typeof STORE_NAMES)[number]);
        expect(store.keyPath, name).toEqual(keyPath);
        expect(store.autoIncrement, name).toBe(false);
      }
      expect([...tx.objectStore('decks').indexNames]).toEqual(['updatedAt']);
      expect([...tx.objectStore('cards').indexNames]).toEqual(['fetchedAt']);
      await tx.done;
    } finally {
      db.close();
    }
  });

  it('stores each kind of record under the key the design names', async () => {
    const s = await openStores(uniqueDbName('schema'));
    open.push(s);
    await s.identity.get();
    await s.settings.set('theme', 'dusk');
    await s.tables.saveAction(SOLO_ROOM_ID, logEntry(SOLO_ROOM_ID, 7), tableRecord(SOLO_ROOM_ID, 7, sampleState(7), 7), sampleSecrets());
    await s.decks.put({ id: 'deck-1', name: 'D', main: [], side: [], source: 'built', createdAt: 1, updatedAt: 1 });
    await s.db.put('cards', { id: '0000579f-7b35-4ed3-b44c-db2a538066fe', data: { name: 'X' }, fetchedAt: 1 });
    await s.db.put('sets', { code: 'm19', data: { booster: {} }, fetchedAt: 1 });

    expect(await s.db.getAllKeys('identity')).toEqual(['me']);
    expect(await s.db.getAllKeys('settings')).toEqual(['theme']);
    expect(await s.db.getAllKeys('tables')).toEqual([SOLO_ROOM_ID]);
    expect(await s.db.getAllKeys('log')).toEqual([[SOLO_ROOM_ID, 7]]);
    expect(await s.db.getAllKeys('secrets')).toEqual([SOLO_ROOM_ID]);
    expect(await s.db.getAllKeys('decks')).toEqual(['deck-1']);
    expect(await s.db.getAllKeys('cards')).toEqual(['0000579f-7b35-4ed3-b44c-db2a538066fe']);
    expect(await s.db.getAllKeys('sets')).toEqual(['m19']);
  });

  it('opens an existing v1 database again without losing data', async () => {
    const name = uniqueDbName('schema');
    const db = await openDb(name);
    await db.put('sets', { code: 'm19', data: 1, fetchedAt: 1 });
    db.close();
    const again = await openDb(name);
    expect(await again.get('sets', 'm19')).toEqual({ code: 'm19', data: 1, fetchedAt: 1 });
    again.close();
  });
});

describe('profile namespacing', () => {
  it('names the database spellplane, or spellplane-<profile>', () => {
    expect(dbName('spellplane', null)).toBe('spellplane');
    expect(dbName('spellplane', 'a')).toBe('spellplane-a');
    expect(dbName()).toBe('spellplane'); // no ?profile= outside a browser
    expect(cacheName('spellplane-images', 'b')).toBe('spellplane-images-b');
  });

  it('gives each profile its own identity, settings, decks and tables', async () => {
    const tag = uniqueDbName('profile');
    const a = await openStores(dbName(tag, 'a'));
    const b = await openStores(dbName(tag, 'b'));
    const plain = await openStores(dbName(tag, null));
    open.push(a, b, plain);

    const [ia, ib, ip] = await Promise.all([a.identity.get(), b.identity.get(), plain.identity.get()]);
    expect(new Set([ia.peerId, ib.peerId, ip.peerId]).size).toBe(3);

    await a.settings.set('theme', 'dusk');
    await a.decks.put({ id: 'd', name: 'A only', main: [], side: [], source: 'pasted', createdAt: 1, updatedAt: 1 });
    await a.tables.saveAction(SOLO_ROOM_ID, logEntry(SOLO_ROOM_ID, 1), tableRecord(SOLO_ROOM_ID, 1, sampleState(1), 1), sampleSecrets());

    for (const other of [b, plain]) {
      expect(await other.settings.get('theme')).toBe('paper');
      expect(await other.decks.list()).toEqual([]);
      expect(await other.tables.loadTable(SOLO_ROOM_ID)).toBeNull();
      expect(await other.db.count('log')).toBe(0);
      expect(await other.db.count('secrets')).toBe(0);
    }
    expect((await a.identity.get()).peerId).toBe(ia.peerId);
    expect(await a.settings.get('theme')).toBe('dusk');
  });

  it('namespaces the image cache by the page profile', () => {
    expect(imageCacheName('https://example.test/spellplane/')).toBe('spellplane-images');
    expect(imageCacheName('https://example.test/spellplane/?profile=a&faces=placeholder#/t/x/k')).toBe('spellplane-images-a');
    expect(imageCacheName('https://example.test/spellplane/?transport=local&profile=b')).toBe('spellplane-images-b');
    // Invalid profile values fall back like the flag parser does.
    expect(imageCacheName('https://example.test/spellplane/?profile=../x')).toBe('spellplane-images');
    expect(imageCacheName(undefined)).toBe('spellplane-images');
    expect(imageCacheName('not a url')).toBe('spellplane-images');
  });
});
