/**
 * Pack visits and the private hand-over check (core/reducer/pass.ts `packVisit`; net/private.ts `packHandOver`,
 * `packRequestOk`; DESIGN "Pre-game", Hidden information: "A pack is visible only to its current holder";
 * "Specification: network protocol and secrecy", Draft packs: the remaining cards go to the next player on the pair's
 * channel together with the public `packPass`), and the pass driver over a state that jumped ahead (a snapshot or a
 * reload skipped the actions in between).
 */
import { describe, expect, it } from 'vitest';
import type { Action } from '../../../../src/core/actions';
import type { RevealedCard } from '../../../../src/core/commit';
import { packCountAt, packVisit, packVisitor } from '../../../../src/core/reducer/pass';
import { emptySecretStore } from '../../../../src/core/secrets';
import type { SecretStore, TableState } from '../../../../src/core/types';
import { createPassDriver } from '../../../../src/draft/pass';
import { POOL_KEY, SENT_PREFIX } from '../../../../src/draft/secret';
import type { DraftHost } from '../../../../src/draft/types';
import { packHandOver, packRequestOk } from '../../../../src/net/private';
import { testEntropy } from '../../../leak/fixtures';
import { act, draftOf, draftTable, ok, openPack, packCards } from '../open/helpers';

/** Three seats in round 1 (left), packs of `size` cards; s0's pack is `cards`. */
function table(size: number, picks = 1): { s: TableState; cards: RevealedCard[]; id: string } {
  let s = draftTable(3, { format: 'pass', packs: 3, picks });
  const cards = packCards(size);
  s = openPack(s, 's0', cards, 0, 'down');
  s = openPack(s, 's1', packCards(size), 0, 'down');
  s = openPack(s, 's2', packCards(size), 0, 'down');
  const id = Object.values(draftOf(s).packs).find((p) => p.opener === 's0')!.id;
  return { s, cards, id };
}

describe('pack visits', () => {
  it('follow the pack from its opener in the round\'s direction, one pick per visit', () => {
    const t = table(5, 2);
    const id = t.id;
    let s = t.s;
    const visit = () => packVisit(draftOf(s), draftOf(s).packs[id]!);
    expect(visit()).toEqual({ k: 0, holder: 's0', picked: false });
    s = ok(s, act('pick', { packId: id, count: 2 }, 's0'));
    expect(visit()).toEqual({ k: 0, holder: 's0', picked: true });
    s = ok(s, act('packPass', { packId: id, to: 's1', count: 3 }, 's0'));
    expect(visit()).toEqual({ k: 1, holder: 's1', picked: false });
    const pack = draftOf(s).packs[id]!;
    expect([0, 1, 2, 3, 4].map((k) => packVisitor(draftOf(s), pack, k))).toEqual(['s0', 's1', 's2', 's0', 's1']);
    expect([0, 1, 2, 3].map((k) => packCountAt(pack, 2, k))).toEqual([5, 3, 1, 0]);
    // s1 picks its own pack first, then s0's; s2 takes the last card and the pack is empty: the last visit is s2's.
    const own1 = draftOf(s).queues.s1![0]!;
    s = ok(s, act('pick', { packId: own1, count: 2 }, 's1'));
    s = ok(s, act('pick', { packId: id, count: 2 }, 's1'));
    s = ok(s, act('packPass', { packId: id, to: 's2', count: 1 }, 's1'));
    const own2 = draftOf(s).queues.s2![0]!;
    s = ok(s, act('pick', { packId: own2, count: 2 }, 's2'));
    s = ok(s, act('pick', { packId: id, count: 1 }, 's2'));
    expect(draftOf(s).packs[id]).toMatchObject({ count: 0, holder: null, picks: 3 });
    expect(visit()).toEqual({ k: 2, holder: 's2', picked: true });
  });

  it('round 2 goes right', () => {
    const { s, id } = table(5);
    const pack = { ...draftOf(s).packs[id]!, number: 1 };
    expect([0, 1, 2, 3].map((k) => packVisitor(draftOf(s), pack, k))).toEqual(['s0', 's2', 's1', 's0']);
  });
});

describe('packHandOver', () => {
  it('accepts exactly the pack as it was at the start of the receiver\'s visit, from the holder of the visit before', () => {
    const t = table(5);
    const { cards, id } = t;
    let s = t.s;
    s = ok(s, act('pick', { packId: id, count: 1 }, 's0'));
    const left = cards.slice(1);
    // Before the pass is applied: wait.
    expect(packHandOver(s, id, left, 's0', 's1')).toBe('wait');
    s = ok(s, act('packPass', { packId: id, to: 's1', count: 4 }, 's0'));
    expect(packHandOver(s, id, left, 's0', 's1')).toBe('ok');
    // Not to the seat after it, not from another seat, never more or fewer cards, never a forged card or a repeated id.
    expect(packHandOver(s, id, left, 's0', 's2')).toBe('wait');
    expect(packHandOver(s, id, left, 's2', 's1')).toBe('refuse');
    expect(packHandOver(s, id, cards, 's0', 's1')).toBe('refuse');
    expect(packHandOver(s, id, left.slice(1), 's0', 's1')).toBe('refuse');
    expect(packHandOver(s, id, [...left.slice(1), left[1]!], 's0', 's1')).toBe('refuse');
    expect(packHandOver(s, id, [{ ...left[0]!, ref: { sid: 'forged' } }, ...left.slice(1)], 's0', 's1')).toBe('refuse');
    expect(packHandOver(s, id, [{ ...left[0]!, salt: 'forged' }, ...left.slice(1)], 's0', 's1')).toBe('refuse');
    expect(packHandOver(s, id, [], 's0', 's1')).toBe('refuse');
    // Still accepted after the pick timer took the receiver's pick (the receiver had not got the cards yet).
    const own1 = draftOf(s).queues.s1![0]!;
    s = { ...s, draft: { ...draftOf(s), pickTimer: true } };
    s = ok(s, act('pick', { packId: own1, count: 1 }, 's1'));
    s = ok(s, act('draftTimeout', { packId: id, picks: 1 }, 's0'));
    expect(packHandOver(s, id, left, 's0', 's1')).toBe('ok');
    // The opener's own pack is never handed to it.
    expect(packHandOver(s, own1, packCards(5), 's0', 's1')).toBe('refuse');
  });

  it('accepts the last visit of an emptied pack, also once the draft moved on to building', () => {
    const t = table(2);
    const { cards, id } = t;
    let s = t.s;
    s = { ...s, draft: { ...draftOf(s), pickTimer: true } };
    s = ok(s, act('pick', { packId: id, count: 1 }, 's0'));
    s = ok(s, act('packPass', { packId: id, to: 's1', count: 1 }, 's0'));
    const own1 = draftOf(s).queues.s1![0]!;
    s = ok(s, act('pick', { packId: own1, count: 1 }, 's1'));
    s = ok(s, act('draftTimeout', { packId: id, picks: 1 }, 's0'));
    expect(draftOf(s).packs[id]).toMatchObject({ count: 0, holder: null });
    expect(packHandOver(s, id, cards.slice(1), 's0', 's1')).toBe('ok');
    expect(packHandOver({ ...s, stage: 'build' }, id, cards.slice(1), 's0', 's1')).toBe('ok');
    expect(packHandOver(s, id, cards.slice(1), 's0', 's2')).toBe('wait');
    expect(packRequestOk(s, id, 's1', 's0')).toBe(true);
    expect(packRequestOk(s, id, 's2', 's0')).toBe(false);
    expect(packRequestOk(s, id, 's1', 's2')).toBe(false);
  });

  it('is refused in a format whose packs are not passed', () => {
    let s = draftTable(2, { format: 'sealed', packs: 1 });
    s = openPack(s, 's0', packCards(3), 0, 'down');
    const id = Object.keys(draftOf(s).packs)[0]!;
    expect(packHandOver(s, id, packCards(3), 's1', 's0')).toBe('refuse');
    expect(packRequestOk(s, id, 's1', 's0')).toBe(false);
  });
});

describe('pass driver over a state that jumped ahead', () => {
  /** A driver for s0 over a confirmed state the test sets without telling the driver (a snapshot load). */
  function driverOver(start: TableState, secrets: SecretStore) {
    let state = start;
    let store = secrets;
    const sent: { to: string; packId: string; cards: readonly RevealedCard[] }[] = [];
    const listeners: ((a: Action, s: TableState) => void)[] = [];
    const host: DraftHost = {
      seat: 's0',
      state: () => state,
      confirmedState: () => state,
      secrets: () => store,
      setSecrets: (next) => {
        store = next;
      },
      dispatch: (draft) => ({ ...draft, by: 's0', cid: 'x' }) as Action,
      packSeed: () => Promise.reject(new Error('not in this test')),
      sendPack: (to, packId, cards) => {
        if (cards.length > 0 && packHandOver(state, packId, cards, 's0', to) !== 'ok') throw new Error('refused');
        sent.push({ to, packId, cards });
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
      secrets: () => store,
      jump(next: TableState) {
        state = next;
      },
      step(a: Action, next: TableState) {
        state = next;
        for (const l of listeners) l(a, next);
      },
    };
  }

  it('a pick and a pass are never resolved twice: the cards handed on do not come back to the own pool', () => {
    const { s: start, cards, id } = table(3);
    const store: SecretStore = { ...emptySecretStore('s0'), draft: { held: { [id]: cards }, generated: [], marked: [cards[2]!.instanceId] } };
    const h = driverOver(start, store);
    // s0 picks (sequenced, seen): the marked card goes to the pool.
    const pick = { ...act('pick', { packId: id, count: 1 }, 's0'), seq: start.seq + 1 } as Action;
    const s1 = ok(start, pick);
    h.step(pick, s1);
    expect(h.secrets().draft!.held[POOL_KEY]!.map((c) => c.instanceId)).toEqual([cards[2]!.instanceId]);
    expect(h.secrets().draft!.held[id]!.map((c) => c.instanceId)).toEqual([cards[0]!.instanceId, cards[1]!.instanceId]);
    // Then the state jumps: the pass, s1's picks and pass, and s2's last pick, all unseen.
    let s = ok(s1, act('packPass', { packId: id, to: 's1', count: 2 }, 's0'));
    s = ok(s, act('pick', { packId: draftOf(s).queues.s1![0]!, count: 1 }, 's1'));
    s = ok(s, act('pick', { packId: id, count: 1 }, 's1'));
    s = ok(s, act('packPass', { packId: id, to: 's2', count: 1 }, 's1'));
    s = ok(s, act('pick', { packId: draftOf(s).queues.s2![0]!, count: 1 }, 's2'));
    s = ok(s, act('pick', { packId: id, count: 1 }, 's2'));
    expect(draftOf(s).packs[id]!.count).toBe(0);
    h.jump(s);
    h.driver.drive();
    // Only the own pick is in the pool; the pack is no longer held, and nothing is sent to a seat that moved on.
    expect(h.secrets().draft!.held[POOL_KEY]!.map((c) => c.instanceId)).toEqual([cards[2]!.instanceId]);
    expect(h.secrets().pool).toHaveLength(1);
    expect(Object.keys(h.secrets().draft!.held)).toEqual([POOL_KEY]);
    expect(h.sent).toEqual([]);
    h.driver.dispose();
  });

  it('a pass seen only after the next holder picked still hands the cards over, as they were passed', () => {
    const { s: start, cards, id } = table(3);
    const store: SecretStore = { ...emptySecretStore('s0'), draft: { held: { [id]: cards }, generated: [], marked: [] } };
    const h = driverOver(start, store);
    const pick = { ...act('pick', { packId: id, count: 1 }, 's0'), seq: start.seq + 1 } as Action;
    const s1 = ok(start, pick);
    h.step(pick, s1);
    let s: TableState = { ...s1, draft: { ...draftOf(s1), pickTimer: true } };
    s = ok(s, act('packPass', { packId: id, to: 's1', count: 2 }, 's0'));
    s = ok(s, act('pick', { packId: draftOf(s).queues.s1![0]!, count: 1 }, 's1'));
    // The timer took s1's pick of s0's pack before s1 had its cards.
    s = ok(s, act('draftTimeout', { packId: id, picks: 1 }, 's2'));
    h.jump(s);
    h.driver.drive();
    expect(h.sent).toEqual([{ to: 's1', packId: id, cards: cards.slice(1) }]);
    expect(Object.keys(h.secrets().draft!.held).sort()).toEqual([POOL_KEY, SENT_PREFIX + id].sort());
    expect(h.secrets().draft!.held[POOL_KEY]!.map((c) => c.instanceId)).toEqual([cards[0]!.instanceId]);
    h.driver.dispose();
  });

  it('never hands on a card of its own pool, even if its held copy of the pack lists one', () => {
    const { s: start, cards, id } = table(3);
    // A corrupted held copy: cards[1] is already in the own pool and still listed in the pack.
    const store: SecretStore = { ...emptySecretStore('s0'), draft: { held: { [id]: cards, [POOL_KEY]: [cards[1]!] }, generated: [], marked: [] } };
    const h = driverOver(start, store);
    const pick = { ...act('pick', { packId: id, count: 1 }, 's0'), seq: start.seq + 1 } as Action;
    const s1 = ok(start, pick);
    h.step(pick, s1);
    const pass = { ...act('packPass', { packId: id, to: 's1', count: 2 }, 's0'), seq: s1.seq + 1 } as Action;
    h.step(pass, ok(s1, pass));
    h.driver.drive();
    expect(h.sent).toEqual([]);
    h.driver.dispose();
  });
});
