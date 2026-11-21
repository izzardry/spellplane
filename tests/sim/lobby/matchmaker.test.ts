/**
 * M8-P7 service sims (PLAN Milestone 8, M8-P7 Service and Sim): the matchmaker over a loopback lobby, and the matched
 * entry over real networked sessions: seat 0 creates the table, the others never sit alone, the opening hands are
 * dealt, the 30-second arrival rule, and a ranked 1v1 ended by concession changes both ratings once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchRecord, TableState } from '../../../src/core/types';
import { ratingChanges } from '../../../src/net/lobby/rating';
import { applyRatedResult, DECK_UNREADABLE, matchSessionInternals, runMatchedEntry, watchRatedResult } from '../../../src/session/match-room';
import { OPENING_HAND } from '../../../src/session/entry';
import { concede } from '../../../src/session/result';
import type { TableSession } from '../../../src/session/types';
import type { MatchStore } from '../../../src/store/types';
import { live, resetLifecycleForTests } from '../../../src/util/lifecycle';
import { browser, closeAll, fixtureDeck, hashOf, net as gameNet, open, settle, until, waitConverged, type Browser } from '../session/harness';
import { FAKE_TIMERS, lateIdTransport, lobbyNet } from './harness';
import { mmPage, type MmPage } from './mm-harness';
import { createMatchmaker, MM_TEXT } from '../../../src/session/matchmaker';
import { fakeNetIdentity } from '../net/fake-identity';

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
    b.mm.arrived(m.link.roomId);
    expect(b.mm.status()).toEqual({ phase: 'off' });
    // The lobby is left once arrived (or 10 s after the match formed).
    expect(live().transports).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(live().transports).toBe(0);
    expect(live().timers).toBe(0);
  });

  it('cancel sends unseek and keeps watching when asked to watch; widen re-sends the ticket open with a higher rev', async () => {
    const { a, b } = await twoPages();
    b.mm.watch(true);
    a.mm.watch(true);
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

  it('a search without a watch: cancel, a decline or a missed ring leaves the lobby and releases its transport and beat', async () => {
    const { a, b } = await twoPages();
    a.mm.seek({ queues: [Q], deckId: 'd' });
    await until(() => a.mm.status().phase === 'seeking', 2_000, 'seeking');
    expect(live()).toMatchObject({ transports: 1, timers: 1 });
    a.mm.cancel();
    expect(a.mm.status()).toEqual({ phase: 'off' });
    expect(live()).toMatchObject({ transports: 0, timers: 0 });

    // A declines; B lets the ring lapse: both end off, with no lobby left running.
    a.mm.seek({ queues: [Q], deckId: 'd' });
    b.mm.seek({ queues: [Q], deckId: 'd' });
    await until(() => a.mm.status().phase === 'check' && b.mm.status().phase === 'check', 3_000, 'check');
    a.mm.answer(false);
    expect(a.mm.status()).toEqual({ phase: 'off' });
    await until(() => b.mm.status().phase === 'seeking', 3_000, 'Ben back to seeking');
    expect(b.mm.notice()).toBe('Ann did not accept. Back in the queue.');
    a.mm.seek({ queues: [Q], deckId: 'd' });
    await until(() => b.mm.status().phase === 'check', 3_000, 'check again');
    a.mm.answer(true);
    b.mm.advance(20_000);
    await until(() => b.mm.status().phase === 'off', 1_000, 'Ben off after the lapse');
    expect(b.mm.notice()).toBe(MM_TEXT.missed);
    await until(() => a.mm.status().phase === 'seeking', 5_000, 'Ann back to seeking');
    expect(live()).toMatchObject({ transports: 1, timers: 1 });
  });

  it('entering a networked room turns the matchmaker off and releases the lobby transport and the beat', async () => {
    const { a } = await twoPages();
    a.mm.seek({ queues: [Q], deckId: 'd' });
    await until(() => a.mm.status().phase === 'seeking', 2_000, 'seeking');
    expect(live()).toMatchObject({ transports: 1, timers: 1 });
    // Another page route (Decks) keeps the search; a networked room (a private table) ends it.
    a.mm.route('#/decks');
    expect(a.mm.status().phase).toBe('seeking');
    a.mm.route('#/t/amber-fox-93/AAAAAAAAAAAAAAAAAAAAAA');
    expect(a.mm.status()).toEqual({ phase: 'off' });
    expect(a.mm.messages().some((r) => r.dir === 'out' && r.msg.t === 'unseek')).toBe(true);
    expect(live()).toMatchObject({ transports: 0, timers: 0 });
  });

  it('a deck that cannot be read matches as average; the ticket carries nothing else about it', async () => {
    const { a, b } = await twoPages();
    a.mm.seek({ queues: [Q], deckId: 'missing-deck' });
    b.mm.seek({ queues: [Q], deckId: 'missing-deck' });
    await until(() => a.mm.status().phase === 'check', 3_000, 'check');
    const mine = a.mm.room()!.state.ticket!;
    expect(mine).toMatchObject({ band: 3, score: 50 });
    expect(Object.keys(mine).sort()).toEqual(['band', 'name', 'nat', 'open', 'peerId', 'proto', 'pubKey', 'queues', 'ratings', 'rev', 'score', 'sig', 'tid', 'v']);
  });

  it('a lobby join that never completes: failed after 15 s with the relay text; nothing is left running', async () => {
    const A = await browser('ann', 'peer-a', 'Ann', 0);
    browsers.push(A);
    const mm = createMatchmaker({
      settings: A.stores.settings,
      decks: A.stores.decks,
      ratings: A.stores.ratings,
      matches: A.stores.matches,
      games: A.stores.games,
      identity: () => Promise.resolve(fakeNetIdentity('peer-a', 'Ann')),
      transport: () => Object.assign(lobbyNet().create('silent'), { join: () => new Promise<void>(() => undefined) }),
      followRoutes: false,
    });
    pages.push({ mm, hashes: [], phases: [], statuses: [] });
    mm.seek({ queues: [Q], deckId: 'd' });
    await vi.advanceTimersByTimeAsync(14_000);
    expect(mm.status().phase).toBe('connecting');
    await vi.advanceTimersByTimeAsync(1_500);
    expect(mm.status()).toEqual({ phase: 'failed', problem: 'relays', text: MM_TEXT.relays });
    expect(live()).toMatchObject({ transports: 0, timers: 0 });
  });

  it('relays that never answer although the join returned (Trystero joins before any relay answers): failed after 15 s', async () => {
    const A = await browser('ann', 'peer-a', 'Ann', 0);
    browsers.push(A);
    let asked = 0;
    const mm = createMatchmaker({
      settings: A.stores.settings,
      decks: A.stores.decks,
      ratings: A.stores.ratings,
      matches: A.stores.matches,
      games: A.stores.games,
      identity: () => Promise.resolve(fakeNetIdentity('peer-a', 'Ann')),
      transport: () => lobbyNet().create('alone'),
      relays: () => (asked++, Promise.resolve(false)),
      followRoutes: false,
    });
    pages.push({ mm, hashes: [], phases: [], statuses: [] });
    mm.seek({ queues: [Q], deckId: 'd' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mm.status().phase).toBe('seeking');
    await vi.advanceTimersByTimeAsync(13_000);
    expect(mm.status().phase).toBe('seeking');
    expect(asked).toBe(0);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(asked).toBe(1);
    expect(mm.status()).toEqual({ phase: 'failed', problem: 'relays', text: MM_TEXT.relays });
    expect(live()).toMatchObject({ transports: 0, timers: 0 });
  });

  it('relays that answer keep the search going', async () => {
    const A = await browser('ann', 'peer-a', 'Ann', 0);
    browsers.push(A);
    const mm = createMatchmaker({
      settings: A.stores.settings,
      decks: A.stores.decks,
      ratings: A.stores.ratings,
      matches: A.stores.matches,
      games: A.stores.games,
      identity: () => Promise.resolve(fakeNetIdentity('peer-a', 'Ann')),
      transport: () => lobbyNet().create('alone'),
      relays: () => Promise.resolve(true),
      followRoutes: false,
    });
    pages.push({ mm, hashes: [], phases: [], statuses: [] });
    mm.seek({ queues: [Q], deckId: 'd' });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(mm.status().phase).toBe('seeking');
  });

  it('a join that rejects (no WebRTC, the transport module did not load): failed, nothing left running, and RETRY opens afresh', async () => {
    const A = await browser('ann', 'peer-a', 'Ann', 0);
    browsers.push(A);
    let fail = true;
    const net = lobbyNet();
    const mm = createMatchmaker({
      settings: A.stores.settings,
      decks: A.stores.decks,
      ratings: A.stores.ratings,
      matches: A.stores.matches,
      games: A.stores.games,
      identity: () => Promise.resolve(fakeNetIdentity('peer-a', 'Ann')),
      transport: () => {
        const t = net.create(`ann-${Math.random()}`);
        if (fail) t.join = () => Promise.reject(new Error('no WebRTC'));
        return t;
      },
      followRoutes: false,
    });
    pages.push({ mm, hashes: [], phases: [], statuses: [] });
    mm.seek({ queues: [Q], deckId: 'd' });
    await vi.advanceTimersByTimeAsync(100);
    expect(mm.status()).toEqual({ phase: 'failed', problem: 'relays', text: MM_TEXT.relays });
    expect(live()).toMatchObject({ transports: 0, timers: 0 });
    fail = false;
    mm.seek({ queues: [Q], deckId: 'd' });
    await until(() => mm.status().phase === 'seeking', 2_000, 'seeking after RETRY');
  });

  it('watch(true) then seek while the lobby is still joining (a transport that learns its id on join): one lobby, and the search runs', async () => {
    const A = await browser('ann', 'peer-a', 'Ann', 0);
    browsers.push(A);
    const net = lobbyNet();
    const mm = createMatchmaker({
      settings: A.stores.settings,
      decks: A.stores.decks,
      ratings: A.stores.ratings,
      matches: A.stores.matches,
      games: A.stores.games,
      identity: () => Promise.resolve(fakeNetIdentity('peer-a', 'Ann')),
      transport: () => {
        const t = lateIdTransport(net.create('ann-late'));
        const join = t.join.bind(t);
        // A cold Trystero chunk: the join takes a while.
        t.join = (room: string, key: string): Promise<void> => new Promise((resolve, reject) => setTimeout(() => void join(room, key).then(resolve, reject), 2_000));
        return t;
      },
      followRoutes: false,
    });
    pages.push({ mm, hashes: [], phases: [], statuses: [] });
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown): void => void unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      mm.watch(true);
      mm.seek({ queues: [Q], deckId: 'd' });
      mm.widen();
      await vi.advanceTimersByTimeAsync(500);
      expect(mm.status().phase).toBe('connecting');
      expect(live().transports).toBe(1);
      await until(() => mm.status().phase === 'seeking', 5_000, 'seeking');
      expect(mm.status()).toMatchObject({ phase: 'seeking', window: { rating: null, band: null } });
      expect(live().transports).toBe(1);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('CANCEL while the lobby is still joining, then seek again: the new search runs on a fresh lobby', async () => {
    const A = await browser('ann', 'peer-a', 'Ann', 0);
    browsers.push(A);
    const net = lobbyNet();
    let n = 0;
    const mm = createMatchmaker({
      settings: A.stores.settings,
      decks: A.stores.decks,
      ratings: A.stores.ratings,
      matches: A.stores.matches,
      games: A.stores.games,
      identity: () => Promise.resolve(fakeNetIdentity('peer-a', 'Ann')),
      transport: () => {
        const t = net.create(`ann-${++n}`);
        const join = t.join.bind(t);
        t.join = (room: string, key: string): Promise<void> => new Promise((resolve, reject) => setTimeout(() => void join(room, key).then(resolve, reject), 2_000));
        return t;
      },
      followRoutes: false,
    });
    pages.push({ mm, hashes: [], phases: [], statuses: [] });
    mm.seek({ queues: [Q], deckId: 'd' });
    await vi.advanceTimersByTimeAsync(500);
    mm.cancel();
    expect(mm.status()).toEqual({ phase: 'off' });
    mm.seek({ queues: [Q], deckId: 'd' });
    await until(() => mm.status().phase === 'seeking', 5_000, 'seeking again');
    expect(live().transports).toBe(1);
  });

  it('CANCEL while the match records are written: the record is void and the game not in History once the writes land', async () => {
    const lobby = lobbyNet({ seed: 41 });
    const A = await browser('ann', 'peer-a', 'Ann', 0);
    const B = await browser('ben', 'peer-b', 'Ben', 1);
    browsers.push(A, B);
    // Ann's match store writes slowly.
    let release: (() => void) | null = null;
    const real = A.stores.matches;
    let put = (r: MatchRecord): Promise<void> => new Promise<void>((resolve, reject) => (release = () => void real.put(r).then(resolve, reject)));
    const slow: MatchStore = { get: (id) => real.get(id), list: () => real.list(), delete: (id) => real.delete(id), put: (r) => put(r) };
    const a = mmPage(lobby, 'Ann', A.peerId, { ...A.stores, matches: slow });
    const b = mmPage(lobby, 'Ben', B.peerId, B.stores);
    pages.push(a, b);
    const m = await toMoving(a, b);
    await until(() => release !== null, 1_000, 'the record write');
    a.mm.cancel();
    expect(a.mm.status()).toEqual({ phase: 'off' });
    release!();
    // The slow store writes once more (the void): let that one through at once.
    put = (r) => real.put(r);
    await eventually(async () => (await A.stores.matches.get(m.link.roomId))?.state === 'void', 'void record');
    await eventually(async () => !(await A.stores.games.get(m.link.roomId)), 'no History entry');
    expect(a.hashes).toEqual([]);
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
    // Back in the queue with the wait kept (both members were stranded, so they may already be matched again).
    await until(() => a.statuses.slice(a.statuses.findIndex((x) => x.phase === 'moving')).some((x) => x.phase === 'seeking'), 3_000, 'seeking again');
    const back = a.statuses.slice(a.statuses.findIndex((x) => x.phase === 'moving')).find((x) => x.phase === 'seeking');
    expect((back as { since: number }).since).toBe(since);
    expect((await browsers[0]!.stores.matches.get(m.link.roomId))?.state).toBe('void');
    // The lobby was left on moving and joined again only now: one lobby transport per page.
    expect(live().transports).toBe(2);
  });
});

async function toMoving(a: MmPage, b: MmPage): Promise<Extract<ReturnType<MmPage['mm']['status']>, { phase: 'moving' }>> {
  a.mm.seek({ queues: [Q], deckId: 'd' });
  b.mm.seek({ queues: [Q], deckId: 'd' });
  await until(() => a.mm.status().phase === 'check' && b.mm.status().phase === 'check', 3_000, 'check');
  a.mm.answer(true);
  b.mm.answer(true);
  await until(() => a.mm.status().phase === 'moving' && b.mm.status().phase === 'moving', 3_000, 'moving');
  const m = a.mm.status();
  if (m.phase !== 'moving') throw new Error('not moving');
  return m;
}

describe('leaving moving (the matchmaker owns the arrival deadline)', () => {
  it('without any table session (the creator never arrives) both members are back in seeking after 30 s, off the room route', async () => {
    const { A, a, b } = await twoPages();
    const m = await toMoving(a, b);
    await until(() => a.hashes.length === 1 && b.hashes.length === 1, 2_000, 'both navigate to the room');
    await vi.advanceTimersByTimeAsync(29_000);
    expect(a.mm.status().phase).toBe('moving');
    await vi.advanceTimersByTimeAsync(1_500);
    for (const p of [a, b]) {
      expect(p.mm.status().phase).not.toBe('moving');
      expect(p.hashes).toEqual([`#/t/${m.link.roomId}/${m.link.key}`, '#/']);
      expect(p.mm.takeNotice()).toMatchObject({ again: true });
      // Taken once.
      expect(p.mm.takeNotice()).toBeNull();
    }
    await until(() => [a, b].every((p) => p.phases.slice(p.phases.indexOf('moving')).includes('seeking')), 3_000, 'both seeking again');
    expect((await A.stores.matches.get(m.link.roomId))?.state).toBe('void');
  });

  it('a route away from the match room while moving abandons it: void, off, no notice; seek works again', async () => {
    const { A, a, b } = await twoPages();
    const m = await toMoving(a, b);
    a.mm.route(`#/t/${m.link.roomId}/${m.link.key}`);
    expect(a.mm.status().phase).toBe('moving');
    a.mm.route('#/');
    expect(a.mm.status()).toEqual({ phase: 'off' });
    await eventually(async () => (await A.stores.matches.get(m.link.roomId))?.state === 'void', 'void record');
    expect(a.mm.takeNotice()).toBeNull();
    a.mm.seek({ queues: [Q], deckId: 'd' });
    await until(() => a.mm.status().phase === 'seeking', 3_000, 'seeking again');
  });

  it('CANCEL while moving abandons the match; it never stays in moving', async () => {
    const { a, b } = await twoPages();
    await toMoving(a, b);
    b.mm.cancel();
    expect(b.mm.status()).toEqual({ phase: 'off' });
    expect(live().timers).toBe(1);
  });

  it('CANCEL clears a pending notice, so a later status shows no stale toast', async () => {
    const { a, b } = await twoPages();
    a.mm.seek({ queues: [Q], deckId: 'd' });
    b.mm.seek({ queues: [Q], deckId: 'd' });
    await until(() => a.mm.status().phase === 'check' && b.mm.status().phase === 'check', 3_000, 'check');
    a.mm.answer(false);
    await until(() => b.mm.status().phase === 'seeking', 3_000, 'Ben back to seeking');
    expect(b.mm.notice()).toBe('Ann did not accept. Back in the queue.');
    b.mm.cancel();
    expect(b.mm.notice()).toBeNull();
    expect(b.mm.takeNotice()).toBeNull();
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
      stops.push(runMatchedEntry({ session: x.session!, record: recOf(x), me: x.peerId, deck, matchmaker: mmOf(x).mm }));
      // The table frame's rating watcher (ui/table/TableFrame.svelte), for as long as the table is shown.
      stops.push(watchRatedResult({ session: x.session!, roomId: m.link.roomId, ratings: x.stores.ratings, matches: x.stores.matches }));
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

describe('the rating outlives no table, and every table mount applies it (matchmaking.md 2.9)', () => {
  it('a reload of the loser before its concession, and a winner away when it comes: both ratings change once', async () => {
    const { A, B, a, b } = await twoPages();
    const m = await toMoving(a, b);
    await until(() => true, 50, 'records');
    const recA = (await A.stores.matches.get(m.link.roomId))!;
    const recB = (await B.stores.matches.get(m.link.roomId))!;
    const creator = recA.players[0]!.peerId === A.peerId ? A : B;
    const other = creator === A ? B : A;
    const recOf = (x: Browser): MatchRecord => (x === A ? recA : recB);
    const mmOf = (x: Browser): MmPage => (x === A ? a : b);
    const game = gameNet({ seed: 47 });
    const opts = (x: Browser) => {
      const i = matchSessionInternals(recOf(x), x.peerId);
      return [{ createdHere: i.createdHere, neverAlone: i.neverAlone, loneWaitMs: 1_000, preferSeat: i.preferSeat }, { roomId: m.link.roomId, roomKey: m.link.key, format: i.format }] as const;
    };
    /** What the table frame does while it is mounted: the rating watcher, and the matched entry in the lobby stage. */
    const mounts = new Map<Browser, (() => void)[]>();
    const mount = (x: Browser, entry: boolean): void => {
      const list = [watchRatedResult({ session: x.session!, roomId: m.link.roomId, ratings: x.stores.ratings, matches: x.stores.matches })];
      if (entry) list.push(runMatchedEntry({ session: x.session!, record: recOf(x), me: x.peerId, deck: null, matchmaker: mmOf(x).mm }));
      mounts.set(x, list);
    };
    const unmount = (x: Browser): void => {
      for (const s of mounts.get(x) ?? []) s();
      mounts.delete(x);
    };
    stops.push(() => [...mounts.keys()].forEach(unmount));
    const pc = open(game, creator, ...opts(creator));
    const po = open(game, other, ...opts(other));
    await Promise.all([pc, po]);
    // Commit decks and start without the deal (the rating needs only the result).
    for (const x of [creator, other]) {
      mount(x, true);
      await settle(x.session!.importDeck(await fixtureDeck(x === A ? 'gw-m19-60.txt' : 'ur-m19-60.mtga.txt')), 60_000, 'the deck');
    }
    await until(() => [creator, other].every((x) => x.session!.engine.confirmedState().stage === 'match'), 60_000, 'the match');

    await test_step('the loser reloads: its table is left and opened again (stage match, no matched entry)', async () => {
      unmount(other);
      await settle(other.session!.leave(), 10_000, 'leave');
      await open(game, other, { ...opts(other)[0], neverAlone: true }, opts(other)[1]);
      mount(other, false);
      await waitConverged([creator.session!, other.session!], 'one table again');
    });

    await test_step('the winner goes Home; the loser concedes from its reopened table', async () => {
      unmount(creator);
      await settle(creator.session!.leave(), 10_000, 'leave');
      concede(other.session!);
      await until(() => other.session!.engine.confirmedState().result !== undefined, 30_000, 'the result');
      await eventually(async () => (await other.stores.ratings.get('1v1.constructed')) !== null, 'the loser rated');
      expect(await creator.stores.ratings.get('1v1.constructed')).toBeNull();
    });

    await test_step('the winner opens the table again: its browser applies the change it missed', async () => {
      await open(game, creator, { ...opts(creator)[0] }, opts(creator)[1]);
      mount(creator, false);
      await until(() => creator.session!.getState().result !== undefined, 30_000, 'the winner syncs the result');
      await eventually(async () => (await creator.stores.ratings.get('1v1.constructed')) !== null, 'the winner rated');
      const expected = ratingChanges(recA.players.map((p, i) => ({ rating: p.rating, games: p.games, band: p.band, side: i as 0 | 1 })), 0)!;
      const ra = (await creator.stores.ratings.get('1v1.constructed'))!;
      const rb = (await other.stores.ratings.get('1v1.constructed'))!;
      expect(ra.rating).toBe(expected[0]!.after);
      expect(rb.rating).toBe(expected[1]!.after);
      expect([ra.games, rb.games]).toEqual([1, 1]);
      // Once: another mount changes nothing.
      unmount(creator);
      mount(creator, false);
      await vi.advanceTimersByTimeAsync(1_000);
      expect((await creator.stores.ratings.get('1v1.constructed'))?.games).toBe(1);
    });
  }, 300_000);
});

describe('a matched 2HG table seats its members as planned', () => {
  it('members arriving in reverse plan order sit in their planned chairs, so the teams are the offer\'s; a deck that cannot be read gives up 30 s after arrival', async () => {
    const people = await Promise.all(['a', 'b', 'c', 'd'].map((n, i) => browser(`t${n}`, `peer-${n}`, n.toUpperCase(), i)));
    browsers.push(...people);
    const ROOM_ID = 'amber-fox-river-77';
    const ROOM_KEY = 'BBBBBBBBBBBBBBBBBBBBBB';
    // The plan: team 0 first (Ann and Dan), then team 1 (Ben and Cat).
    const order = [people[0]!, people[3]!, people[1]!, people[2]!];
    const record: MatchRecord = {
      matchId: '0123456789abcdef',
      roomId: ROOM_ID,
      roomKey: ROOM_KEY,
      queue: '2hg.constructed.casual',
      players: order.map((p, i) => ({ peerId: p.peerId, pubKey: `pk-${p.peerId}`, name: p.name, rating: 1500, games: 0, band: 3, score: 50, team: (i < 2 ? 0 : 1) as 0 | 1 })),
      formedAt: 0,
      state: 'playing',
      deckId: 'missing',
    };
    const game = gameNet({ seed: 53 });
    const openOf = (x: Browser) => {
      const i = matchSessionInternals(record, x.peerId);
      return open(game, x, { createdHere: i.createdHere, neverAlone: i.neverAlone, loneWaitMs: 1_000, preferSeat: i.preferSeat }, { roomId: ROOM_ID, roomKey: ROOM_KEY, format: i.format });
    };
    await openOf(order[0]!);
    // The others arrive at once, last planned first.
    await Promise.all([order[3]!, order[2]!, order[1]!].map((x) => openOf(x)));
    const stalled: string[] = [];
    for (const x of order) stops.push(runMatchedEntry({ session: x.session!, record, me: x.peerId, deck: null, matchmaker: null, onStalled: (t) => stalled.push(`${x.name}: ${t}`) }));
    const sessions = order.map((x) => x.session!);
    await waitConverged(sessions, 'the seated table');
    const st = sessions[0]!.engine.confirmedState();
    expect(st.format).toBe('2hg');
    expect(order.map((_, i) => st.seats[`s${i}`]?.peer)).toEqual(order.map((x) => x.peerId));
    const teamPeers = (t: string): string[] => st.teams[t]!.seats.map((s) => st.seats[s]!.peer!).sort();
    expect(teamPeers('t0')).toEqual(record.players.filter((p) => p.team === 0).map((p) => p.peerId).sort());
    expect(teamPeers('t1')).toEqual(record.players.filter((p) => p.team === 1).map((p) => p.peerId).sort());
    // Nobody could commit a deck: 30 s after everyone was reached, each entry gives up with the reason.
    expect(stalled).toEqual([]);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(stalled.sort()).toEqual(order.map((x) => `${x.name}: ${DECK_UNREADABLE}`).sort());
  }, 300_000);
});

/** A named section of a long sim (the e2e's test.step). */
async function test_step(name: string, body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } catch (e) {
    throw new Error(`${name}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
}
