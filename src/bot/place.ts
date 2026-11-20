/**
 * Poses in Sparring's own territory (computer.md 3.1, C2): a land row along the back of the territory, a creature row
 * in front of it, both left to right (as Sparring sees them) one card and a gap apart, wrapping to a further row at the
 * territory width; attack and block displacement. Pure.
 */
import { GEOMETRY } from '../core/geometry';
import type { Format, Pose } from '../core/types';
import { normDeg, seatLocalToTable } from '../games/frame';
import { MTG_LAYOUT, mtgLayout } from '../games/mtg/layout';
import type { Rect } from '../games/types';

const { w: CW, h: CH } = GEOMETRY.card;
const STEP = CW + GEOMETRY.gap;
const round = (v: number): number => Math.round(v * 1000) / 1000;

/** A seat's territory in the canonical frame (centre, size, angle). */
export function territoryOf(format: Format, seatIndex: number): Rect {
  try {
    const s = mtgLayout(format).seats.find((x) => x.index === seatIndex);
    if (s) return s.territory;
  } catch {
    /* fall through */
  }
  return seatIndex === 0 ? { x: 0, y: -330, w: 1400, d: 440, rot: 0 } : { x: 0, y: 330, w: 1400, d: 440, rot: 180 };
}

/** Local (u right, v away from the owner) to the canonical frame, with the seat's rotation. */
export function toTable(t: Rect, u: number, v: number): Pose {
  const p = seatLocalToTable(t, t.rot, u, v);
  return { x: round(p.x), y: round(p.y), rot: normDeg(t.rot) };
}

/** The canonical frame to the seat's local frame. */
export function toLocal(t: Rect, p: { x: number; y: number }): { u: number; v: number } {
  const a = (-t.rot * Math.PI) / 180;
  const dx = p.x - t.x;
  const dy = p.y - t.y;
  // Inverse of seatLocalToTable's clockwise rotation.
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { u: dx * c + dy * s, v: -dx * s + dy * c };
}

/** Slots of a row family: rows from `v0` stepping toward the centre, columns left to right inside the free width. */
function slots(t: Rect, v0: number, rows: number): { u: number; v: number }[] {
  const m = MTG_LAYOUT.edgeMargin;
  const left = -t.w / 2 + m + MTG_LAYOUT.command.w + GEOMETRY.gap + CW / 2;
  const right = t.w / 2 - m - CW - GEOMETRY.gap - CW / 2;
  const out: { u: number; v: number }[] = [];
  for (let r = 0; r < rows; r++) for (let u = left; u <= right + 0.001; u += STEP) out.push({ u, v: v0 + r * (CH + GEOMETRY.gap) });
  return out;
}

/** The back row's v (lands) and the first creature row's v. */
export function rowsOf(t: Rect): { land: number; creature: number } {
  const land = -t.d / 2 + MTG_LAYOUT.edgeMargin + CH / 2;
  return { land, creature: land + CH + GEOMETRY.gap };
}

/**
 * The first free slot of the land row (or the creature rows) given the poses of the own cards already on the
 * battlefield (a slot within half a card of one is taken). Falls back to the last slot when every slot is taken.
 */
export function freePose(format: Format, seatIndex: number, taken: readonly Pose[], kind: 'land' | 'creature'): Pose {
  const t = territoryOf(format, seatIndex);
  const rows = rowsOf(t);
  const list = kind === 'land' ? slots(t, rows.land, 1).concat(slots(t, rows.creature + 2 * (CH + GEOMETRY.gap), 1)) : slots(t, rows.creature, 2);
  const used = taken.map((p) => toLocal(t, p));
  for (const s of list) if (!used.some((q) => Math.abs(q.u - s.u) < CW / 2 && Math.abs(q.v - s.v) < CH / 2)) return toTable(t, s.u, s.v);
  const last = list[list.length - 1]!;
  return toTable(t, last.u, last.v);
}

/** Whether `p` lies inside the seat's territory. */
export function inside(format: Format, seatIndex: number, p: { x: number; y: number }): boolean {
  const t = territoryOf(format, seatIndex);
  const l = toLocal(t, p);
  return Math.abs(l.u) <= t.w / 2 + 0.001 && Math.abs(l.v) <= t.d / 2 + 0.001;
}

/** An attacker's displaced pose: its home moved toward the opponent (GEOMETRY.attackDisplacement). */
export function attackPose(home: Pose, seatRot: number): Pose {
  const d = seatLocalToTable({ x: 0, y: 0 }, seatRot, 0, GEOMETRY.attackDisplacement);
  return { x: round(home.x + d.x), y: round(home.y + d.y), rot: home.rot };
}

/** A blocker's pose in front of an attacker, toward the blocking seat (the scene's fan of one: GEOMETRY.blockerDistance). */
export function blockPose(attacker: Pose, blockerRot: number, keepRot: number): Pose {
  const d = seatLocalToTable({ x: 0, y: 0 }, blockerRot, 0, -GEOMETRY.blockerDistance);
  return { x: round(attacker.x + d.x), y: round(attacker.y + d.y), rot: keepRot };
}
