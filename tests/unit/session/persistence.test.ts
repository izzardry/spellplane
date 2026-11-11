/**
 * M0-P7 acceptance: reloading restores the solo table to the same state hash (moved here from M0-P5). Every applied
 * action is written with the table record and the secret store in one transaction; snapshots every 200 actions
 * (DESIGN "Specification: network protocol and secrecy", Local persistence and Sync; "Multiplayer architecture", Resume).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { stateHash } from '../../../src/core/hash';
import { SNAPSHOT_EVERY } from '../../../src/session/index';
import type { LoadedTable, LogRecord, SecretsRecord, TableRecord, TableStore } from '../../../src/store/types';
import { closeStores, json, session, stores, withDeck } from './helpers';

afterEach(closeStores);

/** Close the database and open it again, as a page reload does. */
async function reload(name: string) {
  closeStores();
  return stores(name);
}

describe('reload', () => {
  it('restores the same state hash, secret store and log after import, shuffle, draws and plays', async () => {
    const db = await stores();
    const s = await withDeck(db);
    await s.shuffle();
    await s.draw(7);
    const hand = s.secrets().hand;
    s.dispatch({ type: 'move', card: hand[0]!, to: 'battlefield:s0', pose: { x: 30, y: 120, rot: 0 } });
    s.dispatch({ type: 'tap', card: hand[0]!, tapped: true });
    s.dispatch({ type: 'life', seat: 's0', delta: -2 });
    s.undo();
    await s.whenSaved();
    const hash = await stateHash(s.getState());
    const secrets = json(s.secrets());
    const log = s.log().filter((e) => e.kind === 'action');

    const again = await session(await reload(db.db.name));
    expect(await stateHash(again.getState())).toBe(hash);
    expect(json(again.secrets())).toBe(secrets);
    expect(again.log().map((e) => (e.kind === 'action' ? e.action.cid : null))).toEqual(log.map((e) => (e.kind === 'action' ? e.action.cid : null)));
    // The restored table keeps playing from where it was: the next draw takes the restored top card.
    const top = again.secrets().libraryOrder[0]!;
    await again.draw();
    expect(again.secrets().hand).toContain(top);
    expect(again.getState().seq).toBe(s.getState().seq + 1);
  });

  it('restores a fresh table with no deck', async () => {
    const db = await stores();
    const s = await session(db);
    await s.whenSaved();
    const again = await session(await reload(db.db.name));
    expect(await stateHash(again.getState())).toBe(await stateHash(s.getState()));
    expect(again.getState().stage).toBe('match');
  });

  it('keeps separate tables apart by database name (the ?profile= namespace)', async () => {
    const a = await stores();
    const b = await stores();
    const sa = await withDeck(a);
    await sa.whenSaved();
    const sb = await session(b);
    expect(Object.keys(sb.getState().cards)).toHaveLength(0);
  });

  it(`writes a snapshot every ${SNAPSHOT_EVERY} actions and restores from it plus the log after it`, async () => {
    const db = await stores();
    const s = await withDeck(db);
    await s.draw();
    const id = s.secrets().hand[0]!;
    s.dispatch({ type: 'move', card: id, to: 'battlefield:s0', pose: { x: 0, y: 120, rot: 0 } });
    while (s.getState().seq < SNAPSHOT_EVERY + 5) s.dispatch({ type: 'tap', card: id, tapped: !s.getState().cards[id]!.tapped });
    await s.whenSaved();
    const loaded = (await db.tables.loadTable('solo'))!;
    expect(loaded.table.snapshotSeq).toBe(SNAPSHOT_EVERY);
    expect(loaded.table.snapshot!.seq).toBe(SNAPSHOT_EVERY);
    expect(loaded.table.lastSeq).toBe(SNAPSHOT_EVERY + 5);
    expect(loaded.log.map((r) => r.seq)).toEqual([201, 202, 203, 204, 205]);
    const again = await session(await reload(db.db.name));
    expect(await stateHash(again.getState())).toBe(await stateHash(s.getState()));
  });

  it('writes each action, the table record and the secret store in one call (one transaction)', async () => {
    const calls: { entry: LogRecord; table: TableRecord; secrets: unknown }[] = [];
    const memory: { table: TableRecord | null; log: LogRecord[]; secrets: SecretsRecord['secrets'] | null } = { table: null, log: [], secrets: null };
    const store: TableStore = {
      saveAction(_room, entry, table, secrets) {
        calls.push({ entry, table, secrets });
        memory.log.push(entry);
        memory.table = table;
        memory.secrets = secrets;
        return Promise.resolve();
      },
      saveSnapshot(table, secrets) {
        memory.table = table;
        memory.secrets = secrets;
        return Promise.resolve();
      },
      loadTable: (): Promise<LoadedTable | null> =>
        Promise.resolve(memory.table ? { table: memory.table, log: memory.log.filter((r) => r.seq > memory.table!.snapshotSeq), secrets: memory.secrets } : null),
      listTables: () => Promise.resolve([]),
      deleteTable: () => Promise.resolve(),
    };
    const { createSoloSession } = await import('../../../src/session/index');
    const { mtg } = await import('../../../src/games/index');
    const { cardSource, deckA } = await import('./helpers');
    const s = await createSoloSession({ game: mtg, cardData: cardSource, store });
    await s.importDeck(await deckA());
    await s.draw();
    await s.whenSaved();
    const draw = calls.at(-1)!;
    expect(draw.entry.action.type).toBe('draw');
    expect(draw.table.lastSeq).toBe(draw.entry.seq);
    expect((draw.secrets as { hand: string[] }).hand).toEqual(s.secrets().hand);
    // A write that fails is reported in the log, and the table goes on.
    store.saveAction = () => Promise.reject(new Error('disk full'));
    await s.draw();
    await s.whenSaved();
    expect(s.log().some((e) => e.kind === 'system' && e.text.includes('disk full'))).toBe(true);
    expect(s.secrets().hand).toHaveLength(2);
  });

  it('stops replaying at a gap in the saved log and says so', async () => {
    const db = await stores();
    const s = await withDeck(db);
    await s.draw(3);
    await s.whenSaved();
    const seqOfDraw2 = s.getState().seq - 1;
    // Remove one log entry behind the session's back.
    await db.db.delete('log', ['solo', seqOfDraw2]);
    const again = await session(await reload(db.db.name));
    expect(again.getState().seq).toBe(seqOfDraw2 - 1);
    expect(again.log().at(-1)).toMatchObject({ kind: 'system', level: 'warn' });
    // The secret lists follow the restored state, not the newer saved secrets.
    const lib = again.getState().zones['library:s0']!.ids;
    expect([...again.secrets().libraryOrder].sort()).toEqual([...lib].sort());
    const hand = again.getState().zones['hand:s0']!.ids;
    expect([...again.secrets().hand].sort()).toEqual([...hand].sort());
  });
});
