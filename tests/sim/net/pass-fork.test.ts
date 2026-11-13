/**
 * PLAN M5-P6 (owner decision, folded in from the M2 gate): the pass-draft driver stops acting on abandoned history.
 * docs/gates/M2.md: "If the room's history splits and falls back to the sequencer's version, the pass driver may already
 * have pooled a pick and dropped its copy of a pack based on the abandoned version. The next player then waits for that
 * pack forever."
 *
 * The engine replaces an abandoned part of the history with the room's and proposes this browser's own actions of that
 * part again (net/engine.ts `adopt`; tests/sim/net/protocol.test.ts and solo-reload.test.ts cover that on the network).
 * Here the driver sees exactly what such a repair hands it: a confirmed state that had its pick and pass, then the
 * room's state without them, then its pick and pass sequenced again (or the pick taken by the room's pick timer).
 * DESIGN "Specification: network protocol and secrecy", Draft packs: the remaining cards go to the next player on the
 * pair channel with the public `packPass`; a pick is never resolved twice and a picked card is never handed on.
 */
import { describe, expect, it } from 'vitest';
import type { Action, ActionDraft } from '../../../src/core/actions';
import type { RevealedCard } from '../../../src/core/commit';
import { emptySecretStore } from '../../../src/core/secrets';
import type { SecretStore, TableState } from '../../../src/core/types';
import { createPassDriver } from '../../../src/draft/pass';
import { POOL_KEY, SENT_PREFIX } from '../../../src/draft/secret';
import type { DraftHost } from '../../../src/draft/types';
import { packHandOver } from '../../../src/net/private';
import { testEntropy } from '../../leak/fixtures';
import { act, draftOf, draftTable, ok, openPack, packCards } from '../../unit/draft/open/helpers';

/** Three seats in round 1 (left), packs of `size` cards; s0 holds its own pack `cards`. */
function table(size: number, pickTimer = false): { s: TableState; cards: RevealedCard[]; id: string } {
  let s = draftTable(3, { format: 'pass', packs: 3, picks: 1 });
  if (pickTimer) s = { ...s, draft: { ...draftOf(s), pickTimer: true } };
  const cards = packCards(size);
  s = openPack(s, 's0', cards, 0, 'down');
  s = openPack(s, 's1', packCards(size), 0, 'down');
  s = openPack(s, 's2', packCards(size), 0, 'down');
  const id = Object.values(draftOf(s).packs).find((p) => p.opener === 's0')!.id;
  return { s, cards, id };
}

/** s0's driver over a confirmed state the test moves: `step` as the engine applies an action, `fork` as it adopts the room's history. */
function driverOver(start: TableState, secrets: SecretStore) {
  let state = start;
  let store = secrets;
  const sent: { to: string; packId: string; cards: string[] }[] = [];
  const dispatched: ActionDraft[] = [];
  const listeners: ((a: Action, s: TableState) => void)[] = [];
  const host: DraftHost = {
    seat: 's0',
    state: () => state,
    confirmedState: () => state,
    secrets: () => store,
    setSecrets: (next) => {
      store = next;
    },
    dispatch: (draft) => {
      dispatched.push(draft);
      return { ...draft, by: 's0', cid: `d${dispatched.length}` } as Action;
    },
    packSeed: () => Promise.reject(new Error('not in this test')),
    sendPack: (to, packId, cards) => {
      // The receiver's pair channel accepts exactly the pack as its visit starts in the confirmed state (net/private.ts).
      if (cards.length > 0 && packHandOver(state, packId, cards, 's0', to) !== 'ok') throw new Error('refused');
      sent.push({ to, packId, cards: cards.map((c) => c.instanceId) });
    },
    onPack: () => () => undefined,
    onSequenced: (l) => {
      listeners.push(l);
      return () => undefined;
    },
    sets: { listSets: async () => [], get: async () => null, peek: () => null },
    generatePack: () => {
      throw new Error('not in this test');
    },
    entropy: testEntropy(1),
  };
  const driver = createPassDriver(host);
  return {
    driver,
    sent,
    dispatched,
    secrets: () => store,
    held: () => store.draft!.held,
    step(a: Action) {
      state = ok(state, { ...a, seq: state.seq + 1 } as Action);
      for (const l of listeners) l(a, state);
      driver.drive();
      return state;
    },
    /** The room's history replaces this replica's from the fork point on (the session drives after every change). */
    fork(room: TableState) {
      state = room;
      driver.drive();
    },
  };
}

const ids = (cs: readonly RevealedCard[]): string[] => cs.map((c) => c.instanceId);

describe('the pass driver and a history the room abandons (M2 gate follow-up)', () => {
  it('a pick and pass the room never saw: the pack comes back, the pick is not taken twice, and the pass proposed again hands it on', async () => {
    const { s: start, cards, id } = table(3);
    const h = driverOver(start, { ...emptySecretStore('s0'), draft: { held: { [id]: cards }, generated: [], marked: [cards[2]!.instanceId] } });
    // On the history that will be abandoned: the pick (the marked card goes to the pool) and the pass (handed on).
    h.step(act('pick', { packId: id, count: 1 }, 's0'));
    expect(h.dispatched.at(-1)).toMatchObject({ type: 'packPass', packId: id, to: 's1', count: 2 });
    h.step(act('packPass', { packId: id, to: 's1', count: 2 }, 's0'));
    expect(h.sent).toEqual([{ to: 's1', packId: id, cards: ids(cards.slice(0, 2)) }]);
    expect(Object.hasOwn(h.held(), id)).toBe(false);

    // The room's history wins: it holds s1's pick of its own pack, but neither the pick nor the pass of s0.
    const room = ok(start, { ...act('pick', { packId: draftOf(start).queues.s1![0]!, count: 1 }, 's1'), seq: start.seq + 1 } as Action);
    h.fork(room);
    // The pack is held again as it was after the own pick; the picked card stays in the pool, once.
    expect(ids(h.held()[id]!)).toEqual(ids(cards.slice(0, 2)));
    expect(Object.hasOwn(h.held(), SENT_PREFIX + id)).toBe(false);
    expect(ids(h.held()[POOL_KEY]!)).toEqual([cards[2]!.instanceId]);
    expect(h.secrets().pool).toHaveLength(1);
    // Nothing is handed on from a pass the room does not hold.
    expect(h.sent).toHaveLength(1);

    // The engine proposes the own pick and pass again; once sequenced, the pick resolves nothing more and the pass hands
    // the very same cards to s1, which its pair channel accepts in the room's history.
    h.step(act('pick', { packId: id, count: 1 }, 's0'));
    expect(ids(h.held()[POOL_KEY]!)).toEqual([cards[2]!.instanceId]);
    expect(h.dispatched.at(-1)).toMatchObject({ type: 'packPass', packId: id, to: 's1', count: 2 });
    h.step(act('packPass', { packId: id, to: 's1', count: 2 }, 's0'));
    expect(h.sent).toEqual([
      { to: 's1', packId: id, cards: ids(cards.slice(0, 2)) },
      { to: 's1', packId: id, cards: ids(cards.slice(0, 2)) },
    ]);
    // And the copy for a re-send is kept, so s1's request is answered if the hand-over is lost.
    expect(ids(h.held()[SENT_PREFIX + id]!)).toEqual(ids(cards.slice(0, 2)));
    h.driver.dispose();
  });

  it('the room’s pick timer took the pick instead: the pack comes back resolved and the driver passes it once more', async () => {
    const { s: start, cards, id } = table(3, true);
    const h = driverOver(start, { ...emptySecretStore('s0'), draft: { held: { [id]: cards }, generated: [], marked: [cards[1]!.instanceId] } });
    h.step(act('pick', { packId: id, count: 1 }, 's0'));
    h.step(act('packPass', { packId: id, to: 's1', count: 2 }, 's0'));
    // In the room's history the sequencer's pick timer ran out on s0's pick, and nothing more of s0 is there.
    const room = ok(start, { ...act('draftTimeout', { packId: id, picks: 0 }, 's1'), seq: start.seq + 1 } as Action);
    const passes = h.dispatched.filter((d) => d.type === 'packPass').length;
    h.fork(room);
    // The timed-out pick is the one already resolved (a pick names no card; this browser decides which): no second card.
    expect(ids(h.held()[POOL_KEY]!)).toEqual([cards[1]!.instanceId]);
    expect(ids(h.held()[id]!)).toEqual([cards[0]!.instanceId, cards[2]!.instanceId]);
    // The pass is owed again and proposed.
    expect(h.dispatched.filter((d) => d.type === 'packPass').length).toBe(passes + 1);
    h.step(act('packPass', { packId: id, to: 's1', count: 2 }, 's0'));
    expect(h.sent.at(-1)).toEqual({ to: 's1', packId: id, cards: [cards[0]!.instanceId, cards[2]!.instanceId] });
    h.driver.dispose();
  });

  it('without a fork a handed-on copy never comes back: the pack moves on and stays gone', () => {
    const { s: start, cards, id } = table(3);
    const h = driverOver(start, { ...emptySecretStore('s0'), draft: { held: { [id]: cards }, generated: [], marked: [] } });
    h.step(act('pick', { packId: id, count: 1 }, 's0'));
    h.step(act('packPass', { packId: id, to: 's1', count: 2 }, 's0'));
    // s1 picks its own pack, then s0's, and passes it on to s2.
    let s = h.step(act('pick', { packId: draftOf(start).queues.s1![0]!, count: 1 }, 's1'));
    s = h.step(act('pick', { packId: id, count: 1 }, 's1'));
    s = h.step(act('packPass', { packId: id, to: 's2', count: 1 }, 's1'));
    expect(draftOf(s).packs[id]!.holder).toBe('s2');
    expect(Object.hasOwn(h.held(), id)).toBe(false);
    expect(ids(h.held()[POOL_KEY]!)).toEqual([cards[0]!.instanceId]);
    expect(h.sent).toHaveLength(1);
    h.driver.dispose();
  });

  it('a fork that also drops the next drafter’s pass and pick brings the pack back here and lets it travel the same way again', () => {
    const { s: start, cards, id } = table(4);
    const h = driverOver(start, { ...emptySecretStore('s0'), draft: { held: { [id]: cards }, generated: [], marked: [cards[3]!.instanceId] } });
    h.step(act('pick', { packId: id, count: 1 }, 's0'));
    h.step(act('packPass', { packId: id, to: 's1', count: 3 }, 's0'));
    h.step(act('pick', { packId: draftOf(start).queues.s1![0]!, count: 1 }, 's1'));
    h.step(act('pick', { packId: id, count: 1 }, 's1'));
    h.step(act('packPass', { packId: id, to: 's2', count: 2 }, 's1'));
    // The whole stretch is abandoned: the room's history is the start.
    h.fork(start);
    expect(ids(h.held()[id]!)).toEqual(ids(cards.slice(0, 3)));
    expect(ids(h.held()[POOL_KEY]!)).toEqual([cards[3]!.instanceId]);
    h.step(act('pick', { packId: id, count: 1 }, 's0'));
    h.step(act('packPass', { packId: id, to: 's1', count: 3 }, 's0'));
    expect(h.sent.at(-1)).toEqual({ to: 's1', packId: id, cards: ids(cards.slice(0, 3)) });
    h.driver.dispose();
  });
});
