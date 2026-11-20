/**
 * Where each seat's edge shows on screen (scene/types.ts SeatAnchor; docs/design/m7-hud-proposal.md, Opponent plate:
 * "at the opponent's edge of the table"; PLAN M7-P2 "life plates at seat edges"): the midpoint of the seat's table
 * edge, projected through the camera and clamped into the viewport, with the screen direction pointing out of the
 * table there. M7-P3 reports it whenever the camera settles (never per frame); the HUD places the plates. Pure maths.
 */
import type { Rect } from '../../games/types';
import { clamp, forward, rectPoint } from '../math';
import type { CameraPose, ScreenPoint, TablePoint } from '../types';
import { projectPoint, type Viewport } from './pose';

/** A seat edge on the canvas (CSS px relative to the canvas). */
export interface CanvasSeatAnchor {
  /** The edge's midpoint, clamped into the viewport; null when it lies behind the camera. */
  at: ScreenPoint | null;
  /** Screen direction out of the table at the edge, degrees clockwise from up. */
  outwardDeg: number;
}

/** The midpoint of a seat's table edge: the near edge of its territory, in the seat's own orientation. */
export function seatEdgeMid(territory: Rect): TablePoint {
  return rectPoint(territory, 0, -territory.d / 2);
}

/**
 * The anchor of a seat's edge under a pose: its midpoint projected (clamped into the viewport) and the outward screen
 * direction (the seat's backward axis on screen). A seat behind the camera (first person: one's own edge can lie below
 * the view) still gets a clamped point when any of its edge shows, else null.
 */
export function seatAnchorOf(pose: CameraPose, viewerAngleDeg: number, vp: Viewport, territory: Rect, seatAngleDeg: number): CanvasSeatAnchor {
  const mid = seatEdgeMid(territory);
  const f = forward(seatAngleDeg);
  const out: TablePoint = { x: mid.x - f.x * 50, y: mid.y - f.y * 50 };
  const a = projectPoint(pose, viewerAngleDeg, vp, [mid.x, mid.y, 0]);
  const b = projectPoint(pose, viewerAngleDeg, vp, [out.x, out.y, 0]);
  const inward: TablePoint = { x: mid.x + f.x * 50, y: mid.y + f.y * 50 };
  const c = projectPoint(pose, viewerAngleDeg, vp, [inward.x, inward.y, 0]);
  let outwardDeg = 0;
  if (Number.isFinite(a.x) && Number.isFinite(b.x)) outwardDeg = deg(b.x - a.x, b.y - a.y);
  else if (Number.isFinite(a.x) && Number.isFinite(c.x)) outwardDeg = deg(a.x - c.x, a.y - c.y);
  const at = Number.isFinite(a.x) && Number.isFinite(a.y) ? { x: clamp(a.x, 0, vp.w), y: clamp(a.y, 0, vp.h) } : null;
  return { at, outwardDeg };
}

/** A screen vector's direction, degrees clockwise from up, in [0, 360). */
function deg(dx: number, dy: number): number {
  const d = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return ((d % 360) + 360) % 360;
}
