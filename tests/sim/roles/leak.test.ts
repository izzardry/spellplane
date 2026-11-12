/**
 * The spectator scenario of the shared leak test (CLAUDE.md; PLAN M3-P5: "A spectator never receives hidden
 * information except a hand explicitly revealed to that spectator"). Two players play the M1-P8 script under delay,
 * loss and reordering while spectator Dee watches from before the first chair is taken; spectator Cy joins after it;
 * player A then shows the hand to Cy by name. The shared scanner (tests/leak/leak.ts) checks everything each spectator
 * received, holds in state and log, keeps in its secret store and in IndexedDB against both players' hidden cards,
 * with only what the owner made public or showed that spectator as disclosures (tests/leak/spectator.ts); and the
 * opponent B against A as in the M1-P8 scenario, so the reveal to Cy reaches nobody else. A negative control shows the
 * scan finds the shown cards when they are not declared.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoopbackOptions } from '../../../src/net/loopback';
import { revealHandDrafts } from '../../../src/ui/lobby/spectate';
import { forbiddenFor, leakScan } from '../../leak/leak';
import { trackSpectatorDisclosures } from '../../leak/spectator';
import { closeAll, converged, FAKE_TIMERS, hashOf, net, observedBy, until, type Browser } from '../session/harness';
import { playScript } from '../session/script';
import { closeWatchers, observedByWatcher, watch, watching, type Watcher } from './harness';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

const FAULTS: LoopbackOptions = { delay: { min: 0, max: 400 }, drop: 0.05, faultyChannels: ['act', 'ctl', 'pres'] };

let browsers: Browser[] = [];
let watchers: Watcher[] = [];
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
});
afterEach(() => {
  closeWatchers(watchers);
  closeAll(browsers);
  browsers = [];
  watchers = [];
  vi.useRealTimers();
});

describe('shared leak test: spectators', () => {
  it.each([41, 42])('a spectator learns only the public table and the hand shown to it by name; nobody else learns that hand (seed %i)', async (seed) => {
    const network = net({ seed, ...FAULTS });
    const dee = await watch(network, 'dee', 'peer-0', 'Dee');
    watchers.push(dee);
    const p = await playScript(network, browsers);
    const cy = await watch(network, 'cy', 'peer-c', 'Cy');
    watchers.push(cy);
    const all = (): boolean => converged([p.a, p.b]) && [dee, cy].every((w) => watching(w, hashOf(p.a.engine.confirmedState())));
    await until(all, 30_000, 'everyone to converge');

    // What each owner shows each spectator, from the owner's side.
    const aToCy = trackSpectatorDisclosures(p.a, cy.session.seat);
    const bToCy = trackSpectatorDisclosures(p.b, cy.session.seat);
    const aToDee = trackSpectatorDisclosures(p.a, dee.session.seat);
    const bToDee = trackSpectatorDisclosures(p.b, dee.session.seat);

    const hand = [...p.a.engine.confirmedState().zones['hand:s0']!.ids];
    expect(hand.length).toBeGreaterThan(1);
    for (const d of revealHandDrafts(p.a.getState(), 's0', cy.session.seat, 'g-show')) p.a.dispatch(d);
    await until(() => all() && hand.every((id) => Object.hasOwn(cy.session.secrets().received, id)), 30_000, 'Cy to receive the hand');
    expect(aToCy.filter((d) => hand.includes(d.instanceId)).map((d) => d.instanceId).sort()).toEqual([...hand].sort());

    // The spectator Cy: A's shown hand and the public table, nothing else of A's; nothing hidden of B's.
    const cyObserved = await observedByWatcher(network, cy);
    const cyVsA = { observed: cyObserved, owner: { state: p.a.engine.confirmedState(), secrets: p.a.secrets() }, disclosed: aToCy };
    expect(forbiddenFor(cyVsA).tokens.length).toBeGreaterThan(40);
    expect(leakScan(cyVsA)).toEqual({ tokens: [], pairs: [] });
    expect(leakScan({ observed: cyObserved, owner: { state: p.b.engine.confirmedState(), secrets: p.b.secrets() }, disclosed: bToCy })).toEqual({ tokens: [], pairs: [] });

    // The other spectator Dee, there from the start: the public table only.
    const deeObserved = await observedByWatcher(network, dee);
    expect(aToDee.every((d) => !hand.includes(d.instanceId))).toBe(true);
    expect(leakScan({ observed: deeObserved, owner: { state: p.a.engine.confirmedState(), secrets: p.a.secrets() }, disclosed: aToDee })).toEqual({ tokens: [], pairs: [] });
    expect(leakScan({ observed: deeObserved, owner: { state: p.b.engine.confirmedState(), secrets: p.b.secrets() }, disclosed: bToDee })).toEqual({ tokens: [], pairs: [] });

    // The opponent B: what A showed B (the script's targeted reveal) and the public table; not the hand shown to Cy.
    const bObserved = await observedBy(network, p.B);
    expect(leakScan({ observed: bObserved, owner: { state: p.a.engine.confirmedState(), secrets: p.a.secrets() }, disclosed: p.shownToB })).toEqual({ tokens: [], pairs: [] });
    // And the players learn nothing of each other through the spectators' traffic (A against B as in M1-P8).
    expect(leakScan({ observed: await observedBy(network, p.A), owner: { state: p.b.engine.confirmedState(), secrets: p.b.secrets() }, disclosed: [] })).toEqual({ tokens: [], pairs: [] });

    // Negative control: without declaring the shown hand, the scanner finds it in what Cy holds.
    const control = leakScan({ ...cyVsA, disclosed: aToCy.filter((d) => !hand.includes(d.instanceId)) });
    expect(control.tokens.length + control.pairs.length).toBeGreaterThan(0);
  });
});
