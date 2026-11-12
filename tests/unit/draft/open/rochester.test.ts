/**
 * PLAN M2-P3 acceptance, Rochester (DESIGN "Specification: card data, packs and draft formats", Draft formats:
 * "One pack is opened face up. Picks go in snake order starting with the opener: 1, 2, …, S, S, …, 2, 1, repeating, one
 * card each, until `burn` cards remain. The opener role then moves left. End: when every player has opened `packs`
 * packs"; "Pre-game", mode table: "the last player picks twice, then back; the opener rotates each pack"; Hidden
 * information: none, packs and picks are public).
 *
 * The expected order is written out from the design here, independently of core/drafting.ts `rochesterOrder`.
 */
import { describe, expect, it } from 'vitest';
import { rochesterOrder } from '../../../../src/core/drafting';
import { rochesterPicker } from '../../../../src/core/open';
import type { SeatId, TableState } from '../../../../src/core/types';
import { act, applies, draftOf, draftTable, no, ok, openPack, packCards, packOpenFields, prng, sealPackSeed } from './helpers';

const SEATS = ['s0', 's1', 's2', 's3'];

/** The design's snake: position i of a pack opened by `opener` among `seats` (left = next higher seat index). */
function snake(seats: readonly SeatId[], opener: SeatId, i: number): SeatId {
  const s = seats.length;
  const o = seats.indexOf(opener);
  const c = i % (2 * s);
  const step = c < s ? c : 2 * s - 1 - c;
  return seats[(o + step) % s]!;
}

function currentPack(state: TableState): { id: string; cards: string[] } {
  const d = draftOf(state);
  const id = d.rochester!.pack!;
  return { id, cards: (d.packs[id]!.cards ?? []).map((c) => c.id) };
}

function pickAct(state: TableState, by: SeatId, card: string): ReturnType<typeof act<'pick'>> {
  return act('pick', { packId: currentPack(state).id, count: 1, cards: [card] }, by);
}

describe('rochesterOrder', () => {
  it('is one snake cycle from the opener going left', () => {
    expect(rochesterOrder(['s0', 's1'], 's0')).toEqual(['s0', 's1', 's1', 's0']);
    expect(rochesterOrder(['s0', 's1'], 's1')).toEqual(['s1', 's0', 's0', 's1']);
    expect(rochesterOrder(['s0', 's1', 's2'], 's1')).toEqual(['s1', 's2', 's0', 's0', 's2', 's1']);
    expect(rochesterOrder(['s0', 's1', 's2', 's3'], 's3')).toEqual(['s3', 's0', 's1', 's2', 's2', 's1', 's0', 's3']);
    expect(() => rochesterOrder(['s0', 's1'], 's5')).toThrow();
  });
});

describe('Rochester pick order', () => {
  for (const seats of [2, 3, 4]) {
    it(`${seats} seats: the snake from a rotating opener, every pick public, until every player opened its packs`, () => {
      const packs = 2;
      const size = 15;
      const ids = SEATS.slice(0, seats);
      let s = draftTable(seats, { format: 'rochester', packs, burn: 0 });
      const rand = prng(seats);
      const pickers: SeatId[][] = [];
      const openers: SeatId[] = [];
      for (let k = 0; k < packs * seats; k++) {
        const opener = ids[k % seats]!;
        // Nobody else may open the next pack.
        for (const other of ids.filter((x) => x !== opener)) {
          const sealed = sealPackSeed(s, other);
          no(sealed.state, act('packOpen', packOpenFields(`x-${sealed.sid}`, packCards(size), sealed.sid, Math.floor(k / seats), 'M19', 'up'), other), /opens the next pack/);
        }
        s = openPack(s, opener, packCards(size), Math.floor(k / seats), 'up');
        openers.push(draftOf(s).packs[draftOf(s).rochester!.pack!]!.opener);
        const order: SeatId[] = [];
        for (let i = 0; i < size; i++) {
          const expected = snake(ids, opener, i);
          const { cards } = currentPack(s);
          const card = cards[Math.floor(rand() * cards.length)]!;
          for (const other of ids.filter((x) => x !== expected)) no(s, pickAct(s, other, card), /pick/);
          s = ok(s, pickAct(s, expected, card));
          order.push(expected);
        }
        pickers.push(order);
        expect(draftOf(s).rochester!.pack).toBeNull();
      }
      // The opener rotates left each pack, so every player opened `packs` packs.
      expect(openers).toEqual(Array.from({ length: packs * seats }, (_, k) => ids[k % seats]));
      // The first cycle of the first pack, written out: 1, 2, …, S, S, …, 2, 1.
      const cycle = [...ids, ...[...ids].reverse()];
      expect(pickers[0]!.slice(0, 2 * seats)).toEqual(cycle);
      const d = draftOf(s);
      expect(d.done).toBe(true);
      expect(d.round).toBe(packs - 1);
      for (const id of ids) expect(d.pools[id]).toBe(d.taken![id]!.length);
      expect(Object.values(d.pools).reduce((a, b) => a + b, 0)).toBe(packs * seats * size);
      // Nothing more opens or picks once the draft is over.
      const sealed = sealPackSeed(s, ids[0]!);
      no(sealed.state, act('packOpen', packOpenFields('late', packCards(3), sealed.sid, packs, 'M19', 'up'), ids[0]!), /over/);
    });
  }

  it('a pick names exactly one card of the pack on the table', () => {
    let s = draftTable(2, { format: 'rochester', packs: 1, burn: 0 });
    s = openPack(s, 's0', packCards(15), 0, 'up');
    const { id, cards } = currentPack(s);
    no(s, act('pick', { packId: id, count: 1, cards: ['not-there'] }, 's0'), /not in pack/);
    no(s, act('pick', { packId: id, count: 2, cards: [cards[0]!, cards[1]!] }, 's0'));
    no(s, act('pick', { packId: id, count: 1, cards: [cards[0]!, cards[1]!] }, 's0'), /exactly one/);
    no(s, act('pick', { packId: id, count: 1 }, 's0'), /exactly one/);
    no(s, act('pick', { packId: 'other', count: 1, cards: [cards[0]!] }, 's0'), /not the pack on the table/);
    s = ok(s, act('pick', { packId: id, count: 1, cards: [cards[0]!] }, 's0'));
    // A picked card is gone from the table and listed for its picker.
    expect(currentPack(s).cards).not.toContain(cards[0]);
    expect(draftOf(s).taken!.s0).toEqual([cards[0]]);
    no(s, act('pick', { packId: id, count: 1, cards: [cards[0]!] }, 's1'), /not in pack/);
  });

  it('a public pack shows every card, each opening its commitment, from a sealed pack seed of the opener', () => {
    const s = draftTable(2, { format: 'rochester', packs: 1, burn: 0 }, ['M19', 'M20']);
    const cards = packCards(15);
    const sealed = sealPackSeed(s, 's0');
    const base = packOpenFields('pk', cards, sealed.sid, 0, 'M19', 'up');
    // Face down is refused: a Rochester pack lies face up.
    no(sealed.state, act('packOpen', packOpenFields('pk', cards, sealed.sid, 0, 'M19', 'down'), 's0'), /face up/);
    // A card that does not open its commitment (a swapped printing).
    const forged = cards.map((c, i) => (i === 3 ? { ...c, ref: { sid: 'something-else' } } : c));
    no(sealed.state, act('packOpen', { ...base, cards: forged }, 's0'), /does not open/);
    // A card shown twice, or one missing.
    no(sealed.state, act('packOpen', { ...base, cards: [...cards.slice(0, 14), cards[0]!] }, 's0'), /shown twice|not one of/);
    no(sealed.state, act('packOpen', { ...base, cards: cards.slice(0, 14) }, 's0'), /every card/);
    // Ids and commitments are sorted, so they say nothing about pack order.
    no(sealed.state, act('packOpen', { ...base, instanceIds: [...base.instanceIds!].reverse() }, 's0'), /sorted/);
    no(sealed.state, act('packOpen', { ...base, commits: [...base.commits].reverse() }, 's0'), /sorted/);
    // The set of pack 1 and the pack number.
    no(sealed.state, act('packOpen', { ...base, set: 'M20' }, 's0'), /set/);
    no(sealed.state, act('packOpen', { ...base, number: 1, set: 'M20' }, 's0'), /next pack is pack 1/);
    // The seed round must exist, be a pack round of the opener and be sealed.
    no(s, act('packOpen', base, 's0'), /not a pack-seed round/);
    const theirs = sealPackSeed(sealed.state, 's1');
    no(theirs.state, act('packOpen', { ...base, sid: theirs.sid }, 's0'), /belongs to s1/);
    const open = ok(s, act('shuffleCommit', { sid: 'early', zone: 'pack:s0', h: 'h', purpose: 'pack' }, 's0'));
    no(open, act('packOpen', { ...base, sid: 'early' }, 's0'), /waits for peer nonces/);
    // Draft actions apply only in the draft stage.
    no({ ...sealed.state, stage: 'build' }, act('packOpen', base, 's0'), /draft stage/);
    const opened = ok(sealed.state, act('packOpen', base, 's0'));
    const pack = draftOf(opened).packs.pk!;
    expect(pack).toMatchObject({ opener: 's0', number: 0, set: 'M19', count: 15, holder: null, picks: 0 });
    // Face up in pack order, as the opener laid it.
    expect(pack.cards!.map((c) => c.id)).toEqual(cards.map((c) => c.instanceId));
    expect(pack.cards!.map((c) => c.ref.sid)).toEqual(cards.map((c) => c.ref.sid));
    // The same ids cannot be opened twice.
    const again = sealPackSeed(opened, 's1');
    no(again.state, act('packOpen', packOpenFields('pk2', cards, again.sid, 0, 'M19', 'up'), 's1'));
  });
});

describe('pack-seed rounds', () => {
  it('a round backs one pack only, and it must be the opener\'s latest round', () => {
    // Packs no larger than the burn count leave the table at once, so the opener role moves straight on.
    let s = draftTable(2, { format: 'rochester', packs: 2, burn: 15 });
    const first = sealPackSeed(s, 's0');
    s = ok(first.state, act('packOpen', packOpenFields('a', packCards(15), first.sid, 0, 'M19', 'up'), 's0'));
    s = openPack(s, 's1', packCards(15), 0, 'up');
    expect(draftOf(s).rochester).toMatchObject({ opener: 's0', opened: 2, pack: null });
    // Reusing the round of pack 1 for pack 2 is refused.
    no(s, act('packOpen', packOpenFields('b', packCards(15), first.sid, 1, 'M19', 'up'), 's0'), /fresh round/);
    // Of two sealed rounds the opener cannot name the one it likes: only the latest backs the pack.
    const older = sealPackSeed(s, 's0');
    const newer = sealPackSeed(older.state, 's0');
    no(newer.state, act('packOpen', packOpenFields('b', packCards(15), older.sid, 1, 'M19', 'up'), 's0'), /latest/);
    ok(newer.state, act('packOpen', packOpenFields('b', packCards(15), newer.sid, 1, 'M19', 'up'), 's0'));
  });
});

describe('Rochester burn count', () => {
  it('leaves exactly `burn` cards of every pack unpicked, then the opener moves left', () => {
    const burn = 3;
    const size = 15;
    let s = draftTable(3, { format: 'rochester', packs: 1, burn });
    const ids = ['s0', 's1', 's2'];
    const rand = prng(7);
    for (let k = 0; k < 3; k++) {
      expect(draftOf(s).rochester!.opener).toBe(ids[k]);
      const cards = packCards(size);
      s = openPack(s, ids[k]!, cards, 0, 'up');
      const packId = draftOf(s).rochester!.pack!;
      let picks = 0;
      while (draftOf(s).rochester!.pack !== null) {
        const picker = rochesterPicker(draftOf(s))!;
        expect(picker).toBe(snake(ids, ids[k]!, picks));
        const left = currentPack(s).cards;
        s = ok(s, pickAct(s, picker, left[Math.floor(rand() * left.length)]!));
        picks++;
      }
      expect(picks).toBe(size - burn);
      const pack = draftOf(s).packs[packId]!;
      expect(pack.count).toBe(burn);
      expect(pack.cards).toHaveLength(burn);
      // Every card of the pack is either taken by exactly one drafter or burned.
      const taken = Object.values(draftOf(s).taken!).flat();
      const accounted = [...taken.filter((id) => cards.some((c) => c.instanceId === id)), ...pack.cards!.map((c) => c.id)];
      expect(accounted.sort()).toEqual(cards.map((c) => c.instanceId).sort());
      // A burned card can no longer be picked.
      if (draftOf(s).rochester!.pack === null && !draftOf(s).done) expect(applies(s, act('pick', { packId, count: 1, cards: [pack.cards![0]!.id] }, ids[(k + 1) % 3]!))).toBe(false);
    }
    expect(draftOf(s).done).toBe(true);
    expect(Object.values(draftOf(s).pools).reduce((a, b) => a + b, 0)).toBe(3 * (size - burn));
  });

  it('a pack no larger than the burn count leaves the table unpicked', () => {
    let s = draftTable(2, { format: 'rochester', packs: 2, burn: 5 });
    s = openPack(s, 's0', packCards(5), 0, 'up');
    const d = draftOf(s);
    expect(d.rochester).toMatchObject({ pack: null, opener: 's1', opened: 1 });
    expect(Object.values(d.packs)[0]!.count).toBe(5);
    expect(d.taken).toEqual({ s0: [], s1: [] });
  });
});
