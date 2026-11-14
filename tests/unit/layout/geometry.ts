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

/** Whether `inner` lies inside `outer` (oriented rectangles: every corner of `inner` inside `outer`, M5-P7's 120° seats). */
export function inside(outer: Rect, inner: Rect): boolean {
  const t = (outer.rot * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return corners(inner).every((p) => {
    // Into outer's own frame (inverse of `corners`).
    const dx = p.x - outer.x;
    const dy = p.y - outer.y;
    const u = dx * c - dy * s;
    const v = dx * s + dy * c;
    return Math.abs(u) <= outer.w / 2 + EPS && Math.abs(v) <= outer.d / 2 + EPS;
  });
}

/** Positive-area overlap of two oriented rectangles (separating axes); touching edges is not overlap. */
export function overlaps(a: Rect, b: Rect): boolean {
  const ca = corners(a);
  const cb = corners(b);
  const axes = [ca, cb].flatMap((cs) => [0, 1].map((i) => ({ x: cs[i + 1]!.x - cs[i]!.x, y: cs[i + 1]!.y - cs[i]!.y })));
  for (const ax of axes) {
    const n = Math.hypot(ax.x, ax.y) || 1;
    const proj = (cs: { x: number; y: number }[]) => cs.map((p) => (p.x * ax.x + p.y * ax.y) / n);
    const pa = proj(ca);
    const pb = proj(cb);
    if (Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)) <= EPS) return false;
  }
  return true;
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
