/**
 * M0-P6 acceptance: one- and two-seat layouts (DESIGN "Specification: geometry, layout and motion", Tables and seats;
 * "Players, seats and formats"; "Table model"; "The effect stack").
 */
import { describe, expect, it } from 'vitest';
import type { Format, Pose } from '../../../src/core/types';
import { GEOMETRY } from '../../../src/core/geometry';
import type { Rect, SeatLayout, TableLayout } from '../../../src/games/types';
import { fromViewerFrame, rectFromViewerFrame, rectToViewerFrame, stackLaneForViewer, toViewerFrame, viewerAngle } from '../../../src/games/frame';
import { MTG_LAYOUT, isProvisionalLayout, mtg, soloLayout } from '../../../src/games/mtg/index';

const EPS = 1e-6;
const CARD = { w: GEOMETRY.card.w, d: GEOMETRY.card.h };

interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Corners of an oriented rectangle in the canonical frame (rot clockwise, y away from seat 0). */
function corners(r: Rect): { x: number; y: number }[] {
  const t = (r.rot * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => {
    const u = ((a as number) * r.w) / 2;
    const v = ((b as number) * r.d) / 2;
    // Clockwise rotation as seen from above with y pointing up the screen.
    return { x: r.x + u * c + v * s, y: r.y - u * s + v * c };
  });
}

function box(r: Rect): Box {
  const cs = corners(r);
  return {
    minX: Math.min(...cs.map((p) => p.x)),
    maxX: Math.max(...cs.map((p) => p.x)),
    minY: Math.min(...cs.map((p) => p.y)),
    maxY: Math.max(...cs.map((p) => p.y)),
  };
}

const cardRect = (p: Pose): Rect => ({ x: p.x, y: p.y, rot: p.rot, w: CARD.w, d: CARD.d });

function insideTable(layout: TableLayout, r: Rect): boolean {
  const b = box(r);
  const hw = layout.table.w / 2 + EPS;
  const hd = layout.table.d / 2 + EPS;
  return b.minX >= -hw && b.maxX <= hw && b.minY >= -hd && b.maxY <= hd;
}

function inside(outer: Rect, inner: Rect): boolean {
  const o = box(outer);
  const i = box(inner);
  return i.minX >= o.minX - EPS && i.maxX <= o.maxX + EPS && i.minY >= o.minY - EPS && i.maxY <= o.maxY + EPS;
}

/** Positive-area overlap; touching edges is not overlap. All layout rotations are multiples of 90°, so boxes are exact. */
function overlaps(a: Rect, b: Rect): boolean {
  const p = box(a);
  const q = box(b);
  return Math.min(p.maxX, q.maxX) - Math.max(p.minX, q.minX) > EPS && Math.min(p.maxY, q.maxY) - Math.max(p.minY, q.minY) > EPS;
}

/** Everything a seat places inside its territory, in the canonical frame. */
function territoryPieces(seat: SeatLayout): { name: string; rect: Rect }[] {
  return [
    { name: 'library', rect: cardRect(seat.zones.library) },
    { name: 'graveyard', rect: cardRect(seat.zones.graveyard) },
    { name: 'exile', rect: cardRect(seat.zones.exile) },
    { name: 'command', rect: seat.zones.command },
  ];
}

/** Everything a seat places, including the hand row of backs at the seat (outside the territory). */
function seatPieces(seat: SeatLayout): { name: string; rect: Rect }[] {
  return [...territoryPieces(seat), { name: 'handRow', rect: seat.zones.handRow }];
}

/** The avatar's footprint: a square of the avatar radius around its centre. */
function avatarRect(seat: SeatLayout): Rect {
  const r = MTG_LAYOUT.avatarRadius;
  return { ...seat.zones.avatar, w: 2 * r, d: 2 * r };
}

/** A pose seen by the seat's owner, relative to its territory: u to the owner's right, v away from the owner. */
function ownerLocal(seat: SeatLayout, p: { x: number; y: number }): { u: number; v: number } {
  const t = toViewerFrame({ x: p.x, y: p.y, rot: 0 }, seat.angle);
  const c = toViewerFrame({ x: seat.territory.x, y: seat.territory.y, rot: 0 }, seat.angle);
  return { u: t.x - c.x, v: t.y - c.y };
}

const LAYOUTS: { name: string; layout: () => TableLayout }[] = [
  { name: 'one seat (solo on the 1v1 table)', layout: () => soloLayout() },
  { name: '1v1', layout: () => mtg.layout('1v1') },
];

describe('1v1 table geometry from the spec table', () => {
  const l = mtg.layout('1v1');
  it('is 1400 x 1100 with seats at 0° and 180°', () => {
    expect(l.format).toBe('1v1');
    expect(l.table).toEqual({ w: 1400, d: 1100 });
    expect(l.seats.map((s) => s.angle)).toEqual([0, 180]);
    expect(l.seats.map((s) => s.index)).toEqual([0, 1]);
  });
  it('has 1400 x 440 territories at the near and far halves with a 220-deep centre band', () => {
    const [s0, s1] = l.seats as [SeatLayout, SeatLayout];
    expect(s0.territory.w).toBe(1400);
    expect(s0.territory.d).toBe(440);
    expect(s1.territory.w).toBe(1400);
    expect(s1.territory.d).toBe(440);
    const b0 = box(s0.territory);
    const b1 = box(s1.territory);
    // Seat 0 at the bottom (y negative), seat 1 across.
    expect(b0.minY).toBeCloseTo(-550);
    expect(b1.maxY).toBeCloseTo(550);
    expect(b1.minY - b0.maxY).toBeCloseTo(220);
    expect(s0.territory.rot).toBe(0);
    expect(((s1.territory.rot % 360) + 360) % 360).toBe(180);
  });
  it('puts the stack lane at the table centre, 200 wide and clamped to the 220-deep centre band (spec 320 would cover both battlefields)', () => {
    expect(l.stackLane).toMatchObject({ x: 0, y: 0, w: 200, d: 220 });
    expect(insideTable(l, l.stackLane)).toBe(true);
    const [s0, s1] = l.seats as [SeatLayout, SeatLayout];
    expect(box(l.stackLane).minY).toBeCloseTo(box(s0.territory).maxY);
    expect(box(l.stackLane).maxY).toBeCloseTo(box(s1.territory).minY);
  });
  it('is not provisional', () => {
    expect(isProvisionalLayout(l)).toBe(false);
    expect(isProvisionalLayout(soloLayout())).toBe(false);
  });
});

describe('one-seat layout', () => {
  it('is the 1v1 table with seat 0 only', () => {
    const solo = soloLayout();
    const full = mtg.layout('1v1');
    expect(solo.table).toEqual(full.table);
    expect(solo.seats).toHaveLength(1);
    expect(solo.seats[0]).toEqual(full.seats[0]);
    expect(solo.stackLane).toEqual(full.stackLane);
  });
});

describe.each(LAYOUTS)('$name: everything lies inside the table and nothing overlaps', ({ layout }) => {
  const l = layout();

  it('every territory lies inside the table', () => {
    for (const s of l.seats) expect(insideTable(l, s.territory)).toBe(true);
  });

  it('territories do not overlap', () => {
    for (const a of l.seats) for (const b of l.seats) if (a !== b) expect(overlaps(a.territory, b.territory)).toBe(false);
  });

  it('every zone pile and the command area lie inside the table and inside their own territory', () => {
    for (const s of l.seats) {
      for (const p of territoryPieces(s)) {
        expect(insideTable(l, p.rect), `${p.name} of seat ${s.index}`).toBe(true);
        expect(inside(s.territory, p.rect), `${p.name} of seat ${s.index}`).toBe(true);
      }
    }
  });

  it("a seat's piles, command area and hand row do not overlap each other", () => {
    for (const s of l.seats) {
      const ps = seatPieces(s);
      for (const a of ps) for (const b of ps) if (a !== b) expect(overlaps(a.rect, b.rect), `${a.name} vs ${b.name}`).toBe(false);
    }
  });

  it("piles rest upright for their owner (rot = seat angle) and the hand row and command area face the owner", () => {
    for (const s of l.seats) {
      for (const p of [s.zones.library, s.zones.graveyard, s.zones.exile]) expect(p.rot).toBe(s.angle);
      expect(s.zones.command.rot).toBe(s.angle);
      expect(s.zones.handRow.rot).toBe(s.angle);
      expect(s.zones.avatar.rot).toBe(s.angle);
    }
  });
});

describe.each(LAYOUTS)('$name: zone placement within a territory, in the owner orientation', ({ layout }) => {
  const l = layout();

  it('library, graveyard and exile stand in a column at the right edge, library nearest the owner, 12 apart', () => {
    for (const s of l.seats) {
      const half = s.territory.w / 2;
      const lib = ownerLocal(s, s.zones.library);
      const gy = ownerLocal(s, s.zones.graveyard);
      const ex = ownerLocal(s, s.zones.exile);
      // One column: same u.
      expect(gy.u).toBeCloseTo(lib.u);
      expect(ex.u).toBeCloseTo(lib.u);
      // At the right edge: the column's right side is the territory's right side less a small margin.
      expect(lib.u).toBeGreaterThan(half - CARD.w);
      expect(lib.u + CARD.w / 2).toBeLessThanOrEqual(half + EPS);
      // Library nearest the owner (smallest v), then graveyard, then exile, card edges 12 apart.
      expect(lib.v).toBeLessThan(gy.v);
      expect(gy.v).toBeLessThan(ex.v);
      expect(gy.v - lib.v - CARD.d).toBeCloseTo(GEOMETRY.pileColumnGap);
      expect(ex.v - gy.v - CARD.d).toBeCloseTo(12);
      // Library near the owner's edge of the territory.
      expect(lib.v - CARD.d / 2).toBeLessThan(-s.territory.d / 2 + CARD.w);
    }
  });

  it('the command area is at the left edge', () => {
    for (const s of l.seats) {
      const c = ownerLocal(s, s.zones.command);
      const left = c.u - s.zones.command.w / 2;
      expect(left).toBeGreaterThanOrEqual(-s.territory.w / 2 - EPS);
      expect(left).toBeLessThan(-s.territory.w / 2 + CARD.w);
      expect(s.zones.command.w).toBeGreaterThanOrEqual(CARD.w);
      expect(s.zones.command.d).toBeGreaterThanOrEqual(CARD.d);
    }
  });

  it('the avatar sits outside the near edge, centred', () => {
    for (const s of l.seats) {
      const a = ownerLocal(s, s.zones.avatar);
      expect(a.u).toBeCloseTo(0);
      expect(a.v).toBeLessThan(-s.territory.d / 2);
    }
  });

  it("the hand row for others' card backs sits at the seat, just outside the owner's near edge, and holds at least seven backs at half overlap", () => {
    for (const s of l.seats) {
      const h = ownerLocal(s, s.zones.handRow);
      const near = -s.territory.d / 2;
      // Outside the near edge, one standard gap away.
      expect(h.v + s.zones.handRow.d / 2).toBeCloseTo(near - GEOMETRY.gap);
      // Within the territory's width.
      expect(Math.abs(h.u) + s.zones.handRow.w / 2).toBeLessThanOrEqual(s.territory.w / 2 + EPS);
      expect(s.zones.handRow.d).toBeGreaterThanOrEqual(CARD.d);
      expect(s.zones.handRow.w).toBeGreaterThanOrEqual(CARD.w + 6 * (CARD.w / 2));
    }
  });
});

const ALL_LAYOUTS: { name: string; layout: () => TableLayout }[] = [
  ...LAYOUTS,
  ...(['ffa3', 'ffa4', '2hg'] as const).map((f) => ({ name: f, layout: () => mtg.layout(f) })),
];

describe.each(ALL_LAYOUTS)('$name: the stack lane and the hand rows never cover a battlefield', ({ layout }) => {
  const l = layout();

  it('the stack lane, as any viewer sees it, overlaps no territory', () => {
    for (const viewer of [null, ...l.seats.map((s) => s.index)]) {
      const lane = stackLaneForViewer(l, viewer);
      for (const s of l.seats) expect(overlaps(lane, s.territory), `viewer ${viewer} vs seat ${s.index}`).toBe(false);
    }
  });

  it('the stack lane lies inside the table', () => {
    expect(insideTable(l, l.stackLane)).toBe(true);
  });

  it('every hand row overlaps no territory, no other hand row, no avatar and not the stack lane', () => {
    for (const s of l.seats) {
      const h = s.zones.handRow;
      for (const o of l.seats) {
        expect(overlaps(h, o.territory), `hand row of seat ${s.index} vs territory of seat ${o.index}`).toBe(false);
        expect(overlaps(h, avatarRect(o)), `hand row of seat ${s.index} vs avatar of seat ${o.index}`).toBe(false);
        if (o !== s) expect(overlaps(h, o.zones.handRow), `hand rows of seats ${s.index} and ${o.index}`).toBe(false);
      }
      expect(overlaps(h, l.stackLane)).toBe(false);
    }
  });
});

describe('viewer frame', () => {
  it.each([0, 1])('viewer rotation puts seat %i at the bottom of its own view', (index) => {
    const l = mtg.layout('1v1');
    const seat = l.seats[index] as SeatLayout;
    const angle = viewerAngle(l, index);
    expect(angle).toBe(seat.angle);
    const t = rectToViewerFrame(seat.territory, angle);
    // Centre below the table centre, upright for the viewer.
    expect(t.x).toBeCloseTo(0);
    expect(t.y).toBeCloseTo(-330);
    expect(t.rot).toBe(0);
    // Every other seat is above it.
    for (const other of l.seats) {
      if (other === seat) continue;
      expect(rectToViewerFrame(other.territory, angle).y).toBeGreaterThan(0);
    }
    // The own library is at the viewer's right, upright.
    const lib = toViewerFrame(seat.zones.library, angle);
    expect(lib.x).toBeGreaterThan(0);
    expect(lib.rot).toBe(0);
    // The own avatar is below the table's near edge.
    expect(toViewerFrame(seat.zones.avatar, angle).y).toBeLessThan(-l.table.d / 2);
  });

  it('a spectator (no seat) sees seat 0 at the bottom', () => {
    const l = mtg.layout('1v1');
    expect(viewerAngle(l, null)).toBe(0);
  });

  it.each([0, 1, null])('the stack lane is rotated for viewer %s so it cascades toward them', (index) => {
    const l = mtg.layout('1v1');
    const lane = stackLaneForViewer(l, index);
    expect(lane).toMatchObject({ x: 0, y: 0, w: 200, d: 220 });
    expect(rectToViewerFrame(lane, viewerAngle(l, index))).toMatchObject({ x: 0, y: 0, w: 200, d: 220, rot: 0 });
  });

  it('round-trips poses through any viewer angle and keeps rot in [0, 360)', () => {
    const poses: Pose[] = [
      { x: 0, y: 0, rot: 0 },
      { x: 123.5, y: -456.25, rot: 90 },
      { x: -700, y: 550, rot: 270 },
      { x: 10, y: 20, rot: 37 },
    ];
    for (const angle of [0, 90, 180, 270, -90, 450]) {
      for (const p of poses) {
        const v = toViewerFrame(p, angle);
        expect(v.rot).toBeGreaterThanOrEqual(0);
        expect(v.rot).toBeLessThan(360);
        const back = fromViewerFrame(v, angle);
        expect(back.x).toBeCloseTo(p.x, 9);
        expect(back.y).toBeCloseTo(p.y, 9);
        expect(back.rot).toBeCloseTo(((p.rot % 360) + 360) % 360, 9);
        const r = rectFromViewerFrame(rectToViewerFrame({ ...p, w: 63, d: 88 }, angle), angle);
        expect(r.x).toBeCloseTo(p.x, 9);
        expect(r.w).toBe(63);
      }
    }
  });

  it('is exact for right angles (no floating-point noise in shared positions)', () => {
    expect(toViewerFrame({ x: 100, y: 200, rot: 0 }, 180)).toEqual({ x: -100, y: -200, rot: 180 });
    expect(toViewerFrame({ x: 100, y: 200, rot: 0 }, 90)).toEqual({ x: -200, y: 100, rot: 270 });
    expect(Object.is(toViewerFrame({ x: 0, y: 0, rot: 0 }, 180).x, -0)).toBe(false);
  });

  it('a seat at 90° (left side, as seen by seat 0) is brought to the bottom', () => {
    // A point at the left edge of the canonical frame lands at the bottom of a viewer seated at 90°.
    const p = toViewerFrame({ x: -680, y: 0, rot: 90 }, 90);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(-680);
    expect(p.rot).toBe(0);
  });
});

describe('the territory and anchors are canonical-frame positions in plain JSON', () => {
  it('round-trips through JSON unchanged', () => {
    const l = mtg.layout('1v1');
    expect(JSON.parse(JSON.stringify(l))).toEqual(l);
  });
  it('returns a fresh object each call, so callers cannot corrupt later layouts', () => {
    const a = mtg.layout('1v1');
    a.seats[0]!.territory.x = 999;
    expect(mtg.layout('1v1').seats[0]!.territory.x).toBe(0);
  });
});

describe('multi-seat layouts follow the spec table (settled by M3-P1; its own tests are in tests/unit/layout)', () => {
  const cases: { format: Format; table: { w: number; d: number }; angles: number[]; laneDepth: number }[] = [
    { format: 'ffa3', table: { w: 2000, d: 1300 }, angles: [0, 180, 180], laneDepth: 320 },
    { format: 'ffa4', table: { w: 1800, d: 1800 }, angles: [0, 90, 180, 270], laneDepth: 320 },
    { format: '2hg', table: { w: 2200, d: 1100 }, angles: [0, 0, 180, 180], laneDepth: 220 },
  ];
  it.each(cases)('$format', ({ format, table, angles, laneDepth }) => {
    const l = mtg.layout(format);
    expect(isProvisionalLayout(l)).toBe(false);
    expect(l.format).toBe(format);
    expect(l.table).toEqual(table);
    expect(l.seats.map((s) => s.angle)).toEqual(angles);
    expect(l.stackLane).toMatchObject({ x: 0, y: 0, w: 200, d: laneDepth });
    for (const s of l.seats) {
      expect(insideTable(l, s.territory)).toBe(true);
      for (const p of territoryPieces(s)) expect(inside(s.territory, p.rect), `${format} seat ${s.index} ${p.name}`).toBe(true);
      for (const o of l.seats) {
        if (o === s) continue;
        // The four-player territories are shifted toward their owners' right (a pinwheel), so none overlap.
        expect(overlaps(s.territory, o.territory)).toBe(false);
        for (const p of seatPieces(s)) expect(overlaps(p.rect, o.territory), `${format} seat ${s.index} ${p.name} in seat ${o.index}`).toBe(false);
      }
      // Each viewer still sees their own seat at the bottom.
      const t = rectToViewerFrame(s.territory, viewerAngle(l, s.index));
      expect(t.y).toBeLessThan(0);
      expect(t.rot).toBe(0);
    }
  });

  it('Two-Headed Giant teammates have adjoining territories with no gap', () => {
    const l = mtg.layout('2hg');
    const [a, b, c, d] = l.seats.map((s) => box(s.territory)) as [Box, Box, Box, Box];
    expect(Math.min(Math.abs(a.maxX - b.minX), Math.abs(b.maxX - a.minX))).toBeCloseTo(0);
    expect(Math.min(Math.abs(c.maxX - d.minX), Math.abs(d.maxX - c.minX))).toBeCloseTo(0);
    expect(a.minY).toBeCloseTo(b.minY);
    expect(c.minY).toBeCloseTo(d.minY);
  });

  it('three players: seat 0 spans the near edge, seats 1 and 2 share the far edge 1000 wide each, top-left then top-right', () => {
    const l = mtg.layout('ffa3');
    const [s0, s1, s2] = l.seats as [SeatLayout, SeatLayout, SeatLayout];
    expect(s0.territory.w).toBe(2000);
    expect(s1.territory.w).toBe(1000);
    expect(s2.territory.w).toBe(1000);
    expect(s1.territory.x).toBeLessThan(0);
    expect(s2.territory.x).toBeGreaterThan(0);
  });
});
