/**
 * Camera pose maths shared by both rigs and the blend (DESIGN "Camera and navigation": "the table is always a 3D scene
 * and the two views are two camera rigs over it"; "Specification: geometry, layout and motion", Camera rigs: one
 * perspective camera). Pure functions, no Three.js: the scene copies a pose onto its PerspectiveCamera.
 *
 * Table space: x right, y away from seat 0, z up, mm. A pose looks along the viewer's forward axis (the seat angle):
 * the camera never yaws, it only pitches below horizontal (90 = straight down, the bird's-eye rig). Screen points here
 * are CSS px relative to the canvas' top-left corner.
 */
import { DEG, forward } from '../math';
import type { CameraPose, ScreenPoint, TablePoint, Vec3 } from '../types';

export interface Viewport {
  w: number;
  h: number;
}

/** The camera's frame in table space: right, screen up and view direction (unit vectors). */
export interface Basis {
  r: Vec3;
  u: Vec3;
  d: Vec3;
}

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

/**
 * The frame of a camera facing the viewer's forward axis (seat angle `angleDeg`) pitched `pitchDeg` below horizontal.
 * At 90° the view looks straight down with the viewer's forward axis pointing up the screen, so the bird's-eye rig and
 * the ego rig share one continuous family of frames.
 */
export function basis(angleDeg: number, pitchDeg: number): Basis {
  const f = forward(angleDeg);
  const p = pitchDeg * DEG;
  const c = Math.cos(p);
  const s = Math.sin(p);
  return { r: [f.y, -f.x, 0], u: [s * f.x, s * f.y, c], d: [c * f.x, c * f.y, -s] };
}

/** A pose looking at table point `target` from `dist` mm away along the view direction. */
export function poseAt(target: TablePoint, dist: number, pitchDeg: number, fovDeg: number, angleDeg: number): CameraPose {
  const { d } = basis(angleDeg, pitchDeg);
  const t: Vec3 = [target.x, target.y, 0];
  return { position: add(t, d, -dist), target: t, fovDeg, pitchDeg };
}

/** Distance from the camera to its target. */
export function poseDist(pose: CameraPose): number {
  return len(sub(pose.target, pose.position));
}

/** CSS px per mm at the pose's target (the screen centre). */
export function posePxPerMm(pose: CameraPose, vp: Viewport): number {
  return vp.h / 2 / (Math.max(1e-9, poseDist(pose)) * Math.tan((pose.fovDeg / 2) * DEG));
}

/** Screen point of a world point, with its depth along the view direction; x and y are NaN behind the camera. */
export function projectPoint(pose: CameraPose, angleDeg: number, vp: Viewport, p: Vec3): ScreenPoint & { depth: number } {
  const b = basis(angleDeg, pose.pitchDeg);
  const v = sub(p, pose.position);
  const depth = dot(v, b.d);
  if (!(depth > 1e-6)) return { x: NaN, y: NaN, depth };
  const tanH = Math.tan((pose.fovDeg / 2) * DEG);
  const nx = dot(v, b.r) / (depth * tanH * (vp.w / vp.h));
  const ny = dot(v, b.u) / (depth * tanH);
  return { x: (vp.w / 2) * (1 + nx), y: (vp.h / 2) * (1 - ny), depth };
}

/** The view ray through a screen point (not normalised; its component along the view direction is 1). */
export function rayDir(pose: CameraPose, angleDeg: number, vp: Viewport, x: number, y: number): Vec3 {
  const b = basis(angleDeg, pose.pitchDeg);
  const tanH = Math.tan((pose.fovDeg / 2) * DEG);
  const nx = ((2 * x) / vp.w - 1) * tanH * (vp.w / vp.h);
  const ny = (1 - (2 * y) / vp.h) * tanH;
  return add(add(b.d, b.r, nx), b.u, ny);
}

/**
 * Table point under a screen point on the plane at height `z` (default the table, z = 0), or null when the ray misses
 * that plane (above the horizon, or the plane is not below the camera).
 */
export function unprojectToTable(pose: CameraPose, angleDeg: number, vp: Viewport, x: number, y: number, z = 0): TablePoint | null {
  const dir = rayDir(pose, angleDeg, vp, x, y);
  if (!(dir[2] < -1e-9)) return null;
  const k = (z - pose.position[2]) / dir[2];
  if (!(k > 0)) return null;
  return { x: pose.position[0] + dir[0] * k, y: pose.position[1] + dir[1] * k };
}

/**
 * The target that puts table point `a` under screen point `s` for a camera of this pitch, distance and field of view:
 * moving the camera parallel to the table moves every table point with it, so the solution is exact. Null when the ray
 * through `s` misses the table.
 */
export function targetFor(pitchDeg: number, dist: number, fovDeg: number, angleDeg: number, vp: Viewport, a: TablePoint, s: ScreenPoint): TablePoint | null {
  const q = unprojectToTable(poseAt({ x: 0, y: 0 }, dist, pitchDeg, fovDeg, angleDeg), angleDeg, vp, s.x, s.y);
  return q ? { x: a.x - q.x, y: a.y - q.y } : null;
}
