/**
 * M3-P1 acceptance, geometry (DESIGN "Specification: geometry, layout and motion", Tables and seats; "Players, seats and
 * formats"; "Table model"): for each format every seat's territory and zone piles lie inside the table and do not
 * overlap; each viewer sees their own seat at the bottom; seats, and so turn order and the seat keys, run clockwise.
 */
import { describe, expect, it } from 'vitest';
import { GEOMETRY } from '../../../src/core/geometry';
import { TABLE_FORMAT_SEATS } from '../../../src/core/teams';
import type { Format } from '../../../src/core/types';
import { rectToViewerFrame, stackLaneForViewer, toViewerFrame, viewerAngle } from '../../../src/games/frame';
import { isProvisionalLayout, mtg, soloLayout } from '../../../src/games/mtg/index';
import type { SeatLayout, TableLayout } from '../../../src/games/types';
import { avatarRect, box, cardRect, type Box, inside, insideTable, overlaps, polar, seen, zonePieces } from './geometry';

const FORMATS: Format[] = ['1v1', 'ffa3', 'ffa4', '2hg'];
const LAYOUTS: { name: string; layout: () => TableLayout }[] = [...FORMATS.map((f) => ({ name: f, layout: () => mtg.layout(f) })), { name: 'solo', layout: () => soloLayout() }];

describe('the spec table of tables and seats', () => {
  const cases: { format: Format; table: { w: number; d: number }; angles: number[]; widths: number[] }[] = [
    { format: '1v1', table: { w: 1400, d: 1100 }, angles: [0, 180], widths: [1400, 1400] },
    { format: 'ffa3', table: { w: 2000, d: 1300 }, angles: [0, 180, 180], widths: [2000, 1000, 1000] },
    { format: 'ffa4', table: { w: 1800, d: 1800 }, angles: [0, 90, 180, 270], widths: [1100, 1100, 1100, 1100] },
    { format: '2hg', table: { w: 2200, d: 1100 }, angles: [0, 0, 180, 180], widths: [1100, 1100, 1100, 1100] },
  ];
  it.each(cases)('$format: table size, one seat per chair, seat angles and 440-deep territories', ({ format, table, angles, widths }) => {
    const l = mtg.layout(format);
    expect(l.format).toBe(format);
    expect(l.table).toEqual(table);
    expect(l.seats).toHaveLength(TABLE_FORMAT_SEATS[format]);
    expect(l.seats.map((s) => s.index)).toEqual(angles.map((_, i) => i));
    expect(l.seats.map((s) => s.angle)).toEqual(angles);
    expect(l.seats.map((s) => s.territory.w)).toEqual(widths);
    for (const s of l.seats) {
      expect(s.territory.d).toBe(440);
      // Each territory is turned to its owner and its near edge lies on the table edge behind the owner.
      expect(s.territory.rot).toBe(s.angle);
      const near = seen({ x: s.territory.x, y: s.territory.y }, s.angle).y - s.territory.d / 2;
      const edge = s.angle % 180 === 0 ? l.table.d / 2 : l.table.w / 2;
      expect(near).toBeCloseTo(-edge, 6);
    }
    expect(isProvisionalLayout(l)).toBe(false);
  });

  it('three players: seat 0 spans the whole near edge; seats 1 and 2 share the far edge, top-left and top-right', () => {
    const [s0, s1, s2] = mtg.layout('ffa3').seats as [SeatLayout, SeatLayout, SeatLayout];
    const near = (b: Box, want: Partial<Box>) => {
      for (const [k, v] of Object.entries(want)) expect(b[k as keyof Box], k).toBeCloseTo(v, 6);
    };
    near(box(s0.territory), { minX: -1000, maxX: 1000, minY: -650 });
    near(box(s1.territory), { minX: -1000, maxX: 0, maxY: 650 });
    near(box(s2.territory), { minX: 0, maxX: 1000, maxY: 650 });
  });

  it('four players: one territory per side (bottom, left, top, right) and the 920 x 920 centre is free', () => {
    const l = mtg.layout('ffa4');
    const sides = l.seats.map((s) => box(s.territory));
    expect(sides[0]!.minY).toBeCloseTo(-900);
    expect(sides[1]!.minX).toBeCloseTo(-900);
    expect(sides[2]!.maxY).toBeCloseTo(900);
    expect(sides[3]!.maxX).toBeCloseTo(900);
    const centre = { x: 0, y: 0, w: 920, d: 920, rot: 0 };
    for (const s of l.seats) expect(overlaps(s.territory, centre), `seat ${s.index}`).toBe(false);
    // Every territory reaches the centre square's edge (440 deep from its table edge).
    for (const b of sides) expect(Math.min(Math.abs(b.maxY), Math.abs(b.minY), Math.abs(b.maxX), Math.abs(b.minX))).toBeCloseTo(460);
  });

  it('Two-Headed Giant: teammates side by side with no gap on one long edge, the opposing team across', () => {
    const l = mtg.layout('2hg');
    const b = l.seats.map((s) => box(s.territory));
    // Team t0 = seats 0 and 1 on the near edge, t1 = seats 2 and 3 on the far edge.
    expect(l.seats.map((s) => s.team)).toEqual([0, 0, 1, 1]);
    expect(b[0]!.minY).toBeCloseTo(-550);
    expect(b[1]!.minY).toBeCloseTo(-550);
    expect(b[2]!.maxY).toBeCloseTo(550);
    expect(b[3]!.maxY).toBeCloseTo(550);
    // Adjoining: one shared edge, no gap and no overlap.
    for (const [x, y] of [
      [0, 1],
      [2, 3],
    ] as const) {
      const gap = Math.min(Math.abs(b[x]!.maxX - b[y]!.minX), Math.abs(b[y]!.maxX - b[x]!.minX));
      expect(gap).toBeCloseTo(0);
      expect(overlaps(l.seats[x]!.territory, l.seats[y]!.territory)).toBe(false);
    }
  });

  it('Two-Headed Giant teams: their territory is both teammates together, the shared avatar outside its near edge, centred', () => {
    const l = mtg.layout('2hg');
    expect(l.teams).toHaveLength(2);
    for (const t of l.teams!) {
      const members = t.seats.map((i) => l.seats[i]!);
      expect(members.every((m) => m.team === t.index)).toBe(true);
      const tb = box(t.territory);
      const mb = members.map((m) => box(m.territory));
      expect(tb.minX).toBeCloseTo(Math.min(...mb.map((x) => x.minX)));
      expect(tb.maxX).toBeCloseTo(Math.max(...mb.map((x) => x.maxX)));
      expect(tb.minY).toBeCloseTo(Math.min(...mb.map((x) => x.minY)));
      expect(tb.maxY).toBeCloseTo(Math.max(...mb.map((x) => x.maxY)));
      const a = seen(t.avatar, members[0]!.angle);
      const c = seen(t.territory, members[0]!.angle);
      expect(a.x).toBeCloseTo(c.x);
      expect(a.y).toBeLessThan(c.y - t.territory.d / 2);
      expect(insideTable(l, t.territory)).toBe(true);
      // Members are listed left to right as the team sees its own edge.
      const xs = members.map((m) => seen(m.territory, m.angle).x);
      expect(xs[0]).toBeLessThan(xs[1]!);
    }
    for (const f of ['1v1', 'ffa3', 'ffa4'] as const) expect(mtg.layout(f).teams).toBeUndefined();
  });
});

describe.each(LAYOUTS)('$name: territories and zone piles lie inside the table and do not overlap', ({ layout }) => {
  const l = layout();

  it('every territory lies inside the table, and no two overlap', () => {
    for (const s of l.seats) {
      expect(insideTable(l, s.territory), `seat ${s.index}`).toBe(true);
      for (const o of l.seats) if (o !== s) expect(overlaps(s.territory, o.territory), `seats ${s.index} and ${o.index}`).toBe(false);
    }
  });

  it("every seat's library, graveyard, exile and command area lie inside the table and inside its own territory", () => {
    for (const s of l.seats) {
      for (const p of zonePieces(s)) {
        expect(insideTable(l, p.rect), `${p.name} of seat ${s.index}`).toBe(true);
        expect(inside(s.territory, p.rect), `${p.name} of seat ${s.index}`).toBe(true);
      }
    }
  });

  it('no zone pile overlaps another pile, of its own seat or any other', () => {
    const all = l.seats.flatMap((s) => zonePieces(s).map((p) => ({ ...p, seat: s.index })));
    for (const a of all) for (const b of all) if (a !== b) expect(overlaps(a.rect, b.rect), `seat ${a.seat} ${a.name} vs seat ${b.seat} ${b.name}`).toBe(false);
  });

  it("no seat's piles, hand row or avatar reach into another seat's territory", () => {
    for (const s of l.seats) {
      const mine = [...zonePieces(s), { name: 'handRow', rect: s.zones.handRow }, { name: 'avatar', rect: avatarRect(s) }];
      for (const o of l.seats) {
        if (o === s) continue;
        for (const p of mine) expect(overlaps(p.rect, o.territory), `seat ${s.index} ${p.name} in seat ${o.index}`).toBe(false);
      }
    }
  });

  it('hand rows and avatars sit outside the table edge, clear of each other', () => {
    const outside = l.seats.flatMap((s) => [
      { name: `hand row ${s.index}`, rect: s.zones.handRow },
      { name: `avatar ${s.index}`, rect: avatarRect(s) },
    ]);
    for (const a of outside) for (const b of outside) if (a !== b) expect(overlaps(a.rect, b.rect), `${a.name} vs ${b.name}`).toBe(false);
    for (const s of l.seats) {
      const near = seen(s.zones.avatar, s.angle).y;
      const edge = s.angle % 180 === 0 ? l.table.d / 2 : l.table.w / 2;
      expect(near).toBeLessThan(-edge);
    }
  });

  it('the stack lane lies inside the table, clear of every territory, however a viewer turns it', () => {
    for (const viewer of [null, ...l.seats.map((s) => s.index)]) {
      const lane = stackLaneForViewer(l, viewer);
      expect(insideTable(l, lane)).toBe(true);
      for (const s of l.seats) expect(overlaps(lane, s.territory), `viewer ${viewer} vs seat ${s.index}`).toBe(false);
    }
  });

  it('the pile column stands at the right edge, library nearest the owner, 12 apart; command at the left; avatar centred outside', () => {
    for (const s of l.seats) {
      const local = (p: { x: number; y: number }) => {
        const q = seen(p, s.angle);
        const c = seen(s.territory, s.angle);
        return { u: q.x - c.x, v: q.y - c.y };
      };
      const [lib, gy, ex] = [s.zones.library, s.zones.graveyard, s.zones.exile].map(local) as [{ u: number; v: number }, { u: number; v: number }, { u: number; v: number }];
      expect(gy.u).toBeCloseTo(lib.u);
      expect(ex.u).toBeCloseTo(lib.u);
      expect(lib.u).toBeGreaterThan(s.territory.w / 2 - GEOMETRY.card.w);
      expect(gy.v - lib.v - GEOMETRY.card.h).toBeCloseTo(12);
      expect(ex.v - gy.v - GEOMETRY.card.h).toBeCloseTo(12);
      expect(lib.v).toBeLessThan(gy.v);
      const cmd = local(s.zones.command);
      expect(cmd.u - s.zones.command.w / 2).toBeLessThan(-s.territory.w / 2 + GEOMETRY.card.w);
      const av = local(s.zones.avatar);
      expect(av.u).toBeCloseTo(0);
      expect(av.v).toBeLessThan(-s.territory.d / 2);
      for (const p of [s.zones.library, s.zones.graveyard, s.zones.exile]) expect(p.rot).toBe(s.angle);
    }
  });
});

describe.each(LAYOUTS)('$name: each viewer sees their own seat at the bottom', ({ layout }) => {
  const l = layout();

  it.each(l.seats.map((s) => s.index))('viewer in seat %i', (index) => {
    const own = l.seats[index]!;
    const angle = viewerAngle(l, index);
    expect(angle).toBe(own.angle);
    const t = rectToViewerFrame(own.territory, angle);
    // Upright, below the centre, centred on the table's near edge.
    expect(t.rot).toBe(0);
    expect(t.y).toBeLessThan(0);
    const turned = angle % 180 !== 0;
    const nearEdge = (turned ? l.table.w : l.table.d) / 2;
    expect(t.y - t.d / 2).toBeCloseTo(-nearEdge, 6);
    // No other seat reaches below the own seat: it sits further up, or beside it on the same near edge (a teammate in
    // Two-Headed Giant, the other far-edge seat of the three-player table).
    for (const o of l.seats) {
      if (o === own) continue;
      const ot = rectToViewerFrame(o.territory, angle);
      expect(box(ot).minY, `seat ${o.index}`).toBeGreaterThanOrEqual(t.y - t.d / 2 - 1e-6);
      expect(ot.y, `seat ${o.index}`).toBeGreaterThanOrEqual(t.y - 1e-6);
      if (Math.abs(ot.y - t.y) < 1e-6) expect(overlaps(ot, t), `seat ${o.index} beside the own seat`).toBe(false);
    }
    // The own piles are upright for the viewer, at the right; the own avatar under the near edge.
    const lib = toViewerFrame(own.zones.library, angle);
    expect(lib.rot).toBe(0);
    expect(lib.x).toBeGreaterThan(t.x);
    expect(toViewerFrame(own.zones.avatar, angle).y).toBeLessThan(-nearEdge);
    // The stack lane cascades toward the viewer.
    expect(rectToViewerFrame(stackLaneForViewer(l, index), angle).rot).toBe(0);
  });

  it('a spectator (no seat) sees the table as seat 0 does', () => {
    expect(viewerAngle(l, null)).toBe(l.seats[0]!.angle);
  });
});

describe('opponents as each viewer sees them (DESIGN "Players, seats and formats", Layout from your view)', () => {
  it('three players: seat 0 sees its opponents at the top-left and the top-right, in clockwise order', () => {
    const l = mtg.layout('ffa3');
    const angle = viewerAngle(l, 0);
    const [me, a, b] = l.seats.map((s) => seen(s.territory, angle)) as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
    expect(a.y).toBeGreaterThan(me.y);
    expect(b.y).toBeGreaterThan(me.y);
    expect(a.x).toBeLessThan(0);
    expect(b.x).toBeGreaterThan(0);
  });

  it('three players: seats 1 and 2 (which share the far edge, per the spec table) each see themselves at the bottom, seat 0 across', () => {
    const l = mtg.layout('ffa3');
    for (const index of [1, 2]) {
      const angle = viewerAngle(l, index);
      const mine = seen(l.seats[index]!.territory, angle);
      const other = seen(l.seats[3 - index]!.territory, angle);
      const zero = seen(l.seats[0]!.territory, angle);
      expect(mine.y).toBeLessThan(0);
      expect(zero.y).toBeGreaterThan(0);
      expect(other.y).toBeCloseTo(mine.y);
      // Clockwise from the viewer: seat 1 has seat 2 on its left (next), seat 2 has seat 0 next and seat 1 on its right.
      if (index === 1) expect(other.x).toBeLessThan(mine.x);
      else expect(other.x).toBeGreaterThan(mine.x);
    }
  });

  it('four players: from every seat the next seat clockwise is on the left, the one across at the top, the last on the right', () => {
    const l = mtg.layout('ffa4');
    for (const me of l.seats) {
      const angle = viewerAngle(l, me.index);
      const [left, top, right] = [1, 2, 3].map((k) => seen(l.seats[(me.index + k) % 4]!.territory, angle));
      expect(left!.x).toBeLessThan(-400);
      expect(top!.y).toBeGreaterThan(400);
      expect(right!.x).toBeGreaterThan(400);
    }
  });

  it('Two-Headed Giant: from every seat the teammate is beside it on the near edge and the opposing team across', () => {
    const l = mtg.layout('2hg');
    for (const me of l.seats) {
      const angle = viewerAngle(l, me.index);
      const mine = seen(me.territory, angle);
      for (const o of l.seats) {
        if (o === me) continue;
        const p = seen(o.territory, angle);
        if (o.team === me.team) expect(p.y).toBeCloseTo(mine.y);
        else expect(p.y).toBeGreaterThan(0);
      }
    }
  });
});

describe('turn order and seat keys run clockwise (DESIGN "Players, seats and formats", Turn marker; "Camera and navigation")', () => {
  it.each(FORMATS)('%s: seat indices go round the table clockwise as seen from above', (format) => {
    const l = mtg.layout(format);
    expect(l.turnOrder).toEqual(l.seats.map((s) => s.index));
    const order = l.turnOrder!.map((i) => polar(l.seats[i]!.territory));
    // Clockwise: each next seat's polar angle is smaller (mod 360), and one lap covers exactly 360°.
    let total = 0;
    for (let i = 0; i < order.length; i++) {
      const step = (((order[i]! - order[(i + 1) % order.length]!) % 360) + 360) % 360;
      expect(step, `${format} seat ${l.turnOrder![i]} to the next`).toBeGreaterThan(0);
      expect(step).toBeLessThan(360);
      total += step;
    }
    expect(total).toBeCloseTo(360);
  });

  it('Two-Headed Giant: turns go team by team, the team of the first listed seat first', () => {
    const l = mtg.layout('2hg');
    const teamOrder = l.turnOrder!.map((i) => l.seats[i]!.team).filter((t, i, a) => a.indexOf(t) === i);
    expect(teamOrder).toEqual([0, 1]);
    expect(l.seats[l.turnOrder![0]!]!.team).toBe(0);
  });

  it('solo: one seat in the turn order', () => {
    expect(soloLayout().turnOrder).toEqual([0]);
  });
});

describe('cards rest upright for their owner (DESIGN "Specification: geometry, layout and motion", Table space)', () => {
  it.each(FORMATS)('%s: a card at its seat angle is upright for its owner and tapped turns it a quarter clockwise', (format) => {
    const l = mtg.layout(format);
    for (const s of l.seats) {
      const p = toViewerFrame({ x: s.territory.x, y: s.territory.y, rot: s.angle }, s.angle);
      expect(p.rot).toBe(0);
      expect(toViewerFrame({ x: 0, y: 0, rot: s.angle + 90 }, s.angle).rot).toBe(90);
      // A pile anchor is a card rectangle within the territory in the owner's frame too.
      expect(inside(rectToViewerFrame(s.territory, s.angle), rectToViewerFrame(cardRect(s.zones.library), s.angle))).toBe(true);
    }
  });
});
