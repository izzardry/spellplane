/**
 * Canonical and viewer frames (DESIGN "Specification: geometry, layout and motion": shared state stores positions in
 * one canonical frame — origin at the table centre, x to the right, y away from seat 0, rot in degrees clockwise —
 * that each viewer rotates so their own seat is at the bottom; "Players, seats and formats").
 * Game-independent; every layout of every game definition uses these helpers.
 */
import type { Pose } from '../core/types';
import type { Rect, TableLayout } from './types';

/** An angle in degrees normalised to [0, 360). */
export function normDeg(a: number): number {
  const r = ((a % 360) + 360) % 360;
  return r === 0 ? 0 : r; // no -0
}

/** cos and sin of an angle in degrees, exact for multiples of 90 so right-angle layouts carry no float noise. */
function cosSin(deg: number): [number, number] {
  const a = normDeg(deg);
  if (a === 0) return [1, 0];
  if (a === 90) return [0, 1];
  if (a === 180) return [-1, 0];
  if (a === 270) return [0, -1];
  const t = (a * Math.PI) / 180;
  return [Math.cos(t), Math.sin(t)];
}

const noNegZero = (v: number): number => (v === 0 ? 0 : v);

/**
 * Rotate a vector clockwise by `deg` as seen from above (y pointing up the screen). A seat at angle θ has its
 * right-hand axis at rotateCw((1, 0), θ) and its forward axis (away from the owner) at rotateCw((0, 1), θ).
 */
export function rotateCw(x: number, y: number, deg: number): { x: number; y: number } {
  const [c, s] = cosSin(deg);
  return { x: noNegZero(x * c + y * s), y: noNegZero(-x * s + y * c) };
}

/** A canonical pose as seen by a viewer whose seat angle is `viewerAngle`: their seat ends up at the bottom, their own cards upright (rot 0). */
export function toViewerFrame(p: Pose, viewerAngle: number): Pose {
  const v = rotateCw(p.x, p.y, -viewerAngle);
  return { x: v.x, y: v.y, rot: normDeg(p.rot - viewerAngle) };
}

/** Inverse of `toViewerFrame`: a pose in the viewer's frame back to the canonical frame. */
export function fromViewerFrame(p: Pose, viewerAngle: number): Pose {
  const v = rotateCw(p.x, p.y, viewerAngle);
  return { x: v.x, y: v.y, rot: normDeg(p.rot + viewerAngle) };
}

/** `toViewerFrame` for an oriented rectangle; size is unchanged. */
export function rectToViewerFrame(r: Rect, viewerAngle: number): Rect {
  return { ...toViewerFrame(r, viewerAngle), w: r.w, d: r.d };
}

/** `fromViewerFrame` for an oriented rectangle; size is unchanged. */
export function rectFromViewerFrame(r: Rect, viewerAngle: number): Rect {
  return { ...fromViewerFrame(r, viewerAngle), w: r.w, d: r.d };
}

/** The angle to rotate by for a viewer in seat `seatIndex`; spectators (null) and unknown seats see seat 0's view. */
export function viewerAngle(layout: TableLayout, seatIndex: number | null): number {
  if (seatIndex === null) return 0;
  const seat = layout.seats.find((s) => s.index === seatIndex);
  return seat ? seat.angle : 0;
}

/** The stack lane in the canonical frame, rotated for a viewer so it cascades toward them (DESIGN "Specification: geometry, layout and motion"). */
export function stackLaneForViewer(layout: TableLayout, seatIndex: number | null): Rect {
  return { ...layout.stackLane, rot: normDeg(layout.stackLane.rot + viewerAngle(layout, seatIndex)) };
}

/**
 * Place a point given in a seat's own orientation into the canonical frame. `origin` is the canonical centre of the
 * seat's local frame (usually its territory centre); `u` runs to the owner's right, `v` away from the owner.
 */
export function seatLocalToTable(origin: { x: number; y: number }, angle: number, u: number, v: number): { x: number; y: number } {
  const d = rotateCw(u, v, angle);
  return { x: noNegZero(origin.x + d.x), y: noNegZero(origin.y + d.y) };
}
