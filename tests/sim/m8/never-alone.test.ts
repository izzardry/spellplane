/**
 * M8-C: `NetSessionInternals.neverAlone` (contracts.md Part D): a browser that must never sit alone (a matched room's
 * other members, a claim link) waits for a peer however long that takes; two such browsers and one creator end at one
 * table. Real networked sessions on a LoopbackNetwork under fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openNetSession } from '../../../src/session/net';
import { mtg } from '../../../src/games/mtg';
import { browser, cards, closeAll, FAKE_TIMERS, KEY, net, open, ROOM, waitConverged, type Browser } from '../session/harness';

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

describe('neverAlone (contracts.md Part D)', () => {
  it('a neverAlone session alone never starts a table, however long it waits', async () => {
    const network = net({ seed: 3 });
    const b = await browser('ben', 'peer-b', 'Ben', 1);
    browsers.push(b);
    let settled = false;
    const p = openNetSession(
      { game: mtg, cardData: cards(), roomId: ROOM, roomKey: KEY, transport: () => network.create(b.peerId), identity: b.identity, store: b.stores.tables, format: 'ffa4' },
      { nonces: b.nonces, neverAlone: true, loneWaitMs: 1_000 },
    ).then(
      (s) => {
        b.session = s;
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(settled).toBe(false);
    void p;
  });

  it('two neverAlone sessions and one creator end at one table', async () => {
    const network = net({ seed: 5 });
    const A = await browser('ann', 'peer-a', 'Ann', 0);
    const B = await browser('ben', 'peer-b', 'Ben', 1);
    const C = await browser('cy', 'peer-c', 'Cy', 2);
    browsers.push(A, B, C);
    const opts = { format: 'ffa4' as const };
    // The two members arrive first and wait; the creator comes later.
    const pb = open(network, B, { neverAlone: true, loneWaitMs: 1_000 }, opts);
    const pc = open(network, C, { neverAlone: true, loneWaitMs: 1_000 }, opts);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(B.session).toBeNull();
    expect(C.session).toBeNull();
    const pa = open(network, A, { createdHere: true }, opts);
    await Promise.all([pa, pb, pc]);
    const sessions = [A.session!, B.session!, C.session!];
    await waitConverged(sessions, 'one table');
    const seats = sessions.map((s) => s.seat).sort();
    expect(new Set(seats).size).toBe(3);
    const st = A.session!.engine.confirmedState();
    expect(Object.values(st.seats).filter((s) => s.peer !== undefined).length).toBe(3);
  });
});
