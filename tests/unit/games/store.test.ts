/**
 * M8-P2: the games store (persistence.md sections 3 and 4; contracts.md Part E, Part G "History and saving"): purge
 * removes every row of the code in games, tables, log and secrets in one transaction; endOlderSolo(3) ends the
 * fourth-newest unfinished solo game and no networked one; soft delete and restore; at most 50 games, an unfinished
 * networked game never removed automatically.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createGameStore, GAMES_KEPT } from '../../../src/store/games';
import { openStores, type LocalStores } from '../../../src/store/stores';
import type { ComputerGameRecord, GameSummary } from '../../../src/store/types';
import { logEntry, sampleSecrets, sampleState, tableRecord, uniqueDbName } from '../store/helpers';

const open: LocalStores[] = [];
afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

async function stores(): Promise<LocalStores> {
  const s = await openStores(uniqueDbName('games'));
  open.push(s);
  return s;
}

async function seedTable(s: LocalStores, code: string): Promise<void> {
  await s.tables.saveAction(code, logEntry(code, 1), tableRecord(code, 1), sampleSecrets());
  await s.tables.saveAction(code, logEntry(code, 2), tableRecord(code, 2), sampleSecrets());
}

describe('games store', () => {
  it('purge leaves no row of the code in log, tables, secrets, games, and keeps other codes', async () => {
    const s = await stores();
    const games = createGameStore(s.db);
    for (const code of ['amber-fox-river-12', 'other-room-one-40']) {
      await seedTable(s, code);
      await games.create({ code, key: 'k', kind: 'private', format: '1v1', decks: 'constructed' });
    }
    expect((await s.db.getAll('log')).length).toBe(4);
    await games.purge('amber-fox-river-12');
    expect(await s.db.get('games', 'amber-fox-river-12')).toBeUndefined();
    expect(await s.db.get('tables', 'amber-fox-river-12')).toBeUndefined();
    expect(await s.db.get('secrets', 'amber-fox-river-12')).toBeUndefined();
    const logs = await s.db.getAll('log');
    expect(logs.every((l) => l.roomId === 'other-room-one-40')).toBe(true);
    expect(logs.length).toBe(2);
    expect(await s.db.get('tables', 'other-room-one-40')).toBeDefined();
    expect(await games.get('other-room-one-40')).not.toBeNull();
  });

  it('purge of a computer game also removes Sparring\'s bot~ table, log, secrets and the computer record (computer.md 2.5)', async () => {
    const s = await stores();
    const games = createGameStore(s.db);
    const code = 'c-amber-fox-31';
    await seedTable(s, code);
    await seedTable(s, `bot~${code}`);
    await seedTable(s, 'bot~c-other-room-7');
    const record = (roomId: string): ComputerGameRecord => ({
      roomId,
      createdAt: 1,
      updatedAt: 1,
      bot: {
        config: { level: 'steady', pace: 'normal', seed: 'seed-7', name: 'Sparring' },
        identity: { peerId: 'p-bot', nickname: 'Sparring', seatColour: 4, publicKey: {}, privateKey: {} } as unknown as ComputerGameRecord['bot']['identity'],
        seat: 's1',
        deck: { name: 'Red', choice: { kind: 'mirror' }, main: [] },
      },
      human: { deckId: null, deckName: 'Starter' },
    });
    await s.computer.put(record(code));
    await s.computer.put(record('c-other-room-7'));
    await games.create({ code, key: '', kind: 'solo', format: '1v1', decks: 'constructed', opponent: 'sparring', seat: 's0' });
    await games.purge(code);
    for (const room of [code, `bot~${code}`]) {
      expect(await s.db.get('tables', room)).toBeUndefined();
      expect(await s.db.get('secrets', room)).toBeUndefined();
    }
    expect((await s.db.getAll('log')).every((l) => l.roomId === 'bot~c-other-room-7')).toBe(true);
    expect(await s.computer.get(code)).toBeNull();
    // Another computer game keeps its rows.
    expect(await s.computer.get('c-other-room-7')).not.toBeNull();
    expect(await s.db.get('tables', 'bot~c-other-room-7')).toBeDefined();
  });

  it('endOlderSolo(3) ends the fourth-newest unfinished solo game and no networked one', async () => {
    const s = await stores();
    let t = 1000;
    const games = createGameStore(s.db, () => t);
    for (let i = 0; i < 5; i++) {
      t = 1000 + i * 10;
      await games.create({ code: `p-solo${i}`, key: '', kind: 'solo', format: '1v1', decks: 'constructed' });
    }
    t = 1005;
    await games.create({ code: 'net-room-a-11', key: 'k', kind: 'private', format: '1v1', decks: 'constructed' });
    t = 2000;
    await games.endOlderSolo(3);
    const by = new Map((await games.list()).map((g) => [g.code, g]));
    expect(['p-solo4', 'p-solo3', 'p-solo2'].map((c) => by.get(c)?.ended)).toEqual([undefined, undefined, undefined]);
    expect(by.get('p-solo1')?.ended).toBe('replaced');
    expect(by.get('p-solo0')?.ended).toBe('replaced');
    expect(by.get('p-solo1')?.endedAt).toBe(2000);
    expect(by.get('net-room-a-11')?.ended).toBeUndefined();
    // A finished solo game does not count among the three.
    await games.endOlderSolo(3);
    expect((await games.get('p-solo2'))?.ended).toBeUndefined();
  });

  it('remove hides a game from list, restore brings it back, purgeRemoved purges soft-deleted rows', async () => {
    const s = await stores();
    const games = createGameStore(s.db);
    await games.create({ code: 'room-a-b-10', key: 'k', kind: 'private', format: '1v1', decks: 'constructed' });
    await games.remove('room-a-b-10', 5);
    expect(await games.list()).toEqual([]);
    expect((await games.get('room-a-b-10'))?.deletedAt).toBe(5);
    await games.restore('room-a-b-10');
    expect((await games.list()).map((g) => g.code)).toEqual(['room-a-b-10']);
    await games.remove('room-a-b-10', 6);
    await games.purgeRemoved();
    expect(await games.get('room-a-b-10')).toBeNull();
  });

  it('lists newest first by lastPlayedAt', async () => {
    const s = await stores();
    let t = 1;
    const games = createGameStore(s.db, () => t);
    for (const [code, at] of [['a-a-a-10', 5], ['b-b-b-10', 9], ['c-c-c-10', 1]] as const) {
      t = at;
      await games.create({ code, key: 'k', kind: 'private', format: '1v1', decks: 'constructed' });
    }
    expect((await games.list()).map((g) => g.code)).toEqual(['b-b-b-10', 'a-a-a-10', 'c-c-c-10']);
  });

  it('keeps at most 50 games by purging the oldest ended ones; never an unfinished networked game', async () => {
    const s = await stores();
    let t = 0;
    const games = createGameStore(s.db, () => t);
    // 49 unfinished networked games, the oldest first, and one old ended solo game.
    t = 1;
    await games.create({ code: 'p-ended', key: '', kind: 'solo', format: '1v1', decks: 'constructed' });
    const ended = (await games.get('p-ended'))!;
    await games.put({ ...ended, ended: 'result', endedAt: 2 });
    for (let i = 0; i < GAMES_KEPT - 1; i++) {
      t = 10 + i;
      await games.create({ code: `net-${i}`, key: 'k', kind: 'private', format: '1v1', decks: 'constructed' });
    }
    expect((await games.list()).length).toBe(GAMES_KEPT);
    t = 100;
    await games.create({ code: 'net-new', key: 'k', kind: 'private', format: '1v1', decks: 'constructed' });
    const codes = (await games.list()).map((g) => g.code);
    expect(codes.length).toBe(GAMES_KEPT);
    expect(codes).not.toContain('p-ended');
    // Now all 50 are unfinished: a 51st keeps them all.
    t = 101;
    await games.create({ code: 'net-newer', key: 'k', kind: 'private', format: '1v1', decks: 'constructed' });
    const after = await games.list();
    expect(after.length).toBe(GAMES_KEPT + 1);
    expect(after.some((g: GameSummary) => g.code === 'net-0')).toBe(true);
  });

  it('create is idempotent and keeps the first summary', async () => {
    const s = await stores();
    const games = createGameStore(s.db, () => 7);
    await games.create({ code: 'x-y-z-10', key: 'k', kind: 'private', format: 'ffa4', decks: 'draftLive' });
    await games.create({ code: 'x-y-z-10', key: 'other', kind: 'matched', format: '1v1', decks: 'constructed' });
    const g = await games.get('x-y-z-10');
    expect(g).toMatchObject({ key: 'k', kind: 'private', format: 'ffa4', decks: 'draftLive', createdAt: 7, actions: 0 });
    void sampleState;
  });
});
