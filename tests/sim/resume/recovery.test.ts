/**
 * PLAN M1-P7 acceptance, simulated network: "the recovery flow yields a library whose size equals deck size minus
 * public cards minus the agreed hand" (DESIGN "Multiplayer architecture", Resume and failure handling: "If a player
 * loses their local save (cleared storage, different device), their hidden zones are gone. The recovery path is public
 * and logged: the player re-imports the deck, the table subtracts every card of theirs that is currently public, and
 * the remainder is committed and shuffled as a new library with a fresh hand count agreed by the table").
 *
 * Real networked sessions on a LoopbackNetwork under fake timers. A browser loses its save of the room (table record,
 * log, secret store and local-storage nonces deleted; the key pair kept), reopens the link, rejoins its chair and runs
 * the session's recovery driver (session/net.ts `recover`): `recover {hand, round}`, the M1-P3 confirmation round the
 * other seat answers (or lets time out), `recoverCommit` with exactly `recoveryLibrarySize` fresh ids, M1-P2's secret
 * shuffle with the other seat's nonce, and the draws for the agreed hand.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { recoveryStatus } from '../../../src/session/resume';
import { browser, closeAll, FAKE_TIMERS, fixtureDeck, hashOf, LossyTransport, net, open, settle, until, waitConverged, type Browser, type NetTable } from '../session/harness';
import { isLand, playScript, type Played } from '../session/script';
import { deckCards, loseSave, publicCards } from './helpers';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

let browsers: Browser[] = [];
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
});
afterEach(() => {
  closeAll(browsers);
  browsers = [];
  vi.useRealTimers();
});

const actions = (s: NetTable): Action[] => s.log().flatMap((e) => (e.kind === 'action' ? [e.action] : []));
const warnings = (s: NetTable): string[] => s.log().flatMap((e) => (e.kind === 'system' ? [e.text] : []));
const DECK = { A: 'gw-m19-60.txt', B: 'ur-m19-60.mtga.txt' } as const;

/** Settle `p` and return its error message, failing when it resolves. */
async function rejection(p: Promise<unknown>, maxMs = 60_000): Promise<string> {
  try {
    await settle(p, maxMs, 'the rejection');
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error('expected a rejection');
}

interface Lost {
  p: Played;
  /** The browser that lost its save, reopened at its chair. */
  me: Browser;
  s: NetTable;
  other: NetTable;
  seat: 's0' | 's1';
  deckSize: number;
}

/** Play the script, then `who` loses its save and reopens the link. */
async function lose(seed: number, who: 'A' | 'B'): Promise<Lost> {
  const network = net({ seed });
  const p = await playScript(network, browsers);
  const me = who === 'A' ? p.A : p.B;
  const seat = who === 'A' ? 's0' : 's1';
  const deckSize = deckCards(p.a.engine.confirmedState(), seat);
  await loseSave(me);
  const s = await open(network, me, { settleMs: 200 });
  const other = who === 'A' ? p.b : p.a;
  await waitConverged([s, other], 'the rejoin after the lost save');
  return { p, me, s, other, seat, deckSize };
}

describe('the lost-save recovery flow', () => {
  it.each([
    ['B', 'B', 91],
    ['A, the sequencer,', 'A', 92],
  ] as const)('%s loses its save: it rejoins its chair, sees its hidden cards lost, and the recovery leaves deck − public − hand in the library', async (_label, who, seed) => {
    const { me, s, other, seat, deckSize } = await lose(seed, who);
    expect(deckSize).toBe(60);
    expect(s.seat).toBe(seat);
    const view = s.getState();
    const before = recoveryStatus(view, s.secrets(), seat);
    expect(before.phase).toBe('lost');
    expect(before.lost.hand).toBe(view.zones[`hand:${seat}`]!.ids.length);
    expect(before.lost.library).toBe(view.zones[`library:${seat}`]!.ids.length);
    expect(before.deckSize).toBe(60);
    const pub = publicCards(view, seat);
    expect(pub).toBeGreaterThan(0);
    expect(before.maxHand).toBe(60 - pub);
    const commitsBefore = view.commitments[seat]!.instanceIds.length;
    const seqBefore = s.engine.seq();

    // The other seat stays silent: the pass timer (5 s) agrees for it.
    await settle(s.recover(await fixtureDeck(DECK[who]), 7), 120_000, 'the recovery');
    await waitConverged([s, other], 'the recovery to settle');

    for (const st of [s.engine.confirmedState(), other.engine.confirmedState()]) {
      expect(st.zones[`library:${seat}`]!.ids).toHaveLength(60 - pub - 7);
      expect(st.zones[`hand:${seat}`]!.ids).toHaveLength(7);
      expect(st.seats[seat]!.recovering).toBeUndefined();
      expect(publicCards(st, seat)).toBe(pub);
      // recoverCommit committed exactly recoveryLibrarySize fresh ids, appended to the seat's commitment.
      expect(st.commitments[seat]!.instanceIds).toHaveLength(commitsBefore + 60 - pub);
    }
    // The flow is public and logged: recover (the round "new hand of 7?"), the other seat's pass, recoverCommit, the shuffle, the draws.
    const log = actions(other).filter((a) => a.seq! > seqBefore);
    const types = log.map((a) => a.type);
    const at = (t: Action['type']): number => types.indexOf(t);
    expect(log.find((a) => a.type === 'recover')).toMatchObject({ by: seat, hand: 7 });
    expect(at('recover')).toBeLessThan(at('recoverCommit'));
    expect(log.slice(at('recover'), at('recoverCommit')).some((a) => a.type === 'respond' && a.response === 'timeout' && a.seat !== seat)).toBe(true);
    expect(log.find((a) => a.type === 'recoverCommit')).toMatchObject({ by: seat, zone: `library:${seat}` });
    expect((log.find((a) => a.type === 'recoverCommit') as Extract<Action, { type: 'recoverCommit' }>).instanceIds).toHaveLength(60 - pub);
    expect(at('recoverCommit')).toBeLessThan(at('shuffleCommit'));
    expect(log.filter((a) => a.type === 'shuffleNonce' && a.by !== seat)).toHaveLength(1);
    expect(log.filter((a) => a.type === 'draw' && a.by === seat)).toHaveLength(7);

    // The recovered browser holds every new hidden card, and plays on: the identities match the new commitment.
    const sec = s.secrets();
    expect(sec.hand).toHaveLength(7);
    expect(sec.libraryOrder).toHaveLength(60 - pub - 7);
    for (const id of [...sec.hand, ...sec.libraryOrder]) expect(Object.hasOwn(sec.identities, id)).toBe(true);
    expect(recoveryStatus(s.getState(), sec, seat).phase).toBe('none');
    let land = sec.hand.find((id) => isLand(sec.identities[id]!.card.sid));
    for (let i = 0; i < 20 && !land; i++) {
      await settle(s.draw(1));
      land = s.secrets().hand.find((id) => isLand(s.secrets().identities[id]!.card.sid));
    }
    s.dispatch({ type: 'move', card: land!, to: `battlefield:${seat}`, pose: { x: 300, y: seat === 's0' ? -300 : 300, rot: 0 } });
    await until(() => other.engine.confirmedState().cards[land!]?.identity !== undefined, 20_000, 'the land to be turned up');
    await waitConverged([s, other]);
    // The turned-up land matches the new commitment: no peer flags it.
    expect(other.engine.confirmedState().cards[land!]!.suspect).toBeUndefined();
    expect(warnings(other).filter((w) => /Integrity/.test(w))).toEqual([]);
    expect(me.session).toBe(s);
  });

  it('a hold objects: nothing is committed while the other seat holds; after its release the timer passes and the recovery completes', async () => {
    const { s, other, seat } = await lose(93, 'B');
    const pub = publicCards(s.getState(), seat);
    const run = s.recover(await fixtureDeck(DECK.B), 6);
    let done = false;
    run.then(() => (done = true), () => undefined);
    await until(() => other.engine.confirmedState().seats[seat]?.recovering !== undefined, 20_000, 'the proposal');
    const round = other.engine.confirmedState().seats[seat]!.recovering!.round;
    expect(other.engine.confirmedState().confirm).toMatchObject({ id: round, askedBy: seat, label: 'new hand of 6?' });
    other.dispatch({ type: 'respond', round, seat: other.seat, response: 'hold' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(done).toBe(false);
    expect(actions(other).some((a) => a.type === 'recoverCommit')).toBe(false);
    const status = recoveryStatus(s.getState(), s.secrets(), seat);
    expect(status).toMatchObject({ phase: 'proposed', hand: 6, round: { id: round, current: true, holder: other.seat, agreed: false } });
    expect(status.librarySize).toBe(60 - pub);
    // Its hidden zones are already gone from the table (discarded by `recover`), its public cards stay.
    expect(s.getState().zones[`library:${seat}`]!.ids).toEqual([]);
    expect(publicCards(s.getState(), seat)).toBe(pub);
    other.dispatch({ type: 'respond', round, seat: other.seat, response: 'release' });
    await settle(run, 60_000, 'the recovery after the release');
    await waitConverged([s, other]);
    expect(other.engine.confirmedState().zones[`library:${seat}`]!.ids).toHaveLength(60 - pub - 6);
    expect(other.engine.confirmedState().zones[`hand:${seat}`]!.ids).toHaveLength(6);
  });

  it('another round that starts before the table agreed ends the wait; proposing again (another count) completes with the deck size counted the first time', async () => {
    const { s, other, seat } = await lose(94, 'B');
    const pub = publicCards(s.getState(), seat);
    const first = s.recover(await fixtureDeck(DECK.B), 7);
    await until(() => other.engine.confirmedState().seats[seat]?.recovering !== undefined, 20_000, 'the proposal');
    other.dispatch({ type: 'ask', round: 'r-other', label: 'attacks?' });
    expect(await rejection(first)).toMatch(/Another confirmation round started/);
    expect(s.recovering()).toBe(false);
    // Seat.recovering stays open with the deck size counted before the discard.
    expect(s.engine.confirmedState().seats[seat]!.recovering).toMatchObject({ hand: 7, deckSize: 60 });
    other.dispatch({ type: 'respond', round: s.engine.confirmedState().confirm!.id, seat: other.seat, response: 'ok' });
    await settle(s.recover(await fixtureDeck(DECK.B), 5), 60_000, 'the second proposal');
    await waitConverged([s, other]);
    const st = other.engine.confirmedState();
    expect(actions(other).filter((a) => a.type === 'recover').map((a) => (a as Extract<Action, { type: 'recover' }>).hand)).toEqual([7, 5]);
    expect(st.zones[`library:${seat}`]!.ids).toHaveLength(60 - pub - 5);
    expect(st.zones[`hand:${seat}`]!.ids).toHaveLength(5);
  });

  it('a re-imported deck that lacks a public card, too small a deck and too large a hand are refused with nothing proposed', async () => {
    const { s, other, seat } = await lose(95, 'B');
    const seq = s.engine.seq();
    const hash = hashOf(s.engine.confirmedState());
    const wrong = await fixtureDeck(DECK.A);
    expect(await rejection(s.recover(wrong, 7))).toMatch(/not the deck you played/);
    const right = await fixtureDeck(DECK.B);
    expect(await rejection(s.recover({ main: right.main.slice(0, 30), side: [] }, 7))).toMatch(/has \d+ cards/);
    expect(await rejection(s.recover(right, 61))).toMatch(/at most \d+ cards/);
    expect(await rejection(s.recover(right, -1))).toMatch(/whole number/);
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.engine.seq()).toBe(seq);
    expect(hashOf(other.engine.confirmedState())).toBe(hash);
    expect(recoveryStatus(s.getState(), s.secrets(), seat).phase).toBe('lost');
  });

  it('a page that reloads after the table agreed but before its library was committed finishes the same proposal: no second recover', async () => {
    const network = net({ seed: 96 });
    const p = await playScript(network, browsers);
    const pub = publicCards(p.a.engine.confirmedState(), 's1');
    await loseSave(p.B);
    // This page's recoverCommit never reaches the sequencer (it reloads before it is sequenced).
    const lossy = await open(network, p.B, { settleMs: 200 }, { transport: () => new LossyTransport(network.create(p.B.peerId), (a) => a.type === 'recoverCommit') });
    await waitConverged([lossy, p.a]);
    const run = lossy.recover(await fixtureDeck(DECK.B), 7);
    run.catch(() => undefined);
    await until(() => recoveryStatus(p.a.engine.confirmedState(), p.a.secrets(), 's1').phase === 'agreed', 30_000, 'the table to agree');
    await vi.advanceTimersByTimeAsync(3000);
    expect(actions(p.a).some((a) => a.type === 'recoverCommit')).toBe(false);
    lossy.leave();
    const s = await open(network, p.B, { settleMs: 200 });
    await waitConverged([s, p.a]);
    expect(recoveryStatus(s.getState(), s.secrets(), 's1')).toMatchObject({ phase: 'agreed', hand: 7, librarySize: 60 - pub });
    await settle(s.recover(await fixtureDeck(DECK.B), 7), 60_000, 'the recovery after the reload');
    await waitConverged([s, p.a]);
    expect(actions(p.a).filter((a) => a.type === 'recover')).toHaveLength(1);
    expect(p.a.engine.confirmedState().zones['library:s1']!.ids).toHaveLength(60 - pub - 7);
    expect(s.secrets().hand).toHaveLength(7);
  });

  it('nothing is lost after a plain reload: the recovery is not offered', async () => {
    const network = net({ seed: 97 });
    const p = await playScript(network, browsers);
    p.b.leave();
    const b = await open(network, p.B, { settleMs: 200 });
    await waitConverged([b, p.a]);
    expect(recoveryStatus(b.getState(), b.secrets(), 's1')).toMatchObject({ phase: 'none', lost: { hand: 0, library: 0 } });
  });

  it('a recovery in the lobby after Ready (nothing public): the library is the whole deck minus the agreed hand', async () => {
    const network = net({ seed: 98 });
    const A = await browser('anna', 'peer-a', 'Anna', 2);
    const B = await browser('ben', 'peer-b', 'Ben', 5);
    browsers.push(A, B);
    const a = await open(network, A);
    await open(network, B);
    await settle(a.importDeck(await fixtureDeck(DECK.A)));
    await settle(B.session!.importDeck(await fixtureDeck(DECK.B)));
    await waitConverged([a, B.session!]);
    await loseSave(B);
    const b = await open(network, B, { settleMs: 200 });
    await waitConverged([a, b]);
    expect(recoveryStatus(b.getState(), b.secrets(), 's1')).toMatchObject({ phase: 'lost', lost: { hand: 0, library: 60 }, publicCards: 0, maxHand: 60 });
    await settle(b.recover(await fixtureDeck(DECK.B), 0), 60_000, 'the recovery');
    await waitConverged([a, b]);
    expect(a.engine.confirmedState().zones['library:s1']!.ids).toHaveLength(60);
    expect(b.secrets().libraryOrder).toHaveLength(60);
  });
});
