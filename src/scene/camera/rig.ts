/**
 * The table scene's camera: one rig with a continuous tilt from first person (t = 0: seated at the viewer's edge,
 * looking across the table) to bird's-eye (t = 1: straight down) (PLAN Milestone 7, Owner decisions after the first
 * design round, One continuous tilt; PLAN M7-P3). It replaces M4-P1's two rigs and their blend: the old rig names map
 * onto the ends of the tilt (scene/types.ts tiltForRig, rigForTilt). Pure maths and state, no Three.js: the scene copies
 * `pose()` onto its camera.
 *
 * State: the tilt (with a critically damped spring for eased moves), the look-at on the table and the visible
 * half-height there (scene/camera/tilt.ts). Every gesture works at every tilt and holds the table point under the
 * cursor exactly (moving the camera parallel to the table moves every table point with it, scene/camera/pose.ts
 * targetFor): pan, zoom at the cursor, fit, go to a seat, zoom to a card, pan inertia; the tilt itself keeps the table
 * point under its anchor (the cursor, the drag's start, else the view centre) while it moves. A fitted view stays the
 * fitted view of the tilt it is at, so the whole table stays in sight while the tilt moves from the fitted view.
 *
 * Limits (DESIGN "Camera and navigation": "the camera never goes below the table edge or behind the seat"; zoom from
 * the whole table plus a 5% margin to one card filling 80% of the viewport height): the look-at stays on the table;
 * the half-height between one card's and the fitted view's at that tilt; the camera at least `minHeight` above the
 * table and never further back than the seat (`behindEdge` behind the viewer's edge, pulled back as far as the fitted
 * views need: M5's "ego framing"). A view outside the limits (left by a resize, a theme or the HUD) is never pulled
 * back by a jump: a gesture keeps it or brings it toward the limits.
 *
 * Screen coordinates here are CSS px relative to the canvas' top-left corner.
 */
import { CAMERA, GEOMETRY } from '../../core/geometry';
import type { Rect } from '../../games/types';
import { DEG, clamp, forward } from '../math';
import { DEFAULT_EGO_RIG, TILT_PRESETS, rigForTilt, tiltForRig, type CameraBlendState, type CameraPose, type CameraRig, type EgoRigParams, type ScreenPoint, type TablePoint, type TiltEvent, type TiltSource } from '../types';
import { NO_INSETS, safeAreaOf, type FrameBox, type Insets } from './birdseye';
import { easeBlend } from './blend';
import { basis, dot, poseDist, posePxPerMm, projectPoint, rayDir, sub, targetFor, unprojectToTable, type Viewport } from './pose';
import { fromTableLocal, onCameraTable, tableCorners, toTableLocal, type CameraTable } from './table';
import {
  TILT_SNAP_RADIUS,
  halfForBack,
  halfForHeight,
  snapTilt,
  springSettled,
  springStep,
  tiltBack,
  tiltDist,
  tiltFov,
  tiltPitch,
  tiltPose,
  unitTilt,
  type TiltLens,
  type TiltLook,
} from './tilt';

/** Largest bird's-eye tilt a theme may ask for (DESIGN: Dusk is "slightly tilted"). */
export const MAX_BIRDSEYE_TILT_DEG = 30;
/** Pan inertia below this many CSS px per ms stops. */
const INERTIA_STOP_PX_PER_MS = 0.005;
/** Height of the highest thing the clip planes keep in view near the camera, mm (a lifted card on a tall pile). */
const CLIP_TOP_MM = GEOMETRY.dragLift * 4;
/** The near clip plane never comes closer than this, mm. */
const MIN_NEAR_MM = 1;
/** A screen point far outside any viewport: where points behind the camera "project". */
const OFF_SCREEN = -1e9;
/** The closest zoom: one card fills 80% of the viewport height at the look-at (half of the visible height, mm). */
const CLOSE_HALF = GEOMETRY.card.h / CAMERA.maxCardViewportFraction / 2;
/** Tilts at which the seat is checked against the fitted views (the seat is pulled back as far as the farthest needs). */
const SEAT_SAMPLES = 16;
/** A wheel or trackpad tilt snaps to a preset this long after its last step, ms. */
const WHEEL_SNAP_MS = 220;

/** The table as the rig sees it: a rectangle centred on the table centre, turned by `rot` (scene/camera/table.ts; M5-P7). */
export type TableSize = CameraTable;

export interface TableRigOptions {
  table: TableSize;
  viewport: Viewport;
  /** The viewer's seat angle: their side is at the bottom of the screen. */
  angle: number;
  inertiaMs: number;
  /** The tilt to start at (0 first person, 1 bird's-eye); wins over `rig`. */
  tilt?: number;
  /** The old rig to start in (birdseye = 1, ego = 0) when no tilt is given; neither means bird's-eye. */
  rig?: CameraRig;
  /** Theme overrides of the first-person lens and seat (Theme.camera.ego: field of view, pitch, seat, minimum height). */
  ego?: Partial<EgoRigParams>;
  /** Bird's-eye tilt from straight down (Theme.camera.birdseyeTiltDeg). */
  tiltDeg?: number;
  /** The viewer's seat offset along their right axis (kept for the scene; the rig has no lateral limit but the table). */
  lateral?: number;
  /** The HUD's insets at the start (the fitted view keeps clear of them). */
  insets?: Insets;
}

/** A tilt move in progress (spring toward `target`). */
interface TiltMove {
  /** Where the move started (the blend's progress is measured from here). */
  from: number;
  source: TiltSource;
}

/** The anchor a tilt holds: the table point and the screen point it stays under. */
type Anchor = { table: TablePoint; screen: ScreenPoint };

/** An eased move of the look-at and zoom (fit, seat keys, zoom to a card, follow); 'fit' follows the fitted view of the tilt as it moves. */
interface LookMove {
  from: TiltLook;
  to: TiltLook | 'fit';
  start: number;
  dur: number;
}

export class TableRig {
  table: TableSize;
  viewport: Viewport;
  inertiaMs: number;
  /** The first-person lens and seat (the theme's ego parameters over DESIGN's). */
  egoParams: EgoRigParams;
  /** The ego seat's place along the viewer's right axis (kept for the scene; unused by the limits). */
  lateral: number;
  /** What the fitted view frames: the table, plus what the scene draws outside its edges (other seats' hand rows). */
  frame: FrameBox;
  insets: Insets;
  /** Told when a tilt move starts, changes target and ends (SceneEvents.tilt; never per frame). */
  onTilt: ((e: TiltEvent) => void) | null = null;

  private angleDeg: number;
  private birdTiltDeg: number;
  /** The tilt now, its velocity (per ms) and where it is going. */
  private t: number;
  private tv = 0;
  private tTarget: number;
  private move: TiltMove | null = null;
  /** The table point a tilt move or drag holds under its screen point; null holds the view centre's. */
  private anchor: Anchor | null = null;
  /** A tilt dragged directly (right or middle drag, two-finger swipe): it follows the input, no spring. */
  private drag: { source: TiltSource } | null = null;
  /** When a wheel tilt snaps to a near preset (ms, the step clock), or null; and how long that snap eases. */
  private wheelSnapAt: number | null = null;
  private wheelDur = 1;
  /** The source of the tilt interaction between its 'start' and 'end' events, else null. */
  private active: TiltSource | null = null;
  private look: TiltLook;
  /** The view is the fitted view of its tilt: it stays fitted through tilts, resizes and HUD changes. */
  private fitted = true;
  private lookMove: LookMove | null = null;
  /** Pan inertia, look-at mm per ms. */
  private vel = { x: 0, y: 0 };
  /** The farthest a fitted view's camera stands behind the table centre, cached for the inputs it was computed for. */
  private seatCache: { key: string; back: number } | null = null;

  constructor(o: TableRigOptions) {
    this.table = o.table;
    this.viewport = o.viewport;
    this.angleDeg = o.angle;
    this.inertiaMs = o.inertiaMs;
    this.egoParams = { ...DEFAULT_EGO_RIG, ...(o.ego ?? {}) };
    this.birdTiltDeg = clamp(o.tiltDeg ?? 0, 0, MAX_BIRDSEYE_TILT_DEG);
    this.lateral = o.lateral ?? 0;
    this.frame = { x: 0, y: 0, w: o.table.w, d: o.table.d, ...(o.table.rot ? { rot: o.table.rot } : {}) };
    this.insets = o.insets ? { ...o.insets } : NO_INSETS;
    const start = o.tilt !== undefined ? unitTilt(o.tilt) : tiltForRig(o.rig ?? 'birdseye');
    this.t = start;
    this.tTarget = start;
    this.look = { x: 0, y: 0, half: 1 };
    this.look = this.fitAt(start);
  }

  get angle(): number {
    return this.angleDeg;
  }

  /** The lens at each end of the tilt. */
  lens(): TiltLens {
    const e = this.egoParams;
    return { pitch0: e.pitchDeg, fov0: e.fovDeg, pitch1: 90 - this.birdTiltDeg, fov1: CAMERA.birdseye.fovDeg };
  }

  // --- The tilt ---------------------------------------------------------------------------------------------------

  /** The tilt now (mid-move, the eased value). */
  tilt(): number {
    return this.t;
  }

  /** Where the tilt is going (the tilt itself at rest). */
  tiltTarget(): number {
    return this.tTarget;
  }

  /** The old rig the camera shows or is moving to (the nearer end of the tilt's target). */
  rig(): CameraRig {
    return rigForTilt(this.tTarget);
  }

  /** The look-at and zoom (a copy). */
  view(): TiltLook {
    return { ...this.look };
  }

  /** Whether the view is the fitted view of its tilt. */
  isFitted(): boolean {
    return this.fitted;
  }

  /**
   * Move the tilt to `t` (clamped): eased by the spring over about 400 ms, or cut with `dur` 0 (reduced motion). The
   * table point under `anchor` (canvas px; null: the view centre) stays under it; a fitted view without an anchor stays
   * fitted. A new target mid-move carries on from where the camera is, with its speed: nothing jumps.
   */
  setTilt(t: number, now: number, dur: number, anchor: ScreenPoint | null, source: TiltSource = 'api'): void {
    const target = unitTilt(t);
    this.drag = null;
    if (source !== 'wheel') this.wheelSnapAt = null;
    if (anchor) this.setAnchor(anchor);
    else if (!this.move) this.anchor = null;
    if (!this.fitted) this.lookMove = null;
    this.vel = { x: 0, y: 0 };
    if (target === this.tTarget && (this.move !== null || target === this.t)) {
      this.settleIfIdle();
      return;
    }
    this.tTarget = target;
    this.begin(source);
    if (dur <= 0) {
      const prev = this.t;
      this.move = null;
      this.tv = 0;
      this.t = target;
      this.applyTilt(prev);
      this.settleIfIdle();
      return;
    }
    this.move = { from: this.t, source };
  }

  /** Move the tilt by `dt` from where it is going (keys). */
  tiltBy(dt: number, now: number, dur: number, anchor: ScreenPoint | null, source: TiltSource = 'api'): void {
    if (!Number.isFinite(dt) || dt === 0) return;
    this.setTilt(this.tTarget + dt, now, dur, anchor, source);
  }

  /**
   * A wheel or trackpad tilt step: moves the target by `dt` like tiltBy and, once the wheel rests, snaps softly to a
   * preset nearby (PLAN M7-P3: "presets snap softly").
   */
  wheelTilt(dt: number, now: number, dur: number, anchor: ScreenPoint | null): void {
    if (!Number.isFinite(dt) || dt === 0) return;
    this.wheelSnapAt = now + WHEEL_SNAP_MS;
    this.wheelDur = dur;
    this.setTilt(this.tTarget + dt, now, dur, anchor, 'wheel');
  }

  /**
   * Start a direct tilt drag (right or middle mouse drag, two-finger vertical swipe): the tilt follows the input with no
   * spring and the table point under `anchor` (the press point) stays under it.
   */
  beginTiltDrag(anchor: ScreenPoint | null, source: TiltSource): void {
    this.vel = { x: 0, y: 0 };
    this.wheelSnapAt = null;
    this.move = null;
    this.tv = 0;
    this.tTarget = this.t;
    if (anchor) this.setAnchor(anchor);
    else this.anchor = null;
    if (!this.fitted) this.lookMove = null;
    this.drag = { source };
    this.begin(source);
  }

  /** Tilt a drag by `dt` (positive toward bird's-eye). */
  tiltDragBy(dt: number): void {
    if (!this.drag || !Number.isFinite(dt) || dt === 0) return;
    const next = unitTilt(this.t + dt);
    if (next === this.t) return;
    const prev = this.t;
    this.t = next;
    this.tTarget = next;
    this.applyTilt(prev);
  }

  /** The drag ended: a tilt near a preset eases onto it (soft snap), else it stays where the viewer left it. */
  endTiltDrag(now: number, dur: number): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const snapped = snapTilt(this.t, this.presets(), TILT_SNAP_RADIUS);
    if (snapped === this.t) {
      this.settleIfIdle();
      return;
    }
    this.tTarget = snapped;
    this.begin(d.source);
    if (dur <= 0) {
      const prev = this.t;
      this.t = snapped;
      this.applyTilt(prev);
      this.settleIfIdle();
      return;
    }
    this.move = { from: this.t, source: d.source };
  }

  /** Whether a tilt drag is in progress. */
  tiltDragging(): boolean {
    return this.drag !== null;
  }

  /** The tilt presets' values (first person, the middle view, bird's-eye). */
  presets(): number[] {
    return TILT_PRESETS.map((p) => p.tilt);
  }

  /** Switch to an old rig (P before M7; setRig): the tilt goes to that end. */
  setRig(rig: CameraRig, now: number, dur: number, anchor: ScreenPoint | null): void {
    this.setTilt(tiltForRig(rig), now, dur, anchor, 'api');
  }

  /** Pitch by `deg` (positive looks further down): the tilt moves at once by the matching share of its pitch range. */
  pitchBy(deg: number): void {
    if (!Number.isFinite(deg) || deg === 0) return;
    const l = this.lens();
    const span = l.pitch1 - l.pitch0;
    if (!(Math.abs(span) > 1e-9)) return;
    const dragging = this.drag !== null;
    if (!dragging) this.beginTiltDrag(null, 'api');
    this.tiltDragBy(deg / span);
    if (!dragging) {
      this.drag = null;
      this.settleIfIdle();
    }
  }

  private setAnchor(s: ScreenPoint): void {
    const a = this.screenToTableOrNull(s.x, s.y);
    // A cursor over the surround or above the horizon holds the view centre instead (outside the guarantee).
    this.anchor = a && onCameraTable(a, this.table) ? { table: a, screen: { x: s.x, y: s.y } } : null;
    if (this.anchor) this.fitted = false;
  }

  /** A tilt interaction starts, or one in progress changes its target. */
  private begin(source: TiltSource): void {
    if (this.active) {
      this.emit('change', source);
      return;
    }
    this.active = source;
    this.emit('start', source);
  }

  /** The tilt interaction is over once nothing moves it any more: 'end', and the anchor is let go. */
  private settleIfIdle(): void {
    if (this.move || this.drag || this.wheelSnapAt !== null) return;
    const s = this.active;
    this.anchor = null;
    if (!s) return;
    this.active = null;
    this.emit('end', s);
  }

  private emit(phase: TiltEvent['phase'], source: TiltSource): void {
    const fn = this.onTilt;
    if (!fn) return;
    fn({ phase, tilt: this.t, target: phase === 'end' ? this.t : this.tTarget, source });
  }

  /**
   * The tilt changed: carry the look-at with it. A fitted view becomes the fitted view of the new tilt; else the anchor
   * (or the view centre) stays put while the zoom keeps its half-height, within the limits of the new tilt.
   */
  private applyTilt(prev: number): void {
    if (this.fitted) {
      if (!this.lookMove) this.look = this.fitAt(this.t);
      return;
    }
    const a = this.anchor;
    const t = this.t;
    // Never further back than the seat, or than the camera stood before this step (a view left behind it by a resize).
    const bound = Math.max(this.seatBack(), this.cameraBack(this.look, prev));
    let half = this.clampHalf(this.look.half, t);
    let at: TablePoint = { x: this.look.x, y: this.look.y };
    for (let i = 0; i < 12; i++) {
      // The anchor is a table point: holding it may take the view centre past the table's edge (a cursor near a screen
      // edge), which the next pan or zoom only brings back (clampCentre with `keep`). Without one the centre stays.
      if (a) at = this.solve(t, half, a.table, a.screen) ?? at;
      const room = this.halfRoom(at, t, bound);
      if (half <= room + 1e-9) break;
      half = Math.max(this.minHalf(t), room);
    }
    half = Math.max(this.minHalf(t), Math.min(half, this.halfRoom(at, t, bound)));
    this.look = { x: at.x, y: at.y, half };
  }

  // --- Pose and projection ----------------------------------------------------------------------------------------

  /** The camera's pose now. */
  pose(): CameraPose {
    return tiltPose(this.lens(), this.t, this.look, this.angleDeg);
  }

  /** The pose for a tilt and look (the rig's lens and seat angle). */
  poseFor(t: number, look: TiltLook): CameraPose {
    return tiltPose(this.lens(), t, look, this.angleDeg);
  }

  /** A blend report for the old debug shape while a tilt move runs: its direction, progress and the anchor; null at rest. */
  blendState(): CameraBlendState | null {
    const m = this.move;
    if (!m) return null;
    const up = this.tTarget > m.from;
    const span = this.tTarget - m.from;
    const progress = Math.abs(span) > 1e-12 ? clamp((this.t - m.from) / span, 0, 1) : 1;
    const a = this.anchor;
    return { from: up ? 'ego' : 'birdseye', to: up ? 'birdseye' : 'ego', t: progress, durationMs: CAMERA.blendMs, anchor: a ? { table: { ...a.table }, screen: { ...a.screen } } : null };
  }

  /** CSS px per mm at the view centre. */
  pxPerMm(): number {
    return posePxPerMm(this.pose(), this.viewport);
  }

  /** CSS px per mm at a world point (near cards show larger than far ones in perspective); 0 at or behind the camera. */
  pxPerMmAt(p: TablePoint, z = 0, pose: CameraPose = this.pose()): number {
    const depth = this.depthOf(p, z, pose);
    return depth > 1e-6 ? this.viewport.h / 2 / (depth * Math.tan((pose.fovDeg / 2) * DEG)) : 0;
  }

  /** Canvas point of a table point at height z; far off screen when it lies behind the camera. */
  tableToScreen(p: TablePoint, z = 0, pose: CameraPose = this.pose()): ScreenPoint {
    const s = projectPoint(pose, this.angleDeg, this.viewport, [p.x, p.y, z]);
    return Number.isFinite(s.x) && Number.isFinite(s.y) ? { x: s.x, y: s.y } : { x: OFF_SCREEN, y: OFF_SCREEN };
  }

  /** Depth of a world point along the view direction (≤ 0 behind the camera). */
  depthOf(p: TablePoint, z = 0, pose: CameraPose = this.pose()): number {
    return dot(sub([p.x, p.y, z], pose.position), basis(this.angleDeg, pose.pitchDeg).d);
  }

  /** Table point under a canvas point, or null above the horizon. */
  screenToTableOrNull(x: number, y: number, pose: CameraPose = this.pose()): TablePoint | null {
    return unprojectToTable(pose, this.angleDeg, this.viewport, x, y);
  }

  /** The (x, y) where the ray through a canvas point crosses the plane at height `z`, or null (picking at a card's height). */
  screenToPlane(x: number, y: number, z: number, pose: CameraPose = this.pose()): TablePoint | null {
    return unprojectToTable(pose, this.angleDeg, this.viewport, x, y, z);
  }

  /**
   * A card's on-screen height in CSS px (DESIGN "Specification", Texture tiers): the projected length of its long axis
   * at height `z`, drawn at scale `k`; foreshortened when the view is tilted. 0 behind the camera; when the card
   * straddles the camera plane, the scale at its centre.
   */
  cardScreenHeight(p: { x: number; y: number; rot: number }, z = 0, k = 1, pose: CameraPose = this.pose()): number {
    const half = (GEOMETRY.card.h * k) / 2;
    const r = p.rot * DEG;
    const ux = Math.sin(r) * half;
    const uy = Math.cos(r) * half;
    const a = projectPoint(pose, this.angleDeg, this.viewport, [p.x + ux, p.y + uy, z]);
    const b = projectPoint(pose, this.angleDeg, this.viewport, [p.x - ux, p.y - uy, z]);
    if (!(a.depth > 1e-6) || !(b.depth > 1e-6)) return GEOMETRY.card.h * k * this.pxPerMmAt(p, z, pose);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** Table point under a canvas point; above the horizon, a point far away in that direction (nothing is there). */
  screenToTable(x: number, y: number, pose: CameraPose = this.pose()): TablePoint {
    const hit = this.screenToTableOrNull(x, y, pose);
    if (hit) return hit;
    const dir = rayDir(pose, this.angleDeg, this.viewport, x, y);
    const h = Math.hypot(dir[0], dir[1]) || 1;
    return { x: pose.position[0] + (dir[0] / h) * 1e6, y: pose.position[1] + (dir[1] / h) * 1e6 };
  }

  /** Near and far depths of the table, its frame and a little height (for the camera's clip planes). */
  depthRange(pose: CameraPose = this.pose()): { min: number; max: number } {
    const f = this.frame;
    const pts = [...tableCorners(this.table), ...tableCorners({ w: f.w, d: f.d, ...(f.rot ? { rot: f.rot } : {}) }).map((p) => ({ x: p.x + f.x, y: p.y + f.y }))];
    const x0 = Math.min(...pts.map((p) => p.x));
    const x1 = Math.max(...pts.map((p) => p.x));
    const y0 = Math.min(...pts.map((p) => p.y));
    const y1 = Math.max(...pts.map((p) => p.y));
    let min = Infinity;
    let max = -Infinity;
    for (const x of [x0, x1]) {
      for (const y of [y0, y1]) {
        for (const z of [0, CLIP_TOP_MM]) {
          const d = this.depthOf({ x, y }, z, pose);
          min = Math.min(min, d);
          max = Math.max(max, d);
        }
      }
    }
    return { min, max };
  }

  /** The nearest depth at which anything at or below CLIP_TOP_MM can show inside the view (the steepest ray's). */
  nearestVisibleDepth(pose: CameraPose = this.pose()): number {
    const dir = rayDir(pose, this.angleDeg, this.viewport, this.viewport.w / 2, this.viewport.h);
    const drop = pose.position[2] - CLIP_TOP_MM;
    if (!(dir[2] < -1e-9) || !(drop > 0)) return drop > 0 ? Infinity : 0;
    return drop / -dir[2];
  }

  /**
   * The camera's clip planes: near just in front of the nearest thing that can show, far behind the table's farthest
   * corner (a tilted view sees past the table: what a theme draws beyond it is kept). Near never drops to a millimetre
   * while far stays in metres: depth precision near the table stays fine.
   */
  clipPlanes(pose: CameraPose = this.pose()): { near: number; far: number } {
    const depth = this.depthRange(pose);
    const nearest = Math.max(depth.min, Math.min(this.nearestVisibleDepth(pose), depth.max));
    const near = Math.max(MIN_NEAR_MM, nearest / 2);
    const far = pose.pitchDeg < 89.999 ? Math.max(depth.max + 400, depth.max * 4) : depth.max + 400;
    return { near, far };
  }

  /** The view centre and its distance (the debug hook's table view). */
  centre(): { x: number; y: number; dist: number } {
    const p = this.pose();
    return { x: p.target[0], y: p.target[1], dist: poseDist(p) };
  }

  /** Whether a table point shows inside the viewport inset by `marginPx`. */
  shows(p: TablePoint, marginPx = 0): boolean {
    const s = this.tableToScreen(p);
    const vp = this.viewport;
    return s.x >= marginPx && s.y >= marginPx && s.x <= vp.w - marginPx && s.y <= vp.h - marginPx;
  }

  get moving(): boolean {
    return this.move !== null || this.lookMove !== null || this.vel.x !== 0 || this.vel.y !== 0 || this.wheelSnapAt !== null;
  }

  /** A tilt move is easing (the old blend). */
  get switching(): boolean {
    return this.move !== null;
  }

  /** Cancel look moves and inertia (not a tilt move). */
  stop(): void {
    this.lookMove = null;
    this.vel = { x: 0, y: 0 };
  }

  /** Advance the tilt spring, the look moves and inertia; returns whether the pose changed. */
  step(now: number, dtMs: number): boolean {
    let changed = false;
    if (this.wheelSnapAt !== null && now >= this.wheelSnapAt && !this.drag) {
      this.wheelSnapAt = null;
      const snapped = snapTilt(this.tTarget, this.presets(), TILT_SNAP_RADIUS);
      if (snapped !== this.tTarget) {
        this.tTarget = snapped;
        this.begin('wheel');
        if (this.wheelDur <= 0) {
          const prev = this.t;
          this.move = null;
          this.t = snapped;
          this.applyTilt(prev);
          changed = true;
        } else if (!this.move) this.move = { from: this.t, source: 'wheel' };
      }
      this.settleIfIdle();
    }
    const m = this.move;
    if (m) {
      const prev = this.t;
      const s = springStep(this.t, this.tv, this.tTarget, Math.max(0, dtMs));
      if (springSettled(s.x, s.v, this.tTarget) || !Number.isFinite(s.x)) {
        this.t = this.tTarget;
        this.tv = 0;
        this.move = null;
      } else {
        this.t = unitTilt(s.x);
        this.tv = s.v;
      }
      this.applyTilt(prev);
      if (!this.move) this.settleIfIdle();
      changed = true;
    }
    const lm = this.lookMove;
    if (lm) {
      const u = lm.dur > 0 ? clamp((now - lm.start) / lm.dur, 0, 1) : 1;
      const e = easeBlend(u);
      const to = lm.to === 'fit' ? this.fitAt(this.t) : lm.to;
      // Never below the minimum height, even when the tilt changed under the move.
      this.look = {
        x: lm.from.x + (to.x - lm.from.x) * e,
        y: lm.from.y + (to.y - lm.from.y) * e,
        half: Math.max(this.minHalf(this.t), Math.exp(Math.log(lm.from.half) + (Math.log(to.half) - Math.log(lm.from.half)) * e)),
      };
      if (u >= 1) this.lookMove = null;
      return true;
    }
    if (this.vel.x === 0 && this.vel.y === 0) return changed;
    // Exponential decay with time constant inertiaMs: x(t) = v0 * tau * (1 - e^(-t/tau)).
    const tau = Math.max(1, this.inertiaMs);
    const decay = Math.exp(-dtMs / tau);
    const travel = tau * (1 - decay);
    const before = this.look;
    const at = this.clampCentre({ x: before.x + this.vel.x * travel, y: before.y + this.vel.y * travel }, before);
    this.look = { ...before, x: at.x, y: at.y, half: Math.min(before.half, Math.max(this.minHalf(this.t), this.halfRoom(at, this.t, Math.max(this.seatBack(), this.cameraBack(before, this.t))))) };
    this.vel = { x: this.vel.x * decay, y: this.vel.y * decay };
    const speedPx = Math.hypot(this.vel.x, this.vel.y) * this.pxPerMm();
    if (speedPx < INERTIA_STOP_PX_PER_MS || (this.look.x === before.x && this.look.y === before.y)) this.vel = { x: 0, y: 0 };
    return true;
  }

  // --- Gestures (every tilt) --------------------------------------------------------------------------------------

  /**
   * Move the table by (dx, dy) CSS px on screen, as if dragging it: the table point that was under `at - d` (the
   * pointer's last place; absent: the view centre's) comes under `at`. A tilt move in progress keeps going about the
   * view centre.
   */
  panBy(dx: number, dy: number, at?: ScreenPoint): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return;
    this.fitted = false;
    this.lookMove = null;
    this.anchor = null;
    const vp = this.viewport;
    const to = at ?? { x: vp.w / 2, y: vp.h / 2 };
    let a = this.screenToTableOrNull(to.x - dx, to.y - dy);
    let s = to;
    if (!a) {
      // Above the horizon: drag the view centre's point by the same screen distance instead.
      const c = { x: vp.w / 2, y: vp.h / 2 };
      a = this.screenToTableOrNull(c.x - dx, c.y - dy) ?? this.screenToTable(c.x - dx, c.y - dy);
      s = c;
    }
    const next = this.solve(this.t, this.look.half, a, s);
    if (!next) return;
    const at2 = this.clampCentre(next, this.look);
    const bound = Math.max(this.seatBack(), this.cameraBack(this.look, this.t));
    this.look = { x: at2.x, y: at2.y, half: Math.min(this.look.half, Math.max(this.minHalf(this.t), this.halfRoom(at2, this.t, bound))) };
  }

  /** Zoom by `factor` (> 1 zooms in) keeping the table point under (x, y) fixed, within the zoom limits. */
  zoomAt(x: number, y: number, factor: number): void {
    if (!Number.isFinite(factor) || !(factor > 0)) return;
    this.fitted = false;
    this.lookMove = null;
    this.vel = { x: 0, y: 0 };
    this.anchor = null;
    const t = this.t;
    const vp = this.viewport;
    const centre = { x: vp.w / 2, y: vp.h / 2 };
    let s: ScreenPoint = { x, y };
    let a = this.screenToTableOrNull(x, y);
    if (!a || !onCameraTable(a, this.table)) {
      // Over the surround or above the horizon: pivot on the nearest table point, so the zoom heads for the table and
      // the clamp never makes it jump (the view centre's, when that point is behind the camera).
      const q = this.clampToTableRect(a ?? { x: this.look.x, y: this.look.y });
      const sq = this.tableToScreen(q);
      const shown = sq.x > -1e8 && this.depthOf(q) > 1e-6;
      a = shown ? q : this.clampToTableRect({ x: this.look.x, y: this.look.y });
      s = shown ? sq : this.tableToScreen(a);
      if (!(s.x > -1e8)) {
        s = centre;
        a = { x: this.look.x, y: this.look.y };
      }
    }
    const keep = this.look;
    const bound = Math.max(this.seatBack(), this.cameraBack(keep, t));
    const lo = Math.min(this.minHalf(t), keep.half);
    const hi = Math.max(this.maxHalf(t), keep.half);
    let half = clamp(keep.half / factor, lo, hi);
    let at: TablePoint = { x: keep.x, y: keep.y };
    for (let i = 0; i < 12; i++) {
      at = this.solve(t, half, a, s) ?? at;
      at = this.clampCentre(at, keep);
      const room = Math.max(this.halfRoom(at, t, bound), Math.min(half, keep.half));
      if (half <= room + 1e-9) break;
      half = Math.max(lo, room);
    }
    // Whatever the solve left, the seat holds (the cursor's point may then slip a little at the limit).
    half = Math.max(lo, Math.min(half, Math.max(this.halfRoom(at, t, bound), Math.min(half, keep.half))));
    this.look = { x: at.x, y: at.y, half };
  }

  /** Start release inertia with a screen velocity in CSS px per ms (pan release). */
  fling(vxPx: number, vyPx: number): void {
    if (!Number.isFinite(vxPx) || !Number.isFinite(vyPx)) return;
    const vp = this.viewport;
    const c = { x: vp.w / 2, y: vp.h / 2 };
    const k = 10;
    const a0 = this.screenToTableOrNull(c.x, c.y);
    const a1 = this.screenToTableOrNull(c.x - vxPx * k, c.y - vyPx * k);
    if (!a0 || !a1) return;
    this.lookMove = null;
    this.vel = { x: (a1.x - a0.x) / k, y: (a1.y - a0.y) / k };
  }

  // --- Moves (eased over `dur` ms; 0 cuts) ------------------------------------------------------------------------

  /** Fit the whole table (key 0) at the tilt the camera is at or going to; it stays fitted while the tilt moves. */
  fit(now: number, dur: number): void {
    this.fitted = true;
    this.anchor = null;
    this.vel = { x: 0, y: 0 };
    if (dur <= 0) {
      this.lookMove = null;
      this.look = this.fitAt(this.t);
      return;
    }
    this.lookMove = { from: { ...this.look }, to: 'fit', start: now, dur };
  }

  /**
   * Frame an oriented rect (a seat's territory: keys 1–4, Home, avatar taps) at the tilt the camera is going to: its
   * centre at the centre of the HUD's free area, zoomed so the whole rect shows with a 5% margin (straight down, the
   * bird's-eye rig's seat view).
   */
  goToRect(r: Rect, now: number, dur: number): void {
    this.toLook(this.clampLook(this.rectLook(this.tTarget, r), this.tTarget), now, dur);
  }

  /** The look that centres a rect in the free area at tilt t, as close as the whole rect still fits with a 5% margin. */
  rectLook(t: number, r: Rect): TiltLook {
    const u = unitTilt(t);
    const safe = safeAreaOf(this.viewport, this.insets);
    const sc = { x: safe.x + safe.w / 2, y: safe.y + safe.h / 2 };
    const pts = tableCorners({ w: r.w, d: r.d, rot: r.rot }).map((p) => ({ x: p.x + r.x, y: p.y + r.y }));
    const m = CAMERA.fitMargin / 2;
    const at = (half: number): TiltLook => {
      const c = this.solve(u, half, { x: r.x, y: r.y }, sc);
      return { x: c?.x ?? r.x, y: c?.y ?? r.y, half };
    };
    const fits = (half: number): boolean => {
      const b = this.screenBox(this.poseFor(u, at(half)), pts);
      if (!b) return false;
      return b.x0 >= safe.x + safe.w * m && b.x1 <= safe.x + safe.w * (1 - m) && b.y0 >= safe.y + safe.h * m && b.y1 <= safe.y + safe.h * (1 - m);
    };
    let lo = this.minHalf(u);
    let hi = Math.max(lo, this.maxHalf(u));
    if (fits(lo)) return at(lo);
    if (!fits(hi)) return at(hi);
    for (let i = 0; i < 40; i++) {
      const mid = Math.sqrt(lo * hi);
      if (fits(mid)) hi = mid;
      else lo = mid;
    }
    return at(hi);
  }

  /** Centre a table point: 'close' zooms to one card at 80% of the viewport height (key Z), 'keep' keeps the zoom. */
  focus(p: TablePoint, mode: 'close' | 'keep', now: number, dur: number): void {
    const half = mode === 'close' ? CLOSE_HALF : this.look.half;
    this.toLook(this.clampLook({ x: p.x, y: p.y, half }, this.tTarget), now, dur);
  }

  private toLook(to: TiltLook, now: number, dur: number): void {
    this.fitted = false;
    this.anchor = null;
    this.vel = { x: 0, y: 0 };
    if (dur <= 0) {
      this.lookMove = null;
      this.look = to;
      return;
    }
    this.lookMove = { from: { ...this.look }, to, start: now, dur };
  }

  // --- Limits -----------------------------------------------------------------------------------------------------

  /** The closest zoom at tilt t: one card at 80% of the viewport height, and never below the minimum height. */
  minHalf(t: number): number {
    return Math.max(CLOSE_HALF, halfForHeight(this.lens(), t, this.egoParams.minHeight));
  }

  /** The farthest zoom at tilt t: the fitted view of the whole table (its frame) with a 5% margin. */
  maxHalf(t: number): number {
    return Math.max(this.fitAt(t).half, this.minHalf(t));
  }

  /** How far behind the table centre (along the viewer's forward axis) a table point lies. */
  private backOf(p: TablePoint): number {
    const f = forward(this.angleDeg);
    return -(p.x * f.x + p.y * f.y);
  }

  /** How far behind the table centre the camera stands for a look at tilt t. */
  cameraBack(look: TiltLook, t: number): number {
    return this.backOf(look) + tiltBack(this.lens(), t, look.half);
  }

  /**
   * The seat: how far behind the table centre the camera may stand. DESIGN's seat (`behindEdge` behind the viewer's
   * table edge), pulled back as far as the fitted views at any tilt need (M5 owner decision, ego framing: "the ego seat
   * is reframed (pulled back, raised or widened …) so your own pile column … and your whole battlefield row are on
   * screen at the default ego view").
   */
  seatBack(): number {
    const own = halfDepth(this.table, this.angleDeg) + this.egoParams.behindEdge;
    const key = this.limitsKey();
    if (this.seatCache?.key !== key) {
      const backAt = (t: number) => this.cameraBack(this.frameLook(t, this.frameCorners()), t);
      let back = -Infinity;
      let best = 0;
      for (let i = 0; i <= SEAT_SAMPLES; i++) {
        const b = backAt(i / SEAT_SAMPLES);
        if (b > back) {
          back = b;
          best = i;
        }
      }
      // The farthest lies between the samples next to the best one: narrow it down (golden section), then keep a
      // millimetre to spare so no fitted view ever stands behind the seat.
      let lo = Math.max(0, best - 1) / SEAT_SAMPLES;
      let hi = Math.min(SEAT_SAMPLES, best + 1) / SEAT_SAMPLES;
      const g = (Math.sqrt(5) - 1) / 2;
      for (let i = 0; i < 16; i++) {
        const a = hi - g * (hi - lo);
        const b = lo + g * (hi - lo);
        const fa = backAt(a);
        const fb = backAt(b);
        back = Math.max(back, fa, fb);
        if (fa > fb) hi = b;
        else lo = a;
      }
      this.seatCache = { key, back: back + 1 };
    }
    return Math.max(own, this.seatCache.back);
  }

  /** The largest half-height a look-at at `at` allows at tilt t with the camera no further back than `bound`. */
  private halfRoom(at: TablePoint, t: number, bound: number): number {
    return halfForBack(this.lens(), t, bound - this.backOf(at));
  }

  private clampHalf(half: number, t: number): number {
    const lo = this.minHalf(t);
    return clamp(Number.isFinite(half) ? half : this.maxHalf(t), lo, Math.max(lo, this.maxHalf(t)));
  }

  /** A look clamped to the limits at tilt t (a fresh destination: no allowance for where the camera is now). */
  clampLook(l: TiltLook, t: number): TiltLook {
    const at = this.clampCentre(l, null);
    const half = this.clampHalf(l.half, t);
    const room = this.halfRoom(at, t, this.seatBack());
    return { x: at.x, y: at.y, half: Math.max(this.minHalf(t), Math.min(half, room)) };
  }

  /** The look-at clamped onto the table; with `keep`, it may stay as far beyond the table as `keep` is (no jump). */
  private clampCentre(p: TablePoint, keep: TablePoint | null): TablePoint {
    const t = this.table;
    const hw = t.w / 2;
    const hd = t.d / 2;
    const k = keep ? toTableLocal(keep, t) : null;
    const x0 = k ? Math.min(-hw, k.x) : -hw;
    const x1 = k ? Math.max(hw, k.x) : hw;
    const y0 = k ? Math.min(-hd, k.y) : -hd;
    const y1 = k ? Math.max(hd, k.y) : hd;
    const c = toTableLocal(p, t);
    return fromTableLocal({ x: clamp(c.x, x0, x1), y: clamp(c.y, y0, y1) }, t);
  }

  private clampToTableRect(p: TablePoint): TablePoint {
    return this.clampCentre(p, null);
  }

  /** The look-at that puts table point `a` under screen point `s` at tilt t and half-height `half`; null when the ray misses the table. */
  private solve(t: number, half: number, a: TablePoint, s: ScreenPoint): TablePoint | null {
    const l = this.lens();
    return targetFor(tiltPitch(l, t), tiltDist(l, t, half), tiltFov(l, t), this.angleDeg, this.viewport, a, s);
  }

  // --- Framing ----------------------------------------------------------------------------------------------------

  /** A key for everything the fitted views depend on. */
  private limitsKey(): string {
    const i = this.insets;
    const f = this.frame;
    const l = this.lens();
    const t = this.table;
    return [this.viewport.w, this.viewport.h, i.top, i.right, i.bottom, i.left, f.x, f.y, f.w, f.d, f.rot ?? 0, t.w, t.d, t.rot ?? 0, this.angleDeg, l.pitch0, l.fov0, l.pitch1, l.fov1].join(',');
  }

  private fitCache = new Map<number, TiltLook>();
  private fitCacheKey = '';

  /** The fitted view at tilt t: the frame (the table and what is drawn beyond it) with a 5% margin in the HUD's free area. */
  fitAt(t: number): TiltLook {
    const key = this.limitsKey();
    if (key !== this.fitCacheKey) {
      this.fitCacheKey = key;
      this.fitCache.clear();
    }
    const u = unitTilt(t);
    const hit = this.fitCache.get(u);
    if (hit) return { ...hit };
    const look = this.frameLook(u, this.frameCorners());
    if (this.fitCache.size > 256) this.fitCache.clear();
    this.fitCache.set(u, look);
    return { ...look };
  }

  /** The corners of what the fitted view frames. */
  private frameCorners(): TablePoint[] {
    const f = this.frame;
    return tableCorners({ w: f.w, d: f.d, ...(f.rot ? { rot: f.rot } : {}) }).map((p) => ({ x: p.x + f.x, y: p.y + f.y }));
  }

  /**
   * The look that frames `pts` at tilt t with a 5% margin, centred in the HUD's free area (the safe area): the look-at
   * moves the points' screen box to the free area's centre and the zoom scales it to fit, repeated until it holds
   * (exact in one or two rounds straight down, a few more in perspective).
   */
  frameLook(t: number, pts: readonly TablePoint[]): TiltLook {
    const u = unitTilt(t);
    const safe = safeAreaOf(this.viewport, this.insets);
    const m = 1 + CAMERA.fitMargin;
    const centred = this.frameAt(u, pts, 0, null);
    if (u >= 1) return centred;
    // Seated, your own side sits low, just above the hand: a frame the free area's width limits leaves room above and
    // below it, and the lower tilts move it down into the room below (all of it in first person, none straight down).
    const box0 = this.screenBox(this.poseFor(u, centred), pts);
    if (!box0) return centred;
    const limit = safe.y + safe.h - ((box0.y1 - box0.y0) * (m - 1)) / 2;
    const room = limit - box0.y1;
    if (!(room > 0.5)) return centred;
    // Moving the box's target down moves its bottom edge down by about as much: a few corrections find the slide
    // that puts it on the limit.
    let d = room;
    let best = centred;
    for (let i = 0; i < 10; i++) {
      const lk = this.frameAt(u, pts, d, best);
      const b = this.screenBox(this.poseFor(u, lk), pts);
      if (!b) break;
      best = lk;
      const err = b.y1 - limit;
      if (Math.abs(err) < 0.05) break;
      d = clamp(d - err, 0, 2 * room);
    }
    const slide = d * (1 - u);
    return slide > 0.01 ? this.frameAt(u, pts, slide, best) : centred;
  }

  /**
   * The look whose view shows `pts` fitted to the HUD's free area with a 5% margin, their screen box centred `down` px
   * below the free area's centre: the look-at moves the box's centre there and the zoom scales it to fit, repeated
   * until it holds (exact in one or two rounds straight down, a few more in perspective).
   */
  private frameAt(u: number, pts: readonly TablePoint[], down: number, start: TiltLook | null): TiltLook {
    const vp = this.viewport;
    const safe = safeAreaOf(vp, this.insets);
    const sc = { x: safe.x + safe.w / 2, y: safe.y + safe.h / 2 + down };
    const m = 1 + CAMERA.fitMargin;
    let look: TiltLook;
    if (start) look = { ...start };
    else {
      const cx = pts.reduce((s, p) => s + p.x, 0) / Math.max(1, pts.length);
      const cy = pts.reduce((s, p) => s + p.y, 0) / Math.max(1, pts.length);
      let span = 0;
      for (const p of pts) span = Math.max(span, Math.hypot(p.x - cx, p.y - cy));
      look = { x: cx, y: cy, half: Math.max(CLOSE_HALF, span) };
    }
    const l = this.lens();
    for (let i = 0; i < 80; i++) {
      const pose = tiltPose(l, u, look, this.angleDeg);
      const box = this.screenBox(pose, pts);
      if (!box) {
        look = { ...look, half: look.half * 2 };
        continue;
      }
      const k = Math.max(((box.x1 - box.x0) * m) / Math.max(1e-9, safe.w), ((box.y1 - box.y0) * m) / Math.max(1e-9, safe.h), 1e-6);
      const bc = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
      const p = unprojectToTable(pose, this.angleDeg, vp, bc.x, bc.y);
      const q = unprojectToTable(pose, this.angleDeg, vp, sc.x, sc.y);
      if (!p || !q) {
        look = { ...look, half: look.half * k };
        continue;
      }
      // Slide the box's centre to the target point, then zoom about the table point there (a zoom about a table point
      // keeps it where it shows), so the box scales in place.
      const lx = look.x + p.x - q.x;
      const ly = look.y + p.y - q.y;
      look = { x: p.x + (lx - p.x) * k, y: p.y + (ly - p.y) * k, half: look.half * k };
      if (Math.abs(k - 1) < 1e-12 && Math.hypot(bc.x - sc.x, bc.y - sc.y) < 1e-7) break;
    }
    return look;
  }

  /** The screen box of table points under a pose, or null when one lies behind the camera. */
  private screenBox(pose: CameraPose, pts: readonly TablePoint[]): { x0: number; x1: number; y0: number; y1: number } | null {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      const s = projectPoint(pose, this.angleDeg, this.viewport, [p.x, p.y, 0]);
      if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) return null;
      x0 = Math.min(x0, s.x);
      x1 = Math.max(x1, s.x);
      y0 = Math.min(y0, s.y);
      y1 = Math.max(y1, s.y);
    }
    return { x0, x1, y0, y1 };
  }

  // --- Viewport, HUD, table and theme -----------------------------------------------------------------------------

  /** After a change of what the fitted view depends on: a fitted view is refitted, any other clamped without a jump. */
  private refit(): void {
    if (this.fitted) {
      if (!this.lookMove) this.look = this.fitAt(this.t);
      return;
    }
    const at = this.clampCentre(this.look, this.look);
    this.look = { x: at.x, y: at.y, half: clamp(this.look.half, Math.min(this.minHalf(this.t), this.look.half), Math.max(this.maxHalf(this.t), this.look.half)) };
  }

  resize(vp: Viewport): void {
    if (vp.w === this.viewport.w && vp.h === this.viewport.h) return;
    this.viewport = { w: vp.w, h: vp.h };
    this.refit();
  }

  /** The HUD's screen-layer insets: the fitted view keeps clear of them. */
  setInsets(insets: Insets): void {
    const i = this.insets;
    if (i.top === insets.top && i.right === insets.right && i.bottom === insets.bottom && i.left === insets.left) return;
    this.insets = { top: insets.top, right: insets.right, bottom: insets.bottom, left: insets.left };
    this.refit();
  }

  /** Change what the fitted view frames; a view that was fitted stays fitted. */
  setFrame(frame: FrameBox): void {
    const f = this.frame;
    if (f.x === frame.x && f.y === frame.y && f.w === frame.w && f.d === frame.d && (f.rot ?? 0) === (frame.rot ?? 0)) return;
    this.frame = { ...frame };
    this.refit();
  }

  /**
   * A new table or viewer seat: the view starts over at the fitted view, at the same tilt (PLAN M7-P3: "seat switching
   * keeps the tilt"); a tilt move lands on its target.
   */
  setTable(table: TableSize, angle: number, frame?: FrameBox, lateral = 0): void {
    this.table = table;
    this.angleDeg = angle;
    this.frame = frame ? { ...frame } : { x: 0, y: 0, w: table.w, d: table.d, ...(table.rot ? { rot: table.rot } : {}) };
    this.lateral = lateral;
    this.move = null;
    this.drag = null;
    this.wheelSnapAt = null;
    this.tv = 0;
    this.t = this.tTarget;
    this.stop();
    this.fitted = true;
    this.look = this.fitAt(this.t);
    this.settleIfIdle();
  }

  /** A theme's camera defaults: the first-person lens and seat, and the bird's-eye tilt (the view is kept, re-clamped). */
  setTheme(ego: Partial<EgoRigParams> | undefined, tiltDeg: number | undefined): void {
    this.egoParams = { ...DEFAULT_EGO_RIG, ...(ego ?? {}) };
    this.birdTiltDeg = clamp(tiltDeg ?? 0, 0, MAX_BIRDSEYE_TILT_DEG);
    this.refit();
  }
}

/** Half the table's extent along the viewer's forward axis (the distance from the centre to the viewer's edge). */
export function halfDepth(table: TableSize, angleDeg: number): number {
  const f = forward(angleDeg - (table.rot ?? 0));
  return (Math.abs(f.x) * table.w + Math.abs(f.y) * table.d) / 2;
}

/** Offset of a point along the viewer's right axis (the ego seat's lateral place in front of a territory). */
export function lateralOf(p: TablePoint, angleDeg: number): number {
  const b = basis(angleDeg, 90);
  return p.x * b.r[0] + p.y * b.r[1];
}
