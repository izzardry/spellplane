/**
 * Table-space geometry helpers (DESIGN "Specification: geometry, layout and motion", Table space).
 * Millimetres, canonical frame: x to the right, y away from seat 0; rotations in degrees clockwise.
 * Pure functions, no Three.js, so they are unit-testable in Node.
 */
import { GEOMETRY } from '../core/geometry';
import type { Pose } from '../core/types';
import type { Rect } from '../games/types';
import type { TablePoint } from './types';

export const DEG = Math.PI / 180;
export const CARD_W = GEOMETRY.card.w;
export const CARD_H = GEOMETRY.card.h;

/** Rotate (x, y) clockwise by `deg` degrees. rot2(0, 1, 90) = (1, 0). */
export function rot2(x: number, y: number, deg: number): [number, number] {
  const r = deg * DEG;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [x * c + y * s, -x * s + y * c];
}

/** The unit vector a seat at angle `deg` faces (toward the table centre for its own territory). */
export function forward(deg: number): TablePoint {
  const [x, y] = rot2(0, 1, deg);
  return { x, y };
}

/** Degrees normalised to [0, 360). */
export function normDeg(d: number): number {
  let n = d % 360;
  if (n < 0) n += 360;
  // Avoid -0 and floating noise like 359.9999999.
  return n >= 360 - 1e-9 || Math.abs(n) < 1e-9 ? 0 : n;
}

/** The signed difference to - from in (-180, 180]. */
export function deltaDeg(from: number, to: number): number {
  let d = normDeg(to - from);
  if (d > 180) d -= 360;
  return d;
}

/** Half extents of a card's axis-aligned box in a frame rotated by `frameDeg` (the card rotated by `rot`). */
export function cardHalfExtents(rot: number, frameDeg = 0, w = CARD_W, h = CARD_H): { hw: number; hh: number } {
  const rel = (rot - frameDeg) * DEG;
  const c = Math.abs(Math.cos(rel));
  const s = Math.abs(Math.sin(rel));
  // Snap tiny trig noise so 90 degree boxes have exact extents.
  const cc = c < 1e-9 ? 0 : c > 1 - 1e-9 ? 1 : c;
  const ss = s < 1e-9 ? 0 : s > 1 - 1e-9 ? 1 : s;
  return { hw: (cc * w + ss * h) / 2, hh: (ss * w + cc * h) / 2 };
}

/** Whether a table point lies on a card at `pose` (oriented box test). */
export function pointInCard(p: TablePoint, pose: Pose, w: number = CARD_W, h: number = CARD_H): boolean {
  const [lx, ly] = rot2(p.x - pose.x, p.y - pose.y, -pose.rot);
  return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2;
}

/** Whether a table point lies inside an oriented rectangle. */
export function pointInRect(p: TablePoint, r: Rect): boolean {
  const [lx, ly] = rot2(p.x - r.x, p.y - r.y, -r.rot);
  return Math.abs(lx) <= r.w / 2 && Math.abs(ly) <= r.d / 2;
}

/** A point of a rect's local frame (x along w, y along d, centred) in table coordinates. */
export function rectPoint(r: Rect, lx: number, ly: number): TablePoint {
  const [x, y] = rot2(lx, ly, r.rot);
  return { x: r.x + x, y: r.y + y };
}

/** The four corners of a card at `pose` in table coordinates, counter-clockwise from bottom-left (card frame). */
export function cardCorners(pose: Pose, w: number = CARD_W, h: number = CARD_H): TablePoint[] {
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([u, v]) => {
    const [x, y] = rot2(u!, v!, pose.rot);
    return { x: pose.x + x, y: pose.y + y };
  });
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
