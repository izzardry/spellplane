// Shared fixtures for the camera rig tests (M4-P1): table sizes and seat angles from DESIGN "Specification: geometry,
// layout and motion", Tables and seats; a rig at rest in either camera.
import { TableRig } from '../../../src/scene/camera/rig';
import { projectPoint } from '../../../src/scene/camera/pose';
import type { CameraPose, CameraRig, ScreenPoint, TablePoint } from '../../../src/scene/types';

export const VP = { w: 1440, h: 900 };
export const TABLES = {
  '1v1': { w: 1400, d: 1100 },
  ffa3: { w: 2000, d: 1300 },
  ffa4: { w: 1800, d: 1800 },
  '2hg': { w: 2200, d: 1100 },
} as const;
/** The spec's blend duration (DESIGN "Specification: geometry, layout and motion", Camera rigs: 400 ms). */
export const BLEND_MS = 400;

export function makeRig(o: { rig?: CameraRig; angle?: number; table?: { w: number; d: number }; tiltDeg?: number; lateral?: number } = {}): TableRig {
  const table = o.table ?? TABLES['1v1'];
  return new TableRig({ table, viewport: VP, angle: o.angle ?? 0, inertiaMs: 325, rig: o.rig ?? 'birdseye', tiltDeg: o.tiltDeg ?? 0, lateral: o.lateral ?? 0 });
}

/** Screen point of a table point under a pose. */
export function screenOf(pose: CameraPose, angle: number, p: TablePoint): ScreenPoint {
  const s = projectPoint(pose, angle, VP, [p.x, p.y, 0]);
  return { x: s.x, y: s.y };
}

export const px = (a: ScreenPoint, b: ScreenPoint) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Run a rig switch with simulated time, sampling the pose every `stepMs` from start to end. Returns every sampled pose
 * with the blend state at that moment.
 */
export function runSwitch(rig: TableRig, to: CameraRig, anchor: ScreenPoint | null, stepMs = 5, dur = BLEND_MS): { poses: CameraPose[]; blending: boolean[] } {
  const start = 1000;
  const poses: CameraPose[] = [rig.pose()];
  const blending: boolean[] = [false];
  rig.setRig(to, start, dur, anchor);
  for (let t = start; t <= start + dur + stepMs; t += stepMs) {
    rig.step(t, stepMs);
    poses.push(rig.pose());
    blending.push(rig.blendState() !== null);
  }
  return { poses, blending };
}
