/**
 * M0-P5 acceptance: snapshot, log and secrets round-trip through IndexedDB; writes to log, tables and secrets for one
 * action happen in one transaction, so a failure in one store writes none (DESIGN "Specification: network protocol
 * and secrecy", Local persistence; "Multiplayer architecture", Resume).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { stateHash } from '../../../src/core/hash';
import type { SecretStore } from '../../../src/core/types';
import { openDb } from '../../../src/store/db';
import { openStores, type LocalStores } from '../../../src/store/stores';
import { SOLO_ROOM_ID } from '../../../src/store/tables';
import { logEntry, sampleSecrets, sampleState, tableRecord, uniqueDbName } from './helpers';

const open: LocalStores[] = [];
async function stores(name = uniqueDbName('tables')): Promise<LocalStores> {
  const s = await openStores(name);
  open.push(s);
  return s;
}
afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

/** Close the connection and open the same database again, like a reload does. */
async function reopen(s: LocalStores): Promise<LocalStores> {
  s.close();
  return stores(s.db.name);
}

describe('table round-trip', () => {
  it('restores the snapshot to the same state hash after reopening the database', async () => {
    const s = await stores();
    const state = sampleState(3);
    const before = await stateHash(state);
    await s.tables.saveSnapshot(tableRecord(SOLO_ROOM_ID, 3, state, 3), sampleSecrets());

    const loaded = await (await reopen(s)).tables.loadTable(SOLO_ROOM_ID);
    expect(loaded).not.toBeNull();
    expect(loaded!.table.snapshot).toEqual(state);
    expect(await stateHash(loaded!.table.snapshot!)).toBe(before);
    expect(loaded!.table).toEqual(tableRecord(SOLO_ROOM_ID, 3, state, 3));
    expect(loaded!.log).toEqual([]);
  });

  it('round-trips log entries, the table record and the secret store written per action', async () => {
    const s = await stores();
    const secrets = sampleSecrets();
    for (let seq = 1; seq <= 3; seq++) {
      secrets.hand = [`h${seq}`];
      await s.tables.saveAction(SOLO_ROOM_ID, logEntry(SOLO_ROOM_ID, seq), tableRecord(SOLO_ROOM_ID, seq), secrets);
    }
    const loaded = (await (await reopen(s)).tables.loadTable(SOLO_ROOM_ID))!;
    expect(loaded.table.lastSeq).toBe(3);
    expect(loaded.log).toEqual([1, 2, 3].map((seq) => logEntry(SOLO_ROOM_ID, seq)));
    expect(loaded.secrets).toEqual({ ...sampleSecrets(), hand: ['h3'] });
  });

  it('returns only the log after the snapshot, in numeric seq order', async () => {
    const s = await stores();
    // Written out of order and past 9, so a string sort would give 1, 10, 11, 2, ...
    for (const seq of [11, 2, 10, 1, 3, 9]) await s.db.put('log', logEntry(SOLO_ROOM_ID, seq));
    await s.tables.saveSnapshot(tableRecord(SOLO_ROOM_ID, 11, sampleState(2), 2), null);
    const loaded = (await s.tables.loadTable(SOLO_ROOM_ID))!;
    expect(loaded.log.map((e) => e.seq)).toEqual([3, 9, 10, 11]);
    expect(loaded.secrets).toBeNull();
  });

  it('keeps rooms apart, including a room whose id extends another', async () => {
    const s = await stores();
    for (const room of ['solo', 'solo-2', 'sol']) {
      for (let seq = 1; seq <= 2; seq++) {
        await s.tables.saveAction(room, logEntry(room, seq), tableRecord(room, seq), { ...sampleSecrets(), hand: [room] });
      }
    }
    for (const room of ['solo', 'solo-2', 'sol']) {
      const loaded = (await s.tables.loadTable(room))!;
      expect(loaded.table.roomId).toBe(room);
      expect(loaded.log.map((e) => [e.roomId, e.seq])).toEqual([
        [room, 1],
        [room, 2],
      ]);
      expect(loaded.secrets?.hand).toEqual([room]);
    }
  });

  it('stores a copy: mutating the inputs after saving changes nothing stored', async () => {
    const s = await stores();
    const state = sampleState();
    const secrets = sampleSecrets();
    const entry = logEntry(SOLO_ROOM_ID, 1);
    const table = tableRecord(SOLO_ROOM_ID, 1, state, 1);
    await s.tables.saveAction(SOLO_ROOM_ID, entry, table, secrets);
    state.seats.s0!.life = 0;
    secrets.libraryOrder.reverse();
    entry.seq = 99;
    const loaded = (await s.tables.loadTable(SOLO_ROOM_ID))!;
    expect(loaded.table.snapshot).toEqual(sampleState());
    expect(loaded.secrets).toEqual(sampleSecrets());
  });

  it('returns null for a room that was never saved', async () => {
    const s = await stores();
    expect(await s.tables.loadTable('nope')).toBeNull();
  });

  it('keeps the previous secret store when an action is saved without secrets', async () => {
    const s = await stores();
    await s.tables.saveAction(SOLO_ROOM_ID, logEntry(SOLO_ROOM_ID, 1), tableRecord(SOLO_ROOM_ID, 1), sampleSecrets());
    await s.tables.saveAction(SOLO_ROOM_ID, logEntry(SOLO_ROOM_ID, 2), tableRecord(SOLO_ROOM_ID, 2), null);
    const loaded = (await s.tables.loadTable(SOLO_ROOM_ID))!;
    expect(loaded.table.lastSeq).toBe(2);
    expect(loaded.secrets).toEqual(sampleSecrets());
  });

  it('lists tables most recently updated first and deletes one room completely', async () => {
    const s = await stores();
    await s.tables.saveAction('a', logEntry('a', 1), tableRecord('a', 1), sampleSecrets());
    await s.tables.saveAction('b', logEntry('b', 5), tableRecord('b', 5), sampleSecrets());
    await s.tables.saveAction('ab', logEntry('ab', 3), tableRecord('ab', 3), sampleSecrets());
    expect((await s.tables.listTables()).map((t) => t.roomId)).toEqual(['b', 'ab', 'a']);

    await s.tables.deleteTable('a');
    expect(await s.tables.loadTable('a')).toBeNull();
    expect(await s.db.get('secrets', 'a')).toBeUndefined();
    expect((await s.db.getAllKeys('log')).filter((k) => k[0] === 'a')).toEqual([]);
    // Other rooms, including one whose id starts with 'a', are untouched.
    expect((await s.tables.loadTable('ab'))!.log).toHaveLength(1);
    expect((await s.tables.listTables()).map((t) => t.roomId)).toEqual(['b', 'ab']);
  });
});

describe('one transaction per action', () => {
  /** Saved state after one good action, to check that a failed write leaves it exactly as it was. */
  async function seeded(): Promise<LocalStores> {
    const s = await stores();
    await s.tables.saveAction(SOLO_ROOM_ID, logEntry(SOLO_ROOM_ID, 1), tableRecord(SOLO_ROOM_ID, 1, sampleState(1), 1), sampleSecrets());
    return s;
  }

  async function expectUnchanged(s: LocalStores): Promise<void> {
    expect(await s.db.getAll('log')).toEqual([logEntry(SOLO_ROOM_ID, 1)]);
    expect(await s.db.getAll('tables')).toEqual([tableRecord(SOLO_ROOM_ID, 1, sampleState(1), 1)]);
    expect(await s.db.getAll('secrets')).toEqual([{ roomId: SOLO_ROOM_ID, secrets: sampleSecrets() }]);
  }

  it('writes nothing when the secrets write fails (the last of the three)', async () => {
    const s = await seeded();
    // A function cannot be stored (DataCloneError); this is the write that comes after log and tables.
    const broken = { ...sampleSecrets(), hand: [() => 'x'] } as unknown as SecretStore;
    await expect(s.tables.saveAction(SOLO_ROOM_ID, logEntry(SOLO_ROOM_ID, 2), tableRecord(SOLO_ROOM_ID, 2), broken)).rejects.toThrow();
    await expectUnchanged(s);
  });

  it('writes nothing when the table write fails', async () => {
    const s = await seeded();
    const table = { ...tableRecord(SOLO_ROOM_ID, 2), snapshot: Symbol('not storable') } as unknown as ReturnType<typeof tableRecord>;
    await expect(s.tables.saveAction(SOLO_ROOM_ID, logEntry(SOLO_ROOM_ID, 2), table, sampleSecrets())).rejects.toThrow();
    await expectUnchanged(s);
  });

  it('writes nothing when the log write fails', async () => {
    const s = await seeded();
    // NaN is not a valid key: the log put fails before tables and secrets are written.
    const entry = { ...logEntry(SOLO_ROOM_ID, 2), seq: Number.NaN };
    await expect(s.tables.saveAction(SOLO_ROOM_ID, entry, tableRecord(SOLO_ROOM_ID, 2), { ...sampleSecrets(), hand: [] })).rejects.toThrow();
    await expectUnchanged(s);
  });

  it('rejects records of another room before writing anything', async () => {
    const s = await seeded();
    await expect(s.tables.saveAction(SOLO_ROOM_ID, logEntry('other', 2), tableRecord(SOLO_ROOM_ID, 2), null)).rejects.toThrow(TypeError);
    await expect(s.tables.saveAction(SOLO_ROOM_ID, logEntry(SOLO_ROOM_ID, 2), tableRecord('other', 2), null)).rejects.toThrow(TypeError);
    await expectUnchanged(s);
    expect(await s.tables.loadTable('other')).toBeNull();
  });

  it('writes nothing when a snapshot write fails in the secrets store', async () => {
    const s = await seeded();
    const broken = { ...sampleSecrets(), audit: [{ kind: 'reorder', order: () => [] }] } as unknown as SecretStore;
    await expect(s.tables.saveSnapshot(tableRecord(SOLO_ROOM_ID, 1, sampleState(9), 1), broken)).rejects.toThrow();
    await expectUnchanged(s);
  });

  it('stays usable after a failed write', async () => {
    const s = await seeded();
    const broken = { ...sampleSecrets(), hand: [() => 'x'] } as unknown as SecretStore;
    await expect(s.tables.saveAction(SOLO_ROOM_ID, logEntry(SOLO_ROOM_ID, 2), tableRecord(SOLO_ROOM_ID, 2), broken)).rejects.toThrow();
    await s.tables.saveAction(SOLO_ROOM_ID, logEntry(SOLO_ROOM_ID, 2), tableRecord(SOLO_ROOM_ID, 2), null);
    const loaded = (await s.tables.loadTable(SOLO_ROOM_ID))!;
    expect(loaded.table.lastSeq).toBe(2);
    expect(loaded.log.map((e) => e.seq)).toEqual([1, 2]);
    expect(loaded.secrets).toEqual(sampleSecrets());
  });

  it('commits the three stores together: a reader in another connection never sees a partial action', async () => {
    const s = await seeded();
    const other = await openDb(s.db.name);
    try {
      const writes = [2, 3, 4, 5].map((seq) => s.tables.saveAction(SOLO_ROOM_ID, logEntry(SOLO_ROOM_ID, seq), tableRecord(SOLO_ROOM_ID, seq, sampleState(1), 1), { ...sampleSecrets(), hand: [`h${seq}`] }));
      const seen: [number, number, string][] = [];
      for (let i = 0; i < 8; i++) {
        const tx = other.transaction(['log', 'tables', 'secrets'], 'readonly');
        const [keys, table, secrets] = await Promise.all([tx.objectStore('log').getAllKeys(), tx.objectStore('tables').get(SOLO_ROOM_ID), tx.objectStore('secrets').get(SOLO_ROOM_ID)]);
        await tx.done;
        const maxSeq = Math.max(...keys.map((k) => k[1]));
        seen.push([maxSeq, table!.lastSeq, secrets!.secrets.hand[0] ?? '']);
      }
      await Promise.all(writes);
      for (const [maxSeq, lastSeq, hand] of seen) {
        expect(lastSeq).toBe(maxSeq);
        expect(hand).toBe(maxSeq === 1 ? 'c4' : `h${maxSeq}`);
      }
    } finally {
      other.close();
    }
  });
});
