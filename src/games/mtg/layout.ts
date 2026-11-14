/**
 * Magic table layouts (DESIGN "Specification: geometry, layout and motion", Tables and seats; "Players, seats and
 * formats"; "Table model"; "The effect stack"). All positions are in the canonical frame: origin at the table centre,
 * x to the right and y away from seat 0, rot in degrees clockwise. Use games/frame.ts to rotate into a viewer's frame.
 *
 * Every format seats its players clockwise in seat-index order as seen from above (seat 0 at the bottom), so turn
 * order, the seat keys 2–4 ("clockwise from you") and the draft's pass to the left all follow the seat index
 * (DECISIONS [M3-P1]):
 * - 1v1: near and far halves (solo goldfish is seat 0 of this table).
 * - Three players: seated round the table at 0°, 120° and 240° (PLAN Milestone 5, owner decisions: "opponents top-left
 *   and top-right from every seat", as DESIGN's format table says; M5-P7). Every viewer sees the same shape: themselves
 *   at the bottom, the next seat clockwise at the top-left and the last at the top-right, each opponent's territory
 *   turned toward the centre. The territories are 1100 × 440 (as in the four-player table), their centres 600 from the
 *   table centre, so neighbouring territories keep a gap and the centre around the stack lane stays free; the table is
 *   the 2000 × 1800 rectangle that holds every territory (DECISIONS [M5-P7]).
 * - Four players: one 1100 × 440 territory per side, bottom, left, top, right. The spec's 1100-wide territories centred
 *   on 1800-wide sides would overlap 90 × 90 at every corner, so each is shifted 90 toward its owner's right (a
 *   pinwheel): no overlap, the 920 × 920 centre stays free, and each corner keeps a 440 × 260 unused patch.
 * - Two-Headed Giant: teammates side by side with no gap, team t0 (seats 0 and 1) on the near edge, t1 across. Seat 0
 *   sits at the near right and seat 1 at the near left, seat 2 at the far left and seat 3 at the far right, which is
 *   clockwise; the team's shared avatar (life total and turn marker) sits outside its near edge, centred.
 */
import type { Format } from '../../core/types';
import { GEOMETRY } from '../../core/geometry';
import { TABLE_FORMAT_TEAMS } from '../../core/teams';
import { normDeg, seatLocalToTable } from '../frame';
import type { Rect, SeatLayout, SeatZoneAnchors, TableLayout, TeamLayout } from '../types';

/** Within-territory placement constants in mm (the spec fixes the column gap; the rest are M0-P6 choices). */
export const MTG_LAYOUT = {
  /** Distance from the territory edges to the pile column, command area and hand row. */
  edgeMargin: 12,
  /** Gap between library, graveyard and exile in their column (DESIGN: 12 apart). */
  pileGap: GEOMETRY.pileColumnGap,
  /** Command and emblem area: room for two cards side by side plus margins. */
  command: { w: 150, d: 112 },
  /**
   * Row of card backs other viewers see for this seat's hand ("at the seat"): outside the territory's near edge, so it
   * never covers the owner's free-placement battlefield. Seven backs at half overlap (252) fit with room to spare.
   */
  handRow: { w: 420, d: GEOMETRY.card.h },
  /** Avatar centre distance outside the territory's near edge. */
  avatarOffset: 40,
  /** Half-width of the avatar's footprint, kept clear of the hand row beside it. */
  avatarRadius: 34,
  /** Four players: how far each 1100-wide territory is shifted toward its owner's right so the corners do not overlap. */
  ffa4Shift: 90,
  /**
   * Three players round the table at 0°, 120° and 240° (M5-P7): territory width, the distance of each territory's
   * centre from the table centre, and the table that holds every territory.
   */
  ffa3: { width: 1100, centreDistance: 600, table: { w: 2000, d: 1800 } },
} as const;

/** Formats whose layout is provisional. Empty since M3-P1 settled the three-, four-seat and Two-Headed Giant tables. */
export const PROVISIONAL_FORMATS: readonly Format[] = [];

/** True for a provisional layout; no format is provisional since M3-P1. */
export function isProvisionalLayout(layout: TableLayout): boolean {
  return PROVISIONAL_FORMATS.includes(layout.format);
}

interface TerritorySpec {
  x: number;
  y: number;
  angle: number;
  w: number;
  d: number;
}

const TERRITORY_DEPTH = 440;

/** The spec table: table size and one territory per seat in seat-index order (clockwise from seat 0). */
function tableSpec(format: Format): { table: { w: number; d: number }; centreBand: number; territories: TerritorySpec[] } {
  const d = TERRITORY_DEPTH;
  switch (format) {
    case '1v1': {
      // Near and far halves, 1400 x 440 each, with a 220-deep centre band.
      const y = 1100 / 2 - d / 2;
      return {
        table: { w: 1400, d: 1100 },
        centreBand: 1100 - 2 * d,
        territories: [
          { x: 0, y: -y, angle: 0, w: 1400, d },
          { x: 0, y, angle: 180, w: 1400, d },
        ],
      };
    }
    case 'ffa3': {
      // Seats at 0°, 120° and 240°, clockwise: seat 1 top-left and seat 2 top-right as seen by seat 0, and the same
      // shape from seats 1 and 2 (M5-P7). The free centre is the circle inside the three near-centre edges.
      const r = MTG_LAYOUT.ffa3.centreDistance;
      return {
        table: { ...MTG_LAYOUT.ffa3.table },
        centreBand: 2 * (r - d / 2),
        territories: [0, 120, 240].map((angle) => ({ ...seatLocalToTable({ x: 0, y: 0 }, angle, 0, -r), angle, w: MTG_LAYOUT.ffa3.width, d })),
      };
    }
    case 'ffa4': {
      // One 1100 x 440 territory per side, seats clockwise: bottom, left, top, right; each shifted toward its owner's
      // right (a pinwheel) so no two overlap at a corner. Centre 1800 - 2 x 440 = 920 square.
      const o = 1800 / 2 - d / 2;
      const shift = MTG_LAYOUT.ffa4Shift;
      return {
        table: { w: 1800, d: 1800 },
        centreBand: 1800 - 2 * d,
        territories: [0, 90, 180, 270].map((angle) => ({ ...seatLocalToTable({ x: 0, y: 0 }, angle, shift, -o), angle, w: 1100, d })),
      };
    }
    case '2hg': {
      // Teammates side by side, 1100 x 440 each, no gap; team t0 (seats 0 and 1) on the near edge, t1 across. Seats run
      // clockwise: near right, near left, far left, far right.
      const y = 1100 / 2 - d / 2;
      return {
        table: { w: 2200, d: 1100 },
        centreBand: 1100 - 2 * d,
        territories: [
          { x: 550, y: -y, angle: 0, w: 1100, d },
          { x: -550, y: -y, angle: 0, w: 1100, d },
          { x: -550, y, angle: 180, w: 1100, d },
          { x: 550, y, angle: 180, w: 1100, d },
        ],
      };
    }
  }
}

/** Zone anchors of one territory, computed in the owner's orientation (u right, v away from the owner) and placed into the canonical frame. */
function seatZones(t: TerritorySpec): SeatZoneAnchors {
  const { w: cw, h: ch } = GEOMETRY.card;
  const m = MTG_LAYOUT.edgeMargin;
  const rot = normDeg(t.angle);
  const at = (u: number, v: number): { x: number; y: number; rot: number } => ({ ...seatLocalToTable(t, t.angle, u, v), rot });
  const rect = (u: number, v: number, w: number, d: number): Rect => ({ ...at(u, v), w, d });

  // Pile column at the right edge, library nearest the owner, then graveyard, then exile, 12 apart.
  const colU = t.w / 2 - m - cw / 2;
  const libV = -t.d / 2 + m + ch / 2;
  const step = ch + MTG_LAYOUT.pileGap;

  const cmd = MTG_LAYOUT.command;
  const hand = MTG_LAYOUT.handRow;
  return {
    library: at(colU, libV),
    graveyard: at(colU, libV + step),
    exile: at(colU, libV + 2 * step),
    // Command and emblem area in the near-left corner, beside the avatar.
    command: rect(-t.w / 2 + m + cmd.w / 2, -t.d / 2 + m + cmd.d / 2, cmd.w, cmd.d),
    // Avatar with the life total outside the near edge, centred.
    avatar: at(0, -t.d / 2 - MTG_LAYOUT.avatarOffset),
    // Others see this seat's hand as a row of backs at the seat: outside the near edge, one gap away, to the owner's
    // right of the avatar. It never covers the battlefield.
    handRow: rect(MTG_LAYOUT.avatarRadius + GEOMETRY.gap + hand.w / 2, -t.d / 2 - GEOMETRY.gap - hand.d / 2, hand.w, hand.d),
  };
}

/** The Magic table layout for a format (DESIGN "Specification: code interfaces": table size, seat angles, territories, zone anchors). Returns a fresh object. */
export function mtgLayout(format: Format): TableLayout {
  const spec = tableSpec(format);
  const teamSpec = TABLE_FORMAT_TEAMS[format];
  const teamOfSeat = (index: number): number => (teamSpec ?? []).findIndex((t) => t.includes(index));
  const seats: SeatLayout[] = spec.territories.map((t, index) => ({
    index,
    angle: normDeg(t.angle),
    territory: { x: t.x, y: t.y, w: t.w, d: t.d, rot: normDeg(t.angle) },
    zones: seatZones(t),
    ...(teamSpec ? { team: teamOfSeat(index) } : {}),
  }));
  const layout: TableLayout = {
    format,
    table: { ...spec.table },
    seats,
    stackLane: stackLane(spec.centreBand),
    // Clockwise from seat 0: seat indices run clockwise in every format (DESIGN "Players, seats and formats", Turn
    // marker: per player, clockwise; per team in Two-Headed Giant, where team t0 of seat 0 goes first).
    turnOrder: seats.map((s) => s.index),
  };
  if (teamSpec) layout.teams = teamSpec.map((members, index) => teamLayout(index, members, spec.territories));
  return layout;
}

/**
 * A team's territory and shared avatar (DESIGN "Players, seats and formats", Two-Headed Giant): the teammates'
 * territories side by side along their common edge, the avatar (shared life total and turn marker) outside its near
 * edge, centred. Members are listed left to right in the team's orientation.
 */
function teamLayout(index: number, members: readonly number[], territories: readonly TerritorySpec[]): TeamLayout {
  const ts = members.map((i) => territories[i]!);
  const angle = ts[0]!.angle;
  const x = ts.reduce((a, t) => a + t.x, 0) / ts.length;
  const y = ts.reduce((a, t) => a + t.y, 0) / ts.length;
  const w = ts.reduce((a, t) => a + t.w, 0);
  const d = ts[0]!.d;
  const left = [...members].sort((a, b) => seatU(territories[a]!, angle) - seatU(territories[b]!, angle));
  return {
    index,
    seats: left,
    territory: { x, y, w, d, rot: normDeg(angle) },
    avatar: { ...seatLocalToTable({ x, y }, angle, 0, -d / 2 - MTG_LAYOUT.avatarOffset), rot: normDeg(angle) },
  };
}

/** A territory centre's coordinate along the owner's right-hand axis for a seat at `angle`. */
function seatU(t: TerritorySpec, angle: number): number {
  const a = (normDeg(angle) * Math.PI) / 180;
  return t.x * Math.cos(a) - t.y * Math.sin(a);
}

/**
 * The stack lane at the table centre. The spec's 200 x 320 lane is deeper than the 220 centre band of the 1v1 and
 * Two-Headed Giant tables, and the design says the lane "never covers a battlefield", so its depth is clamped to the
 * centre band (200 x 220 there); the cascade scrolls or collapses to its count badge once it outgrows the lane.
 */
function stackLane(centreBand: number): Rect {
  const lane = GEOMETRY.stackLane;
  return { x: 0, y: 0, w: lane.w, d: Math.min(lane.d, centreBand), rot: 0 };
}

/** Solo goldfish: the 1v1 table with seat 0 only (PLAN M0). */
export function soloLayout(): TableLayout {
  const l = mtgLayout('1v1');
  return { ...l, seats: l.seats.slice(0, 1), turnOrder: [0] };
}
