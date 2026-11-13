/**
 * The rig blend (DESIGN "Camera and navigation", Switching: about 400 ms, interpolating position, tilt and field of
 * view, the point under the cursor stays under the cursor; "Specification: geometry, layout and motion", Camera rigs:
 * distance solved so the cursor's table point stays fixed; reduced motion cuts). Stub by M4-C; implemented by M4-P1.
 */
import type { CameraPose, ScreenPoint, TablePoint } from '../types';

/**
 * The pose at eased progress `t` (0..1) between two rig poses, keeping `anchor.table` under `anchor.screen` for a
 * viewport of `viewport` CSS px when an anchor is given (PLAN M4-P1: it moves less than 2 px). Stub: M4-P1.
 */
export function blendPose(
  _from: CameraPose,
  _to: CameraPose,
  _t: number,
  _viewport: { w: number; h: number },
  _anchor: { table: TablePoint; screen: ScreenPoint } | null,
): CameraPose {
  throw new Error('not implemented: M4-P1 (rig blend)');
}
