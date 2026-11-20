/**
 * Card motion (DESIGN "Specification: geometry, layout and motion", Motion): a critically damped spring for
 * dragged and dropped cards (stiffness 320, damping 36, mass 1), tap 120 ms, flip 220 ms with a half-way texture
 * swap, remote players' moves 180 ms ease-out. With reduced motion every change is a cut.
 * Pure: time is passed in (ms), so this is unit-testable with a fake clock.
 */
import type { MotionConstants } from '../core/geometry';
import type { Pose } from '../core/types';
import { deltaDeg, normDeg, rot2 } from './math';

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

  /**
   * A timed move with its own length and curve (M7-P4: a tap's overshoot, a draw, a toss to a pile, a wave of untaps);
   * reduced motion or no length: a cut. Interruptible like every move: it starts from the pose drawn now.
   */
  tweenTo(pose: Pose, now: number, durMs: number, ease: (t: number) => number, reduced: boolean, delayMs = 0): void {
    if (reduced || !(durMs > 0)) {
      this.cut(pose);
      return;
    }
    const to: Pose = { x: pose.x, y: pose.y, rot: this.unwrapNear(pose.rot) };
    this.target = { ...pose };
    const from: Pose = { x: this.x.x, y: this.y.x, rot: this.r.x };
    this.springing = false;
    this.x.v = this.y.v = this.r.v = 0;
    this.tween = { from, to, start: now + Math.max(0, delayMs), dur: durMs, ease };
  }

  /** Start a flip; the caller swaps the texture when `flipSwapped` turns true. */
  startFlip(now: number, m: MotionConstants, reduced: boolean, durMs = m.flipMs): void {
    if (reduced || !(durMs > 0)) {
      this.flip = null;
      this.flipSwapped = true;
      return;
    }
    this.flip = { start: now, dur: durMs };
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

/**
 * Lift of one card while held (DESIGN "Specification: geometry, layout and motion": "Lift while dragged 12, with a 4°
 * tilt toward the drag direction in lit themes"; themes/types.ts CardDressing.held). The lift rises and falls with the
 * card spring; reduced motion cuts. Pure: time is passed in. Added by M4-P2.
 */
export class HeldLift {
  lift: SpringAxis = { x: 0, v: 0 };
  target = 0;

  /** Lift toward `mm` (the dressing's held lift while held, 0 after the drop). */
  set(mm: number, reduced: boolean): void {
    this.target = mm;
    if (reduced) this.lift = { x: mm, v: 0 };
  }

  get value(): number {
    return this.lift.x;
  }

  get moving(): boolean {
    return Math.abs(this.lift.x - this.target) >= REST_POS || Math.abs(this.lift.v) >= REST_VEL;
  }

  /** Advance by `dtMs`; returns whether the lift still moves. */
  step(dtMs: number, m: MotionConstants): boolean {
    if (!this.moving) return false;
    const { stiffness: k, damping: c, mass } = m.spring;
    this.lift = springStep(this.lift, this.target, Math.min(dtMs, 100) / 1000, k, c, mass);
    if (!this.moving) this.lift = { x: this.target, v: 0 };
    return this.moving;
  }
}

/** Drag speed (mm/s) at which a held card reaches its full tilt. */
export const FULL_TILT_SPEED = 400;

/**
 * Tilt of a held card from its velocity (mm/s, table frame): toward the drag direction, `tiltDeg` at FULL_TILT_SPEED and
 * above, proportionally less when slower, none at rest, with reduced motion or in themes without tilt (Paper).
 */
export function heldTilt(vx: number, vy: number, tiltDeg: number, reduced: boolean): { x: number; y: number; deg: number } | null {
  const speed = Math.hypot(vx, vy);
  if (reduced || tiltDeg <= 0 || speed < 1e-3) return null;
  return { x: vx / speed, y: vy / speed, deg: tiltDeg * Math.min(1, speed / FULL_TILT_SPEED) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Card feel (PLAN Milestone 7, Owner decisions after the first design round, Almost haptic card handling: "they lift on
// pickup, sway with movement, are pulled into snap slots as they near them, settle with a small bounce, and every common
// move has a short animation … Reduced motion is respected"; scene/types.ts CardFeel). M7-P4. Presentation only: none of
// this changes where a card lands (the drop resolves from the pointer, the state decides the pose).
// ---------------------------------------------------------------------------------------------------------------------

/** Ease out with a small overshoot past 1 before settling (`c` 0 is an ease-out cubic; 1.70158 overshoots by 10%). */
export function easeOutBack(t: number, c = 1.70158): number {
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

/** Ease in and out (cubic). */
export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** The overshoot constant of a tap's turn (easeOutBack): about 4% past the turn, 4° on a 90° tap, then back. */
export const TAP_OVERSHOOT = 1.0;
/** How long a tap or untap turns, ms (DESIGN tap 120 ms, lengthened so its overshoot reads; scaled by the motion setting). */
export const TAP_FEEL_MS = 180;
/** A wave of untaps (untap all) staggers per card by this, ms, at most WAVE_MAX_MS in all (left to right). */
export const WAVE_STEP_MS = 30;
export const WAVE_MAX_MS = 240;
/**
 * A group of moves that arrives at once (an opening hand of seven, a mill, a wrath) staggers card by card
 * (m7-adjustments.md, M7-P4 change 3: "the opening seven draw 40 ms apart, the whole group done within 600 ms").
 */
export const GROUP_STEP_MS = 40;
export const GROUP_MAX_MS = 600;

/**
 * The delay of the `i`-th card (0-based) of a group whose moves last `durMs`: GROUP_STEP_MS apart, but never so late
 * that the card ends after GROUP_MAX_MS (later cards of a large group start together at the last possible moment).
 * Reduced motion has no durations, so no delay.
 */
export function groupDelay(i: number, durMs: number): number {
  if (!(i > 0) || !(durMs > 0)) return 0;
  return Math.min(i * GROUP_STEP_MS, Math.max(0, GROUP_MAX_MS - durMs));
}

/** A card at full lift is drawn this much larger (it rises toward the viewer); never a distortion, a uniform scale. */
export const LIFT_SCALE = 0.05;
/** A counter change pops its badge by this much, over POP_MS. */
export const POP_SCALE = 0.35;
export const POP_MS = 220;
/** A clip snapping on pops the clipped cards by this much, over the clip duration. */
export const CLIP_POP_SCALE = 0.03;
/** Where a riffled library's halves part to, as a fraction of the card width. */
export const RIFFLE_SPREAD = 0.55;

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/**
 * The magnet's pull (CardFeel.magnet): 0 at `radius` and beyond, rising smoothly to `strength` on the slot. The drawn
 * distance to the slot, d·(1 − pull(d)), keeps growing with d, so a card never moves against the pointer and never jumps
 * at the edge of the radius.
 */
export function magnetPull(d: number, radius: number, strength: number): number {
  if (!(radius > 0) || !(strength > 0) || !(d < radius)) return 0;
  const s = clamp01(1 - Math.max(0, d) / radius);
  return Math.min(1, strength) * s * s * (3 - 2 * s);
}

/** The free pose pulled toward the slot by `pull` (0 stays free, 1 is on the slot); the turn takes the shorter way. */
export function magnetPose(free: Pose, slot: Pose, pull: number): Pose {
  const k = clamp01(pull);
  return { x: free.x + (slot.x - free.x) * k, y: free.y + (slot.y - free.y) * k, rot: normDeg(free.rot + deltaDeg(free.rot, slot.rot) * k) };
}

/** The magnet a drag in progress feels: the slot, its pull and the drawn pose of the grabbed card. */
export interface MagnetState {
  slot: Pose;
  pull: number;
  pose: Pose;
}

/** The magnet on a free pose toward `slot` (null when out of reach or switched off). */
export function magnetOn(free: Pose, slot: Pose | null, m: { radiusMm: number; strength: number }): MagnetState | null {
  if (!slot) return null;
  const d = Math.hypot(slot.x - free.x, slot.y - free.y);
  const pull = magnetPull(d, m.radiusMm, m.strength);
  if (pull <= 0) return null;
  return { slot, pull, pose: magnetPose(free, slot, pull) };
}

/** Lever below the grab point, mm: a card swings as if held a little above where it was grabbed (it hangs, it does not spin). */
export const SWAY_LEVER_MM = 20;

/**
 * The sway a dragged card leans to, degrees clockwise (CardFeel.sway): the card hangs from the pointer, so its centre
 * trails the motion and it turns about the grab point, by `degPerMmPerS` per mm/s of sideways speed, at most `maxDeg`.
 * `rx, ry` is the card centre minus the grab point (table mm), `vx, vy` its velocity (mm/s), `downDeg` the viewer's
 * angle (the lever hangs toward the viewer).
 */
export function swayTarget(vx: number, vy: number, rx: number, ry: number, downDeg: number, sway: { maxDeg: number; degPerMmPerS: number }): number {
  if (!(sway.maxDeg > 0)) return 0;
  const [lx, ly] = rot2(0, -SWAY_LEVER_MM, downDeg);
  const ax = rx + lx;
  const ay = ry + ly;
  const len = Math.hypot(ax, ay);
  if (len < 1e-6) return 0;
  // The turn that swings the lever toward −v: clockwise-positive cross product of lever and velocity, per unit lever.
  const cross = (ax * vy - ay * vx) / len;
  const deg = cross * sway.degPerMmPerS;
  return Math.max(-sway.maxDeg, Math.min(sway.maxDeg, deg));
}

/** First-order relax of `value` toward `target` with time constant `relaxMs` over `dtMs`. */
export function relaxToward(value: number, target: number, dtMs: number, relaxMs: number): number {
  if (!(relaxMs > 0)) return target;
  return target + (value - target) * Math.exp(-Math.max(0, dtMs) / relaxMs);
}

/** The sway of one card: it leans into its motion and relaxes back to flat (CardFeel.sway). Reduced motion: none. */
export class SwayMotion {
  value = 0;
  private target = 0;

  /** Lean toward `deg` (the drag's swayTarget), or 0 when the card is let go. */
  set(deg: number): void {
    this.target = deg;
  }

  /** Drop any sway at once (reduced motion). */
  cut(): void {
    this.value = this.target = 0;
  }

  get moving(): boolean {
    return Math.abs(this.value) >= 0.01 || Math.abs(this.target) >= 0.01;
  }

  /** Advance by `dtMs`; returns whether the card still leans. */
  step(dtMs: number, relaxMs: number): boolean {
    this.value = relaxToward(this.value, this.target, Math.min(dtMs, 100), relaxMs);
    if (Math.abs(this.value - this.target) < 0.01) this.value = this.target;
    if (Math.abs(this.value) < 0.01 && this.target === 0) this.value = 0;
    return this.moving;
  }
}

/**
 * The settle curve of a falling card: from 1 (its height when let go) down to the table by `split` of the time, then one
 * small hop of `bounce` (a fraction of the fall) and down again; 0 at the end, never below the table.
 */
export function settleCurve(t: number, bounce: number, split = 0.6): number {
  const u = clamp01(t);
  if (u >= 1) return 0;
  if (u < split) {
    const k = u / split;
    return 1 - k * k;
  }
  if (!(bounce > 0)) return 0;
  return bounce * Math.sin((Math.PI * (u - split)) / (1 - split));
}

/** A hop along a move (a card tossed to a pile, drawn, played): 0 at both ends, 1 half-way. */
export const arcCurve = (t: number): number => Math.sin(Math.PI * clamp01(t));

/** A pop (counter badges, a clip snapping on): rises fast to 1 and eases back to 0. */
export function popCurve(t: number): number {
  const u = clamp01(t);
  if (u >= 1) return 0;
  return u < 0.3 ? easeOutCubic(u / 0.3) : 1 - easeInOutCubic((u - 0.3) / 0.7);
}

/** One timed lift curve: shape 'rise' (eased toward `to`), 'settle' (falls from `from` with the bounce), 'arc' (a hop of `from` height above `to`). */
interface LiftCurve {
  shape: 'rise' | 'settle' | 'arc';
  from: number;
  to: number;
  start: number;
  dur: number;
  bounce: number;
}

/**
 * The height a card is drawn above its place, mm (M7-P4; DESIGN geometry: lift while dragged 12): it rises on pickup,
 * falls back with a small bounce when let go, hops along a toss or a draw and lands softly when played. Every curve
 * starts from the height drawn now, so a new one interrupts the last without a jump. Reduced motion: cuts. Pure: time is
 * passed in.
 */
export class LiftMotion {
  /** The height drawn at the last step. */
  value = 0;
  /** Where the lift is going (the held height, else 0). */
  target = 0;
  private curve: LiftCurve | null = null;

  get moving(): boolean {
    return this.curve !== null || Math.abs(this.value - this.target) >= 1e-6;
  }

  /** Rise to `mm` over `ms` (pickup); reduced motion or no time: a cut. */
  rise(now: number, mm: number, ms: number, reduced: boolean): void {
    this.target = mm;
    if (reduced || !(ms > 0)) return this.cut(mm);
    if (this.curve?.shape === 'rise' && this.curve.to === mm) return;
    this.curve = { shape: 'rise', from: this.value, to: mm, start: now, dur: ms, bounce: 0 };
  }

  /** Fall back to the table over `ms` with a hop of `bounce` (a fraction of the fall); a card already down stays down. */
  settle(now: number, ms: number, bounce: number, reduced: boolean): void {
    this.target = 0;
    if (reduced || !(ms > 0) || this.value <= 1e-6) return this.cut(0);
    this.curve = { shape: 'settle', from: this.value, to: 0, start: now, dur: ms, bounce: Math.max(0, bounce) };
  }

  /** Land from `mm` above the table over `ms` with a small bounce (a card played or arriving). */
  land(now: number, mm: number, ms: number, bounce: number, reduced: boolean): void {
    this.target = 0;
    if (reduced || !(ms > 0) || !(mm > 0)) return this.cut(0);
    this.value = Math.max(this.value, mm);
    this.curve = { shape: 'settle', from: this.value, to: 0, start: now, dur: ms, bounce: Math.max(0, bounce) };
  }

  /** A hop of `mm` over `ms` (a toss to a pile, a draw), ending where it is going. */
  arc(now: number, mm: number, ms: number, reduced: boolean): void {
    if (reduced || !(ms > 0) || !(mm > 0)) return this.cut(this.target);
    this.curve = { shape: 'arc', from: mm, to: this.target, start: now, dur: ms, bounce: 0 };
  }

  cut(mm: number): void {
    this.target = mm;
    this.value = mm;
    this.curve = null;
  }

  /** The height at `now` (without advancing). */
  at(now: number): number {
    const c = this.curve;
    if (!c) return this.value;
    const t = c.dur <= 0 ? 1 : clamp01((now - c.start) / c.dur);
    if (c.shape === 'rise') return c.from + (c.to - c.from) * easeOutCubic(t);
    if (c.shape === 'settle') return c.to + (c.from - c.to) * settleCurve(t, c.bounce);
    return c.to + c.from * arcCurve(t);
  }

  /** Advance to `now`; returns whether the lift still moves. */
  step(now: number): boolean {
    const c = this.curve;
    if (!c) {
      this.value = this.target;
      return false;
    }
    this.value = this.at(now);
    if (now - c.start >= c.dur) {
      this.value = c.to;
      this.curve = null;
    }
    return this.moving;
  }
}

/** The uniform scale a lifted card is drawn at: up to LIFT_SCALE larger at full lift (`liftMm`). */
export function liftScale(lift: number, liftMm: number): number {
  if (!(liftMm > 0) || !(lift > 0)) return 1;
  return 1 + LIFT_SCALE * Math.min(1.5, lift / liftMm);
}

/**
 * The shadow under a lifted card (M7-P4: "its shadow grows and softens"): it slides away from the light (toward the
 * viewer's lower right) and spreads, blurs and fades as the card rises. `lift` and `liftMm` in mm; null on the table.
 * The offset is in the viewer's frame (x right, y away), mm.
 */
export function liftShadow(lift: number, liftMm: number): { dx: number; dy: number; grow: number; blur: number; opacity: number } | null {
  if (!(lift > 0.05) || !(liftMm > 0)) return null;
  const k = Math.min(1.5, lift / liftMm);
  return { dx: 0.3 * lift, dy: -0.45 * lift, grow: 1 + 0.06 * k, blur: 1.5 + 4.5 * k, opacity: Math.min(0.32, 0.12 + 0.16 * k) };
}

/**
 * A riffle shuffle of a pile (M7-P4: "shuffle (a riffle of the library pile)"): the pile splits into two halves that
 * part sideways and interleave back. Card `i` of `n` (bottom first) at `t` (0..1): its sideways offset as a fraction of
 * the card width (viewer's frame) and its hop in mm.
 */
export function riffleOffset(i: number, n: number, t: number): { dx: number; dz: number } {
  const u = clamp01(t);
  if (u >= 1 || n <= 1) return { dx: 0, dz: 0 };
  const side = i < n / 2 ? -1 : 1;
  // The halves part and close; cards fall back in alternately, each a little later than the one below.
  const lag = n > 1 ? (i % 2 === 0 ? i / 2 : (i - 1) / 2) / Math.ceil(n / 2) : 0;
  const s = clamp01((u - lag * 0.25) / 0.75);
  const k = Math.sin(Math.PI * s);
  return k > 0 ? { dx: side * RIFFLE_SPREAD * k, dz: 2 * k } : { dx: 0, dz: 0 };
}

/** Start delays of a wave (untap all) over cards at `xs` (their position across the viewer's frame): left first, WAVE_STEP_MS apart, at most WAVE_MAX_MS in all. */
export function waveDelays(xs: readonly number[], stepMs = WAVE_STEP_MS, maxMs = WAVE_MAX_MS): number[] {
  if (xs.length <= 1) return xs.map(() => 0);
  const order = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x || a.i - b.i);
  const step = Math.min(stepMs, maxMs / (xs.length - 1));
  const out = new Array<number>(xs.length).fill(0);
  order.forEach((o, k) => (out[o.i] = k * step));
  return out;
}

/** A timed effect on a card or a pile (an animation the debug hook lists): its kind, start and length. */
export interface TimedEffect<K extends string = string> {
  kind: K;
  start: number;
  dur: number;
}

/** Progress of a timed effect at `now`, 0..1 (1 when it has no length). */
export function progressOf(e: { start: number; dur: number }, now: number): number {
  return e.dur <= 0 ? 1 : clamp01((now - e.start) / e.dur);
}

/** The length every card animation keeps to at full motion, ms (PLAN M7-P4: "Animations, each short (120–350 ms)"). */
export const ANIMATION_MS = { min: 120, max: 350 } as const;

/**
 * The card feel with its move durations kept within ANIMATION_MS (scaled like the rest by the motion setting: half under
 * 'subtle', none under reduced motion). `feel` is cardFeel's result for `scale` (scene/types.ts).
 */
export function feelWithin<F extends { durations: Record<string, number> }>(feel: F, scale: number): F {
  const lo = ANIMATION_MS.min * scale;
  const hi = ANIMATION_MS.max * scale;
  const durations: Record<string, number> = {};
  for (const [k, v] of Object.entries(feel.durations)) durations[k] = Math.min(hi, Math.max(lo, v));
  return { ...feel, durations: durations as F['durations'] };
}
