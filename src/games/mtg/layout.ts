/**
 * Magic table layouts (DESIGN "Specification: geometry, layout and motion", Tables and seats; "Players, seats and
 * formats"; "Table model"; "The effect stack"). All positions are in the canonical frame: origin at the table centre,
 * x to the right and y away from seat 0, rot in degrees clockwise. Use games/frame.ts to rotate into a viewer's frame.
 *
 * 1v1 (and solo goldfish, which is seat 0 of the 1v1 table) is final. Three- and four-player and Two-Headed Giant
 * layouts are PROVISIONAL until M3-P1: they follow the spec table so nothing crashes, but are not tuned.
 */
import type { Format } from '../../core/types';
import { GEOMETRY } from '../../core/geometry';
import { normDeg, seatLocalToTable } from '../frame';
import type { Rect, SeatLayout, SeatZoneAnchors, TableLayout } from '../types';

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
} as const;

/** Formats whose layout is provisional until M3-P1. */
export const PROVISIONAL_FORMATS: readonly Format[] = ['ffa3', 'ffa4', '2hg'];

/** True for the provisional three-, four-seat and Two-Headed Giant layouts (M3-P1 replaces them). */
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

/** The spec table: table size and one territory per seat in seat-index order. */
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
      // PROVISIONAL (M3-P1). Seat 0 on the near edge at full width; seats 1 and 2 share the far edge, 1000 wide each,
      // seat 1 top-left and seat 2 top-right as seen by seat 0 (clockwise order).
      const y = 1300 / 2 - d / 2;
      return {
        table: { w: 2000, d: 1300 },
        centreBand: 1300 - 2 * d,
        territories: [
          { x: 0, y: -y, angle: 0, w: 2000, d },
          { x: -500, y, angle: 180, w: 1000, d },
          { x: 500, y, angle: 180, w: 1000, d },
        ],
      };
    }
    case 'ffa4': {
      // PROVISIONAL (M3-P1). One 1100 x 440 territory per side, seats clockwise: bottom, left, top, right.
      // The spec's numbers overlap 90 x 90 at each corner (1100 + 2 x 440 > 1800) although it calls the corners
      // unused; kept as specified until M3-P1 settles it (docs/DECISIONS.md).
      const o = 1800 / 2 - d / 2;
      return {
        table: { w: 1800, d: 1800 },
        centreBand: 1800 - 2 * d,
        territories: [
          { x: 0, y: -o, angle: 0, w: 1100, d },
          { x: -o, y: 0, angle: 90, w: 1100, d },
          { x: 0, y: o, angle: 180, w: 1100, d },
          { x: o, y: 0, angle: 270, w: 1100, d },
        ],
      };
    }
    case '2hg': {
      // PROVISIONAL (M3-P1). Teammates side by side, 1100 x 440 each, no gap; team of seats 0 and 1 on the near edge.
      // Each seat is on its team's left in its own orientation.
      const y = 1100 / 2 - d / 2;
      return {
        table: { w: 2200, d: 1100 },
        centreBand: 1100 - 2 * d,
        territories: [
          { x: -550, y: -y, angle: 0, w: 1100, d },
          { x: 550, y: -y, angle: 0, w: 1100, d },
          { x: 550, y, angle: 180, w: 1100, d },
          { x: -550, y, angle: 180, w: 1100, d },
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
  const seats: SeatLayout[] = spec.territories.map((t, index) => ({
    index,
    angle: normDeg(t.angle),
    territory: { x: t.x, y: t.y, w: t.w, d: t.d, rot: normDeg(t.angle) },
    zones: seatZones(t),
  }));
  return { format, table: { ...spec.table }, seats, stackLane: stackLane(spec.centreBand) };
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
  return { ...l, seats: l.seats.slice(0, 1) };
}
