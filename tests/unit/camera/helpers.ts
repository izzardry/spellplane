// Shared fixtures for the camera rig tests (M4-P1): table sizes and seat angles from DESIGN "Specification: geometry,
// layout and motion", Tables and seats; a rig at rest in either camera.
import { TableRig, lateralOf } from '../../../src/scene/camera/rig';
import { mtgLayout } from '../../../src/games/mtg/layout';
import { projectPoint } from '../../../src/scene/camera/pose';
import { onCameraTable, type CameraTable } from '../../../src/scene/camera/table';
import { cameraTable } from '../../../src/scene/layout';
import type { CameraPose, CameraRig, ScreenPoint, TablePoint } from '../../../src/scene/types';

export const VP = { w: 1440, h: 900 };
export const TABLES = {
  '1v1': { w: 1400, d: 1100 },
  // M5-P7: three players sit at 0°, 120° and 240° on a 2000 x 1800 table.
  ffa3: { w: 2000, d: 1800 },
  ffa4: { w: 1800, d: 1800 },
  '2hg': { w: 2200, d: 1100 },
} as const;
/**
 * Every viewer seat of every table format: the camera's table (turned to the viewer at the three-player table, as the
 * table scene hands it over: scene/layout.ts cameraTable; M5-P7), the seat angle and the ego seat's offset along the
 * viewer's right axis (in front of their own territory, as the table scene places it).
 */
export const SEATS = (['1v1', 'ffa3', 'ffa4', '2hg'] as const).flatMap((format) => {
  const layout = mtgLayout(format);
  return layout.seats.map((s) => ({ format, seat: s.index, table: cameraTable(layout, s.angle) as CameraTable, angle: s.angle, lateral: lateralOf(s.territory, s.angle) }));
});
export type Seat = (typeof SEATS)[number];

/** Whether a table point lies on the table (not over the surround); the camera's table may be turned (M5-P7). */
export const onTable = (table: CameraTable, p: TablePoint): boolean => (table.rot ? onCameraTable(p, table) : Math.abs(p.x) <= table.w / 2 && Math.abs(p.y) <= table.d / 2);

/** The spec's blend duration (DESIGN "Specification: geometry, layout and motion", Camera rigs: 400 ms). */
export const BLEND_MS = 400;

export function makeRig(o: { rig?: CameraRig; angle?: number; table?: CameraTable; tiltDeg?: number; lateral?: number } = {}): TableRig {
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
