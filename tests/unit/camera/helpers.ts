// Shared fixtures for the camera tests (M4-P1, M7-P3): table sizes and seat angles from DESIGN "Specification:
// geometry, layout and motion", Tables and seats; a rig at rest at a tilt; a tilt move run with simulated time.
import { TableRig, lateralOf } from '../../../src/scene/camera/rig';
import { mtgLayout } from '../../../src/games/mtg/layout';
import { projectPoint } from '../../../src/scene/camera/pose';
import { onCameraTable, type CameraTable } from '../../../src/scene/camera/table';
import { cameraTable } from '../../../src/scene/layout';
import type { CameraPose, CameraRig, ScreenPoint, TablePoint } from '../../../src/scene/types';
import type { Insets } from '../../../src/scene/camera/birdseye';

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
 * table scene hands it over: scene/layout.ts cameraTable; M5-P7), the seat angle and the seat's offset along the
 * viewer's right axis.
 */
export const SEATS = (['1v1', 'ffa3', 'ffa4', '2hg'] as const).flatMap((format) => {
  const layout = mtgLayout(format);
  return layout.seats.map((s) => ({ format, seat: s.index, table: cameraTable(layout, s.angle) as CameraTable, angle: s.angle, lateral: lateralOf(s.territory, s.angle) }));
});
export type Seat = (typeof SEATS)[number];

/** Whether a table point lies on the table (not over the surround); the camera's table may be turned (M5-P7). */
export const onTable = (table: CameraTable, p: TablePoint): boolean => (table.rot ? onCameraTable(p, table) : Math.abs(p.x) <= table.w / 2 && Math.abs(p.y) <= table.d / 2);

/** The spec's blend time, which the tilt's spring settles in (DESIGN "Specification: geometry, layout and motion", Camera rigs: 400 ms). */
export const BLEND_MS = 400;

/** A typical HUD: the toolbar at the top and the hand fan at the bottom (ui/hand.ts fitInsets at 900 px). */
export const HUD: Insets = { top: 56, right: 0, bottom: 214, left: 0 };

export function makeRig(o: { rig?: CameraRig; tilt?: number; angle?: number; table?: CameraTable; tiltDeg?: number; lateral?: number; insets?: Insets; vp?: { w: number; h: number } } = {}): TableRig {
  const table = o.table ?? TABLES['1v1'];
  return new TableRig({
    table,
    viewport: o.vp ?? VP,
    angle: o.angle ?? 0,
    inertiaMs: 325,
    ...(o.tilt !== undefined ? { tilt: o.tilt } : { rig: o.rig ?? 'birdseye' }),
    tiltDeg: o.tiltDeg ?? 0,
    lateral: o.lateral ?? 0,
    ...(o.insets ? { insets: o.insets } : {}),
  });
}

/** Screen point of a table point under a pose. */
export function screenOf(pose: CameraPose, angle: number, p: TablePoint, vp = VP): ScreenPoint {
  const s = projectPoint(pose, angle, vp, [p.x, p.y, 0]);
  return { x: s.x, y: s.y };
}

export const px = (a: ScreenPoint, b: ScreenPoint) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Run a tilt move with simulated time from t = 1000 ms, sampling the pose every `stepMs` until it settles (at most
 * `maxMs`). Returns every sampled pose and tilt, and whether the move was still running at each.
 */
export function runTilt(rig: TableRig, to: number, anchor: ScreenPoint | null, stepMs = 5, maxMs = 2000): { poses: CameraPose[]; tilts: number[]; moving: boolean[]; settledAt: number } {
  const start = 1000;
  const poses: CameraPose[] = [rig.pose()];
  const tilts: number[] = [rig.tilt()];
  const moving: boolean[] = [false];
  rig.setTilt(to, start, BLEND_MS, anchor);
  let t = start;
  let settledAt = Infinity;
  while (t < start + maxMs) {
    t += stepMs;
    rig.step(t, stepMs);
    poses.push(rig.pose());
    tilts.push(rig.tilt());
    moving.push(rig.switching);
    if (!rig.switching) {
      settledAt = t - start;
      break;
    }
  }
  return { poses, tilts, moving, settledAt };
}
