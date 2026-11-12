/**
 * The builder's scenario of the shared leak test (CLAUDE.md: any code touching hidden information adds its scenario to
 * the shared leak test; DESIGN "Pre-game", Sealed: "Own pool only"; Deck building: "Ready locks the deck and publishes
 * its commitment"). Anna builds a deck from her pool (cards moved between deck and sideboard, basics from the
 * dispenser, table positions) and readies through the builder's Ready path (deckImportOf, then TableSession.importDeck)
 * on a networked table with delay and reordering; Ben readies a fixture deck. Nothing Ben received, holds in his state,
 * log, secret store or IndexedDB names any card of Anna's pool, deck or sideboard alike.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeckBuild } from '../../../src/core/types';
import { applyDrop, dispense, sortLayout } from '../../../src/scene/builder';
import { deckImportOf } from '../../../src/ui/builder/model';
import { scan } from '../../leak/scan';
import { browser, closeAll, FAKE_TIMERS, fixtureDeck, net, observedBy, open, settle, waitConverged, type Browser } from '../../sim/session/harness';
import { buildOf, lookup, sid } from './helpers';

vi.mock('../../../src/net/identity', async () => (await import('../../sim/net/fake-identity')).fakeIdentityModule);

let browsers: Browser[] = [];
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
});
afterEach(() => {
  closeAll(browsers);
  browsers = [];
  vi.useRealTimers();
});

/** A pool of cards Ben's fixture deck (blue-red) does not hold, so any of their ids in Ben's hands is a leak. */
const POOL = ['Llanowar Elves', 'Llanowar Elves', 'Draconic Disciple', 'Sarkhan, Fireblood', 'Colossal Dreadmaw', 'Meteor Golem', 'Rupture Spire', 'Detection Tower', 'Forest', 'Murder', 'Phylactery Lich', 'Gigantosaurus'];

function annasBuild(): DeckBuild {
  let b = buildOf(POOL);
  b = { ...b, poses: sortLayout(b, lookup, 'colour') };
  // Into the deck area: the first nine cards; Murder, Phylactery Lich and Gigantosaurus stay in the sideboard.
  const moved = Object.fromEntries(b.cards.slice(0, 9).map((c, i) => [c.id, { x: -300 + i * 69, y: 200, rot: 0 }]));
  b = applyDrop(b, b.poses!, moved);
  // Two Forests of a chosen printing from the dispenser.
  for (let i = 0; i < 2; i++) b = dispense(b, b.poses!, { sid: sid('Forest') }, lookup, 'colour');
  return b;
}

describe('shared leak test: the builder', () => {
  it('Ready commits the built deck without naming any card of the pool to the other seat', async () => {
    const network = net({ seed: 11, delay: { min: 0, max: 200 } });
    const A = await browser('anna', 'peer-a', 'Anna', 2);
    const B = await browser('ben', 'peer-b', 'Ben', 5);
    browsers.push(A, B);
    const a = await open(network, A);
    const b = await open(network, B);
    await waitConverged([a, b], 'both seated');

    const build = annasBuild();
    const deck = deckImportOf(build);
    expect(deck.main).toHaveLength(11);
    expect(deck.side.map((r) => r.sid)).toEqual([sid('Murder'), sid('Phylactery Lich'), sid('Gigantosaurus')]);
    await settle(a.importDeck(deck), 30_000, 'Anna ready');
    await settle(b.importDeck(await fixtureDeck('ur-m19-60.mtga.txt')), 30_000, 'Ben ready');
    await waitConverged([a, b], 'both ready');
    await settle(Promise.all([a.whenSaved(), b.whenSaved()]));

    expect(a.getState().commitments['s0']?.commits).toHaveLength(11);
    expect(b.getState().commitments['s0']?.commits).toHaveLength(11);
    const forbidden = [...new Set(build.cards.map((c) => c.ref.sid))];
    expect(forbidden).toHaveLength(11);
    // Not vacuous: Anna's own secret store names every one of them.
    expect(new Set(scan([a.secrets()], forbidden).map((h) => h.token)).size).toBe(forbidden.length);
    expect(scan(await observedBy(network, B), forbidden)).toEqual([]);
  });
});
