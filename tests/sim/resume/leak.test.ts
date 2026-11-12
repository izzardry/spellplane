/**
 * The lost-save recovery's scenario of the shared leak test, driven through the real networked session (CLAUDE.md: any
 * code touching hidden information adds its scenario to the shared leak test; PLAN M1-P7). M1-P2's minitable version
 * (tests/sim/secrecy/leak.test.ts) runs the protocol by hand; this one runs session/net.ts `recover` end to end.
 *
 * The scripted game (tests/sim/session/script.ts) under delay, loss and reordering; then B loses its save, reopens the
 * link, re-imports its deck and recovers with a fresh hand of 7 that A lets pass; B plays a land from the new hand.
 * The scanner (tests/leak/leak.ts) checks everything A received, holds in state and log, keeps in its secret store and
 * IndexedDB against B's new hidden cards (only the land was shown), and everything B holds against A's hidden cards.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoopbackOptions } from '../../../src/net/loopback';
import { forbiddenFor, leakScan } from '../../leak/leak';
import { closeAll, FAKE_TIMERS, fixtureDeck, net, observedBy, open, settle, trackDisclosures, until, waitConverged, type Browser } from '../session/harness';
import { isLand, playScript } from '../session/script';
import { loseSave } from './helpers';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

const FAULTS: LoopbackOptions = { delay: { min: 0, max: 400 }, drop: 0.05, faultyChannels: ['act', 'ctl', 'pres'] };

let browsers: Browser[] = [];
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
});
afterEach(() => {
  closeAll(browsers);
  browsers = [];
  vi.useRealTimers();
});

describe('shared leak test: the lost-save recovery through the networked session', () => {
  it.each([5, 29])('B recovers after losing its save; A learns none of B’s new hidden cards, B none of A’s (seed %i)', async (seed) => {
    const network = net({ seed, ...FAULTS });
    const p = await playScript(network, browsers);
    await loseSave(p.B);
    const b = await open(network, p.B, { settleMs: 200 });
    await waitConverged([p.a, b], 'the rejoin');
    const shownToA = trackDisclosures(b, 's0');
    await settle(b.recover(await fixtureDeck('ur-m19-60.mtga.txt'), 7), 120_000, 'the recovery');
    await waitConverged([p.a, b], 'the recovery');
    const sec = b.secrets();
    const land = sec.hand.find((id) => isLand(sec.identities[id]!.card.sid)) ?? sec.hand[0]!;
    b.dispatch({ type: 'move', card: land, to: 'battlefield:s1', pose: { x: 100, y: 300, rot: 180 } });
    await until(() => p.a.engine.confirmedState().cards[land]?.identity !== undefined, 30_000, 'the land to be turned up');
    await waitConverged([p.a, b], 'the end');
    await settle(Promise.all([p.a.whenSaved(), b.whenSaved()]));
    expect(shownToA.map((d) => d.instanceId)).toEqual([land]);

    const toA = { observed: await observedBy(network, p.A), owner: { state: b.engine.confirmedState(), secrets: b.secrets() }, disclosed: shownToA };
    // Non-vacuous: the new library and hand of B are what A must not learn.
    expect(forbiddenFor(toA).tokens.length).toBeGreaterThan(40);
    const report = leakScan(toA);
    expect(report.tokens).toEqual([]);
    expect(report.pairs).toEqual([]);
    const toB = leakScan({ observed: await observedBy(network, p.B), owner: { state: p.a.engine.confirmedState(), secrets: p.a.secrets() }, disclosed: p.shownToB });
    expect(toB.tokens).toEqual([]);
    expect(toB.pairs).toEqual([]);
  });
});
