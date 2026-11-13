/**
 * The ego camera rig (DESIGN "Camera and navigation", Ego perspective; "Specification: geometry, layout and motion",
 * Camera rigs): a perspective camera at the viewer's seat, pitched 35° below horizontal, with lean, dolly and pitch
 * within limits; never below the table edge or behind the seat. Stub by M4-C; implemented by M4-P1 (scene/camera/*,
 * which may also move scene/camera.ts's bird's-eye rig here).
 */
import type { CameraPose, EgoRigParams } from '../types';

/** Where the viewer has leaned, dollied and pitched the ego rig (DESIGN "Camera and navigation", Navigation gestures). Added by M4-C. */
export interface EgoNav {
  /** Sideways lean in mm, within ±EgoRigParams.leanMm. */
  lean: number;
  /** Dolly forward in mm, 0..EgoRigParams.maxDollyMm. */
  dolly: number;
  /** Pitch below horizontal in degrees, within the rig's limits. */
  pitchDeg: number;
}

/** The ego camera's pose for a table and viewer seat angle (DESIGN "Specification: geometry", Camera rigs). Stub: M4-P1. */
export function egoPose(_params: EgoRigParams, _table: { w: number; d: number }, _viewerAngleDeg: number, _nav: EgoNav): CameraPose {
  throw new Error('not implemented: M4-P1 (ego rig)');
}
