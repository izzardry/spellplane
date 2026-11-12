/**
 * PLAN M1-P8 acceptance: two LoopbackNetwork sessions converge on the same hash for a scripted game, and the leak scan
 * (tests/leak/scan.ts, through tests/leak/leak.ts) finds nothing (CLAUDE.md: hidden information never leaves its
 * owner's browser except through the design's reveal paths; this is the networked session's scenario of the shared
 * leak test).
 *
 * Both browsers run the real networked session (session/net.ts) over the M1-P1 engine and the M1-P2 pair channel, on
 * a network with delay and reordering, under fake timers. The script (DESIGN "Multiplayer architecture", Hidden
 * information; "Specification: network protocol and secrecy"): both take chairs, both Ready with a fixture deck
 * (commitments only), both shuffle with each other's nonces, both draw seven, A mulligans and bottoms a card, A scries
 * one to the bottom, A plays a land (reveal first), A casts a spell onto the stack (reveal first), A reveals a hand
 * card to B only, A plays a card face down, A rolls a die (commit and reveal by both), A returns its land to the hand
 * (fresh ids for the hand), B draws and plays a land.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scan } from '../../leak/scan';
import { forbiddenFor, leakScan } from '../../leak/leak';
import { secretTokens } from '../../../src/core/secrets';
import type { InstanceId } from '../../../src/core/types';
import { browser, closeAll, FAKE_TIMERS, fixtureDeck, hashOf, net, observedBy, open, settle, trackDisclosures, typeOf, until, waitConverged, type Browser } from './harness';

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

const isLand = (sid: string): boolean => /\bLand\b/.test(typeOf(sid));

describe('M1-P8 acceptance: a scripted game over two networked sessions', () => {
  it('both sessions converge on one state hash and B holds nothing of A’s hidden cards', async () => {
    const network = net({ seed: 21, delay: { min: 0, max: 80 } });
    const A = await browser('anna', 'peer-a', 'Anna', 2);
    const B = await browser('ben', 'peer-b', 'Ben', 5);
    browsers = [A, B];

    // Anna opens the link first and takes the first chair; Ben joins, catches up and takes the other one.
    const a = await open(network, A);
    expect(a.seat).toBe('s0');
    const b = await open(network, B);
    expect(b.seat).toBe('s1');
    await waitConverged([a, b]);
    expect(a.getState().seats.s0).toMatchObject({ name: 'Anna', colour: 2, peer: 'peer-a' });
    expect(b.getState().seats.s1).toMatchObject({ name: 'Ben', colour: 5, peer: 'peer-b' });
    const shownToB = trackDisclosures(a, 's1');

    // Ready: commitments and opaque ids only.
    await settle(a.importDeck(await fixtureDeck('gw-m19-60.txt')));
    await settle(b.importDeck(await fixtureDeck('ur-m19-60.mtga.txt')));
    await waitConverged([a, b]);
    expect(b.getState().seats.s0!.ready).toBe(true);
    expect(b.getState().zones['library:s0']!.ids).toHaveLength(60);

    // Both shuffle with the other's nonce (each waits for it), then draw seven.
    await settle(Promise.all([a.shuffle(), b.shuffle()]), 30_000, 'both shuffles');
    await settle(a.draw(7));
    await settle(b.draw(7));
    await waitConverged([a, b]);
    const st = a.engine.confirmedState();
    const shuffles = Object.values(st.shuffles);
    expect(shuffles).toHaveLength(2);
    for (const r of shuffles) expect(Object.keys(r.nonces)).toEqual([r.owner === 's0' ? 's1' : 's0']);
    expect(a.secrets().hand).toHaveLength(7);
    expect(b.getState().zones['hand:s0']!.ids).toHaveLength(7);

    // A mulligans (hand in, shuffle with B's nonce, seven new) and puts one card on the bottom.
    await settle(a.mulligan(), 30_000, 'the mulligan');
    const bottomed = a.secrets().hand[0]!;
    a.dispatch({ type: 'toZone', card: bottomed, to: 'library:s0', position: 'bottom' });
    expect(a.secrets().libraryOrder.at(-1)).toBe(bottomed);
    // A scries 1: a logged look, then the top card goes to the bottom as a private reorder.
    const [seen] = await settle(a.lookAt('library:s0', 1));
    a.dispatch({ type: 'toZone', card: seen!.id, to: 'library:s0', position: 'bottom' });
    expect(a.secrets().libraryOrder.at(-1)).toBe(seen!.id);
    await waitConverged([a, b]);

    // Make sure A has a land and three other cards in hand.
    const handOf = (): InstanceId[] => a.secrets().hand;
    const sidOf = (id: InstanceId): string => a.secrets().identities[id]!.card.sid;
    for (let i = 0; i < 20 && (!handOf().some((id) => isLand(sidOf(id))) || handOf().filter((id) => !isLand(sidOf(id))).length < 3); i++) await settle(a.draw(1));
    const land = handOf().find((id) => isLand(sidOf(id)))!;
    const [spell, shown, faceDown] = handOf().filter((id) => !isLand(sidOf(id)));

    // A plays the land and casts a spell: each publishes the identity first (a `reveal` checked against the commitment).
    a.dispatch({ type: 'move', card: land, to: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 } });
    a.dispatch({ type: 'stackPush', item: 'si-1', kind: 'spell', card: spell!, controller: 's0' });
    // A shows a hand card to B only, and plays a card face down.
    a.dispatch({ type: 'revealTo', instanceId: shown!, seats: ['s1'] });
    a.playFaceDown(faceDown!, 'battlefield:s0', { x: 70, y: -200, rot: 0 });
    await waitConverged([a, b]);
    await until(() => Object.hasOwn(b.secrets().received, shown!), 5_000, 'B to receive the targeted reveal');
    expect(b.secrets().received[shown!]).toMatchObject({ card: a.secrets().identities[shown!]!.card, from: 's0' });
    expect(b.getState().cards[land]!.identity).toEqual(a.secrets().identities[land]!.card);
    expect(b.getState().cards[spell!]).toMatchObject({ zone: 'stack', identity: a.secrets().identities[spell!]!.card });
    expect(b.getState().cards[faceDown!]).toMatchObject({ zone: 'battlefield:s0', face: 'down' });
    expect(b.getState().cards[faceDown!]!.identity).toBeUndefined();
    expect(a.getState().cards[shown!]!.identity).toBeUndefined();

    // A rolls a die: commit and reveal by both seats, one result on both sides.
    const result = await settle(a.roll('die', 6), 30_000, 'the roll');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(6);
    await waitConverged([a, b]);
    const round = Object.values(b.engine.confirmedState().rng)[0]!;
    expect(Object.keys(round.commits).sort()).toEqual(['s0', 's1']);
    expect(round.result).toBe(result);

    // A returns its land to the hand: the hand gets fresh opaque ids (the land's old id is gone on both sides).
    a.dispatch({ type: 'toZone', card: land, to: 'hand:s0', position: 'any' });
    await until(() => a.engine.confirmedState().cards[land] === undefined, 10_000, 'the re-issue of A’s hand');
    // B draws and plays a land.
    await settle(b.draw(1));
    const bLand = b.secrets().hand.find((id) => isLand(b.secrets().identities[id]!.card.sid)) ?? b.secrets().hand[0]!;
    b.dispatch({ type: 'move', card: bLand, to: 'battlefield:s1', pose: { x: 0, y: 200, rot: 180 } });

    const h = await waitConverged([a, b], 'the end of the script');
    expect(hashOf(a.getState())).toBe(h);
    expect(hashOf(b.getState())).toBe(h);
    await settle(Promise.all([a.whenSaved(), b.whenSaved()]));

    // Every path the leak test is about was exercised.
    const types = new Set(b.log().flatMap((e) => (e.kind === 'action' ? [e.action.type] : [])));
    for (const t of ['seatTake', 'ready', 'shuffleCommit', 'shuffleNonce', 'shuffleDone', 'draw', 'mulligan', 'toZone', 'lookAt', 'reorder', 'reveal', 'move', 'stackPush', 'revealTo', 'rngCommit', 'rngReveal']) {
      expect(types, t).toContain(t);
    }
    expect(b.log().some((e) => e.kind === 'action' && e.action.type === 'reorder' && e.action.reissue !== undefined && e.action.zone === 'hand:s0')).toBe(true);

    // The leak scan: nothing B received, holds in state or log, keeps in its secret store or IndexedDB carries an
    // identity, salt, nonce or id mapping of a card that stayed hidden in A's hand or library.
    const observed = await observedBy(network, B);
    const input = { observed, owner: { state: a.engine.confirmedState(), secrets: a.secrets() }, disclosed: shownToB };
    const forbidden = forbiddenFor(input);
    expect(forbidden.tokens.length).toBeGreaterThan(40);
    expect(scan(observed, secretTokens(a.engine.confirmedState(), a.secrets()).filter((t) => !shownToB.some((d) => d.sid === t || d.salt === t)))).toEqual([]);
    const report = leakScan(input);
    expect(report.tokens).toEqual([]);
    expect(report.pairs).toEqual([]);
    // And the other way round: A holds nothing of B's hidden cards.
    const back = leakScan({ observed: await observedBy(network, A), owner: { state: b.engine.confirmedState(), secrets: b.secrets() }, disclosed: [] });
    expect(back.tokens).toEqual([]);
    expect(back.pairs).toEqual([]);
  });
});
