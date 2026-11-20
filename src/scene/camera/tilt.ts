/**
 * The one continuous tilt (PLAN Milestone 7, Owner decisions after the first design round, One continuous tilt: "The
 * camera no longer switches between two rigs. One tilt control moves continuously and smoothly from first person
 * (seated, looking across the table) to bird's-eye (straight down), with the hand kept in reach throughout"). M7-P3.
 *
 * Pure maths. A tilt t in [0, 1] fixes the camera's pitch and field of view: t = 0 is the first-person lens (the ego
 * rig's 35° below horizontal and 45° field of view, DESIGN "Specification: geometry, layout and motion", Camera rigs),
 * t = 1 the bird's-eye lens (straight down, 6°, less a theme's slight tilt). In between:
 *
 * - the pitch moves linearly with t;
 * - the tangent of the half field of view moves linearly with t: the perspective (how much nearer cards show larger
 *   than far ones) fades evenly, where a linear field of view would keep almost all of it until the very end;
 * - the camera looks at a table point (the look-at) and keeps the visible half-height there (the zoom), so its distance
 *   is half-height / tan(half field of view) and its height distance × sin(pitch). For a fixed zoom both grow
 *   monotonically from first person to bird's-eye: the camera rises and backs away as it tilts up and never dips.
 *
 * The rig (scene/camera/rig.ts) moves the look-at and the zoom with gestures and solves the look-at so the table point
 * under the cursor stays under it while the tilt moves.
 */
import { DEG, clamp } from '../math';
import type { CameraPose, TablePoint } from '../types';
import { poseAt } from './pose';

/** The two ends of the tilt: pitch below horizontal and field of view, degrees. */
export interface TiltLens {
  /** First person (t = 0). */
  pitch0: number;
  fov0: number;
  /** Bird's-eye (t = 1). */
  pitch1: number;
  fov1: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** A tilt clamped into [0, 1] (a non-finite value is bird's-eye, as scene/types.ts clampTilt). */
export function unitTilt(t: number): number {
  return Number.isFinite(t) ? clamp(t, 0, 1) : 1;
}

/** Pitch below horizontal at tilt t, degrees: linear from first person to bird's-eye. */
export function tiltPitch(lens: TiltLens, t: number): number {
  return lerp(lens.pitch0, lens.pitch1, unitTilt(t));
}

/** tan(half the field of view) at tilt t: linear, so the perspective fades evenly. */
export function tiltTanHalf(lens: TiltLens, t: number): number {
  return lerp(Math.tan((lens.fov0 / 2) * DEG), Math.tan((lens.fov1 / 2) * DEG), unitTilt(t));
}

/** Field of view at tilt t, degrees (exactly the lens' own at either end). */
export function tiltFov(lens: TiltLens, t: number): number {
  const u = unitTilt(t);
  if (u === 0) return lens.fov0;
  if (u === 1) return lens.fov1;
  return (2 * Math.atan(tiltTanHalf(lens, u))) / DEG;
}

/** Distance from the camera to its look-at for a visible half-height `half` (mm) at the look-at, at tilt t. */
export function tiltDist(lens: TiltLens, t: number, half: number): number {
  return half / tiltTanHalf(lens, t);
}

/** Where the camera looks and how much of the table it shows: the look-at on the table and the visible half-height there (mm). */
export interface TiltLook {
  x: number;
  y: number;
  half: number;
}

/** The camera pose at tilt t for a look (the viewer's forward axis is the seat angle; the camera never yaws). */
export function tiltPose(lens: TiltLens, t: number, look: TiltLook, angleDeg: number): CameraPose {
  const u = unitTilt(t);
  return poseAt({ x: look.x, y: look.y }, tiltDist(lens, u, look.half), tiltPitch(lens, u), tiltFov(lens, u), angleDeg);
}

/** Camera height above the table at tilt t for a visible half-height `half`. */
export function tiltHeight(lens: TiltLens, t: number, half: number): number {
  return tiltDist(lens, t, half) * Math.sin(tiltPitch(lens, t) * DEG);
}

/** How far the camera stands back from its look-at along the viewer's forward axis, at tilt t (0 straight down). */
export function tiltBack(lens: TiltLens, t: number, half: number): number {
  return tiltDist(lens, t, half) * Math.max(0, Math.cos(tiltPitch(lens, t) * DEG));
}

/**
 * The largest visible half-height that keeps the camera no further back than `room` mm behind its look-at (the seat:
 * "the camera never goes … behind the seat"); Infinity when the view looks straight down (it stands over the look-at).
 */
export function halfForBack(lens: TiltLens, t: number, room: number): number {
  const c = Math.cos(tiltPitch(lens, t) * DEG);
  if (!(c > 1e-9)) return Infinity;
  return (Math.max(0, room) * tiltTanHalf(lens, t)) / c;
}

/** The smallest visible half-height that keeps the camera at least `minHeight` above the table at tilt t. */
export function halfForHeight(lens: TiltLens, t: number, minHeight: number): number {
  const s = Math.sin(tiltPitch(lens, t) * DEG);
  return (minHeight * tiltTanHalf(lens, t)) / Math.max(1e-9, s);
}

// --- Motion ------------------------------------------------------------------------------------------------------

/**
 * The tilt's spring (PLAN M7-P3: "eased spring motion"): critically damped, so it settles without overshoot (a tilt
 * never passes beyond the preset it was sent to, nor beyond 0 or 1) in about 400 ms, the spec's blend time (DESIGN
 * "Specification: geometry, layout and motion", Camera rigs: 400 ms; Motion: critically damped springs).
 */
export const TILT_SPRING = { omega: 16 } as const;

/** One step of a critically damped spring toward `target` (exact for any step length): the new value and velocity (per ms). */
export function springStep(x: number, v: number, target: number, dtMs: number, omega: number = TILT_SPRING.omega): { x: number; v: number } {
  const w = omega / 1000;
  const e0 = x - target;
  const t = Math.max(0, dtMs);
  const k = Math.exp(-w * t);
  const b = v + w * e0;
  return { x: target + (e0 + b * t) * k, v: (v - w * b * t) * k };
}

/** Whether a spring is close enough to rest to stop drawing frames (a thousandth of the tilt, nearly still). */
export function springSettled(x: number, v: number, target: number): boolean {
  return Math.abs(x - target) < 5e-4 && Math.abs(v) < 5e-5;
}

/**
 * Soft snapping to the presets (PLAN M7-P3: "presets snap softly to first person, a middle view and bird's-eye"): a
 * tilt released within `radius` of a preset goes there; elsewhere it stays where the viewer left it.
 */
export function snapTilt(t: number, presets: readonly number[], radius: number): number {
  const u = unitTilt(t);
  let best = u;
  let bestD = radius;
  for (const p of presets) {
    const d = Math.abs(p - u);
    if (d <= bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/** How near a preset a released tilt must be to snap to it. */
export const TILT_SNAP_RADIUS = 0.1;

/** Mouse right- or middle-drag: tilt per CSS px of vertical travel (dragging down goes toward bird's-eye, as the old pitch drag looked further down). */
export const TILT_PER_DRAG_PX = 1 / 360;

/** Two fingers swiped vertically: tilt per CSS px (a little quicker than the mouse: a finger travels less). */
export const TILT_PER_SWIPE_PX = 1 / 300;

/** A wheel with the tilt modifier: tilt per wheel pixel (a 100 px mouse notch is one TILT_STEP-sized move, 0.125). */
export const TILT_PER_WHEEL_PX = 0.125 / 100;

/** A table point (a free helper for the rig: the look-at as a point). */
export function lookPoint(l: TiltLook): TablePoint {
  return { x: l.x, y: l.y };
}
