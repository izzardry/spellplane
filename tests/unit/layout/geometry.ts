/** Oriented-rectangle geometry for the layout tests (canonical frame: y away from seat 0, rot clockwise). */
import { GEOMETRY } from '../../../src/core/geometry';
import type { Pose } from '../../../src/core/types';
import type { Rect, SeatLayout, TableLayout } from '../../../src/games/types';
import { MTG_LAYOUT } from '../../../src/games/mtg/layout';

export const EPS = 1e-6;

export interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Corners of an oriented rectangle, computed independently of src/games/frame.ts. */
export function corners(r: Rect): { x: number; y: number }[] {
  const t = (r.rot * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => {
    const u = (a! * r.w) / 2;
    const v = (b! * r.d) / 2;
    return { x: r.x + u * c + v * s, y: r.y - u * s + v * c };
  });
}

export function box(r: Rect): Box {
  const cs = corners(r);
  return { minX: Math.min(...cs.map((p) => p.x)), maxX: Math.max(...cs.map((p) => p.x)), minY: Math.min(...cs.map((p) => p.y)), maxY: Math.max(...cs.map((p) => p.y)) };
}

export const cardRect = (p: Pose): Rect => ({ x: p.x, y: p.y, rot: p.rot, w: GEOMETRY.card.w, d: GEOMETRY.card.h });

export function insideTable(layout: TableLayout, r: Rect): boolean {
  const b = box(r);
  const hw = layout.table.w / 2 + EPS;
  const hd = layout.table.d / 2 + EPS;
  return b.minX >= -hw && b.maxX <= hw && b.minY >= -hd && b.maxY <= hd;
}

export function inside(outer: Rect, inner: Rect): boolean {
  const o = box(outer);
  const i = box(inner);
  return i.minX >= o.minX - EPS && i.maxX <= o.maxX + EPS && i.minY >= o.minY - EPS && i.maxY <= o.maxY + EPS;
}

/** Positive-area overlap (layout rotations are multiples of 90°, so boxes are exact); touching edges is not overlap. */
export function overlaps(a: Rect, b: Rect): boolean {
  const p = box(a);
  const q = box(b);
  return Math.min(p.maxX, q.maxX) - Math.max(p.minX, q.minX) > EPS && Math.min(p.maxY, q.maxY) - Math.max(p.minY, q.minY) > EPS;
}

/** A seat's zone piles and command area (inside its territory). */
export function zonePieces(seat: SeatLayout): { name: string; rect: Rect }[] {
  return [
    { name: 'library', rect: cardRect(seat.zones.library) },
    { name: 'graveyard', rect: cardRect(seat.zones.graveyard) },
    { name: 'exile', rect: cardRect(seat.zones.exile) },
    { name: 'command', rect: seat.zones.command },
  ];
}

/** The avatar's footprint. */
export function avatarRect(seat: SeatLayout): Rect {
  const r = MTG_LAYOUT.avatarRadius;
  return { ...seat.zones.avatar, w: 2 * r, d: 2 * r };
}

/** A point as a viewer at `angle` sees it (rotated counter-clockwise by the viewer's seat angle), computed independently. */
export function seen(p: { x: number; y: number }, angle: number): { x: number; y: number } {
  const t = (-angle * Math.PI) / 180;
  return { x: p.x * Math.cos(t) + p.y * Math.sin(t), y: -p.x * Math.sin(t) + p.y * Math.cos(t) };
}

/** Polar angle of a point around the table centre, degrees counter-clockwise from +x. */
export const polar = (p: { x: number; y: number }): number => (Math.atan2(p.y, p.x) * 180) / Math.PI;
