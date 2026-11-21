/**
 * The library-drag scenario of the shared leak test (CLAUDE.md: any code touching hidden information adds its
 * scenario; PLAN Milestone 8, M7-P5 "drag from library to hand draws"). Seat A picks up the top card of its library and
 * drags it toward its hand with presence on, over the real networked sessions: the scene drags that card (its debug
 * card reads `dragging`), and A's presence sender (scene/presence.ts createPresenceTracker, the one `attachPresence`
 * runs) reports the drag. No drag presence B receives names a card of A's library or hand, and nothing B received
 * carries a hidden identity of A's (the shared scanner). A control drag of a card on the battlefield does reach B, so
 * the scan sees drag messages at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstanceId, Pose } from '../../../src/core/types';
import { createPresenceTracker, type PresenceScene, type ShownCard } from '../../../src/scene/presence';
import { forbiddenFor, leakScan } from '../../leak/leak';
import { browser, closeAll, FAKE_TIMERS, fixtureDeck, net, observedBy, open, settle, trackDisclosures, until, waitConverged, type Browser } from './harness';

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

/** The card ids of every drag presence message in what B received. */
function dragIds(observed: readonly unknown[]): InstanceId[] {
  const out: InstanceId[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o.t === 'drag' && Array.isArray(o.cards)) for (const c of o.cards as { id: InstanceId }[]) out.push(c.id);
      else Object.values(o).forEach(walk);
    }
  };
  walk(observed);
  return out;
}

/** A scene as the presence sender reads it: screen px are table mm, `under` is the card at every point, `held` what the scene drags. */
function fakeScene(under: () => InstanceId | null, held: () => ShownCard[]): PresenceScene {
  return {
    screenToTable: (x: number, y: number) => ({ x, y, z: 0 }),
    cardAt: () => under(),
    debug: { cards: () => held() },
  } as unknown as PresenceScene;
}

describe('shared leak test: the library card picked up to draw it', () => {
  it('a drag of the library top card sends no drag presence naming it, and B receives no hidden identity of A’s', async () => {
    const network = net({ seed: 23, delay: { min: 0, max: 80 } });
    const A = await browser('anna', 'peer-a', 'Anna', 2);
    const B = await browser('ben', 'peer-b', 'Ben', 5);
    browsers.push(A, B);
    const a = await open(network, A);
    const b = await open(network, B);
    await waitConverged([a, b], 'both seated');
    const shownToB = trackDisclosures(a, 's1');
    await settle(a.importDeck(await fixtureDeck('gw-m19-60.txt')), 30_000, 'A ready');
    await settle(b.importDeck(await fixtureDeck('ur-m19-60.mtga.txt')), 30_000, 'B ready');
    await settle(Promise.all([a.shuffle(), b.shuffle()]), 60_000, 'both shuffles');
    await settle(a.draw(7));
    await waitConverged([a, b], 'A’s opening hand');

    // A control card on the battlefield: its drag must reach B.
    const played = a.secrets().hand[0]!;
    a.dispatch({ type: 'move', card: played, to: 'battlefield:s0', pose: { x: -200, y: -300, rot: 0 } });
    await waitConverged([a, b], 'the land on the table');
    const land = a.engine.confirmedState().zones['battlefield:s0']!.ids.at(-1)!;

    const lib = a.engine.confirmedState().zones['library:s0']!.ids;
    const top = lib.at(-1)!;
    let under: InstanceId | null = top;
    let held: ShownCard[] = [];
    const pose = (x: number, y: number): Pose => ({ x, y, rot: 0 });
    const tracker = createPresenceTracker(
      fakeScene(
        () => under,
        () => held,
      ),
      a.presence,
      { state: () => a.engine.confirmedState(), selection: () => [], seat: 's0' },
    );

    // Pick up the library's top card and drag it toward the hand: the scene drags it (M7-P5), the sender reports.
    tracker.down(400, -300, 0);
    held = [{ id: top, pose: pose(400, -300), dragging: true }];
    for (let i = 1; i <= 12; i++) {
      held = [{ id: top, pose: pose(400 - i * 10, -300 - i * 20), dragging: true }];
      tracker.move(400 - i * 10, -300 - i * 20, true);
      await vi.advanceTimersByTimeAsync(40);
    }
    tracker.up();
    held = [];
    await vi.advanceTimersByTimeAsync(500);

    // The control: a drag of the land on the table is shown to B.
    under = land;
    tracker.down(-200, -300, 0);
    for (let i = 1; i <= 6; i++) {
      held = [{ id: land, pose: pose(-200 + i * 10, -300), dragging: true }];
      tracker.move(-200 + i * 10, -300, true);
      await vi.advanceTimersByTimeAsync(40);
    }
    tracker.up();
    held = [];
    await until(() => dragIds(network.delivered.filter((d) => d.to === B.peerId).map((d) => d.msg)).includes(land), 10_000, 'B to see the land dragged');
    tracker.stop();
    await vi.advanceTimersByTimeAsync(500);

    const state = a.engine.confirmedState();
    const hidden = new Set(
      Object.values(state.cards)
        .filter((c) => c.owner === 's0' && state.zones[c.zone]?.visibility !== 'public')
        .map((c) => c.id),
    );
    expect(hidden.has(top)).toBe(true);
    const observed = await observedBy(network, B);
    const dragged = dragIds(observed);
    expect(dragged).toContain(land);
    expect(dragged.filter((id) => hidden.has(id) || lib.includes(id))).toEqual([]);

    const input = { observed, owner: { state, secrets: a.secrets() }, disclosed: shownToB };
    expect(forbiddenFor(input).tokens.length).toBeGreaterThan(40);
    const report = leakScan(input);
    expect(report.tokens).toEqual([]);
    expect(report.pairs).toEqual([]);
  });
});
