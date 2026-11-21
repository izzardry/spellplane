/**
 * The geometry of a table thumbnail (docs/design/m8/visual.md V19, 2.8 "Table still"; persistence.md section 3):
 * one outlined rectangle per public battlefield card of `GameSummary.thumb` (rotated when tapped) and one disc per
 * seat at its table edge. Pure; it reads a `GameThumb` only, never a TableState or a SecretStore. Added by M8-P1.
 */
import type { GameThumb } from '../../store/types';

export interface ThumbRect {
  x: number;
  y: number;
  w: number;
  h: number;
  tapped: boolean;
  seat: number;
}
export interface ThumbDisc {
  cx: number;
  cy: number;
  seat: number;
}

/** The thumbnail's box: 16:9, centred on the thumb's frame and holding all of it, and at least `THUMB_MIN_W` wide so a
 *  frame of one or two cards still reads as a table. The still is drawn in this box at a fixed 16:9 size
 *  (visual.md 2.8: 128 × 72, 96 × 54), whatever the frame's own aspect. */
export const THUMB_MIN_W = 1050;
export function thumbBox(t: Pick<GameThumb, 'w' | 'h'>): { x: number; y: number; w: number; h: number } {
  const w = Math.max(THUMB_MIN_W, t.w, (t.h * 16) / 9);
  const h = (w * 9) / 16;
  return { x: (t.w - w) / 2, y: (t.h - h) / 2, w, h };
}

/** Card outline size in the thumb's own units: 63 × 88 for a table frame in millimetres, scaled for a small frame. */
export function thumbCardSize(t: Pick<GameThumb, 'w' | 'h'>): { w: number; h: number } {
  const w = Math.min(63, t.w * 0.06);
  return { w, h: (w * 88) / 63 };
}

/** One rectangle per card (at most 80), centred on its position, sized for the thumbnail's box. A GameThumb keeps table
 *  space's direction (y away from seat 0, docs/DESIGN.md "Table space"); SVG's y points down, so y is flipped here and
 *  seat 0's cards land in the lower half, next to its disc (`thumbDiscs`). */
export function thumbRects(t: GameThumb): ThumbRect[] {
  const s = thumbCardSize(thumbBox(t));
  return t.cards.slice(0, 80).map(([x, y, tapped, seat]) => ({ x: x - s.w / 2, y: t.h - y - s.h / 2, w: s.w, h: s.h, tapped: tapped === 1, seat }));
}

/** Seat discs at the table's edges: seat 0 bottom, 1 top, 2 left, 3 right (more seats share the bottom and top). */
export function thumbDiscs(t: Pick<GameThumb, 'w' | 'h'>, seats: number): ThumbDisc[] {
  const r = Math.min(t.w, t.h) * 0.09;
  const at = [
    { cx: t.w / 2, cy: t.h - r * 1.2 },
    { cx: t.w / 2, cy: r * 1.2 },
    { cx: r * 1.2, cy: t.h / 2 },
    { cx: t.w - r * 1.2, cy: t.h / 2 },
  ];
  return Array.from({ length: seats }, (_, i) => {
    const base = at[i % 4]!;
    const shift = Math.floor(i / 4) * r * 2.6;
    return { cx: base.cx + shift, cy: base.cy, seat: i };
  });
}
