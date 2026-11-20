/**
 * The settled camera pose at a tilt, without a scene (docs/design/m8/m7-adjustments.md, M7-P3: "an exported pure
 * function `poseAt(tilt, layout, seat)` in `src/scene/camera/` returning position, look-at and field of view, which the
 * landing's still uses"; PLAN M8-C HUD and scene seam). Named `poseAtTilt` because `poseAt` in ./pose.ts is the pose
 * builder the rigs share; it lives in its own module because the rig imports ./pose.
 *
 * Pure: it builds the same rig the table scene builds (scene/camera/rig.ts TableRig, the camera's table of
 * scene/layout.ts cameraTable, the seat's angle) at rest at that tilt with the fitted view, and returns its pose, so
 * the still and the live table frame the table identically. No DOM, clock or randomness.
 */
import type { TableLayout } from '../../games/types';
import type { CameraDefaults } from '../../themes/types';
import { cameraTable } from '../layout';
import type { CameraPose } from '../types';
import type { Viewport } from './pose';
import { TableRig } from './rig';

/** The viewport a pose is fitted to when none is given (CSS px; a 16:9 window). */
export const POSE_VIEWPORT: Viewport = { w: 1600, h: 900 };

/** The seat's angle in the layout: `s<i>` is seat index i; null or an unknown seat is seat 0's view (as spectators). */
export function seatAngle(layout: Pick<TableLayout, 'seats'>, seat: string | null): number {
  const i = seat && /^s\d+$/.test(seat) ? Number(seat.slice(1)) : 0;
  return layout.seats[i]?.angle ?? layout.seats[0]?.angle ?? 0;
}

/**
 * The camera's settled pose at `tilt` (0 first person … 1 bird's-eye) for `seat`'s view of `layout`, fitted to
 * `viewport` (default POSE_VIEWPORT): position, look-at (`target`), field of view and pitch. `camera` carries a theme's
 * lens overrides (Theme.camera: ego, birdseyeTiltDeg), as the table scene passes them.
 */
export function poseAtTilt(tilt: number, layout: Pick<TableLayout, 'table' | 'seats' | 'format'>, seat: string | null, viewport: Viewport = POSE_VIEWPORT, camera?: Pick<CameraDefaults, 'ego' | 'birdseyeTiltDeg'>): CameraPose {
  const angle = seatAngle(layout, seat);
  const rig = new TableRig({
    table: cameraTable(layout as TableLayout, angle),
    viewport: { w: Math.max(1, viewport.w), h: Math.max(1, viewport.h) },
    angle,
    inertiaMs: 0,
    tilt,
    ...(camera?.ego ? { ego: camera.ego } : {}),
    ...(camera?.birdseyeTiltDeg !== undefined ? { tiltDeg: camera.birdseyeTiltDeg } : {}),
  });
  return rig.pose();
}
