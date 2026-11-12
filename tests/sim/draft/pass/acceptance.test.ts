/**
 * PLAN M2-P2 acceptance on a simulated network: "In a simulated four-seat draft, every card of every pack ends in
 * exactly one pool; … pass direction is left, right, left; Pick-Two takes two per pass; a reload mid-pick restores the
 * held pack." (The leak scenario is tests/sim/draft/pass/leak.test.ts.)
 *
 * DESIGN "Specification: card data, packs and draft formats", Pass draft: "Everyone holds a pack; each picks `picks`
 * cards and passes the rest; packs queue at the receiver. Direction is left for odd rounds and right for even rounds
 * [counting from 1]. A new round starts when all packs of the round are empty." "Left" means the next seat clockwise
 * (the next higher seat index, wrapping). Expectations are derived from the public log, the network's delivery
 * record and the owners' own records, never from the driver's bookkeeping alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../../../../src/core/actions';
import type { SequencedAction } from '../../../../src/net/messages';
import { reduce } from '../../../../src/core/reducer';
import type { RevealedCard } from '../../../../src/core/commit';
import type { SeatId, TableState } from '../../../../src/core/types';
import { close, generatedPacks, passNet, poolOf, randomBot, runDraft, type PassNet } from './net';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

const FAULTY = { seed: 7, delay: { min: 0, max: 40 }, drop: 0.05 };

/** Every card of every opened pack is in exactly one pool, and each pool matches its shared count and its refs. */
function expectEveryCardInOnePool(t: PassNet): void {
  const state = t.seats[0]!.peer.state;
  const d = state.draft!;
  const packs = generatedPacks(t);
  const opened = Object.keys(d.packs);
  expect(opened.length).toBe(t.seats.length * (d.settings as { packs: number }).packs);
  const all = new Map<string, RevealedCard>();
  for (const id of opened) {
    const p = packs.get(id);
    expect(p, `the opener's record of pack ${id}`).toBeDefined();
    // The record is the pack the opener committed to.
    expect([...p!.cards.map((c) => c.instanceId)].sort()).toEqual(d.packs[id]!.commitment.instanceIds);
    for (const c of p!.cards) all.set(c.instanceId, c);
  }
  const owner = new Map<string, SeatId>();
  for (const s of t.seats) {
    const pool = poolOf(s);
    expect(pool.length).toBe(d.pools[s.seat]);
    expect(s.secrets().pool).toEqual(pool.map((c) => c.ref));
    for (const c of pool) {
      expect(owner.has(c.instanceId), `${c.instanceId} in two pools`).toBe(false);
      owner.set(c.instanceId, s.seat);
      // The very card that was generated (same printing, finish and salt).
      expect(all.get(c.instanceId)).toEqual(c);
    }
  }
  expect(owner.size).toBe(all.size);
  // Nothing is still held or kept for a re-send.
  for (const s of t.seats) {
    const held = s.secrets().draft!.held;
    expect(Object.keys(held).filter((k) => k !== 'pool:hidden')).toEqual([]);
  }
}

/** The state before each sequenced action, from the start and the log. */
function replay(start: TableState, log: readonly SequencedAction[]): { before: TableState; a: Action }[] {
  const out: { before: TableState; a: Action }[] = [];
  let s = start;
  for (const a of log) {
    out.push({ before: s, a });
    s = reduce(s, a);
  }
  return out;
}

describe('pass draft on a simulated network', () => {
  it('four seats, three packs: every card ends in exactly one pool, passes go left, right, left', async () => {
    const t = await passNet(4, { format: 'pass', packs: 3, picks: 1 }, { net: FAULTY, sets: ['M19', 'M20', 'M21'] });
    await runDraft(t, randomBot(11));
    expectEveryCardInOnePool(t);

    const seats = ['s0', 's1', 's2', 's3'];
    const left = (s: string): string => seats[(seats.indexOf(s) + 1) % 4]!;
    const right = (s: string): string => seats[(seats.indexOf(s) + 3) % 4]!;
    const steps = replay(t.start, t.seats[0]!.peer.log());
    const passes = steps.filter((x) => x.a.type === 'packPass');
    const byRound = [0, 0, 0];
    for (const { before, a } of passes) {
      if (a.type !== 'packPass') continue;
      const round = before.draft!.packs[a.packId]!.number;
      byRound[round]! += 1;
      expect(a.to).toBe(round === 1 ? right(a.by) : left(a.by));
    }
    // 15-card packs, one pick per pass: 14 passes per pack, 4 packs per round.
    expect(byRound).toEqual([56, 56, 56]);
    // Every pack's sets: pack 1 M19, pack 2 M20, pack 3 M21.
    for (const p of Object.values(t.seats[0]!.peer.state.draft!.packs)) expect(p.set).toBe(['M19', 'M20', 'M21'][p.number]);

    // The cards themselves travelled the same way: every pack message with cards went to the left neighbour in
    // rounds 1 and 3 and to the right one in round 2, from the drafter that passed.
    const peerSeat = (p: string): string => `s${p.slice(1)}`;
    const numberOf = new Map(Object.values(t.seats[0]!.peer.state.draft!.packs).map((p) => [p.id, p.number]));
    const packMsgs = t.net.delivered.filter((m) => m.channel === 'prv' && (m.msg as { t?: string }).t === 'pack' && ((m.msg as { cards: unknown[] }).cards.length > 0));
    expect(packMsgs.length).toBeGreaterThanOrEqual(168);
    for (const m of packMsgs) {
      const n = numberOf.get((m.msg as { packId: string }).packId)!;
      expect(peerSeat(m.to)).toBe(n === 1 ? right(peerSeat(m.from)) : left(peerSeat(m.from)));
    }
    close(t);
  }, 240_000);

  it('three seats and two seats draft to the end too, with a different set per pack', async () => {
    for (const n of [3, 2]) {
      const t = await passNet(n, { format: 'pass', packs: 2, picks: 1 }, { net: { ...FAULTY, seed: 20 + n }, sets: ['M20', 'ORI'] });
      await runDraft(t, randomBot(30 + n));
      expectEveryCardInOnePool(t);
      for (const s of t.seats) expect(t.seats[0]!.peer.state.draft!.pools[s.seat]).toBeGreaterThan(0);
      close(t);
    }
  }, 240_000);

  it('Pick-Two: four seats, three packs, two picks per pass', async () => {
    const t = await passNet(4, { format: 'pass', packs: 3, picks: 2 }, { net: FAULTY });
    await runDraft(t, randomBot(5));
    expectEveryCardInOnePool(t);
    const steps = replay(t.start, t.seats[0]!.peer.log());
    const picks = steps.filter((x) => x.a.type === 'pick');
    expect(picks.length).toBeGreaterThan(0);
    for (const { before, a } of picks) {
      if (a.type !== 'pick') continue;
      const left = before.draft!.packs[a.packId]!.count;
      // Two per pass; only the last card of an odd-sized pack goes alone.
      expect(a.count).toBe(Math.min(2, left));
      if (left >= 2) expect(a.count).toBe(2);
    }
    // 15-card packs: seven picks of two and one of one per pack.
    expect(picks.filter((x) => x.a.type === 'pick' && x.a.count === 2).length).toBe(12 * 7);
    expect(picks.filter((x) => x.a.type === 'pick' && x.a.count === 1).length).toBe(12);
    // Each holder took two cards a visit: the pools grew by two with every pick of two.
    for (const s of t.seats) expect(poolOf(s).length).toBe(t.seats[0]!.peer.state.draft!.pools[s.seat]);
    expect(t.seats.reduce((n, s) => n + poolOf(s).length, 0)).toBe(12 * 15);
    close(t);
  }, 240_000);

  it('a reload mid-pick restores the held pack and its marks, and the draft goes on', async () => {
    const t = await passNet(4, { format: 'pass', packs: 2, picks: 1 }, { net: FAULTY });
    const bot = randomBot(17);
    const b = t.seats[1]!;
    let reloaded = 0;
    let markedCard: string | null = null;
    await runDraft(t, bot, 900_000, () => {
      if (reloaded >= 3) return;
      const v = b.driver.view();
      if (v.pack === null || v.pack.cards.length < 3) return;
      // Mid-pick: a card is marked, not confirmed.
      const id = v.pack.cards[v.pack.cards.length - 1]!.id;
      b.driver.mark([id]);
      const before = b.driver.view();
      expect(before.marked).toEqual([id]);
      b.reload();
      const after = b.driver.view();
      expect(after.pack).toEqual(before.pack);
      expect(after.marked).toEqual([id]);
      expect(after.pool).toEqual(before.pool);
      expect(after.queued).toBe(before.queued);
      reloaded += 1;
      markedCard = id;
    });
    expect(reloaded).toBe(3);
    expectEveryCardInOnePool(t);
    // The bot confirms marked cards, so the last marked card ended in that seat's pool.
    expect(poolOf(b).map((c) => c.instanceId)).toContain(markedCard);
    close(t);
  }, 240_000);

  it('configurable packs and picks per pass: three seats, one pack, three picks a pass', async () => {
    const t = await passNet(3, { format: 'pass', packs: 1, picks: 3 }, { net: { ...FAULTY, seed: 77 } });
    await runDraft(t, randomBot(78));
    expectEveryCardInOnePool(t);
    const steps = replay(t.start, t.seats[0]!.peer.log());
    // 15 cards, three a pass: five picks per pack, four passes.
    expect(steps.filter((x) => x.a.type === 'pick').map((x) => (x.a.type === 'pick' ? x.a.count : 0))).toEqual(Array(15).fill(3));
    expect(steps.filter((x) => x.a.type === 'packPass').length).toBe(12);
    expect(t.seats.map((s) => poolOf(s).length)).toEqual([15, 15, 15]);
    close(t);
  }, 240_000);
});

describe('sealed on a simulated network', () => {
  it('four seats open six packs each: every card ends in exactly its opener\'s pool', async () => {
    const t = await passNet(4, { format: 'sealed', packs: 6 }, { net: FAULTY, sets: ['M19', 'M20', 'M21'] });
    await runDraft(t, () => undefined);
    expectEveryCardInOnePool(t);
    const d = t.seats[0]!.peer.state.draft!;
    const packs = generatedPacks(t);
    for (const s of t.seats) {
      // The own packs, in pack order, are the pool.
      const own = Object.values(d.packs)
        .filter((p) => p.opener === s.seat)
        .sort((a, b) => a.number - b.number);
      expect(own.map((p) => p.number)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(own.map((p) => p.set)).toEqual(['M19', 'M20', 'M21', 'M21', 'M21', 'M21']);
      expect(poolOf(s).map((c) => c.instanceId)).toEqual(own.flatMap((p) => packs.get(p.id)!.cards.map((c) => c.instanceId)));
      expect(d.pools[s.seat]).toBe(90);
    }
    expect(d.done).toBe(true);
    close(t);
  }, 240_000);
});
