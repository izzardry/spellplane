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

/** Card outline size in the thumb's own units: 63 × 88 for a table frame in millimetres, scaled for a small frame. */
export function thumbCardSize(t: Pick<GameThumb, 'w' | 'h'>): { w: number; h: number } {
  const w = Math.min(63, t.w * 0.06);
  return { w, h: (w * 88) / 63 };
}

/** One rectangle per card (at most 80), centred on its position. */
export function thumbRects(t: GameThumb): ThumbRect[] {
  const s = thumbCardSize(t);
  return t.cards.slice(0, 80).map(([x, y, tapped, seat]) => ({ x: x - s.w / 2, y: y - s.h / 2, w: s.w, h: s.h, tapped: tapped === 1, seat }));
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
