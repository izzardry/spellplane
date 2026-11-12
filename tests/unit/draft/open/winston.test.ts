/**
 * PLAN M2-P3 acceptance, Winston (DESIGN "Specification: card data, packs and draft formats", Draft formats: "Two
 * seats; 6 packs shuffled into one face-down stack; three piles of one card. The active player looks at pile 1 and
 * takes it, or adds a stack card to it and looks at pile 2, then pile 3 likewise; declining pile 3 takes the top stack
 * card. A taken pile is replaced by one stack card. End: stack and piles empty"; "Pre-game", Hidden information:
 * "Pile contents visible to whoever looks").
 *
 * Shared state may hold only opaque ids and counts: no Winston card identity ever enters it.
 */
import { describe, expect, it } from 'vitest';
import type { RevealedCard } from '../../../../src/core/commit';
import type { SeatId, TableState, WinstonState } from '../../../../src/core/types';
import { act, applies, draftOf, draftTable, no, ok, openPack, packCards, packOpenFields, prng, sealPackSeed } from './helpers';

function winston(s: TableState): WinstonState {
  return draftOf(s).winston!;
}

/** Open `packs` face-down packs of `size` as the dealer s0; returns the state and every card. */
function dealt(packs: number, size = 15): { s: TableState; cards: RevealedCard[] } {
  let s = draftTable(2, { format: 'winston', packs });
  const cards: RevealedCard[] = [];
  for (let k = 0; k < packs; k++) {
    const pack = packCards(size);
    cards.push(...pack);
    s = openPack(s, 's0', pack, k, 'down');
  }
  return { s, cards };
}

function look(s: TableState, take: boolean, by = winston(s).active): TableState {
  return ok(s, act('pileLook', { pile: winston(s).pile, take }, by));
}

describe('Winston dealing', () => {
  it('the dealer opens every pack face down; the last one deals the stack and three piles of one card', () => {
    let s = draftTable(2, { format: 'winston', packs: 2 });
    expect(winston(s).dealer).toBe('s0');
    const first = packCards(15);
    // Only the dealer opens, and only face down: no identity enters shared state.
    const sealedB = sealPackSeed(s, 's1');
    no(sealedB.state, act('packOpen', packOpenFields('b', first, sealedB.sid, 0, 'M19', 'down'), 's1'), /deals/);
    const sealed = sealPackSeed(s, 's0');
    no(sealed.state, act('packOpen', packOpenFields('a', first, sealed.sid, 0, 'M19', 'up'), 's0'), /face down/);
    s = ok(sealed.state, act('packOpen', packOpenFields('a', first, sealed.sid, 0, 'M19', 'down'), 's0'));
    expect(winston(s).stackIds).toBeUndefined();
    no(s, act('pileLook', { pile: 0, take: true }, 's0'), /not dealt/);
    const second = packCards(15);
    s = openPack(s, 's0', second, 1, 'down');
    const w = winston(s);
    expect(w.stack).toBe(27);
    expect(w.piles).toEqual([1, 1, 1]);
    expect(w.stackIds).toHaveLength(27);
    expect(w.pileIds!.map((p) => p.length)).toEqual([1, 1, 1]);
    expect([...w.stackIds!, ...w.pileIds!.flat()].sort()).toEqual([...first, ...second].map((c) => c.instanceId).sort());
    expect(w).toMatchObject({ active: 's0', pile: 0 });
    // The stack interleaves the packs (sorted random ids), it does not stack them pack by pack.
    expect(w.stackIds).toEqual([...w.stackIds!].sort());
    // No identity of any Winston card in shared state.
    const json = JSON.stringify(s);
    for (const c of [...first, ...second]) {
      expect(json).not.toContain(c.ref.sid);
      expect(json).not.toContain(c.salt);
    }
    // No more packs after the deal.
    const late = sealPackSeed(s, 's0');
    no(late.state, act('packOpen', packOpenFields('late', packCards(3), late.sid, 2, 'M19', 'down'), 's0'), /dealt/);
  });

  it('is for two seats only', () => {
    const s = draftTable(3, { format: 'winston', packs: 1 });
    const sealed = sealPackSeed(s, 's0');
    no(sealed.state, act('packOpen', packOpenFields('a', packCards(15), sealed.sid, 0, 'M19', 'down'), 's0'), /two seats/);
  });
});

describe('Winston turn procedure', () => {
  it('taking a pile replaces it with one stack card and passes the turn', () => {
    const { s: start } = dealt(1);
    const before = winston(start);
    const pile0 = before.pileIds![0]!;
    const top = before.stackIds![0]!;
    no(start, act('pileLook', { pile: 0, take: true }, 's1'), /s0's turn/);
    no(start, act('pileLook', { pile: 1, take: true }, 's0'), /looking at pile 1/);
    const s = look(start, true);
    const w = winston(s);
    expect(draftOf(s).taken!.s0).toEqual(pile0);
    expect(draftOf(s).pools.s0).toBe(1);
    expect(w.pileIds![0]).toEqual([top]);
    expect(w.stack).toBe(before.stack - 1);
    expect(w).toMatchObject({ active: 's1', pile: 0 });
  });

  it('declining adds a stack card and moves to the next pile; declining pile 3 adds one and takes the next top card', () => {
    const { s: start } = dealt(1);
    const b = winston(start);
    const [t0, t1, t2, t3] = b.stackIds!;
    let s = look(start, false);
    expect(winston(s).pileIds![0]).toEqual([...b.pileIds![0]!, t0]);
    expect(winston(s)).toMatchObject({ active: 's0', pile: 1 });
    s = look(s, false);
    expect(winston(s).pileIds![1]).toEqual([...b.pileIds![1]!, t1]);
    expect(winston(s)).toMatchObject({ active: 's0', pile: 2 });
    s = look(s, false);
    expect(winston(s).pileIds![2]).toEqual([...b.pileIds![2]!, t2]);
    expect(draftOf(s).taken!.s0).toEqual([t3]);
    expect(winston(s)).toMatchObject({ active: 's1', pile: 0, stack: b.stack - 4, piles: [2, 2, 2] });
    // The other player now looks at pile 1 (two cards) and takes both.
    s = look(s, true);
    expect(draftOf(s).taken!.s1).toEqual([...b.pileIds![0]!, t0]);
    expect(draftOf(s).pools).toEqual({ s0: 1, s1: 2 });
  });

  it('at the end of the stack: empty piles are skipped, the last stack card is taken, and an empty stack forces a take', () => {
    // A tiny stack: 4 cards, so one card is left after the deal.
    const { s: start } = dealt(1, 4);
    expect(winston(start)).toMatchObject({ stack: 1, piles: [1, 1, 1] });
    // s0 takes pile 1: the last stack card replaces it.
    let s = look(start, true);
    expect(winston(s)).toMatchObject({ stack: 0, piles: [1, 1, 1], active: 's1' });
    // s1 declines piles 1 and 2 (nothing to add), and cannot decline pile 3 with an empty stack.
    s = look(s, false);
    expect(winston(s)).toMatchObject({ piles: [1, 1, 1], pile: 1 });
    s = look(s, false);
    expect(winston(s).pile).toBe(2);
    no(s, act('pileLook', { pile: 2, take: false }, 's1'), /stack is empty/);
    s = look(s, true);
    expect(winston(s)).toMatchObject({ piles: [1, 1, 0], active: 's0', pile: 0 });
    // s0 declines pile 1 and must take pile 2, the last pile with a card.
    s = look(s, false);
    expect(winston(s).pile).toBe(1);
    no(s, act('pileLook', { pile: 1, take: false }, 's0'), /stack is empty/);
    s = look(s, true);
    expect(winston(s)).toMatchObject({ piles: [1, 0, 0], active: 's1', pile: 0 });
    s = look(s, true);
    expect(draftOf(s).done).toBe(true);
    expect(applies(s, act('pileLook', { pile: 0, take: true }, 's0'))).toBe(false);
  });

  it('declining the last pile with one stack card left takes that card without adding one', () => {
    // 6 cards: three on the piles, three in the stack.
    const { s: start } = dealt(1, 6);
    let s = look(start, false); // pile 1 gets a card: stack 2
    s = look(s, false); // pile 2 gets a card: stack 1
    const w = winston(s);
    expect(w).toMatchObject({ stack: 1, pile: 2, active: 's0' });
    const last = w.stackIds![0]!;
    const pile3 = [...w.pileIds![2]!];
    s = look(s, false);
    expect(winston(s).pileIds![2]).toEqual(pile3);
    expect(draftOf(s).taken!.s0).toEqual([last]);
    expect(winston(s)).toMatchObject({ stack: 0, active: 's1', pile: 0 });
  });
});

describe('Winston end state', () => {
  for (const [packs, seed] of [
    [6, 1],
    [6, 2],
    [2, 3],
    [1, 4],
  ] as const) {
    it(`${packs} packs, seed ${seed}: every card ends with exactly one player, stack and piles empty`, () => {
      const { s: start, cards } = dealt(packs);
      const rand = prng(seed);
      let s = start;
      let looks = 0;
      const turns: SeatId[] = [];
      while (!draftOf(s).done) {
        const w = winston(s);
        turns.push(w.active);
        const decline = act('pileLook', { pile: w.pile, take: false }, w.active);
        const take = rand() < 0.4 || !applies(s, decline);
        s = look(s, take);
        // Counts always match the ids, and no card is in two places.
        const now = winston(s);
        const all = [...now.stackIds!, ...now.pileIds!.flat(), ...draftOf(s).taken!.s0!, ...draftOf(s).taken!.s1!];
        expect(new Set(all).size).toBe(all.length);
        expect(all.length).toBe(cards.length);
        expect(now.stack).toBe(now.stackIds!.length);
        expect(now.piles).toEqual(now.pileIds!.map((p) => p.length));
        expect(++looks).toBeLessThan(1000);
      }
      const d = draftOf(s);
      const w = winston(s);
      expect(w.stack).toBe(0);
      expect(w.piles).toEqual([0, 0, 0]);
      const taken = [...d.taken!.s0!, ...d.taken!.s1!];
      expect([...taken].sort()).toEqual(cards.map((c) => c.instanceId).sort());
      expect(d.pools.s0).toBe(d.taken!.s0!.length);
      expect(d.pools.s1).toBe(d.taken!.s1!.length);
      expect(d.pools.s0! + d.pools.s1!).toBe(packs * 15);
      // Both players had turns, alternating.
      expect(new Set(turns)).toEqual(new Set(['s0', 's1']));
    });
  }
});
