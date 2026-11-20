/**
 * Leak test (contracts.md Part A; PLAN M8-P4): no waiting-room message or state carries another player's deck name or
 * list. Two browsers sit at a private table over the loopback network (delay, loss and reordering), each picks a deck
 * from its own library the way the waiting room does (journey.md 4.8: the deck record stays in the owner's library,
 * READY commits its cards through `importDeck`), renames once and both are Ready. Then everything the other browser
 * could have seen (every message it received, its state, log, secret store and IndexedDB) is scanned for the owner's
 * deck name, the Scryfall ids of its deck that the observer's own deck does not hold, and the salts of its
 * commitments. A negative control shows the scan catches a deck name that is sent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecretStore } from '../../../src/core/types';
import type { DeckImport } from '../../../src/session/types';
import type { DeckRecord } from '../../../src/store/types';
import { scan } from '../../leak/scan';
import { browser, closeAll, FAKE_TIMERS, fixtureDeck, net, observedBy, open, settle, until, waitConverged, type Browser } from '../session/harness';

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

const NAMES = { anna: 'Anna Secret Elves Of The Glade', ben: 'Ben Hidden Tempo Islands' };

/** The waiting room's READY: the deck record stays in the own library (journey.md 4.8), its cards are committed. */
async function readyWith(b: Browser, deck: DeckImport, name: string): Promise<void> {
  const record: DeckRecord = { id: `deck-${b.name}`, name, main: deck.main, side: deck.side, source: 'pasted', kind: 'custom', createdAt: 1, updatedAt: 1 };
  await b.stores.decks.put(record);
  await settle(b.session!.importDeck({ main: [...deck.main], side: [...deck.side] }), 60_000, `${b.name} ready`);
}

/** What `owner` must keep: its deck's name, the ids of its deck the observer does not also hold, its commitment salts. */
function forbiddenOf(ownerDeck: DeckImport, ownerSecrets: SecretStore, observerDeck: DeckImport, name: string): string[] {
  const theirs = new Set([...observerDeck.main, ...observerDeck.side].map((c) => c.sid));
  const ids = [...ownerDeck.main, ...ownerDeck.side].map((c) => c.sid).filter((sid) => !theirs.has(sid));
  const salts = Object.values(ownerSecrets.identities).map((s) => s.salt);
  return [name, ...ids, ...salts];
}

describe('waiting room leak (M8-P4)', () => {
  it("no waiting-room message or state carries another player's deck name or list", async () => {
    const network = net({ delay: { min: 0, max: 200 }, drop: 0.05, faultyChannels: ['act', 'ctl', 'pres'] });
    const A = await browser('anna', 'peer-a', 'Anna', 2);
    const B = await browser('ben', 'peer-b', 'Ben', 5);
    browsers.push(A, B);
    await open(network, A);
    await open(network, B);
    await waitConverged([A.session!, B.session!], 'both seated');
    const gw = await fixtureDeck('gw-m19-60.txt');
    const ur = await fixtureDeck('ur-m19-60.mtga.txt');

    await readyWith(A, gw, NAMES.anna);
    A.session!.takeSeat(A.session!.seat, 3);
    await readyWith(B, ur, NAMES.ben);
    await until(() => [A, B].every((b) => Object.values(b.session!.engine.confirmedState().seats).every((s) => s.ready)), 30_000, 'both ready');
    await waitConverged([A.session!, B.session!], 'both ready');
    expect(A.session!.getState().stage).toBe('lobby');

    const annaKeeps = forbiddenOf(gw, A.session!.secrets(), ur, NAMES.anna);
    const benKeeps = forbiddenOf(ur, B.session!.secrets(), gw, NAMES.ben);
    expect(annaKeeps.length).toBeGreaterThan(60);
    expect(benKeeps.length).toBeGreaterThan(60);
    // Each owner does hold what it keeps (the scan would find it on its own side), so an empty scan means something.
    expect(scan(await observedBy(network, A), [NAMES.anna]).length).toBeGreaterThan(0);
    expect(scan(await observedBy(network, B), [NAMES.ben]).length).toBeGreaterThan(0);

    expect(scan(await observedBy(network, B), annaKeeps)).toEqual([]);
    expect(scan(await observedBy(network, A), benKeeps)).toEqual([]);

    // Negative control: a deck name that does go out (a chat line) is caught by the same scan.
    A.session!.dispatch({ type: 'chat', text: `I play ${NAMES.anna}`, channel: 'table' });
    await waitConverged([A.session!, B.session!], 'the chat line');
    expect(scan(await observedBy(network, B), annaKeeps).map((h) => h.token)).toContain(NAMES.anna);
  }, 120_000);
});
