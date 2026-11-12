/**
 * The draft surface's pure layout and pick gestures (DESIGN "Pre-game: draft, sealed and deck building", Drafting
 * interaction: the current pack is a fan or grid on the private table; click a card to mark it, click again to confirm;
 * picks go to the pool area, which auto-sorts by colour; "Specification: geometry, layout and motion": card 63 × 88,
 * cascade offset 14; "Specification: card data, packs and draft formats", Grid: row or column).
 */
import { describe, expect, it } from 'vitest';
import type { CardRef, DraftCard, Pose } from '../../../../src/core/types';
import type { CardData } from '../../../../src/data/types';
import {
  canConfirm,
  clickPick,
  DRAFT_LAYOUT,
  draftFrame,
  foilBadgeAt,
  foilSheenColour,
  gridLineCells,
  gridLineOpen,
  packPoses,
  packRows,
  poolColumnOf,
  poolColumns,
  POOL_COLUMNS,
  poolSlots,
  poolTop,
  queuePlaces,
  rowY,
} from '../../../../src/scene/draft';
import { cardCorners } from '../../../../src/scene/math';
import m19 from '../../../fixtures/scryfall/m19.json';

const CARDS = m19 as unknown as CardData[];
const byId = new Map(CARDS.map((c) => [c.id, c]));
const data = (ref: CardRef): CardData | null => byId.get(ref.sid) ?? null;
const named = (name: string): CardData => CARDS.find((c) => c.name === name)!;
const card = (over: Partial<CardData>): CardData => ({ id: 'x', name: 'X', set: 'tst', collector_number: '1', rarity: 'common', layout: 'normal', cmc: 0, type_line: 'Creature', color_identity: [], ...over });

function box(p: Pose): { x0: number; x1: number; y0: number; y1: number } {
  const c = cardCorners(p);
  return { x0: Math.min(...c.map((q) => q.x)), x1: Math.max(...c.map((q) => q.x)), y0: Math.min(...c.map((q) => q.y)), y1: Math.max(...c.map((q) => q.y)) };
}
const overlap = (a: Pose, b: Pose): boolean => {
  const p = box(a);
  const q = box(b);
  return p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;
};
const inFrame = (p: Pose, rows: number): boolean => {
  const { frame } = draftFrame(rows);
  const b = box(p);
  return b.x0 >= frame.x - frame.w / 2 && b.x1 <= frame.x + frame.w / 2 && b.y0 >= frame.y - frame.d / 2 && b.y1 <= frame.y + frame.d / 2;
};
const pack = (n: number): DraftCard[] => CARDS.slice(0, n).map((c, i) => ({ id: `c${i}`, ref: { sid: c.id } }));

describe('pool colour columns (DESIGN "Pre-game", Drafting interaction: the pool auto-sorts by colour)', () => {
  it('sorts mono-coloured cards into their colour, the rest into multicolour, colourless and land', () => {
    expect(poolColumnOf(card({ colors: ['W'] }))).toBe('W');
    expect(poolColumnOf(card({ colors: ['G'] }))).toBe('G');
    expect(poolColumnOf(card({ colors: ['U', 'R'] }))).toBe('M');
    expect(poolColumnOf(card({ colors: [], type_line: 'Artifact' }))).toBe('C');
    expect(poolColumnOf(card({ colors: ['W'], type_line: 'Land — Plains' }))).toBe('L');
    expect(poolColumnOf(card({ colors: [], type_line: 'Basic Land — Island' }))).toBe('L');
    expect(poolColumnOf(null)).toBe('C');
  });

  it('reads a double-faced card by its front face (fixture: Nicol Bolas, the Ravager is multicolour)', () => {
    const bolas = CARDS.find((c) => c.name.startsWith('Nicol Bolas, the Ravager'))!;
    expect(bolas.colors).toBeUndefined();
    expect(poolColumnOf(bolas)).toBe('M');
  });

  it('a whole fixture set lands in exactly one column each, ordered by mana value then name, ties in pick order', () => {
    const pool: CardRef[] = [...CARDS.map((c) => ({ sid: c.id })), { sid: CARDS[5]!.id }];
    const cols = poolColumns(pool, data);
    const all = POOL_COLUMNS.flatMap((c) => cols[c].map((e) => e.index)).sort((a, b) => a - b);
    expect(all).toEqual(pool.map((_, i) => i));
    for (const c of POOL_COLUMNS) {
      const list = cols[c].map((e) => data(e.ref)!);
      for (const x of list) expect(poolColumnOf(x)).toBe(c);
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1]!;
        const b = list[i]!;
        expect(a.cmc < b.cmc || (a.cmc === b.cmc && a.name <= b.name)).toBe(true);
      }
    }
    // The duplicate of card 5 follows the original (pick order).
    const col = cols[poolColumnOf(CARDS[5]!)];
    const at = col.findIndex((e) => e.index === 5);
    expect(col[at + 1]!.index).toBe(pool.length - 1);
    expect(cols.W.length).toBeGreaterThan(0);
    expect(cols.L.length).toBeGreaterThan(0);
    expect(cols.M.length).toBeGreaterThan(0);
  });

  it('pool columns stand left to right in colour order W U B R G, multicolour, colourless, land and cascade toward the owner', () => {
    // Six of each column: a 45-card-sized pool that needs no compression.
    const pool = POOL_COLUMNS.flatMap((col) => CARDS.filter((c) => poolColumnOf(c) === col).slice(0, 6)).map((c) => ({ sid: c.id }));
    const slots = poolSlots(pool, data, 2);
    expect(new Set(slots.map((s) => s.column)).size).toBe(POOL_COLUMNS.length);
    const xs = POOL_COLUMNS.map((c) => slots.find((s) => s.column === c)?.pose.x).filter((x): x is number => x !== undefined);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    for (const c of POOL_COLUMNS) {
      const col = slots.filter((s) => s.column === c).sort((a, b) => a.row - b.row);
      for (let i = 1; i < col.length; i++) expect(col[i - 1]!.pose.y - col[i]!.pose.y).toBeCloseTo(DRAFT_LAYOUT.cascade);
    }
    expect(new Set(slots.map((s) => s.index)).size).toBe(pool.length);
  });

  it('a long column compresses its cascade so it stays inside the pool area; a card keeps its column when other colours arrive', () => {
    const white = CARDS.filter((c) => poolColumnOf(c) === 'W').slice(0, 30);
    const pool = white.map((c) => ({ sid: c.id }));
    const slots = poolSlots(pool, data, 2);
    const ys = slots.map((s) => s.pose.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(DRAFT_LAYOUT.poolDepth + 1e-9);
    for (const s of slots) expect(inFrame(s.pose, 2)).toBe(true);
    const before = poolSlots([{ sid: white[0]!.id }], data, 2)[0]!.pose.x;
    const blue = CARDS.find((c) => poolColumnOf(c) === 'U')!;
    const after = poolSlots([{ sid: blue.id }, { sid: white[0]!.id }], data, 2).find((s) => s.index === 1)!.pose.x;
    expect(after).toBe(before);
  });

  it('the pool lies below the pack area, never under it', () => {
    for (const rows of [2, 3]) {
      const packBottom = rowY(rows - 1) - 44 - DRAFT_LAYOUT.fanDrop;
      expect(poolTop(rows).cardY + 44).toBeLessThan(packBottom);
      expect(poolTop(rows).labelY).toBeLessThan(packBottom);
      expect(poolTop(rows).labelY).toBeGreaterThan(poolTop(rows).cardY + 44);
    }
  });
});

describe('pack fan and grid (DESIGN "Pre-game", Drafting interaction: the current pack is a fan or grid)', () => {
  it('a 15-card pack lies in two arced rows of eight and seven, no two cards overlapping, all inside the frame', () => {
    const cards = pack(15);
    const poses = packPoses(cards, 'fan') as Pose[];
    expect(poses.every((p) => p)).toBe(true);
    const rows = new Map<number, number>();
    for (const p of poses) {
      const r = Math.round((DRAFT_LAYOUT.firstRowY - p.y) / DRAFT_LAYOUT.rowStep);
      rows.set(r, (rows.get(r) ?? 0) + 1);
    }
    expect([...rows.values()]).toEqual([8, 7]);
    for (let i = 0; i < poses.length; i++) for (let j = i + 1; j < poses.length; j++) expect(overlap(poses[i]!, poses[j]!)).toBe(false);
    for (const p of poses) expect(inFrame(p, packRows(15, 'fan'))).toBe(true);
    // A fan: outer cards turn outward and drop, the middle stays level.
    expect(poses[0]!.rot).toBeLessThan(0);
    expect(poses[7]!.rot).toBeGreaterThan(0);
  });

  it('pack order reads left to right, top row first', () => {
    const poses = packPoses(pack(10), 'fan') as Pose[];
    for (let i = 1; i < 5; i++) expect(poses[i]!.x).toBeGreaterThan(poses[i - 1]!.x);
    expect(poses[5]!.y).toBeLessThan(poses[0]!.y);
  });

  it('small and odd packs: one card is centred and level, bigger packs add rows and the pool moves down', () => {
    const [one] = packPoses(pack(1), 'fan') as Pose[];
    expect(one).toEqual({ x: DRAFT_LAYOUT.packX, y: DRAFT_LAYOUT.firstRowY, rot: 0 });
    expect(packRows(0, 'fan')).toBe(2);
    expect(packRows(16, 'fan')).toBe(2);
    expect(packRows(17, 'fan')).toBe(3);
    const big = packPoses(pack(20), 'fan') as Pose[];
    for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++) expect(overlap(big[i]!, big[j]!)).toBe(false);
    for (const p of big) expect(inFrame(p, 3)).toBe(true);
  });

  it('the grid is 3×3 row by row; taken cells leave a gap', () => {
    const cells: (DraftCard | null)[] = pack(9);
    cells[4] = null;
    const poses = packPoses(cells, 'grid');
    expect(poses[4]).toBeNull();
    expect(poses[0]!.y).toBe(poses[2]!.y);
    expect(poses[0]!.x).toBe(poses[6]!.x);
    expect(poses[3]!.y).toBeLessThan(poses[0]!.y);
    for (const p of poses) if (p) expect(inFrame(p, packRows(9, 'grid'))).toBe(true);
    const live = poses.filter((p): p is Pose => !!p);
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) expect(overlap(live[i]!, live[j]!)).toBe(false);
  });

  it('grid lines: a row is three cells across, a column three down; an emptied line cannot be taken', () => {
    expect(gridLineCells('row', 1)).toEqual([3, 4, 5]);
    expect(gridLineCells('col', 2)).toEqual([2, 5, 8]);
    const cells: (DraftCard | null)[] = pack(9);
    for (const i of gridLineCells('row', 0)) cells[i] = null;
    expect(gridLineOpen(cells, 'row', 0)).toBe(false);
    expect(gridLineOpen(cells, 'col', 0)).toBe(true);
    for (const i of gridLineCells('col', 0)) cells[i] = null;
    expect(gridLineOpen(cells, 'col', 0)).toBe(false);
    expect(gridLineOpen(cells, 'row', 1)).toBe(true);
  });

  it('waiting packs: one pile per drafting seat, in seat order, apart from each other and inside the frame', () => {
    const q = queuePlaces(['s0', 's1', 's2', 's3']);
    expect(q.map((x) => x.seat)).toEqual(['s0', 's1', 's2', 's3']);
    for (let i = 1; i < q.length; i++) expect(q[i - 1]!.pose.y - q[i]!.pose.y).toBeGreaterThanOrEqual(88 * DRAFT_LAYOUT.queueScale);
    for (const x of q) expect(inFrame({ ...x.pose }, 2)).toBe(true);
  });
});

describe('mark and confirm (DESIGN "Pre-game", Drafting interaction: click a card to mark it, click again or press Enter to confirm)', () => {
  it('one pick per pass: a click marks, a click on the marked card confirms it, a click elsewhere moves the mark', () => {
    expect(clickPick([], 1, 15, 'a')).toEqual({ kind: 'mark', cards: ['a'] });
    expect(clickPick(['a'], 1, 15, 'a')).toEqual({ kind: 'confirm', cards: ['a'] });
    expect(clickPick(['a'], 1, 15, 'b')).toEqual({ kind: 'mark', cards: ['b'] });
    expect(canConfirm([], 1, 15)).toBe(false);
    expect(canConfirm(['a'], 1, 15)).toBe(true);
  });

  it('Pick-Two: marks add up to two, a third replaces the oldest; a marked card confirms once two are marked, else unmarks', () => {
    expect(clickPick(['a'], 2, 15, 'b')).toEqual({ kind: 'mark', cards: ['a', 'b'] });
    expect(clickPick(['a', 'b'], 2, 15, 'c')).toEqual({ kind: 'mark', cards: ['b', 'c'] });
    expect(clickPick(['a', 'b'], 2, 15, 'a')).toEqual({ kind: 'confirm', cards: ['a', 'b'] });
    expect(clickPick(['a'], 2, 15, 'a')).toEqual({ kind: 'mark', cards: [] });
    expect(canConfirm(['a'], 2, 15)).toBe(false);
    expect(canConfirm(['a', 'b'], 2, 15)).toBe(true);
  });

  it('a short pack takes what is left: one card left with two picks per pass confirms one', () => {
    expect(clickPick([], 2, 1, 'z')).toEqual({ kind: 'mark', cards: ['z'] });
    expect(clickPick(['z'], 2, 1, 'z')).toEqual({ kind: 'confirm', cards: ['z'] });
    expect(canConfirm(['z'], 2, 1)).toBe(true);
    expect(canConfirm([], 1, 0)).toBe(false);
  });
});

it('the fixture card helper finds known cards', () => {
  expect(named('Aegis of the Heavens').colors).toEqual(['W']);
});

describe('foils (DESIGN "Pre-game", Pack generation: "Foils are marked with a subtle sheen and a badge"; faces are never recoloured)', () => {
  it('the badge sits in the gutter beside its card’s top strip: on no card of a pool cascade, its own or a neighbour column’s', () => {
    const refs: CardRef[] = CARDS.slice(0, 60).map((c) => ({ sid: c.id, foil: true }));
    const slots = poolSlots(refs, data, 2);
    // A badge is at most the gutter wide (the surface sizes it so), centred in the gutter.
    const half = (DRAFT_LAYOUT.colStep - 63) / 2;
    for (const s of slots) {
      const b = foilBadgeAt(s.pose);
      const badge = { x0: b.x - half + 0.5, x1: b.x + half - 0.5, y0: b.y - 4, y1: b.y + 4 };
      // Within the card's top strip, the part the next card in the cascade leaves visible.
      expect(b.y).toBeLessThanOrEqual(s.pose.y + 44);
      expect(b.y).toBeGreaterThanOrEqual(s.pose.y + 44 - DRAFT_LAYOUT.cascade);
      for (const o of slots) {
        const q = box(o.pose);
        expect(badge.x0 < q.x1 && q.x0 < badge.x1 && badge.y0 < q.y1 && q.y0 < badge.y1).toBe(false);
      }
    }
  });

  it('the sheen is a light hue that drifts with time, each card a little out of phase', () => {
    expect(foilSheenColour(0, 0)).toBe('hsl(0, 55%, 72%)');
    expect(foilSheenColour(0.5, 0)).toBe('hsl(180, 55%, 72%)');
    expect(foilSheenColour(0, 1)).not.toBe(foilSheenColour(0, 0));
    expect(foilSheenColour(1.25, 0)).toBe(foilSheenColour(0.25, 0));
  });
});
