/**
 * The networked session's behaviour around the engine (PLAN M1-P8; DESIGN "Players, seats and formats", Seats;
 * "Multiplayer architecture", Resume; "Specification: network protocol and secrecy": Sequencing 3-4, Timers, Public
 * randomness, Secret shuffle). Real sessions on a LoopbackNetwork under fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../../../src/core/actions';
import type { Channel, Message, MessageHandler, PeerHandler, PeerId, Transport } from '../../../src/net/transport';
import { mtg } from '../../../src/games/index';
import { openNetSession } from '../../../src/session/net';
import { UnreachableTransport } from '../../../src/session/transports';
import { browser, cards, closeAll, FAKE_TIMERS, fixtureDeck, hashOf, net, open, settle, until, waitConverged, type Browser, KEY, ROOM } from './harness';
import { isLand, playScript } from './script';

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

async function two(seed = 1): Promise<{ network: ReturnType<typeof net>; A: Browser; B: Browser }> {
  const network = net({ seed });
  const A = await browser('anna', 'peer-a', 'Anna', 1);
  const B = await browser('ben', 'peer-b', 'Ben', 3);
  browsers.push(A, B);
  await open(network, A);
  await open(network, B);
  await waitConverged([A.session!, B.session!]);
  return { network, A, B };
}

const actions = (b: Browser): Action[] => b.session!.log().flatMap((e) => (e.kind === 'action' ? [e.action] : []));
const warnings = (b: Browser): string[] => b.session!.log().flatMap((e) => (e.kind === 'system' ? [e.text] : []));

describe('chairs', () => {
  it('two browsers that open the link at the same moment end up in different chairs and agree on one table', async () => {
    const network = net({ seed: 12, delay: { min: 5, max: 50 } });
    const A = await browser('anna', 'peer-a', 'Anna', 0);
    const B = await browser('ben', 'peer-b', 'Ben', 0);
    browsers.push(A, B);
    const [a, b] = await Promise.all([open(network, A), open(network, B)]);
    await waitConverged([a, b]);
    expect(new Set([a.seat, b.seat])).toEqual(new Set(['s0', 's1']));
    const seats = a.getState().seats;
    expect(seats[a.seat]).toMatchObject({ peer: 'peer-a', name: 'Anna' });
    expect(seats[b.seat]).toMatchObject({ peer: 'peer-b', name: 'Ben' });
    // Both preferred colour 0: the second chair takes another one.
    expect(seats.s0!.colour).not.toBe(seats.s1!.colour);
  });

  it('a browser that joins later waits for the table and takes the free chair, never the creator’s', async () => {
    const network = net({ seed: 13 });
    const A = await browser('anna', 'peer-z', 'Anna'); // a peer id that sorts after B's
    browsers.push(A);
    const a = await open(network, A);
    expect(a.seat).toBe('s0');
    const B = await browser('ben', 'peer-a', 'Ben');
    browsers.push(B);
    const b = await open(network, B);
    expect(b.seat).toBe('s1');
    await waitConverged([a, b]);
    expect(a.getState().seats.s0!.peer).toBe('peer-z');
    // B never proposed a chair someone held.
    expect(warnings(B).filter((w) => /seatTake/.test(w))).toEqual([]);
  });

  it('a third browser at a full 1v1 table is told so plainly', async () => {
    const { network } = await two(14);
    const C = await browser('cleo', 'peer-c', 'Cleo');
    browsers.push(C);
    await expect(open(network, C)).rejects.toThrow('This table is full.');
  });

  it('moving chairs: the new chair is taken before the old one is left, stamped as the lobby does, and nothing is refused', async () => {
    const network = net({ seed: 15 });
    const A = await browser('anna', 'peer-a', 'Anna', 1);
    const B = await browser('ben', 'peer-b', 'Ben', 3);
    const C = await browser('cleo', 'peer-c', 'Cleo', 5);
    browsers.push(A, B, C);
    const opts = { format: 'ffa4' as const };
    const a = await open(network, A, {}, opts);
    const b = await open(network, B, {}, opts);
    const c = await open(network, C, {}, opts);
    await waitConverged([a, b, c]);
    expect([a.seat, b.seat, c.seat]).toEqual(['s0', 's1', 's2']);
    // A follower moves up (s1 -> s3).
    const up = b.takeSeat('s3', 3);
    expect(up).toMatchObject({ type: 'seatTake', seat: 's3', by: 's3', peer: 'peer-b', name: 'Ben' });
    await waitConverged([a, b, c]);
    expect(b.seat).toBe('s3');
    const moves = actions(B).slice(-2);
    expect(moves.map((x) => [x.type, x.by])).toEqual([
      ['seatTake', 's3'],
      ['seatLeave', 's1'],
    ]);
    expect(moves[0]!.group).toBeDefined();
    expect(moves[1]!.group).toBe(moves[0]!.group);
    // The sequencer itself moves to the chair B left; s0 is free now, and A still holds the lowest taken chair.
    a.takeSeat('s1', 1);
    await waitConverged([a, b, c]);
    expect(a.seat).toBe('s1');
    expect(a.getState().seats.s0!.peer).toBeUndefined();
    // C moves into the lowest chair and so becomes the sequencer.
    c.takeSeat('s0', 5);
    await waitConverged([a, b, c]);
    await until(() => [a, b, c].every((s) => s.engine.sequencerId() === 'peer-c'), 20_000, 'C to sequence');
    for (const x of [A, B, C]) expect(warnings(x).filter((w) => /refused/.test(w)), x.name).toEqual([]);
    expect([a.seat, b.seat, c.seat]).toEqual(['s1', 's3', 's0']);
  });

  it('takeSeat uses the identity’s current nickname, and “Player” while it has none', async () => {
    const network = net({ seed: 16 });
    const A = await browser('anna', 'peer-a', '');
    browsers.push(A);
    const a = await open(network, A);
    expect(a.getState().seats.s0!.name).toBe('Player');
    // The lobby renames through the IdentityStore; main.ts's live identity follows it (session/live-identity.ts).
    (A.identity as { nickname: string }).nickname = 'Ann Lee';
    a.takeSeat('s0', 4);
    await until(() => a.engine.pending().length === 0);
    expect(a.getState().seats.s0).toMatchObject({ name: 'Ann Lee', colour: 4 });
  });
});

describe('sequencing', () => {
  it('a proposal the sequencer refuses is rolled back and logged with its reason', async () => {
    const { A, B } = await two(21);
    const a = A.session!;
    const b = B.session!;
    a.dispatch({ type: 'createToken', card: 'tok-1', zone: 'battlefield:s0', pose: { x: 0, y: -250, rot: 0 }, label: 'Soldier' });
    await waitConverged([a, b]);
    // A (the sequencer) removes the token while B's tap of it is on the way.
    a.dispatch({ type: 'remove', card: 'tok-1' });
    b.dispatch({ type: 'tap', card: 'tok-1', tapped: true });
    expect(b.getState().cards['tok-1']?.tapped).toBe(true);
    await waitConverged([a, b]);
    expect(b.getState().cards['tok-1']).toBeUndefined();
    expect(warnings(B).some((w) => /^tap refused: /.test(w))).toBe(true);
  });

  it('own chat lines come back sequenced with their cid in both logs', async () => {
    const { A, B } = await two(22);
    const line = A.session!.chat('good luck');
    expect(line.cid).toBeTruthy();
    await waitConverged([A.session!, B.session!]);
    for (const x of [A, B]) expect(actions(x).find((e) => e.type === 'chat')).toMatchObject({ cid: line.cid, text: 'good luck', by: 's0' });
  });

  it('a confirmation round times out on the sequencer’s clock for a seat that stays silent', async () => {
    const { A, B } = await two(23);
    const a = A.session!;
    a.dispatch({ type: 'ask', round: 'r-1', label: 'attacks?' });
    await waitConverged([a, B.session!]);
    expect(a.getState().confirm?.responses.s1).toBeUndefined();
    await until(() => a.engine.confirmedState().confirm?.responses.s1 === 'timeout', 15_000, 'the timeout');
    await waitConverged([a, B.session!]);
    const t = actions(B).find((x) => x.type === 'respond');
    expect(t).toMatchObject({ type: 'respond', seat: 's1', response: 'timeout', by: 's0' });
  });
});

describe('commit windows (DESIGN "Specification: network protocol and secrecy", Public randomness 2, Secret shuffle 2)', () => {
  it('three seats: a seat that stays silent in a roll and a shuffle another seat started is excluded by the sequencer after 3 s', async () => {
    const network = net({ seed: 31 });
    const A = await browser('anna', 'peer-a', 'Anna', 1);
    const B = await browser('ben', 'peer-b', 'Ben', 3);
    const C = await browser('cleo', 'peer-c', 'Cleo', 5);
    browsers.push(A, B, C);
    const a = await open(network, A, {}, { format: 'ffa3' });
    const b = await open(network, B, {}, { format: 'ffa3' });
    const c = await open(network, C, {}, { format: 'ffa3' });
    await waitConverged([a, b, c]);
    expect([a.seat, b.seat, c.seat]).toEqual(['s0', 's1', 's2']);
    expect(a.engine.isSequencer()).toBe(true);
    await settle(b.importDeck(await fixtureDeck('ur-m19-60.mtga.txt')));
    await waitConverged([a, b, c]);
    // C stays connected (heartbeats go on) but never contributes: every proposal of its own is dropped.
    const silent = vi.spyOn(c.engine, 'propose').mockReturnValue(false);
    const t0 = Date.now();
    const result = settle(b.roll('die', 6), 20_000, 'the roll');
    const rolled = await result;
    expect(rolled).toBeGreaterThanOrEqual(1);
    expect(rolled).toBeLessThanOrEqual(6);
    const close = actions(A).find((x) => x.type === 'commitClose' && x.kind === 'rng');
    expect(close).toMatchObject({ by: 's0' });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(3000);
    const rid = (close as { id: string }).id;
    expect(Object.keys(a.engine.confirmedState().rng[rid]!.commits).sort()).toEqual(['s0', 's1']);
    await settle(b.shuffle(), 20_000, 'the shuffle');
    const shuffleClose = actions(A).find((x) => x.type === 'commitClose' && x.kind === 'shuffle');
    expect(shuffleClose).toMatchObject({ by: 's0' });
    const sid = (shuffleClose as { id: string }).id;
    expect(Object.keys(a.engine.confirmedState().shuffles[sid]!.nonces).sort()).toEqual(['s0']);
    expect(a.engine.confirmedState().shuffles[sid]!.orderHash).not.toBeNull();
    silent.mockRestore();
    const h = await waitConverged([a, b, c]);
    expect(hashOf(c.engine.confirmedState())).toBe(h);
    expect(c.engine.confirmedState().rng[rid]!.result).toBe(rolled);
  });
});

describe('undo', () => {
  it('after a public card returns to the hand and the hand gets fresh ids, undo skips the steps naming the old ids', async () => {
    const network = net({ seed: 24 });
    const p = await playScript(network, browsers);
    const a = p.a;
    const sidOf = (id: string): string => a.secrets().identities[id]!.card.sid;
    for (let i = 0; i < 20 && !a.secrets().hand.some((id) => isLand(sidOf(id))); i++) await settle(a.draw(1));
    const land = a.secrets().hand.find((id) => isLand(sidOf(id)))!;
    a.dispatch({ type: 'move', card: land, to: 'battlefield:s0', pose: { x: 200, y: -200, rot: 0 } });
    a.dispatch({ type: 'createToken', card: 'tok-u', zone: 'battlefield:s0', pose: { x: 260, y: -200, rot: 0 }, label: 'Soldier' });
    a.dispatch({ type: 'tap', card: 'tok-u', tapped: true });
    a.dispatch({ type: 'toZone', card: land, to: 'hand:s0', position: 'any' });
    await until(() => a.engine.confirmedState().cards[land] === undefined && a.engine.pending().length === 0, 20_000, 'the re-issue');
    // The return and the play name the land's retired id: gone from the stack. The tap is undone next.
    expect(a.undo()).toBe(true);
    await waitConverged([a, p.b]);
    expect(p.b.getState().cards['tok-u']!.tapped).toBe(false);
    expect(warnings(p.A).filter((w) => /Cannot undo/.test(w))).toEqual([]);
  });
});

describe('owed private effects', () => {
  it('a hand re-issue the sequencer refuses is tried again until the hand has fresh ids', async () => {
    const network = net({ seed: 25 });
    const A = await browser('anna', 'peer-a', 'Anna');
    const B = await browser('ben', 'peer-b', 'Ben');
    browsers.push(A, B);
    const a = await open(network, A);
    // B's first hand re-issue reaches the sequencer broken, so it is refused (nack).
    let broken = 0;
    const b = await open(network, B, {}, {
      transport: () =>
        new Tamper(network.create('peer-b'), (action) => {
          if (action.type !== 'reorder' || !action.reissue || broken > 0) return action;
          broken++;
          return { ...action, count: action.count + 5 };
        }),
    });
    await settle(a.importDeck(await fixtureDeck('gw-m19-60.txt')));
    await settle(b.importDeck(await fixtureDeck('ur-m19-60.mtga.txt')));
    await settle(b.draw(7));
    await waitConverged([a, b]);
    const card = b.secrets().hand[0]!;
    b.dispatch({ type: 'move', card, to: 'battlefield:s1', pose: { x: 0, y: 200, rot: 180 } });
    await until(() => b.engine.confirmedState().cards[card]?.identity !== undefined, 20_000, 'the card to be turned up');
    b.dispatch({ type: 'toZone', card, to: 'hand:s1', position: 'any' });
    await until(() => broken === 1 && warnings(B).some((w) => /^reorder refused/.test(w)), 20_000, 'the refused re-issue');
    await until(() => a.engine.confirmedState().cards[card] === undefined && b.engine.pending().length === 0, 20_000, 'the re-issue to be tried again');
    await waitConverged([a, b]);
    expect(b.secrets().hand).not.toContain(card);
    expect(b.secrets().hand).toHaveLength(7);
    expect([...b.secrets().hand].sort()).toEqual([...a.engine.confirmedState().zones['hand:s1']!.ids].sort());
  });

  it('a card played face up is still turned up when the page reloads after its move is sequenced and before its flip is', async () => {
    const network = net({ seed: 26 });
    const p = await playScript(network, browsers);
    const { a, b } = p;
    const card = b.secrets().hand[0]!;
    const sid = b.secrets().identities[card]!.card.sid;
    // B (not the sequencer) closes right after the move comes back sequenced: its verified flip is never proposed.
    let cut = false;
    b.engine.onSequenced((x) => {
      if (!cut && x.type === 'move' && x.card === card) {
        cut = true;
        b.leave();
      }
    });
    b.dispatch({ type: 'move', card, to: 'battlefield:s1', pose: { x: 80, y: 200, rot: 180 } });
    await until(() => cut, 10_000, 'the move');
    await settle(b.whenSaved());
    await until(() => a.engine.confirmedState().cards[card]?.zone === 'battlefield:s1', 10_000, 'the move at A');
    expect(a.engine.confirmedState().cards[card]).toMatchObject({ face: 'down' });
    expect(a.engine.confirmedState().cards[card]!.identity).toBeUndefined();
    const b2 = await open(network, p.B, { settleMs: 200 });
    await until(() => a.engine.confirmedState().cards[card]?.identity !== undefined, 20_000, 'the turn-up after the reload');
    expect(a.engine.confirmedState().cards[card]).toMatchObject({ face: 'up', identity: { sid } });
    await waitConverged([a, b2]);
    expect(p.B.nonces.ids('turnUp')).toEqual([]);
    // A card played face down on purpose is left face down after a reload.
    const hidden = b2.secrets().hand[0]!;
    b2.playFaceDown(hidden, 'battlefield:s1', { x: 160, y: 200, rot: 180 });
    await waitConverged([a, b2]);
    b2.leave();
    const b3 = await open(network, p.B, { settleMs: 200 });
    await waitConverged([a, b3]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(a.engine.confirmedState().cards[hidden]).toMatchObject({ face: 'down' });
    expect(a.engine.confirmedState().cards[hidden]!.identity).toBeUndefined();
  });
});

describe('joint randomness', () => {
  it('the HUD’s back-to-back rngCommit and rngReveal: the reveal waits until the other seat committed', async () => {
    const { A, B } = await two(31);
    const a = A.session!;
    const { nonceHash } = await import('../../../src/core/commit');
    const nonce = 'hud-nonce-0123456789';
    a.dispatch({ type: 'rngCommit', rid: 'rng-hud', purpose: 'die', n: 6, h: nonceHash(nonce) });
    a.dispatch({ type: 'rngReveal', rid: 'rng-hud', nonce });
    await until(() => a.engine.confirmedState().rng['rng-hud']?.result != null, 15_000, 'the result');
    await waitConverged([a, B.session!]);
    const r = B.session!.getState().rng['rng-hud']!;
    expect(Object.keys(r.commits).sort()).toEqual(['s0', 's1']);
    expect(r.reveals.s0).toBe(nonce);
    expect(warnings(A).filter((w) => /refused/.test(w))).toEqual([]);
  });

  it('a roll survives the roller’s reload: the committed nonce is revealed from local storage once the other seat commits', async () => {
    const { network, A, B } = await two(32);
    // B's connection drops: it is still waited for (an away seat counts, decision M1-P2).
    network.kill('peer-b');
    let rolled: number | null = null;
    void A.session!.roll('die', 20).then(
      (r) => (rolled = r),
      () => undefined,
    );
    await until(() => Object.keys(A.session!.engine.confirmedState().rng).length === 1, 10_000, 'the commit');
    const rid = Object.keys(A.session!.engine.confirmedState().rng)[0]!;
    expect(A.nonces.get('rng', rid)).not.toBeNull();
    await settle(A.session!.whenSaved());
    // A reloads while the round waits.
    A.session!.leave();
    expect(rolled).toBeNull();
    const a = await open(network, A, { settleMs: 200 });
    network.revive('peer-b');
    await until(() => a.engine.confirmedState().rng[rid]?.result != null, 30_000, 'the result after the reload');
    await waitConverged([a, B.session!]);
    expect(Object.keys(a.engine.confirmedState().rng[rid]!.reveals).sort()).toEqual(['s0', 's1']);
    // The nonce of a decided round is forgotten.
    await until(() => A.nonces.get('rng', rid) === null, 5_000, 'the nonce to be dropped');
  });

  it('an own nonce that comes back from the sequencer changed is logged as an integrity warning', async () => {
    const network = net({ seed: 33 });
    const A = await browser('anna', 'peer-a', 'Anna');
    const B = await browser('ben', 'peer-b', 'Ben');
    browsers.push(A, B);
    const a = await open(network, A);
    // B's shuffle nonces are rewritten on the way to the sequencer (a sequencer could do that: actions are unsigned).
    const b = await open(network, B, {}, { transport: () => new Tamper(network.create('peer-b')) });
    await settle(a.importDeck(await fixtureDeck('gw-m19-60.txt')));
    await settle(b.importDeck(await fixtureDeck('ur-m19-60.mtga.txt')));
    await settle(a.shuffle(), 30_000, 'A’s shuffle');
    await waitConverged([a, b]);
    expect(warnings(B).some((w) => /^Integrity warning: your shuffleNonce came back from the sequencer changed/.test(w))).toBe(true);
    expect(warnings(A).filter((w) => /Integrity/.test(w))).toEqual([]);
  });
});

/** A transport whose join resolves at once while the peer connection comes up `ms` later (TrysteroTransport: Nostr signalling). */
function lateTransport(network: ReturnType<typeof net>, peerId: string, ms: number): () => Transport {
  return () => {
    const t = network.create(peerId);
    const join = t.join.bind(t);
    t.join = (room: string, key: string) => {
      setTimeout(() => void join(room, key), ms);
      return Promise.resolve();
    };
    return t;
  };
}

const chats = (b: Browser): string[] => actions(b).flatMap((a) => (a.type === 'chat' ? [a.text] : []));

describe('a table started alone (decision M1-P8: peers that connect after SETTLE_MS)', () => {
  async function lateJoiner(seed: number, internals: { createdHere?: boolean; loneWaitMs?: number } = { createdHere: true }) {
    const network = net({ seed });
    const A = await browser('anna', 'peer-a', 'Anna', 1);
    const B = await browser('ben', 'peer-b', 'Ben', 3);
    browsers.push(A, B);
    const a = await open(network, A, internals.createdHere ? { createdHere: true } : {});
    const b = await open(network, B, internals.loneWaitMs !== undefined ? { loneWaitMs: internals.loneWaitMs } : {}, { transport: lateTransport(network, B.peerId, 3000) });
    return { network, A, B, a, b };
  }

  it('a joiner that sat alone at the creator’s chair gives it up once they connect, even when both spoke meanwhile', async () => {
    const { A, B, a, b } = await lateJoiner(41);
    expect(b.seat).toBe('s0'); // nobody answered within SETTLE_MS
    await vi.advanceTimersByTimeAsync(5000);
    a.chat('anyone there?');
    await vi.advanceTimersByTimeAsync(500);
    b.chat('hi');
    await until(() => a.engine.state().seats.s1?.peer === 'peer-b' && chats(A).length === 2 && chats(B).length === 2, 60_000, 'B to rejoin');
    await waitConverged([a, b]);
    expect(a.seat).toBe('s0');
    expect(b.seat).toBe('s1');
    expect(a.engine.sequencerId()).toBe(b.engine.sequencerId());
    expect(chats(B)).toEqual(['anyone there?', 'hi']);
    expect(warnings(B).some((w) => /already at this table/.test(w))).toBe(true);
    expect(warnings(A).some((w) => /already at this table/.test(w))).toBe(false);
  });

  it('the same when both changed their seat colour before they connected (histories of equal length)', async () => {
    const { a, b } = await lateJoiner(42);
    a.takeSeat('s0', 5);
    b.takeSeat('s0', 6);
    await vi.advanceTimersByTimeAsync(4000);
    await until(() => a.engine.state().seats.s1?.peer === 'peer-b', 60_000, 'B to rejoin');
    await waitConverged([a, b]);
    expect([a.seat, b.seat]).toEqual(['s0', 's1']);
    expect(a.getState().seats.s0).toMatchObject({ peer: 'peer-a', colour: 5 });
  });

  it('a joiner that pressed Ready alone gives up its table too and is asked to press Ready again; the creator’s Ready stays', async () => {
    const { A, B, a, b } = await lateJoiner(43);
    await settle(a.importDeck(await fixtureDeck('gw-m19-60.txt')));
    await settle(b.importDeck(await fixtureDeck('ur-m19-60.mtga.txt')));
    a.chat('ready');
    await vi.advanceTimersByTimeAsync(4000);
    await until(() => a.engine.state().seats.s1?.peer === 'peer-b', 60_000, 'B to rejoin');
    await waitConverged([a, b]);
    const st = a.engine.confirmedState();
    expect(Object.keys(st.commitments)).toEqual(['s0']);
    expect(b.secrets().identities).toEqual({});
    expect(warnings(B).some((w) => /press Ready again/.test(w))).toBe(true);
    // B readies again at its new chair and both agree.
    await settle(b.importDeck(await fixtureDeck('ur-m19-60.mtga.txt')));
    await waitConverged([a, b]);
    expect(Object.keys(a.engine.confirmedState().commitments).sort()).toEqual(['s0', 's1']);
    expect(actions(A).filter((x) => x.type === 'ready')).toHaveLength(2);
    expect(warnings(A).some((w) => /already at this table/.test(w))).toBe(false);
  });

  it('two browsers that both started alone without a creator both give up, meet afresh and converge', async () => {
    const { A, B, a, b } = await lateJoiner(44, {});
    expect([a.seat, b.seat]).toEqual(['s0', 's0']);
    a.chat('one');
    b.chat('two');
    await vi.advanceTimersByTimeAsync(4000);
    await until(() => new Set([a.engine.seat(), b.engine.seat()]).size === 2 && a.engine.seat() !== null && b.engine.seat() !== null, 60_000, 'different chairs');
    await waitConverged([a, b]);
    expect(new Set([a.seat, b.seat])).toEqual(new Set(['s0', 's1']));
    await until(() => chats(A).length === 2, 10_000, 'both lines said again');
    await waitConverged([a, b]);
    expect(new Set(chats(A))).toEqual(new Set(['one', 'two']));
    expect(chats(B)).toEqual(chats(A));
  });

  it('a joiner that waits for peers (LONE_WAIT_MS) takes the free chair once they connect and never sits alone', async () => {
    const { A, B, a, b } = await lateJoiner(45, { createdHere: true, loneWaitMs: 8000 });
    expect(b.seat).toBe('s1');
    await waitConverged([a, b]);
    expect(warnings(B).some((w) => /already at this table/.test(w))).toBe(false);
    expect(a.getState().seats.s0!.peer).toBe('peer-a');
    expect(actions(A).filter((x) => x.type === 'seatTake').map((x) => x.by)).toEqual(['s0', 's1']);
  });

  it('a joiner that waits for peers sits alone once LONE_WAIT_MS passed with nobody there', async () => {
    const network = net({ seed: 46 });
    const B = await browser('ben', 'peer-b', 'Ben', 3);
    browsers.push(B);
    const start = Date.now();
    const b = await open(network, B, { loneWaitMs: 8000 });
    expect(b.seat).toBe('s0');
    expect(Date.now() - start).toBeGreaterThanOrEqual(8000);
  });
});

describe('joining', () => {
  it('a join through relays that never answer is cancelled by its signal: the transport is left and the open rejects', async () => {
    const A = await browser('anna', 'peer-a', 'Anna');
    browsers.push(A);
    let left = 0;
    class Stuck extends UnreachableTransport {
      override leave(): void {
        left++;
      }
    }
    const joining = new AbortController();
    const p = openNetSession({ game: mtg, cardData: cards(), roomId: ROOM, roomKey: KEY, transport: () => new Stuck('t-a'), identity: A.identity, store: A.stores.tables }, { nonces: A.nonces }, joining.signal);
    let outcome: unknown = null;
    p.catch((e: unknown) => (outcome = e));
    // Thirty seconds of table time (in small steps, so the fake IndexedDB's own callbacks run in between).
    for (let i = 0; i < 3_000; i++) await vi.advanceTimersByTimeAsync(10);
    expect(outcome).toBeNull();
    expect(left).toBe(0);
    joining.abort();
    await until(() => outcome !== null, 1_000, 'the open to reject');
    expect(String(outcome)).toMatch(/cancelled/);
    expect(left).toBe(1);
  });
});

describe('resume', () => {
  it('a reload rejoins the same chair with the same hand and library order, the log, and one state hash', async () => {
    const network = net({ seed: 41 });
    const p = await playScript(network, browsers);
    const before = { seat: p.a.seat, hand: [...p.a.secrets().hand], library: [...p.a.secrets().libraryOrder], log: p.a.log().filter((e) => e.kind === 'action').length };
    p.a.leave();
    const a = await open(network, p.A, { settleMs: 200 });
    await waitConverged([a, p.b]);
    expect(a.seat).toBe(before.seat);
    expect(a.secrets().hand).toEqual(before.hand);
    expect(a.secrets().libraryOrder).toEqual(before.library);
    expect(a.log().filter((e) => e.kind === 'action').length).toBeGreaterThanOrEqual(before.log);
    expect(hashOf(a.getState())).toBe(hashOf(p.b.getState()));
    // And A plays on from its restored secrets: a draw takes the top card it remembered.
    const top = before.library[0]!;
    await settle(a.draw(1));
    await waitConverged([a, p.b]);
    expect(a.secrets().hand).toContain(top);
  });

  it('the cards another seat saw are rebuilt from the log after a reload, so the next shuffle still re-issues their ids', async () => {
    const network = net({ seed: 42 });
    const p = await playScript(network, browsers);
    const sidOf = (id: string): string => p.a.secrets().identities[id]!.card.sid;
    for (let i = 0; i < 20 && !p.a.secrets().hand.some((id) => isLand(sidOf(id))); i++) await settle(p.a.draw(1));
    const land = p.a.secrets().hand.find((id) => isLand(sidOf(id)))!;
    // A plays a land and puts it back on top of its library: B saw it, and knows where it is.
    p.a.dispatch({ type: 'move', card: land, to: 'battlefield:s0', pose: { x: 200, y: -200, rot: 0 } });
    p.a.dispatch({ type: 'toZone', card: land, to: 'library:s0', position: 'top' });
    await waitConverged([p.a, p.b]);
    await settle(p.a.whenSaved());
    p.a.leave();
    const a = await open(network, p.A, { settleMs: 200 });
    await settle(a.shuffle(), 30_000, 'the shuffle after the reload');
    await waitConverged([a, p.b]);
    const done = actions(p.B).filter((x) => x.type === 'shuffleDone').at(-1)!;
    expect(done.type === 'shuffleDone' && done.reissue !== undefined).toBe(true);
    expect(a.getState().cards[land]).toBeUndefined();
  });

  it('after a catch-up from a snapshot, every own card counts as seen, so the next shuffle re-issues the library', async () => {
    const network = net({ seed: 44 });
    const p = await playScript(network, browsers);
    // A drops off while B plays on for more than a tail's worth of actions: A comes back through a snapshot, and
    // cannot tell what the skipped stretch showed of its cards.
    network.kill(p.A.peerId);
    for (let i = 0; i < 620; i++) {
      p.b.chat(`line ${i}`);
      if (i % 50 === 49) await vi.advanceTimersByTimeAsync(200);
    }
    await until(() => p.b.engine.pending().length === 0, 60_000, 'B to play on alone');
    network.revive(p.A.peerId);
    await waitConverged([p.a, p.b], 'A to catch up');
    await settle(p.a.shuffle(), 30_000, 'the shuffle after the catch-up');
    await waitConverged([p.a, p.b]);
    const done = actions(p.B).filter((x) => x.type === 'shuffleDone').at(-1)!;
    expect(done.type === 'shuffleDone' && done.reissue !== undefined).toBe(true);
  });

  it('every sequenced action is saved with the table record, and the save restores the same state hash', async () => {
    const network = net({ seed: 43 });
    const p = await playScript(network, browsers);
    const loaded = (await settle(p.A.stores.tables.loadTable(ROOM)))!;
    expect(loaded.table).toMatchObject({ roomId: ROOM, roomKey: KEY, seat: 's0', lastSeq: p.a.engine.seq(), stage: p.a.getState().stage });
    expect(loaded.secrets).toEqual(p.a.secrets());
    const log = await settle(p.A.stores.tables.loadLog(ROOM));
    expect(log.map((r) => r.seq)).toEqual(Array.from({ length: p.a.engine.seq() }, (_, i) => i + 1));
  });
});

/** A transport that rewrites this peer's `shuffleNonce` proposals in transit (as a dishonest sequencer could). */
/** Rewrites own proposals on the way to the sequencer (default: B's shuffle nonces). */
class Tamper implements Transport {
  constructor(
    private readonly inner: Transport,
    private readonly rewrite: (action: Action) => Action = (action) => (action.type === 'shuffleNonce' ? { ...action, nonce: 'chosen-by-the-sequencer' } : action),
  ) {}
  get selfId(): PeerId {
    return this.inner.selfId;
  }
  join(roomId: string, roomKey: string): Promise<void> {
    return this.inner.join(roomId, roomKey);
  }
  leave(): void {
    this.inner.leave();
  }
  peers(): PeerId[] {
    return this.inner.peers();
  }
  send(channel: Channel, msg: Message, to?: PeerId): void {
    if (channel === 'act' && msg.t === 'propose') {
      const action = (msg as unknown as { action: Action }).action;
      const next = this.rewrite(action);
      if (next !== action) {
        this.inner.send(channel, { ...msg, action: next } as Message, to);
        return;
      }
    }
    this.inner.send(channel, msg, to);
  }
  on(channel: Channel, handler: MessageHandler): void {
    this.inner.on(channel, handler);
  }
  onPeer(handler: PeerHandler): void {
    this.inner.onPeer(handler);
  }
}
