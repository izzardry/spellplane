/**
 * PLAN M2-P3 acceptance, Grid (DESIGN "Specification: card data, packs and draft formats", Draft formats: "Two seats;
 * 18 grids of nine face-up cards from shuffled packs. First player takes a row or column; second takes a remaining
 * row or column; the rest is discarded. First player alternates each grid. End: after 18 grids"; "Pre-game", Hidden
 * information: none).
 */
import { describe, expect, it } from 'vitest';
import type { RevealedCard } from '../../../../src/core/commit';
import { gridLine } from '../../../../src/core/open';
import type { GridState, SeatId, TableState } from '../../../../src/core/types';
import { act, applies, draftOf, draftTable, no, ok, openPack, packCards, packOpenFields, prng, sealPackSeed } from './helpers';

function grid(s: TableState): GridState {
  return draftOf(s).grid!;
}

function take(s: TableState, by: SeatId, line: 'row' | 'col', index: 0 | 1 | 2): TableState {
  return ok(s, act('gridTake', { grid: grid(s).index, line, index }, by));
}

/** Cell ids of a line, written out from the design's 3×3 layout (row by row). */
const ROW = (i: number): number[] => [3 * i, 3 * i + 1, 3 * i + 2];
const COL = (i: number): number[] => [i, i + 3, i + 6];

describe('grid lines', () => {
  it('rows and columns of a 3×3 grid laid row by row', () => {
    for (const i of [0, 1, 2]) {
      expect(gridLine('row', i)).toEqual(ROW(i));
      expect(gridLine('col', i)).toEqual(COL(i));
    }
  });
});

describe('Grid draft', () => {
  it('the first player lays nine cards face up, takes a row, the second a remaining column; the rest is discarded', () => {
    let s = draftTable(2, { format: 'grid', grids: 2 });
    const cards = packCards(9);
    // Only the grid's first player lays it, face up, and at most nine cards.
    const other = sealPackSeed(s, 's1');
    no(other.state, act('packOpen', packOpenFields('g', cards, other.sid, 0, 'M19', 'up'), 's1'), /lays the next grid/);
    const sealed = sealPackSeed(s, 's0');
    no(sealed.state, act('packOpen', packOpenFields('g', cards, sealed.sid, 0, 'M19', 'down'), 's0'), /face up/);
    no(sealed.state, act('packOpen', packOpenFields('g', packCards(10), sealed.sid, 0, 'M19', 'up'), 's0'), /1 to 9/);
    no(sealed.state, act('packOpen', packOpenFields('g', cards, sealed.sid, 1, 'M19', 'up'), 's0'), /grid 1/);
    s = ok(sealed.state, act('packOpen', packOpenFields('g', cards, sealed.sid, 0, 'M19', 'up'), 's0'));
    expect(grid(s).cells.map((c) => c?.id)).toEqual(cards.map((c) => c.instanceId));
    no(s, act('gridTake', { grid: 0, line: 'row', index: 1 }, 's1'), /s0's take/);
    no(s, act('gridTake', { grid: 1, line: 'row', index: 1 }, 's0'), /grid 1 is on the table/);
    s = take(s, 's0', 'row', 1);
    const id = (i: number): string => cards[i]!.instanceId;
    expect(draftOf(s).taken!.s0).toEqual(ROW(1).map(id));
    expect(grid(s).cells.filter((c) => c === null)).toHaveLength(3);
    // The second player: not the same row, and only now.
    no(s, act('gridTake', { grid: 0, line: 'row', index: 1 }, 's1'), /already taken/);
    no(s, act('gridTake', { grid: 0, line: 'col', index: 0 }, 's0'), /s1's take/);
    s = take(s, 's1', 'col', 0);
    // Column 0 minus the cell row 1 already took.
    expect(draftOf(s).taken!.s1).toEqual([0, 6].map(id));
    expect(draftOf(s).pools).toEqual({ s0: 3, s1: 2 });
    // The rest is discarded: four cards stay listed in their pack, unpicked; the next grid is due from s1.
    const pack = draftOf(s).packs.g!;
    expect(pack.count).toBe(4);
    expect(pack.cards!.map((c) => c.id).sort()).toEqual([1, 2, 7, 8].map(id).sort());
    expect(grid(s)).toMatchObject({ index: 1, cells: [], first: 's1', taken: [] });
    no(s, act('gridTake', { grid: 1, line: 'row', index: 0 }, 's1'), /no grid/);
  });

  it('the second player may take a crossing line, and a grid with few cards ends when no line is left', () => {
    let s = draftTable(2, { format: 'grid', grids: 1 });
    // A short grid: three cards fill row 0 only.
    const cards = packCards(3);
    s = openPack(s, 's0', cards, 0, 'up');
    expect(grid(s).cells.slice(3).every((c) => c === null)).toBe(true);
    no(s, act('gridTake', { grid: 0, line: 'row', index: 2 }, 's0'), /already taken/);
    s = take(s, 's0', 'col', 1);
    s = take(s, 's1', 'row', 0);
    expect(draftOf(s).taken).toEqual({ s0: [cards[1]!.instanceId], s1: [cards[0]!.instanceId, cards[2]!.instanceId] });
    expect(draftOf(s).done).toBe(true);
    // The first take empties the only row: nothing left for the second player, so the grid ends at once.
    let t = draftTable(2, { format: 'grid', grids: 2 });
    t = openPack(t, 's0', packCards(3), 0, 'up');
    t = take(t, 's0', 'row', 0);
    expect(grid(t)).toMatchObject({ index: 1, first: 's1', cells: [] });
  });

  it('18 grids: the first player alternates, and every card ends in exactly one pool or the discard', () => {
    const grids = 18;
    let s = draftTable(2, { format: 'grid', grids }, ['M19', 'M20']);
    const rand = prng(18);
    const firsts: SeatId[] = [];
    const all: RevealedCard[] = [];
    for (let g = 0; g < grids; g++) {
      const first = grid(s).first;
      firsts.push(first);
      const cards = packCards(9);
      all.push(...cards);
      // A grid counts as a pack for the set per pack (DECISIONS M2-P3).
      s = openPack(s, first, cards, g, 'up', g === 0 ? 'M19' : 'M20');
      const second: SeatId = first === 's0' ? 's1' : 's0';
      for (const by of [first, second]) {
        const lines = (['row', 'col'] as const).flatMap((line) => ([0, 1, 2] as const).map((index) => ({ line, index })));
        const open = lines.filter((l) => applies(s, act('gridTake', { grid: g, line: l.line, index: l.index }, by)));
        expect(open.length).toBeGreaterThan(0);
        const pick = open[Math.floor(rand() * open.length)]!;
        s = take(s, by, pick.line, pick.index);
      }
    }
    expect(firsts).toEqual(Array.from({ length: grids }, (_, g) => (g % 2 === 0 ? 's0' : 's1')));
    const d = draftOf(s);
    expect(d.done).toBe(true);
    expect(grid(s).index).toBe(grids);
    const taken = [...d.taken!.s0!, ...d.taken!.s1!];
    const discarded = Object.values(d.packs).flatMap((p) => p.cards!.map((c) => c.id));
    expect(new Set(taken).size).toBe(taken.length);
    expect([...taken, ...discarded].sort()).toEqual(all.map((c) => c.instanceId).sort());
    for (const p of Object.values(d.packs)) expect(p.count).toBe(p.cards!.length);
    // Each grid gives 5 or 6 cards (a line of three, then one of two or three).
    expect(taken.length).toBeGreaterThanOrEqual(grids * 5);
    expect(taken.length).toBeLessThanOrEqual(grids * 6);
    expect(d.pools.s0! + d.pools.s1!).toBe(taken.length);
    // Over: no further grid.
    const late = sealPackSeed(s, 's0');
    no(late.state, act('packOpen', packOpenFields('late', packCards(9), late.sid, grids, 'M20', 'up'), 's0'), /over/);
  });
});
