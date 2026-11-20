/**
 * M8-P7 service sims (PLAN Milestone 8, M8-P7 Service and Sim): the matchmaker over a loopback lobby, and the matched
 * entry over real networked sessions: seat 0 creates the table, the others never sit alone, the opening hands are
 * dealt, the 30-second arrival rule, and a ranked 1v1 ended by concession changes both ratings once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchRecord, TableState } from '../../../src/core/types';
import { ratingChanges } from '../../../src/net/lobby/rating';
import { applyRatedResult, matchSessionInternals, runMatchedEntry } from '../../../src/session/match-room';
import { OPENING_HAND } from '../../../src/session/entry';
import { concede } from '../../../src/session/result';
import type { TableSession } from '../../../src/session/types';
import { live, resetLifecycleForTests } from '../../../src/util/lifecycle';
import { browser, closeAll, fixtureDeck, hashOf, net as gameNet, open, until, waitConverged, type Browser } from '../session/harness';
import { FAKE_TIMERS, lobbyNet } from './harness';
import { mmPage, type MmPage } from './mm-harness';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

let browsers: Browser[] = [];
let pages: MmPage[] = [];
const stops: (() => void)[] = [];
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
  resetLifecycleForTests();
});
afterEach(() => {
  for (const s of stops.splice(0)) s();
  for (const p of pages) p.mm.dispose();
  pages = [];
  closeAll(browsers);
  browsers = [];
  vi.useRealTimers();
});

const Q = '1v1.constructed.ranked' as const;

async function twoPages(): Promise<{ A: Browser; B: Browser; a: MmPage; b: MmPage; lobby: ReturnType<typeof lobbyNet> }> {
  const lobby = lobbyNet({ seed: 41 });
  const A = await browser('ann', 'peer-a', 'Ann', 0);
  const B = await browser('ben', 'peer-b', 'Ben', 1);
  browsers.push(A, B);
  const a = mmPage(lobby, 'Ann', A.peerId, A.stores);
  const b = mmPage(lobby, 'Ben', B.peerId, B.stores);
  pages.push(a, b);
  return { A, B, a, b, lobby };
}

describe('the matchmaker service', () => {
  it('off → connecting → watching → seeking → check → moving, with every status', async () => {
    const { a, b } = await twoPages();
    expect(a.mm.status()).toEqual({ phase: 'off' });
    expect(live().transports).toBe(0);
    a.mm.watch(true);
    expect(a.mm.status().phase).toBe('connecting');
    await until(() => a.mm.status().phase === 'watching', 2_000, 'watching');
    expect(live().transports).toBe(1);
    expect(live().timers).toBe(1);
    const w = a.mm.status();
    if (w.phase !== 'watching') throw new Error('not watching');
    expect(w.lobby.seekers).toEqual([]);

    a.mm.seek({ queues: [Q], deckId: 'deck-a' });
    await until(() => a.mm.status().phase === 'seeking', 2_000, 'seeking');
    const s = a.mm.status();
    if (s.phase !== 'seeking') throw new Error('not seeking');
    expect(s).toMatchObject({ deckId: 'deck-a', queues: [Q], alone: false, window: { rating: 100, band: 0 } });
    await vi.advanceTimersByTimeAsync(10_500);
    expect(a.mm.status()).toMatchObject({ phase: 'seeking', alone: true, window: { rating: 200, band: 1 } });

    b.mm.seek({ queues: [Q], deckId: 'deck-b' });
    await until(() => a.mm.status().phase === 'check' && b.mm.status().phase === 'check', 3_000, 'check');
    const c = a.mm.status();
    if (c.phase !== 'check') throw new Error('not check');
    expect(c.match.players.map((p) => p.name).sort()).toEqual(['Ann', 'Ben']);
    expect(c.match.players.find((p) => p.me)?.name).toBe('Ann');
    expect(c.match.players.every((p) => p.rating === 1500 && p.band === 3)).toBe(true);
    expect(c.mine).toBe(false);
    expect(c.deadline - a.mm.now()).toBeGreaterThan(19_000);
    a.mm.answer(true);
    await until(() => a.mm.status().phase === 'check' && (a.mm.status() as { mine: boolean }).mine, 1_000, 'accepted');
    b.mm.answer(true);
    await until(() => a.mm.status().phase === 'moving' && b.mm.status().phase === 'moving', 3_000, 'moving');
    const m = a.mm.status();
    const mb = b.mm.status();
    if (m.phase !== 'moving' || mb.phase !== 'moving') throw new Error('not moving');
    expect(m.link).toEqual(mb.link);
    expect(m.plan.seats).toEqual(mb.plan.seats);
    await until(() => a.hashes.length > 0, 1_000, 'the route');
    expect(a.hashes).toEqual([`#/t/${m.link.roomId}/${m.link.key}`]);
    expect(a.phases).toEqual(['off', 'connecting', 'watching', 'seeking', 'check', 'moving']);
    await until(() => true, 100, 'flush');
    const rec = await browsers[0]!.stores.matches.get(m.link.roomId);
    expect(rec).toMatchObject({ roomId: m.link.roomId, roomKey: m.link.key, queue: Q, deckId: 'deck-a', state: 'formed' });
    expect(await browsers[0]!.stores.games.get(m.link.roomId)).toMatchObject({ code: m.link.roomId, kind: 'matched' });
    a.mm.arrived(m.link.roomId);
    expect(a.mm.status()).toEqual({ phase: 'off' });
    // The lobby is left once arrived (or 10 s after the match formed).
    expect(live().transports).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(live().transports).toBe(0);
    expect(live().timers).toBe(0);
  });

  it('cancel sends unseek and keeps watching; widen re-sends the ticket open with a higher rev', async () => {
    const { a, b } = await twoPages();
    b.mm.watch(true);
    a.mm.seek({ queues: [Q], deckId: 'd' });
    await until(() => a.mm.status().phase === 'seeking', 2_000, 'seeking');
    await until(() => b.mm.status().phase === 'watching' && (b.mm.status() as { lobby: { seekers: unknown[] } }).lobby.seekers.length === 1, 2_000, 'Ben sees Ann');
    a.mm.widen();
    await until(() => a.mm.messages().some((r) => r.dir === 'out' && r.msg.t === 'seek' && r.msg.ticket.open && r.msg.ticket.rev === 2), 1_000, 'the widened ticket');
    const sinceBefore = (a.mm.status() as { since: number }).since;
    expect(a.mm.status()).toMatchObject({ phase: 'seeking', since: sinceBefore, window: { rating: null, band: null } });
    a.mm.cancel();
    expect(a.mm.messages().some((r) => r.dir === 'out' && r.msg.t === 'unseek')).toBe(true);
    expect(a.mm.status().phase).toBe('watching');
    await until(() => (b.mm.status() as { lobby: { seekers: unknown[] } }).lobby.seekers.length === 0, 2_000, 'Ann gone from the seekers');
    a.mm.watch(false);
    expect(a.mm.status()).toEqual({ phase: 'off' });
  });

  it('a member that cannot reach everyone within 30 s is back in seeking with its wait kept; nobody ends in two rooms', async () => {
    const { a, b } = await twoPages();
    a.mm.seek({ queues: [Q], deckId: 'd' });
    await vi.advanceTimersByTimeAsync(5_000);
    const since = (a.mm.status() as { since: number }).since;
    b.mm.seek({ queues: [Q], deckId: 'd' });
    await until(() => a.mm.status().phase === 'check' && b.mm.status().phase === 'check', 3_000, 'check');
    a.mm.answer(true);
    b.mm.answer(true);
    await until(() => a.mm.status().phase === 'moving', 3_000, 'moving');
    const m = a.mm.status();
    if (m.phase !== 'moving') throw new Error('not moving');
    const record = (await browsers[0]!.stores.matches.get(m.link.roomId))!;
    // A table session that never sees Ben (his network cannot be reached).
    const lonely = fakeSession();
    let strandedText = '';
    stops.push(runMatchedEntry({ session: lonely, record, me: 'peer-a', deck: null, matchmaker: a.mm, onStranded: (t) => (strandedText = t) }));
    await vi.advanceTimersByTimeAsync(29_000);
    expect(a.mm.status().phase).toBe('moving');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(strandedText).toBe('Ben could not be reached directly. Some networks do not allow it, and Spellplane uses no relay.');
    await until(() => a.mm.status().phase === 'seeking', 3_000, 'seeking again');
    expect((a.mm.status() as { since: number }).since).toBe(since);
    expect((await browsers[0]!.stores.matches.get(m.link.roomId))?.state).toBe('void');
    // The lobby was left on moving and joined again only now: one lobby transport.
    expect(live().transports).toBe(1);
  });
});

async function eventually(done: () => Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await done()) return;
    await vi.advanceTimersByTimeAsync(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

function fakeSession(): TableSession {
  const state = { stage: 'match', seats: {}, commitments: {}, format: '1v1' } as unknown as TableState;
  return {
    seat: 's0',
    getState: () => state,
    subscribe: () => () => undefined,
    subscribeNet: () => () => undefined,
    netStatus: () => ({ connection: 'connected', peers: [], sequencer: null, seq: 0 }),
    log: () => [],
  } as unknown as TableSession;
}

describe('matched entry over real networked sessions', () => {
  it('seat 0 creates the table, the other never sits alone; decks committed, 7 cards each; a ranked concession rates once', async () => {
    const { A, B, a, b } = await twoPages();
    a.mm.seek({ queues: [Q], deckId: 'deck-a' });
    b.mm.seek({ queues: [Q], deckId: 'deck-b' });
    await until(() => a.mm.status().phase === 'check' && b.mm.status().phase === 'check', 3_000, 'check');
    a.mm.answer(true);
    b.mm.answer(true);
    await until(() => a.mm.status().phase === 'moving' && b.mm.status().phase === 'moving', 3_000, 'moving');
    const m = a.mm.status();
    if (m.phase !== 'moving') throw new Error('not moving');
    await until(() => true, 50, 'records');
    const recA = (await A.stores.matches.get(m.link.roomId))!;
    const recB = (await B.stores.matches.get(m.link.roomId))!;
    expect(recA.players.map((p) => p.peerId)).toEqual(recB.players.map((p) => p.peerId));
    const creator = recA.players[0]!.peerId === A.peerId ? A : B;
    const other = creator === A ? B : A;
    const recOf = (x: Browser): MatchRecord => (x === A ? recA : recB);
    const mmOf = (x: Browser): MmPage => (x === A ? a : b);

    const game = gameNet({ seed: 43 });
    const opts = (x: Browser) => {
      const i = matchSessionInternals(recOf(x), x.peerId);
      return { internals: { createdHere: i.createdHere, neverAlone: i.neverAlone, loneWaitMs: 1_000 }, opts: { roomId: m.link.roomId, roomKey: m.link.key, format: i.format } };
    };
    // The other member arrives first and waits; it never starts a table of its own.
    const pOther = open(game, other, opts(other).internals, opts(other).opts);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(other.session).toBeNull();
    const pCreator = open(game, creator, opts(creator).internals, opts(creator).opts);
    await Promise.all([pOther, pCreator]);
    const deckOf = async (x: Browser) => fixtureDeck(x === A ? 'gw-m19-60.txt' : 'ur-m19-60.mtga.txt');
    for (const x of [creator, other]) {
      const deck = await deckOf(x);
      stops.push(runMatchedEntry({ session: x.session!, record: recOf(x), me: x.peerId, deck, matchmaker: mmOf(x).mm, ratings: x.stores.ratings, matches: x.stores.matches }));
    }
    const sessions = [creator.session!, other.session!];
    await until(() => sessions.every((s) => s.engine.confirmedState().stage === 'match' && s.secrets().hand.length === OPENING_HAND), 120_000, 'the opening hands');
    await waitConverged(sessions, 'one table');
    const st = creator.session!.engine.confirmedState();
    expect(st.seats.s0?.peer).toBe(recA.players[0]!.peerId);
    expect(st.seats.s1?.peer).toBe(recA.players[1]!.peerId);
    expect(Object.keys(st.commitments).sort()).toEqual(['s0', 's1']);
    expect(st.settings).toMatchObject({ autoSetup: true, matched: true });
    // The table's first chair was taken by the creator.
    const firstTake = creator.session!.log().find((e) => e.kind === 'action' && e.action.type === 'seatTake');
    expect(firstTake && firstTake.kind === 'action' ? (firstTake.action as { peer?: string }).peer : null).toBe(creator.peerId);
    expect(hashOf(other.session!.engine.confirmedState())).toBe(hashOf(st));
    // Both arrived: the matchmakers are off.
    expect(a.mm.status()).toEqual({ phase: 'off' });
    expect(b.mm.status()).toEqual({ phase: 'off' });

    // The other member concedes: the creator wins; both browsers apply the same change once.
    concede(other.session!);
    await until(() => sessions.every((s) => s.engine.confirmedState().result !== undefined), 30_000, 'the result');
    await eventually(async () => (await other.stores.ratings.get('1v1.constructed')) !== null && (await creator.stores.ratings.get('1v1.constructed')) !== null, 'ratings');
    const expected = ratingChanges(recA.players.map((p, i) => ({ rating: p.rating, games: p.games, band: p.band, side: i as 0 | 1 })), 0)!;
    const ra = await creator.stores.ratings.get('1v1.constructed');
    const rb = await other.stores.ratings.get('1v1.constructed');
    expect(ra?.rating).toBe(expected[0]!.after);
    expect(rb?.rating).toBe(expected[1]!.after);
    expect(ra!.rating - 1500).toBe(-(rb!.rating - 1500));
    expect((await creator.stores.matches.get(m.link.roomId))?.rated).toEqual({ key: '1v1.constructed', before: 1500, after: expected[0]!.after });
    // Once: applying again changes nothing.
    expect(await applyRatedResult({ state: st.result ? st : creator.session!.engine.confirmedState(), roomId: m.link.roomId, me: creator.peerId, ratings: creator.stores.ratings, matches: creator.stores.matches })).toBeNull();
    expect((await creator.stores.ratings.get('1v1.constructed'))?.games).toBe(1);
  }, 300_000);
});
