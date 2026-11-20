/**
 * The rig blend (DESIGN "Camera and navigation", Switching: about 400 ms, interpolating position, tilt and field of
 * view, the point under the cursor stays under the cursor; "Specification: geometry, layout and motion", Camera rigs:
 * distance solved so the cursor's table point stays fixed; reduced motion cuts). M4-P1.
 *
 * The blend interpolates pitch and field of view linearly and the visible half-height at the target log-linearly (a
 * zoom feels even on a log scale), derives the distance from those, and then solves the camera's position parallel to
 * the table so the anchor's table point lands exactly where it should: on the anchor's screen point when both end
 * poses hold it there, or on a straight path between where the two end poses show it when a rig's limits kept the
 * destination from holding it (DECISIONS [M4-P1]). Without an anchor the target moves linearly.
 */
import { DEG } from '../math';
import type { CameraPose, ScreenPoint, TablePoint } from '../types';
import { poseAt, poseDist, projectPoint, targetFor, type Viewport } from './pose';

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Ease-in-out cubic: the blend's progress curve (also the bird's-eye rig's eases, scene/camera.ts). */
export const easeBlend = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * The pose at eased progress `t` (0..1) between two rig poses, keeping `anchor.table` under `anchor.screen` for a
 * viewport of `viewport` CSS px when an anchor is given (PLAN M4-P1: it moves less than 2 px). Both poses face the
 * viewer's forward axis `angleDeg` (the seat angle; poses looking straight down carry no heading of their own).
 */
export function blendPose(
  from: CameraPose,
  to: CameraPose,
  t: number,
  viewport: { w: number; h: number },
  anchor: { table: TablePoint; screen: ScreenPoint } | null,
  angleDeg = 0,
): CameraPose {
  if (!(t > 0)) return clonePose(from);
  if (t >= 1) return clonePose(to);
  const vp: Viewport = { w: Math.max(1, viewport.w), h: Math.max(1, viewport.h) };
  const pitch = lerp(from.pitchDeg, to.pitchDeg, t);
  const fov = lerp(from.fovDeg, to.fovDeg, t);
  const h0 = poseDist(from) * Math.tan((from.fovDeg / 2) * DEG);
  const h1 = poseDist(to) * Math.tan((to.fovDeg / 2) * DEG);
  const half = Math.exp(lerp(Math.log(Math.max(1e-6, h0)), Math.log(Math.max(1e-6, h1)), t));
  const dist = half / Math.tan((fov / 2) * DEG);
  const linear = { x: lerp(from.target[0], to.target[0], t), y: lerp(from.target[1], to.target[1], t) };
  let target: TablePoint = linear;
  if (anchor) {
    const at = (p: CameraPose): ScreenPoint => {
      const s = projectPoint(p, angleDeg, vp, [anchor.table.x, anchor.table.y, 0]);
      return Number.isFinite(s.x) && Number.isFinite(s.y) ? s : anchor.screen;
    };
    const s0 = at(from);
    const s1 = at(to);
    const s = { x: lerp(s0.x, s1.x, t), y: lerp(s0.y, s1.y, t) };
    target = targetFor(pitch, dist, fov, angleDeg, vp, anchor.table, s) ?? linear;
  }
  return poseAt(target, dist, pitch, fov, angleDeg);
}

function clonePose(p: CameraPose): CameraPose {
  return { position: [...p.position], target: [...p.target], fovDeg: p.fovDeg, pitchDeg: p.pitchDeg };
}
