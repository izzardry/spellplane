/**
 * Card motion (DESIGN "Specification: geometry, layout and motion", Motion): a critically damped spring for
 * dragged and dropped cards (stiffness 320, damping 36, mass 1), tap 120 ms, flip 220 ms with a half-way texture
 * swap, remote players' moves 180 ms ease-out. With reduced motion every change is a cut.
 * Pure: time is passed in (ms), so this is unit-testable with a fake clock.
 */
import type { MotionConstants } from '../core/geometry';
import type { Pose } from '../core/types';
import { deltaDeg, normDeg } from './math';

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/** One spring axis: position and velocity (units per second). */
export interface SpringAxis {
  x: number;
  v: number;
}

/** Largest integration step (s); smaller steps keep the stiff spring stable. */
const MAX_STEP_S = 1 / 240;

/** Advance a damped spring toward `target` by `dtS` seconds (semi-implicit Euler, sub-stepped). */
export function springStep(a: SpringAxis, target: number, dtS: number, k: number, c: number, m: number): SpringAxis {
  let { x, v } = a;
  let left = dtS;
  while (left > 1e-9) {
    const h = Math.min(MAX_STEP_S, left);
    const acc = (-k * (x - target) - c * v) / m;
    v += acc * h;
    x += v * h;
    left -= h;
  }
  return { x, v };
}

/** How the displayed pose approaches a new target. */
/** 'settle': a displaced card going home (DESIGN "Specification: geometry, layout and motion", Motion: settle 260 ms with a 20 ms stagger per card). */
export type MoveKind = 'spring' | 'remote' | 'tap' | 'cut' | 'settle';

/** Settle threshold: closer than this (mm, degrees) and slower than this per second counts as at rest. */
const REST_POS = 0.01;
const REST_VEL = 0.05;

/**
 * The displayed pose of one card. `target` is where it is going; `pose` is where it is drawn now.
 * Rotation is kept unwrapped while animating so a tap from 0 to 90 turns clockwise by 90, never by 270.
 */
export class CardMotion {
  target: Pose;
  /** Displayed x, y, rot (rot unwrapped). */
  x: SpringAxis;
  y: SpringAxis;
  r: SpringAxis;
  private tween: { from: Pose; to: Pose; start: number; dur: number; ease: (t: number) => number } | null = null;
  private springing = false;
  /** Flip: horizontal scale goes 1 -> 0 -> 1; the texture swaps when it reaches 0 (half-way). */
  private flip: { start: number; dur: number } | null = null;
  /** True once the current flip passed its half-way point (the new face shows). */
  flipSwapped = true;

  constructor(pose: Pose) {
    this.target = { ...pose };
    this.x = { x: pose.x, v: 0 };
    this.y = { x: pose.y, v: 0 };
    this.r = { x: pose.rot, v: 0 };
  }

  /** The displayed pose, rot normalised to [0, 360). */
  get pose(): Pose {
    return { x: this.x.x, y: this.y.x, rot: normDeg(this.r.x) };
  }

  get moving(): boolean {
    return this.springing || this.tween !== null || this.flip !== null;
  }

  /** Jump to a pose, dropping velocity (drag follows the pointer through `follow` instead). */
  cut(pose: Pose): void {
    this.target = { ...pose };
    this.x = { x: pose.x, v: 0 };
    this.y = { x: pose.y, v: 0 };
    this.r = { x: this.unwrapNear(pose.rot), v: 0 };
    this.tween = null;
    this.springing = false;
  }

  /** Retarget. `kind` picks the motion; reduced motion turns everything into a cut. A timed move may start `delayMs` later (settle stagger). */
  moveTo(pose: Pose, kind: MoveKind, now: number, m: MotionConstants, reduced: boolean, delayMs = 0): void {
    if (reduced || kind === 'cut') {
      this.cut(pose);
      return;
    }
    const to: Pose = { x: pose.x, y: pose.y, rot: this.unwrapNear(pose.rot) };
    this.target = { ...pose };
    if (kind === 'spring') {
      this.tween = null;
      this.springing = true;
      return;
    }
    const dur = kind === 'tap' ? m.tapMs : kind === 'settle' ? m.settleMs : m.remoteMoveMs;
    const from: Pose = { x: this.x.x, y: this.y.x, rot: this.r.x };
    this.springing = false;
    this.x.v = this.y.v = this.r.v = 0;
    this.tween = { from, to, start: now + Math.max(0, delayMs), dur, ease: kind === 'tap' ? (t) => t * t * (3 - 2 * t) : easeOutCubic };
  }

  /** Start a flip; the caller swaps the texture when `flipSwapped` turns true. */
  startFlip(now: number, m: MotionConstants, reduced: boolean): void {
    if (reduced) {
      this.flip = null;
      this.flipSwapped = true;
      return;
    }
    this.flip = { start: now, dur: m.flipMs };
    this.flipSwapped = false;
  }

  /** Horizontal scale for the flip (1 at rest, 0 half-way). */
  flipScale(now: number): number {
    if (!this.flip) return 1;
    const t = Math.min(1, Math.max(0, (now - this.flip.start) / this.flip.dur));
    return Math.abs(Math.cos(Math.PI * t));
  }

  /** Advance to `now`; returns whether anything is still moving. */
  step(now: number, dtMs: number, m: MotionConstants): boolean {
    if (this.flip) {
      const t = (now - this.flip.start) / this.flip.dur;
      if (t >= 0.5) this.flipSwapped = true;
      if (t >= 1) this.flip = null;
    }
    if (this.tween) {
      const { from, to, start, dur, ease } = this.tween;
      const t = dur <= 0 ? 1 : Math.min(1, Math.max(0, (now - start) / dur));
      const e = ease(t);
      this.x.x = from.x + (to.x - from.x) * e;
      this.y.x = from.y + (to.y - from.y) * e;
      this.r.x = from.rot + (to.rot - from.rot) * e;
      if (t >= 1) this.tween = null;
    } else if (this.springing) {
      const { stiffness: k, damping: c, mass } = m.spring;
      const dt = Math.min(dtMs, 100) / 1000;
      const tr = this.unwrapNear(this.target.rot);
      this.x = springStep(this.x, this.target.x, dt, k, c, mass);
      this.y = springStep(this.y, this.target.y, dt, k, c, mass);
      this.r = springStep(this.r, tr, dt, k, c, mass);
      const rest =
        Math.abs(this.x.x - this.target.x) < REST_POS &&
        Math.abs(this.y.x - this.target.y) < REST_POS &&
        Math.abs(this.r.x - tr) < REST_POS &&
        Math.abs(this.x.v) < REST_VEL &&
        Math.abs(this.y.v) < REST_VEL &&
        Math.abs(this.r.v) < REST_VEL;
      if (rest) {
        this.x = { x: this.target.x, v: 0 };
        this.y = { x: this.target.y, v: 0 };
        this.r = { x: tr, v: 0 };
        this.springing = false;
      }
    }
    return this.moving;
  }

  /** Drive the displayed pose toward a moving goal (the pointer while dragging) with the spring. */
  follow(pose: Pose): void {
    this.target = { ...pose };
    this.tween = null;
    this.springing = true;
  }

  /** The unwrapped angle equal to `rot` (mod 360) nearest to the displayed rotation. */
  private unwrapNear(rot: number): number {
    return this.r.x + deltaDeg(this.r.x, rot);
  }
}
