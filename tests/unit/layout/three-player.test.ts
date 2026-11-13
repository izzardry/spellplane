/**
 * PLAN Milestone 5, owner decisions: "Three-player layout: opponents top-left and top-right from every seat, as DESIGN's
 * format table says. Seats 2 and 3 currently see one opponent beside them on their own edge; that changes so every
 * viewer sees the same shape." DESIGN "Players, seats and formats": every viewer sees their own seat at the bottom;
 * three players: "You at the bottom, opponents at top-left and top-right"; turn order per player, clockwise.
 * "Specification: geometry, layout and motion": shared state stores positions in one canonical frame that each viewer
 * rotates so their own seat is at the bottom (so state hashes never depend on the viewer).
 *
 * The geometry itself is in tables.test.ts; these tests check the same shape through what each viewer's camera shows
 * (the fitted bird's-eye view and the default ego view), that the state stays viewer-independent, and that a table saved
 * with the earlier three-player geometry still loads and shows every card.
 */
import { describe, expect, it } from 'vitest';
import { stateHash } from '../../../src/core/hash';
import type { Pose, SeatId, TableState } from '../../../src/core/types';
import { fromViewerFrame, toViewerFrame } from '../../../src/games/frame';
import { mtg } from '../../../src/games/mtg/index';
import type { TableLayout } from '../../../src/games/types';
import { TableRig, lateralOf } from '../../../src/scene/camera/rig';
import { cameraTable, fitFrame, placeCards, rightAngled, viewerAngle } from '../../../src/scene/layout';
import { EGO_FRAMING_VIEWPORTS, type ViewState } from '../../../src/scene/types';
import { play, readyTable } from '../core/helpers';
import { insideTable } from './geometry';

const SEATS: SeatId[] = ['s0', 's1', 's2'];
const VIEW: ViewState = { selection: [], hovered: null, privateFaces: {}, reducedMotion: true, pings: [], openPile: null };

/** A three-player table with every chair taken and one creature in front of each seat (a00, b00, c00). */
function threePlayers(): { s: TableState; layout: TableLayout } {
  const layout = mtg.layout('ffa3');
  let s = readyTable(4, 'ffa3', 3);
  SEATS.forEach((seat, i) => {
    const sl = layout.seats[i]!;
    // 150 toward the centre from the territory centre, in the seat's own orientation.
    const p = fromViewerFrame({ x: 0, y: 150, rot: 0 }, sl.angle);
    s = play(s, `${'abc'[i]}00`, { x: sl.territory.x + p.x, y: sl.territory.y + p.y, rot: sl.angle }, seat);
  });
  return { s, layout };
}

/** A rig as the table scene builds it for `viewer` (scene/table-scene.ts: camera table, fit frame, seat offset). */
function rigFor(s: TableState, layout: TableLayout, viewer: SeatId, rig: 'birdseye' | 'ego', vp: { width: number; height: number }): TableRig {
  const angle = viewerAngle(s, layout, viewer);
  const sl = layout.seats[s.seats[viewer]!.index]!;
  const r = new TableRig({ table: cameraTable(layout, angle), viewport: { w: vp.width, h: vp.height }, angle, inertiaMs: 325, rig, lateral: lateralOf(sl.territory, sl.angle) });
  r.setTable(cameraTable(layout, angle), angle, fitFrame(s, layout, viewer), lateralOf(sl.territory, sl.angle));
  return r;
}

describe('three players: every viewer sees the same shape through their camera', () => {
  const { s, layout } = threePlayers();

  it('the camera table is turned to each viewer at the three-player table only', () => {
    expect(rightAngled(layout)).toBe(false);
    expect(SEATS.map((v) => cameraTable(layout, viewerAngle(s, layout, v)))).toEqual([
      { w: 2000, d: 1800 },
      { w: 2000, d: 1800, rot: 120 },
      { w: 2000, d: 1800, rot: 240 },
    ]);
    for (const f of ['1v1', 'ffa4', '2hg'] as const) {
      const l = mtg.layout(f);
      expect(rightAngled(l)).toBe(true);
      for (const sl of l.seats) expect(cameraTable(l, sl.angle)).toEqual({ ...l.table });
    }
  });

  it("the fitted frame is the same box in every viewer's own frame", () => {
    const boxes = SEATS.map((v) => {
      const f = fitFrame(s, layout, v);
      const angle = viewerAngle(s, layout, v);
      const c = toViewerFrame({ x: f.x, y: f.y, rot: 0 }, angle);
      return { x: c.x, y: c.y, w: f.w, d: f.d, rot: (f.rot ?? 0) - angle };
    });
    for (const b of boxes.slice(1)) {
      expect(b.x).toBeCloseTo(boxes[0]!.x, 6);
      expect(b.y).toBeCloseTo(boxes[0]!.y, 6);
      expect(b.w).toBeCloseTo(boxes[0]!.w, 6);
      expect(b.d).toBeCloseTo(boxes[0]!.d, 6);
      expect(b.rot).toBeCloseTo(0, 6);
    }
  });

  for (const rig of ['birdseye', 'ego'] as const) {
    for (const vp of EGO_FRAMING_VIEWPORTS) {
      it(`${rig} at ${vp.width}x${vp.height}: own seat at the bottom, the next seat clockwise top-left, the last top-right, identical on screen from every seat`, () => {
        // Where viewer v sees seat (v + k)'s territory, avatar, library and creature, k = 0 (self), 1 (next), 2 (last).
        const seen = SEATS.map((v, vi) => {
          const r = rigFor(s, layout, v, rig, vp);
          return [0, 1, 2].map((k) => {
            const i = (vi + k) % 3;
            const sl = layout.seats[i]!;
            const cardPose = s.cards[`${'abc'[i]}00`]!.pose;
            return [sl.territory, sl.zones.avatar, sl.zones.library, cardPose].map((p) => r.tableToScreen(p));
          });
        });
        const [self, next, last] = seen[0]!;
        // Self at the bottom centre, the next seat clockwise at the top-left, the last at the top-right.
        expect(self![0]!.y).toBeGreaterThan(next![0]!.y);
        expect(self![0]!.y).toBeGreaterThan(last![0]!.y);
        expect(next![0]!.x).toBeLessThan(self![0]!.x);
        expect(last![0]!.x).toBeGreaterThan(self![0]!.x);
        expect(Math.abs(self![0]!.x - vp.width / 2)).toBeLessThan(vp.width * 0.15);
        for (let v = 1; v < 3; v++) {
          for (let k = 0; k < 3; k++) {
            seen[v]![k]!.forEach((p, j) => {
              // Within a hundredth of a pixel (card poses are stored quantised to a thousandth of a millimetre).
              expect(p.x, `viewer s${v}, seat +${k}, point ${j}`).toBeCloseTo(seen[0]![k]![j]!.x, 2);
              expect(p.y, `viewer s${v}, seat +${k}, point ${j}`).toBeCloseTo(seen[0]![k]![j]!.y, 2);
            });
          }
        }
      });
    }
  }
});

describe('three players: the shared state stays viewer-independent', () => {
  it('a place in front of each seat is stored in the canonical frame; each owner sees theirs where seat 0 sees its own', () => {
    const { s, layout } = threePlayers();
    const own = SEATS.map((seat, i) => toViewerFrame(s.cards[`${'abc'[i]}00`]!.pose, layout.seats[i]!.angle));
    // Equal up to the state's quantisation of poses (a thousandth of a millimetre).
    for (const p of own.slice(1)) {
      expect(p.x).toBeCloseTo(own[0]!.x, 2);
      expect(p.y).toBeCloseTo(own[0]!.y, 2);
      expect(p.rot).toBeCloseTo(own[0]!.rot, 2);
    }
  });

  it('drawing the table for any viewer, or for a spectator, never changes the state or its hash', async () => {
    const { s, layout } = threePlayers();
    const before = await stateHash(s);
    const json = JSON.stringify(s);
    for (const viewer of [...SEATS, null]) {
      const placed = placeCards(s, VIEW, { game: mtg, layout, viewerSeat: viewer });
      expect(placed.size).toBeGreaterThan(0);
      fitFrame(s, layout, viewer);
    }
    expect(JSON.stringify(s)).toBe(json);
    expect(await stateHash(s)).toBe(before);
  });
});

describe('three players: a table saved with the earlier geometry still loads', () => {
  it("cards at the old far-edge seats' places (rot 180) lie on the new table and are drawn for every viewer", () => {
    const layout = mtg.layout('ffa3');
    let s = readyTable(4, 'ffa3', 3);
    // The pre-M5 geometry: seat 0 on the near edge 2000 wide, seats 1 and 2 on the far edge (x -500 and 500, y 430).
    const old: Record<SeatId, Pose[]> = {
      s0: [{ x: -900, y: -600, rot: 0 }, { x: 900, y: -250, rot: 0 }],
      s1: [{ x: -950, y: 640, rot: 180 }, { x: -60, y: 220, rot: 180 }],
      s2: [{ x: 60, y: 220, rot: 180 }, { x: 950, y: 640, rot: 180 }],
    };
    SEATS.forEach((seat, i) => old[seat]!.forEach((pose, k) => (s = play(s, `${'abc'[i]}0${k}`, pose, seat))));
    for (const seat of SEATS) for (const pose of old[seat]!) expect(insideTable(layout, { ...pose, w: 63, d: 88 })).toBe(true);
    for (const viewer of [...SEATS, null]) {
      const placed = placeCards(s, VIEW, { game: mtg, layout, viewerSeat: viewer });
      for (const seat of SEATS) for (let k = 0; k < 2; k++) expect(placed.get(`${'abc'[SEATS.indexOf(seat)]}0${k}`)?.rest).toEqual(old[seat]![k]);
    }
  });
});
