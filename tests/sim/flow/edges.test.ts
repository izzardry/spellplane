/**
 * The evening's edges through the networked session (PLAN M2-P7; DESIGN "Specification: card data, packs and draft
 * formats", Evening stages; "Pre-game", Deck building: between games players return to the builder to sideboard;
 * "Turn flow and confirmation": a hold stops a round).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson } from '../../../src/core/hash';
import type { CardRef } from '../../../src/core/types';
import { memoryNonces } from '../../../src/session/nonces';
import { closeAll, FAKE_TIMERS, fixtureDeck, net, settle, until, waitConverged, type Browser } from '../session/harness';
import { both, reload, seatedPair, stageIs, startDraft } from './evening';

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

const sorted = (refs: readonly CardRef[]): string[] => refs.map((r) => canonicalJson(r)).sort();

describe('the evening’s edges', () => {
  it('a constructed rematch: the next game returns to the builder with the committed deck and its sideboard', async () => {
    const network = net({ seed: 2 });
    const e = await seatedPair(network, browsers);
    const [a, b] = both(e);
    a!.evening!.setLobby({ draft: null, sets: ['M19'], pickTimer: false });
    const deckA = await fixtureDeck('gw-m19-60.txt');
    await settle(a!.importDeck(deckA));
    await settle(b!.importDeck(await fixtureDeck('ur-m19-60.mtga.txt')));
    a!.evening!.start();
    await stageIs(e, 'match');
    expect(await settle(b!.evening!.propose('nextGame'), 30_000, 'the rematch')).toBe(true);
    await stageIs(e, 'build');
    const build = a!.draft!.build()!;
    expect(build.main).toHaveLength(deckA.main.length);
    expect(sorted(build.cards.filter((c) => build.main.includes(c.id)).map((c) => c.ref))).toEqual(sorted(deckA.main));
    expect(sorted(build.cards.filter((c) => !build.main.includes(c.id)).map((c) => c.ref))).toEqual(sorted(deckA.side));
    // Sideboard one card in, then both Ready: game two.
    const out = build.main[0]!;
    const inn = build.cards.find((c) => !build.main.includes(c.id))!.id;
    a!.draft!.setBuild({ ...build, main: [...build.main.filter((id) => id !== out), inn] });
    await settle(a!.draft!.ready());
    await settle(b!.draft!.ready());
    await stageIs(e, 'match');
    expect(a!.engine.confirmedState().games).toBe(2);
    // A new draft afterwards starts from an empty pool, not the constructed deck.
    expect(await settle(a!.evening!.propose('newDraft'), 30_000, 'the new draft')).toBe(true);
    await stageIs(e, 'lobby');
    await startDraft(e, { draft: { format: 'sealed', packs: 1 }, sets: ['M19'], pickTimer: false });
    await stageIs(e, 'build', 60_000);
    expect(e.A.session!.draft!.build()!.cards).toHaveLength(15);
    expect(e.A.session!.draft!.build()!.main).toEqual([]);
  }, 240_000);

  it('a hold stops the proposal; nothing moves until a new one passes', async () => {
    const network = net({ seed: 8 });
    const e = await seatedPair(network, browsers);
    const [a, b] = both(e);
    a!.evening!.setLobby({ draft: null, sets: ['M19'], pickTimer: false });
    a!.evening!.start();
    await stageIs(e, 'match');
    const p = a!.evening!.propose('newDraft');
    await until(() => b!.engine.confirmedState().confirm?.label === 'New draft?', 10_000, 'the proposal');
    b!.dispatch({ type: 'respond', round: b!.engine.confirmedState().confirm!.id, seat: 's1', response: 'hold' });
    expect(await settle(p, 30_000, 'the held proposal')).toBe(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(a!.engine.confirmedState().stage).toBe('match');
    // A new proposal replaces the held round; Ben stays silent and the pass timer confirms for him.
    expect(await settle(a!.evening!.propose('nextGame'), 30_000, 'the next game')).toBe(true);
    await stageIs(e, 'build');
    // From the builder a next game is not offered; it resolves false at once and asks nobody.
    expect(await settle(a!.evening!.propose('nextGame'), 1000)).toBe(false);
    expect(a!.engine.confirmedState().confirm).toBeNull();
  }, 120_000);

  it('a pack seed whose nonce this browser lost is closed unused, and the pool still fills', async () => {
    const network = net({ seed: 6 });
    const e = await seatedPair(network, browsers);
    await startDraft(e, { draft: { format: 'sealed', packs: 2 }, sets: ['M19'], pickTimer: false });
    // Anna's page loses its local storage (the open-round nonces) while her first pack seed is open, and reloads.
    await until(() => Object.values(e.A.session!.engine.confirmedState().shuffles).some((r) => r.owner === 's0' && r.orderHash === null), 30_000, 'an open pack seed');
    e.A.nonces = memoryNonces();
    await reload(network, e.A);
    await stageIs(e, 'build', 120_000);
    await waitConverged(both(e));
    const st = e.A.session!.engine.confirmedState();
    expect(st.draft!.pools.s0).toBe(30);
    expect(e.A.session!.secrets().pool).toHaveLength(30);
    expect(Object.values(st.shuffles).every((r) => r.orderHash !== null)).toBe(true);
  }, 240_000);
});
