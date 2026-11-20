/**
 * M8-P6: opening a computer game the way `#/c/<room>` does (computer.md sections 3, 8.2, 10.3 and 10.4; journey.md
 * 4.1 SOLO row and J26): a room without a saved game starts a new one for the selected library deck, or a green starter
 * deck when none is selected; a room with one resumes it; without a starter pool Sparring plays Mirror and a notice
 * says so; a call without services takes them from the page's provider and otherwise rejects naming the package.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualClock } from '../../../src/bot/runner';
import { stateHash } from '../../../src/core/hash';
import { botSessionOf, createComputerGame, deleteComputerGame, MIRROR_NOTICE, openComputerGame, provideComputerDeps, resumeComputerGame } from '../../../src/session/computer';
import type { NetTable } from '../../../src/session/net';
import type { ComputerGame } from '../../../src/session/types';
import { BOT_TABLE_PREFIX } from '../../../src/store/computer';
import type { LocalStores } from '../../../src/store/stores';
import { resetLifecycleForTests } from '../../../src/util/lifecycle';
import { cards, FAKE_TIMERS, fakeBotKeys, humanDeck, settle, simDeps, until } from './harness';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

const open: { game: ComputerGame; stores: LocalStores }[] = [];
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
  resetLifecycleForTests();
});
afterEach(() => {
  for (const o of open) {
    o.game.handle.dispose();
    o.stores.close();
  }
  open.length = 0;
  provideComputerDeps(null);
  vi.useRealTimers();
});

const botOf = (g: ComputerGame): NetTable => botSessionOf(g.handle)!;
const sidsOf = (s: NetTable): string[] => {
  const sec = s.secrets();
  return [...sec.hand, ...sec.libraryOrder].map((id) => sec.identities[id]!.card.sid).sort();
};

describe('opening #/c/<room>', () => {
  it('starts a new game for the selected library deck, then resumes the saved one', async () => {
    const { deps, stores } = await simDeps(61);
    const deck = humanDeck('W', 'library');
    await stores.decks.put({ id: 'd-white', name: 'White weenie', main: deck.main, side: [], source: 'built', createdAt: 1, updatedAt: 1 });
    deps.decks = stores.decks;
    const g = await settle(openComputerGame('c-open-61', { deckId: 'd-white', deps }), 120_000, 'the new game');
    open.push({ game: g, stores });
    const human = g.session as NetTable;
    expect(human.secrets().hand).toHaveLength(7);
    expect(sidsOf(human)).toEqual(deck.main.map((r) => r.sid).sort());
    const record = await stores.computer.get('c-open-61');
    expect(record?.human).toEqual({ deckId: 'd-white', deckName: 'White weenie' });
    expect(record?.bot.deck.choice.kind).toBe('sparring');
    // Sparring's colour is not the human's main colour (computer.md 2.1 `auto`).
    expect(record?.bot.deck.choice).not.toMatchObject({ colour: 'W' });

    g.handle.dispose();
    open.length = 0;
    const hash = await stateHash(human.engine.confirmedState());
    const { deps: again } = await simDeps(62, { stores });
    again.clock = new ManualClock(); // Sparring waits, so the hash is the table's as it was left
    // Both sessions reopen together, so the human’s muster sees Sparring at once: no wait for MUSTER_WAIT_MS (5 s; 7 s of fake time before the fix).
    const t0 = Date.now();
    const r = await settle(openComputerGame('c-open-61', { deckId: 'd-other', deps: again }), 120_000, 'the resumed game');
    expect(Date.now() - t0).toBeLessThan(5_000);
    open.push({ game: r, stores });
    await until(() => botOf(r).engine.seq() === (r.session as NetTable).engine.seq() && botOf(r).engine.pending().length === 0, 30_000, 'resumed');
    expect(await stateHash((r.session as NetTable).engine.confirmedState())).toBe(hash);
    expect((await stores.computer.list()).map((x) => x.roomId)).toEqual(['c-open-61']);
  }, 60_000);

  it('gives a newcomer without a deck a green starter deck', async () => {
    const { deps, stores } = await simDeps(63);
    const g = await settle(openComputerGame('c-open-63', { deps }), 120_000, 'the new game');
    open.push({ game: g, stores });
    const record = await stores.computer.get('c-open-63');
    expect(record?.human).toEqual({ deckId: null, deckName: 'Starter · Green' });
    const human = g.session as NetTable;
    const colours = new Set(sidsOf(human).flatMap((sid) => cards().peek(sid)?.colors ?? []));
    expect([...colours]).toEqual(['G']);
    expect(record?.bot.deck.choice).not.toMatchObject({ colour: 'G' });
  }, 60_000);

  it('plays Mirror with a notice when no sparring deck can be made', async () => {
    const { deps, stores } = await simDeps(64, { starter: false });
    const notices: string[] = [];
    deps.notice = (t) => notices.push(t);
    const deck = humanDeck('G', 'mirror');
    const g = await settle(createComputerGame({ roomId: 'c-open-64', deckId: null, deck, deps }), 120_000, 'the game');
    open.push({ game: g, stores });
    expect(notices).toEqual([MIRROR_NOTICE]);
    const record = await stores.computer.get('c-open-64');
    expect(record?.bot.deck.choice).toEqual({ kind: 'mirror' });
    expect(record?.bot.deck.main.map((r) => r.sid).sort()).toEqual(deck.main.map((r) => r.sid).sort());
    expect(sidsOf(botOf(g))).toEqual(deck.main.map((r) => r.sid).sort());
  }, 60_000);

  it("takes the page's services from the provider, and rejects without them", async () => {
    await expect(resumeComputerGame('c-none')).rejects.toThrow(/M8-P6/);
    await expect(createComputerGame({ roomId: 'c-none', deckId: null })).rejects.toThrow(/M8-P6/);
    const { deps, stores } = await simDeps(65);
    provideComputerDeps(() => Promise.resolve(deps));
    const g = await settle(openComputerGame('c-open-65'), 120_000, 'the game');
    open.push({ game: g, stores });
    expect(await stores.computer.get('c-open-65')).not.toBeNull();
    await expect(resumeComputerGame('c-missing')).rejects.toThrow(/Sparring is gone/);
  }, 60_000);

  it('starts the game of a record whose first setup was cut off before the decks were committed', async () => {
    const { deps, stores } = await simDeps(66);
    const g = await settle(openComputerGame('c-open-66', { deps }), 120_000, 'the new game');
    const deckSids = sidsOf(g.session as NetTable);
    g.handle.dispose();
    await vi.advanceTimersByTimeAsync(100);
    // A reload in the first second: the record is written, nothing of the table is.
    await stores.tables.deleteTable('c-open-66');
    await stores.tables.deleteTable(`${BOT_TABLE_PREFIX}c-open-66`);
    expect(await stores.computer.get('c-open-66')).not.toBeNull();
    const { deps: again } = await simDeps(67, { stores });
    const r = await settle(openComputerGame('c-open-66', { deps: again }), 20_000, 'the game of the cut-off record');
    open.push({ game: r, stores });
    const human = r.session as NetTable;
    expect(human.secrets().hand).toHaveLength(7);
    expect(human.getState().stage).toBe('match');
    // The same starter deck again: it is made from the stored seed.
    expect(sidsOf(human)).toEqual(deckSids);
  }, 60_000);

  it('a first setup that fails leaves no record behind', async () => {
    const { deps, stores } = await simDeps(68);
    deps.botKeys = { create: fakeBotKeys.create, open: () => Promise.reject(new Error('no key')) };
    await expect(settle(createComputerGame({ roomId: 'c-open-68', deckId: null, deps }), 60_000, 'the failing game')).rejects.toThrow('no key');
    expect(await stores.computer.get('c-open-68')).toBeNull();
  }, 60_000);

  it('deletes a computer game whole: both tables and the record', async () => {
    const { deps, stores } = await simDeps(69);
    const g = await settle(openComputerGame('c-open-69', { deps }), 120_000, 'the game');
    g.handle.dispose();
    // Right after leaving: the last saves are still on their way, the delete waits for them.
    await settle(deleteComputerGame('c-open-69', stores), 20_000, 'the delete');
    expect(await stores.tables.loadTable('c-open-69')).toBeNull();
    expect(await stores.tables.loadTable(`${BOT_TABLE_PREFIX}c-open-69`)).toBeNull();
    expect(await stores.computer.get('c-open-69')).toBeNull();
    stores.close();
  }, 60_000);
});
