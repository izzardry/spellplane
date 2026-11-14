/**
 * PLAN Milestone 5, owner decisions, Installable on iPad: "lets decks and saved tables be exported to a file and
 * imported again" (Safari deletes a site's storage after 7 days without a visit). store/backup.ts over IndexedDB
 * (fake-indexeddb): a versioned JSON file round-trips decks, saved tables (record, full log, the owner's secret store),
 * the identity's key pair as JWK and the settings; a bad or newer file is reported, never thrown on; restoring never
 * overwrites unless asked and never seats a networked table under another identity.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalJson } from '../../../src/core/hash';
import { backupFileName, backupText, exportBackup, readBackup, readBackupText, restoreBackup, suggestReplaceIdentity } from '../../../src/store/backup';
import { exportLibrary } from '../../../src/store/decks';
import { generateIdentity } from '../../../src/store/identity';
import { openStores, type LocalStores } from '../../../src/store/stores';
import { SOLO_ROOM_ID } from '../../../src/store/tables';
import { BACKUP_FILE_FORMAT, BACKUP_FILE_VERSION, type BackupFile, type DeckRecord, type StoredIdentity } from '../../../src/store/types';
import { logEntry, sampleSecrets, sampleState, tableRecord, uniqueDbName } from './helpers';

const open: LocalStores[] = [];
async function stores(name = uniqueDbName('backup')): Promise<LocalStores> {
  const s = await openStores(name);
  open.push(s);
  return s;
}
afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

const ROOM = 'amber-fox-river-42';
const NOW = Date.UTC(2026, 10, 13, 20, 0, 0);

function deck(id: string, name: string, at = 1_700_000_000_000): DeckRecord {
  return { id, name, main: [{ sid: 'aaaa' }, { sid: 'bbbb', foil: true }], side: [{ sid: 'cccc' }], source: 'pasted', text: '1 A\n1 B', createdAt: at, updatedAt: at };
}

/** A browser with an identity, two decks, the solo table and one networked table with a log, and some settings. */
async function filledBrowser(): Promise<{ s: LocalStores; identity: StoredIdentity }> {
  const s = await stores();
  const identity = { ...(await generateIdentity()), nickname: 'Ann', seatColour: 3 };
  await s.db.put('identity', identity);
  await s.decks.put(deck('d1', 'Green-white'));
  await s.decks.put(deck('d2', 'Blue-red', 1_700_000_100_000));
  // Solo table: a snapshot at 3 and log entries 1..5.
  for (let seq = 1; seq <= 5; seq++) await s.tables.saveAction(SOLO_ROOM_ID, logEntry(SOLO_ROOM_ID, seq), tableRecord(SOLO_ROOM_ID, seq, null, 0), sampleSecrets());
  await s.tables.saveSnapshot(tableRecord(SOLO_ROOM_ID, 5, sampleState(3), 3), sampleSecrets());
  // A networked table with its own log.
  for (let seq = 1; seq <= 4; seq++) await s.tables.saveAction(ROOM, logEntry(ROOM, seq), { ...tableRecord(ROOM, seq), protocol: 1 }, sampleSecrets());
  await s.settings.set('theme', 'dusk');
  await s.settings.set('hintsSeen', ['installHomeScreen']);
  return { s, identity };
}

async function dump(s: LocalStores): Promise<unknown> {
  return {
    decks: await s.decks.list(),
    tables: await s.tables.listTables(),
    solo: [await s.tables.loadTable(SOLO_ROOM_ID), await s.tables.loadLog(SOLO_ROOM_ID)],
    room: [await s.tables.loadTable(ROOM), await s.tables.loadLog(ROOM)],
    identity: await s.db.get('identity', 'me'),
    settings: await s.settings.all(),
  };
}

describe('export', () => {
  it('writes a versioned file with decks, every saved table with its full log and own secret store, the identity as JWK and the settings', async () => {
    const { s, identity } = await filledBrowser();
    const file = await exportBackup(s, { decks: true, tables: 'all', settings: true }, NOW);
    expect(file).toMatchObject({ format: BACKUP_FILE_FORMAT, version: BACKUP_FILE_VERSION, exportedAt: NOW });
    expect(file.decks.map((d) => d.id).sort()).toEqual(['d1', 'd2']);
    expect(file.tables.map((t) => t.table.roomId).sort()).toEqual([ROOM, SOLO_ROOM_ID].sort());
    const solo = file.tables.find((t) => t.table.roomId === SOLO_ROOM_ID)!;
    // The full log, not only the entries after the snapshot.
    expect(solo.log.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(solo.secrets).toEqual(sampleSecrets());
    expect(file.identity).toEqual({ privateJwk: identity.privateJwk, publicJwk: identity.publicJwk, peerId: identity.peerId, nickname: 'Ann', seatColour: 3 });
    expect(file.settings).toMatchObject({ theme: 'dusk', hintsSeen: ['installHomeScreen'] });
    // Plain JSON: the text parses back to the same file, and no CryptoKey object is in it.
    expect(JSON.parse(backupText(file))).toEqual(file);
    expect(backupText(file)).not.toContain('CryptoKey');
    expect(backupFileName(NOW)).toBe('spellplane-backup-2026-11-13.json');
  });

  it('includes only what was asked: decks without tables carry no identity; a chosen table only', async () => {
    const { s } = await filledBrowser();
    const decksOnly = await exportBackup(s, { decks: true, tables: [], settings: false }, NOW);
    expect(decksOnly.tables).toEqual([]);
    expect(decksOnly.identity).toBeUndefined();
    expect(decksOnly.settings).toBeUndefined();
    const one = await exportBackup(s, { decks: false, tables: [ROOM, 'no-such-room'], settings: false }, NOW);
    expect(one.decks).toEqual([]);
    expect(one.tables.map((t) => t.table.roomId)).toEqual([ROOM]);
    expect(one.identity).toBeDefined();
  });

  it('an empty browser exports an empty, readable file', async () => {
    const s = await stores();
    const file = await exportBackup(s, { decks: true, tables: 'all', settings: false }, NOW);
    expect(file).toEqual({ format: BACKUP_FILE_FORMAT, version: 1, exportedAt: NOW, decks: [], tables: [] });
    expect(readBackup(JSON.parse(backupText(file)))).toEqual({ decks: [], tables: [], identity: null, settings: {}, errors: [] });
  });
});

describe('round trip', () => {
  it('a wiped browser gets back the same decks, tables, logs, hidden cards, identity and settings', async () => {
    const { s } = await filledBrowser();
    const before = await dump(s);
    const text = backupText(await exportBackup(s, { decks: true, tables: 'all', settings: true }, NOW));

    // Safari's 7-day wipe: a new, empty database (a fresh identity would be made on the next visit).
    const wiped = await stores();
    const data = readBackupText(text);
    expect(data.errors).toEqual([]);
    expect(await suggestReplaceIdentity(wiped, data)).toBe(true);
    expect(await restoreBackup(wiped, data, { replaceIdentity: true, overwrite: false })).toEqual({ errors: [] });
    expect(canonicalJson(await dump(wiped))).toBe(canonicalJson(before));
  });

  it('restoring the same file twice changes nothing and reports the tables it kept', async () => {
    const { s } = await filledBrowser();
    const data = readBackup(JSON.parse(backupText(await exportBackup(s, { decks: true, tables: 'all', settings: false }, NOW))));
    const before = await dump(s);
    const { errors } = await restoreBackup(s, data, { replaceIdentity: false, overwrite: false });
    // Equal decks are no conflict; existing tables are kept and named.
    expect(errors.map((e) => e.where).sort()).toEqual([`table ${ROOM}`, `table ${SOLO_ROOM_ID}`].sort());
    expect(errors.every((e) => /already has it/.test(e.message))).toBe(true);
    expect(canonicalJson(await dump(s))).toBe(canonicalJson(before));
  });
});

describe('restore choices', () => {
  it('keeps a different deck with the same id unless asked to overwrite', async () => {
    const s = await stores();
    await s.decks.put(deck('d1', 'Mine'));
    const data = readBackup({ format: BACKUP_FILE_FORMAT, version: 1, exportedAt: NOW, decks: [deck('d1', 'Theirs'), deck('d9', 'New')], tables: [] });
    const kept = await restoreBackup(s, data, { replaceIdentity: false, overwrite: false });
    expect(kept.errors).toEqual([{ where: 'deck d1', message: expect.stringContaining('Deck "Theirs" was skipped') }]);
    expect((await s.decks.get('d1'))!.name).toBe('Mine');
    expect((await s.decks.get('d9'))!.name).toBe('New');
    expect(await restoreBackup(s, data, { replaceIdentity: false, overwrite: true })).toEqual({ errors: [] });
    expect((await s.decks.get('d1'))!.name).toBe('Theirs');
  });

  it('restores over the untouched solo table every visit creates, without asking', async () => {
    const { s } = await filledBrowser();
    const file = await exportBackup(s, { decks: false, tables: [SOLO_ROOM_ID], settings: false }, NOW);
    const fresh = await stores();
    // What session/solo.ts writes on a first visit: an empty table and the stageSet that starts play.
    const empty = { ...sampleState(0), cards: {}, zones: {}, lines: {}, commitments: {} };
    await fresh.tables.saveSnapshot({ ...tableRecord(SOLO_ROOM_ID, 0, empty, 0), seat: 's0' }, null);
    await fresh.tables.saveAction(SOLO_ROOM_ID, { roomId: SOLO_ROOM_ID, seq: 1, action: { type: 'stageSet', stage: 'match', by: 's0', cid: 'x', seq: 1 } as never, at: 1 }, tableRecord(SOLO_ROOM_ID, 1, empty, 0), null);
    expect(await restoreBackup(fresh, readBackup(file), { replaceIdentity: false, overwrite: false })).toEqual({ errors: [] });
    expect((await fresh.tables.loadLog(SOLO_ROOM_ID)).map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    // A solo table with play on it is kept.
    const played = await stores();
    await played.tables.saveAction(SOLO_ROOM_ID, logEntry(SOLO_ROOM_ID, 1), tableRecord(SOLO_ROOM_ID, 1, null, 0), null);
    expect((await restoreBackup(played, readBackup(file), { replaceIdentity: false, overwrite: false })).errors.map((e) => e.where)).toEqual([`table ${SOLO_ROOM_ID}`]);
  });

  it('overwriting a table replaces its whole log: no entry of the old timeline survives', async () => {
    const { s } = await filledBrowser();
    const file = await exportBackup(s, { decks: false, tables: [SOLO_ROOM_ID], settings: false }, NOW);
    // The browser played on: its solo log now runs to 9.
    for (let seq = 6; seq <= 9; seq++) await s.tables.saveAction(SOLO_ROOM_ID, logEntry(SOLO_ROOM_ID, seq), tableRecord(SOLO_ROOM_ID, seq, sampleState(3), 3), sampleSecrets());
    expect(await restoreBackup(s, readBackup(file), { replaceIdentity: false, overwrite: true })).toEqual({ errors: [] });
    expect((await s.tables.loadLog(SOLO_ROOM_ID)).map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect((await s.tables.loadTable(SOLO_ROOM_ID))!.table.lastSeq).toBe(5);
  });

  it('never restores a networked table under another identity; the solo table needs none', async () => {
    const { s } = await filledBrowser();
    const data = readBackup(JSON.parse(backupText(await exportBackup(s, { decks: false, tables: 'all', settings: false }, NOW))));
    const other = await stores();
    await other.db.put('identity', { ...(await generateIdentity()), nickname: 'Ben' });
    // Ben has a table of his own: taking over Ann's identity is not suggested.
    await other.tables.saveAction('ben-room', logEntry('ben-room', 1), tableRecord('ben-room', 1), null);
    expect(await suggestReplaceIdentity(other, data)).toBe(false);
    const { errors } = await restoreBackup(other, data, { replaceIdentity: false, overwrite: false });
    expect(errors).toEqual([{ where: `table ${ROOM}`, message: expect.stringContaining('was played as Ann') }]);
    expect(await other.tables.loadTable(ROOM)).toBeNull();
    expect(await other.tables.loadTable(SOLO_ROOM_ID)).not.toBeNull();
    expect((await other.db.get('identity', 'me'))!.nickname).toBe('Ben');
  });

  it('refuses an identity whose key pair does not match its peer id', async () => {
    const { s } = await filledBrowser();
    const file = await exportBackup(s, { decks: false, tables: 'all', settings: false }, NOW);
    const forged: BackupFile = { ...file, identity: { ...file.identity!, publicJwk: (await generateIdentity()).publicJwk! } };
    const wiped = await stores();
    const { errors } = await restoreBackup(wiped, readBackup(JSON.parse(JSON.stringify(forged))), { replaceIdentity: true, overwrite: false });
    expect(errors.map((e) => e.where)).toEqual(['identity', `table ${ROOM}`]);
    expect(await wiped.db.get('identity', 'me')).toBeUndefined();
    expect(await wiped.tables.loadTable(ROOM)).toBeNull();
  });
});

describe('reading a file', () => {
  const base = (extra: Record<string, unknown> = {}) => ({ format: BACKUP_FILE_FORMAT, version: 1, exportedAt: NOW, decks: [], tables: [], ...extra });

  it('reports a file that is not JSON, not a backup, or from a newer version, and reads nothing from it', () => {
    expect(readBackupText('{not json').errors).toEqual([{ where: 'file', message: expect.stringContaining('not JSON') }]);
    for (const json of [null, 42, 'text', [], {}, { format: 'something-else', version: 1 }]) {
      expect(readBackup(json)).toEqual({ decks: [], tables: [], identity: null, settings: {}, errors: [{ where: 'file', message: 'The file is not a Spellplane backup.' }] });
    }
    expect(readBackup(base({ version: 2, decks: [deck('d1', 'x')] }))).toMatchObject({ decks: [], errors: [{ where: 'file', message: expect.stringContaining('newer Spellplane (version 2)') }] });
    expect(readBackup(base({ version: 0 })).errors[0]!.message).toMatch(/no valid version/);
    expect(readBackup(base({ version: 1.5 })).errors[0]!.message).toMatch(/no valid version/);
  });

  it('reads the deck library file of the builder (and a single exported deck) as a backup of decks', () => {
    const lib = JSON.parse(exportLibrary([deck('d1', 'A'), deck('d2', 'B')], NOW)) as unknown;
    expect(readBackup(lib)).toEqual({ decks: [deck('d1', 'A'), deck('d2', 'B')], tables: [], identity: null, settings: {}, errors: [] });
    expect(readBackup(deck('d3', 'C')).decks.map((d) => d.id)).toEqual(['d3']);
  });

  it('skips each broken entry with a message and keeps the rest', () => {
    const goodTable = { table: tableRecord(ROOM, 2), log: [logEntry(ROOM, 1), logEntry(ROOM, 2)], secrets: sampleSecrets() };
    const json = base({
      decks: [deck('d1', 'Good'), { id: 'd2', name: 'Broken', main: 'nope', side: [], source: 'pasted', createdAt: 0, updatedAt: 0 }],
      tables: [
        goodTable,
        { table: tableRecord('r2', 2), log: [logEntry('r2', 2), logEntry('r2', 1)], secrets: null },
        { table: tableRecord('r3', 1), log: [logEntry('other-room', 1)], secrets: null },
        { table: { ...tableRecord('r4', 1), stage: 'party' }, log: [], secrets: null },
        { table: tableRecord('r5', 1), log: [], secrets: { ...sampleSecrets(), seat: 's3' } },
        { table: { ...tableRecord('r6', 1), snapshotSeq: 5 }, log: [], secrets: null },
        { table: tableRecord('r7', 1), log: [{ roomId: 'r7', seq: 1, action: 'tap', at: 0 }], secrets: null },
        goodTable,
      ],
      identity: { privateJwk: { kty: 'RSA' }, publicJwk: {}, peerId: '0123456789abcdef', nickname: 'A', seatColour: 1 },
      settings: { theme: 'wyrm', quality: 'ultra', cardBack: 'official', hintsSeen: ['welcome', 'futureHint', 'welcome'], volume: 3, talk: 'loud', micDevice: null },
    });
    const r = readBackup(json);
    expect(r.decks.map((d) => d.id)).toEqual(['d1']);
    expect(r.tables.map((t) => t.table.roomId)).toEqual([ROOM]);
    expect(r.identity).toBeNull();
    expect(r.settings).toEqual({ theme: 'wyrm', cardBack: 'official', hintsSeen: ['welcome'], micDevice: null });
    const where = r.errors.map((e) => e.where);
    expect(where).toEqual(['deck 2', 'table 2', 'table 3', 'table 4', 'table 5', 'table 6', 'table 7', 'table 8', 'identity', 'setting quality', 'setting volume', 'setting talk']);
    const msg = (w: string) => r.errors.find((e) => e.where === w)!.message;
    expect(msg('table 2')).toMatch(/ascending order/);
    expect(msg('table 3')).toMatch(/another room/);
    expect(msg('table 4')).toMatch(/stage is unknown/);
    expect(msg('table 5')).toMatch(/another seat/);
    expect(msg('table 6')).toMatch(/snapshot is newer/);
    expect(msg('table 7')).toMatch(/holds no action/);
    expect(msg('table 8')).toMatch(/same room/);
    expect(msg('identity')).toMatch(/P-256/);
    expect(msg('setting volume')).toMatch(/does not know it/);
  });

  it('copies only known fields of an identity; a private key without its private part is refused', async () => {
    const id = await generateIdentity();
    const ok = readBackup(base({ identity: { privateJwk: { ...id.privateJwk, extra: 'x' }, publicJwk: id.publicJwk, peerId: id.peerId, nickname: 'Ann', seatColour: 7, more: true } }));
    expect(ok.errors).toEqual([]);
    expect(Object.keys(ok.identity!).sort()).toEqual(['nickname', 'peerId', 'privateJwk', 'publicJwk', 'seatColour']);
    expect(ok.identity!.privateJwk).not.toHaveProperty('extra');
    const noD = readBackup(base({ identity: { privateJwk: id.publicJwk, publicJwk: id.publicJwk, peerId: id.peerId, nickname: 'Ann', seatColour: 1 } }));
    expect(noD.identity).toBeNull();
    expect(noD.errors[0]!.message).toMatch(/no private part/);
    const colour = readBackup(base({ identity: { privateJwk: id.privateJwk, publicJwk: id.publicJwk, peerId: id.peerId, nickname: 'Ann', seatColour: 8 } }));
    expect(colour.errors[0]!.message).toMatch(/seat colour/);
  });
});
