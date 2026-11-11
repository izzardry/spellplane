/**
 * Table-frame helpers for the HUD (DESIGN "Specification: geometry, layout and motion": canonical frame, seat angles
 * clockwise, a card of a seat at angle θ rests at rot = θ; attack displacement along the seat's forward axis).
 */
import { GEOMETRY } from '../core/geometry';
import type { CardInstance, InstanceId, Pose, SeatId, TableState } from '../core/types';
import type { GameDefinition, SeatLayout, TableLayout } from '../games/types';

/** The layout for the table's format, or null when the game definition cannot provide one yet. */
export function layoutOf(game: GameDefinition, state: TableState): TableLayout | null {
  try {
    return game.layout(state.format);
  } catch {
    return null;
  }
}

/** A seat's layout entry, or null. */
export function seatLayout(layout: TableLayout | null, state: TableState, seat: SeatId): SeatLayout | null {
  const index = state.seats[seat]?.index;
  if (index === undefined || !layout) return null;
  return layout.seats.find((s) => s.index === index) ?? null;
}

/** A seat's angle in degrees; without a layout seat 0 sits at 0° and every other seat across at 180°. */
export function seatAngle(layout: TableLayout | null, state: TableState, seat: SeatId): number {
  const s = seatLayout(layout, state, seat);
  if (s) return s.angle;
  return (state.seats[seat]?.index ?? 0) === 0 ? 0 : 180;
}

/** Rotate a vector clockwise by `deg` in the y-up table frame: a seat's local frame to the canonical frame. */
export function rotateCw(x: number, y: number, deg: number): { x: number; y: number } {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const rx = x * c + y * s;
  const ry = -x * s + y * c;
  return { x: Math.abs(rx) < 1e-9 ? 0 : rx, y: Math.abs(ry) < 1e-9 ? 0 : ry };
}

/** Offset a pose by a vector given in the seat's own frame (x to the seat's right, y toward the table centre). */
export function offsetLocal(pose: Pose, dx: number, dy: number, angle: number): Pose {
  const d = rotateCw(dx, dy, angle);
  return { x: round(pose.x + d.x), y: round(pose.y + d.y), rot: pose.rot };
}

/** Round to 1/1000 mm, so poses stay short and exactly reproducible as JSON. */
export function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Whether a card's zone is of `kind` (core/ids.ts convention `<kind>:<seat>`). */
export function inZoneKind(card: CardInstance, kind: string): boolean {
  return card.zone === kind || card.zone.startsWith(`${kind}:`);
}

/** Axis-aligned box in a seat's own frame (u to the seat's right, v toward the table centre), mm. */
interface LocalBox {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

/**
 * A free battlefield slot in `seat`'s territory for a card that arrives without a drop point, such as a resolved
 * permanent (DESIGN "The effect stack", Resolving 2: permanents go to the controller's battlefield; "Table model";
 * "Specification: geometry, layout and motion", Tables and seats and Within a territory). Rows run from the front
 * edge (toward the table centre) back; within a row, columns start beside the stack lane's width and alternate left
 * and right outward, so an attack (110 forward, tapped) does not land on the lane. A slot keeps the standard gap to every
 * card already there (home slots of displaced cards included), stays clear of the pile column at the right edge and
 * of the command area, and lies inside the territory. Falls back to the territory centre when the territory is full.
 * The card rests untapped at the seat's angle.
 */
export function freeSlot(state: TableState, seat: SeatId, layout: TableLayout | null, ignore: InstanceId | null = null): Pose {
  const { card: CARD, gap: GAP, pileColumnGap: COLUMN_GAP } = GEOMETRY;
  const angle = seatAngle(layout, state, seat);
  const sl = seatLayout(layout, state, seat);
  const terr = sl ? sl.territory : { ...rotateCw(0, -330, angle), w: 1400, d: 440 };
  const toLocal = (p: { x: number; y: number }) => rotateCw(p.x - terr.x, p.y - terr.y, -angle);
  const toTable = (u: number, v: number): Pose => {
    const d = rotateCw(u, v, angle);
    return { x: round(terr.x + d.x), y: round(terr.y + d.y), rot: angle };
  };
  const boxAt = (centre: { x: number; y: number }, rot: number, tapped: boolean, w: number, d: number): LocalBox => {
    const c = toLocal(centre);
    const r = ((((rot + (tapped ? 90 : 0) - angle) % 180) + 180) % 180) * (Math.PI / 180);
    const hw = (Math.abs(Math.cos(r)) * w + Math.abs(Math.sin(r)) * d) / 2;
    const hd = (Math.abs(Math.sin(r)) * w + Math.abs(Math.cos(r)) * d) / 2;
    return { u0: c.x - hw, u1: c.x + hw, v0: c.y - hd, v1: c.y + hd };
  };
  const taken: LocalBox[] = [];
  for (const id of state.zones[`battlefield:${seat}`]?.ids ?? []) {
    const c = state.cards[id];
    if (!c || id === ignore) continue;
    taken.push(boxAt(c.pose, c.pose.rot, c.tapped, CARD.w, CARD.h));
    if (c.home) taken.push(boxAt(c.home, c.home.rot, c.tapped, CARD.w, CARD.h));
  }
  // Cards of other battlefields can lie in this territory too (a stolen creature keeps its place).
  for (const c of Object.values(state.cards)) {
    if (c.id === ignore || c.zone === `battlefield:${seat}` || !c.zone.startsWith('battlefield:')) continue;
    const b = boxAt(c.pose, c.pose.rot, c.tapped, CARD.w, CARD.h);
    if (b.u1 > -terr.w / 2 && b.u0 < terr.w / 2 && b.v1 > -terr.d / 2 && b.v0 < terr.d / 2) taken.push(b);
  }
  if (sl) {
    const cmd = sl.zones.command;
    taken.push(boxAt(cmd, cmd.rot, false, cmd.w, cmd.d));
  }
  const free = (b: LocalBox) => taken.every((t) => b.u1 + GAP <= t.u0 + 1e-6 || b.u0 >= t.u1 + GAP - 1e-6 || b.v1 + GAP <= t.v0 + 1e-6 || b.v0 >= t.v1 + GAP - 1e-6);
  const laneHalf = (layout?.stackLane.w ?? GEOMETRY.stackLane.w) / 2;
  const left = -terr.w / 2 + COLUMN_GAP;
  // Leave the library/graveyard/exile column at the right edge free.
  const right = terr.w / 2 - (CARD.w + 2 * COLUMN_GAP);
  const columns: number[] = [];
  const step = CARD.w + GAP;
  // The first columns sit far enough out that the card, tapped (sideways) and 110 forward, clears the lane.
  const first = laneHalf + GAP + CARD.h / 2;
  for (let j = 0; ; j++) {
    const l = -first - j * step;
    const r = first + j * step;
    const lOk = l - CARD.w / 2 >= left;
    const rOk = r + CARD.w / 2 <= right;
    if (!lOk && !rOk) break;
    if (lOk) columns.push(l);
    if (rOk) columns.push(r);
  }
  for (let v = terr.d / 2 - GAP - CARD.h / 2; v - CARD.h / 2 >= -terr.d / 2; v -= CARD.h + GAP) {
    for (const u of columns) {
      const b = { u0: u - CARD.w / 2, u1: u + CARD.w / 2, v0: v - CARD.h / 2, v1: v + CARD.h / 2 };
      if (free(b)) return toTable(u, v);
    }
  }
  return toTable(0, 0);
}
