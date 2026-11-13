/**
 * The table as the camera rigs see it (DESIGN "Camera and navigation"; "Specification: geometry, layout and motion",
 * Camera rigs: the ego seat stands behind "the viewer's table edge", zoom reaches "the whole table plus a 5% margin",
 * and the point under the cursor is held for points on the table, not over the surround). M5-P7.
 *
 * A rectangle centred on the table centre, turned by `rot` degrees clockwise (absent: 0, the layout's own table). Every
 * format whose seats sit at right angles uses the layout's table as it is. The three-player table seats its players at
 * 0°, 120° and 240° (PLAN Milestone 5, owner decisions: opponents top-left and top-right from every seat), so a
 * rectangle fixed in the canonical frame would stand at a slant for two of them; the scene hands each viewer the same
 * rectangle turned to their own seat instead (scene/layout.ts cameraTable), so every viewer's camera sees the same
 * table: the same fit, the same ego seat, the same reach (DECISIONS [M5-P7]). Pure maths.
 */
import { clamp, rot2 } from '../math';
import type { TablePoint } from '../types';

/** The camera's table: w × d mm centred on the table centre, turned by `rot` degrees clockwise. */
export interface CameraTable {
  w: number;
  d: number;
  rot?: number;
}

/** A table point in the table rectangle's own frame (x along its width, y along its depth). */
export function toTableLocal(p: TablePoint, t: CameraTable): TablePoint {
  if (!t.rot) return { x: p.x, y: p.y };
  const [x, y] = rot2(p.x, p.y, -t.rot);
  return { x, y };
}

/** Back from the table rectangle's own frame to the canonical frame. */
export function fromTableLocal(p: TablePoint, t: CameraTable): TablePoint {
  if (!t.rot) return { x: p.x, y: p.y };
  const [x, y] = rot2(p.x, p.y, t.rot);
  return { x, y };
}

/** Whether a point lies on the table (within `eps` mm of it), not over the surround. */
export function onCameraTable(p: TablePoint, t: CameraTable, eps = 0): boolean {
  const q = toTableLocal(p, t);
  return Math.abs(q.x) <= t.w / 2 + eps && Math.abs(q.y) <= t.d / 2 + eps;
}

/** The nearest table point to `p`. */
export function clampToTable(p: TablePoint, t: CameraTable): TablePoint {
  const q = toTableLocal(p, t);
  return fromTableLocal({ x: clamp(q.x, -t.w / 2, t.w / 2), y: clamp(q.y, -t.d / 2, t.d / 2) }, t);
}

/** The table's four corners in the canonical frame. */
export function tableCorners(t: CameraTable): TablePoint[] {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => fromTableLocal({ x: (a! * t.w) / 2, y: (b! * t.d) / 2 }, t));
}
