/**
 * Temporary-move signals (DESIGN "Combat and annotation", Temporary move: a displaced card "remembers its home slot,
 * leaves a faint ghost outline there, and is drawn with a displacement marker"; "Themes and rendering": attacking is a
 * functional signal every theme renders, styled by CardDressing.ghost and CardDressing.displacedMarker).
 *
 * The ghost is a dashed outline of the card at its home pose, drawn under the cards. The marker is a chevron just
 * outside the card's edge that faces home, pointing in the direction of the displacement, drawn over the table and
 * cards. Pure geometry here (segment lists in table mm); the scene draws them with two fat-line layers.
 */
import type { Pose } from '../core/types';
import { CARD_H, CARD_W, rot2 } from './math';
import type { TablePoint } from './types';

/** A segment in table mm. */
export interface Segment {
  from: TablePoint;
  to: TablePoint;
}

/** Dash and gap of a dashed ghost outline, mm. */
export const GHOST_DASH = { dash: 4, gap: 3 } as const;
/** Displacements shorter than this (mm) draw no marker: the card is (nearly) home. */
export const MIN_DISPLACEMENT = 2;
/** Marker size bounds, mm: never smaller than MARKER_MIN on the table, never larger than MARKER_MAX. */
export const MARKER_MIN = 5;
export const MARKER_MAX = 14;
/** Marker size on screen at far zoom, CSS px. */
export const MARKER_MIN_PX = 12;

/** The outline of a card at `pose`, dashed (dash, gap) or solid, as segments. */
export function ghostSegments(pose: Pose, dashed: boolean, w = CARD_W, h = CARD_H): Segment[] {
  const corner = (u: number, v: number): TablePoint => {
    const [x, y] = rot2(u, v, pose.rot);
    return { x: pose.x + x, y: pose.y + y };
  };
  const pts = [corner(-w / 2, -h / 2), corner(w / 2, -h / 2), corner(w / 2, h / 2), corner(-w / 2, h / 2)];
  const out: Segment[] = [];
  for (let i = 0; i < 4; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % 4]!;
    if (!dashed) {
      out.push({ from: a, to: b });
      continue;
    }
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const period = GHOST_DASH.dash + GHOST_DASH.gap;
    // Centre the dash pattern on the edge so every corner looks the same.
    const n = Math.max(1, Math.round((len + GHOST_DASH.gap) / period));
    const dash = (len - (n - 1) * GHOST_DASH.gap) / n;
    for (let k = 0; k < n; k++) {
      const s = (k * (dash + GHOST_DASH.gap)) / len;
      const e = (k * (dash + GHOST_DASH.gap) + dash) / len;
      out.push({ from: { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s }, to: { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e } });
    }
  }
  return out;
}

/** Marker size in mm for a zoom level (CSS px per mm), so the marker stays legible at far zoom. */
export function markerSize(pxPerMm: number): number {
  const want = pxPerMm > 0 ? MARKER_MIN_PX / pxPerMm : MARKER_MAX;
  return Math.min(MARKER_MAX, Math.max(MARKER_MIN, Math.round(want * 2) / 2));
}

/**
 * The displacement marker of a card drawn at `pose` (displayed rotation, tap included) whose home is `home`: a chevron
 * of `size` mm whose tip sits 2 mm outside the card's edge facing home, pointing away from home. Empty when the card
 * is within MIN_DISPLACEMENT of home.
 */
export function markerSegments(home: TablePoint, pose: Pose, size: number, w = CARD_W, h = CARD_H): Segment[] {
  const dx = pose.x - home.x;
  const dy = pose.y - home.y;
  const len = Math.hypot(dx, dy);
  if (len < MIN_DISPLACEMENT) return [];
  const ux = dx / len;
  const uy = dy / len;
  const [ax, ay] = rot2(1, 0, pose.rot);
  const [bx, by] = rot2(0, 1, pose.rot);
  // Half extent of the drawn card along the displacement direction.
  const ext = (Math.abs(ux * ax + uy * ay) * w) / 2 + (Math.abs(ux * bx + uy * by) * h) / 2;
  const tip = { x: pose.x - ux * (ext + 2), y: pose.y - uy * (ext + 2) };
  const back = { x: tip.x - ux * size * 0.6, y: tip.y - uy * size * 0.6 };
  const px = -uy * (size / 2);
  const py = ux * (size / 2);
  return [
    { from: { x: back.x + px, y: back.y + py }, to: tip },
    { from: { x: back.x - px, y: back.y - py }, to: tip },
  ];
}
