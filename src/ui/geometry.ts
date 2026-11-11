/**
 * Table-frame helpers for the HUD (DESIGN "Specification: geometry, layout and motion": canonical frame, seat angles
 * clockwise, a card of a seat at angle θ rests at rot = θ; attack displacement along the seat's forward axis).
 */
import type { CardInstance, Pose, SeatId, TableState } from '../core/types';
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
