/**
 * The table scene's camera: the bird's-eye rig, the ego rig and the blend between them (DESIGN "Camera and
 * navigation"; "Specification: geometry, layout and motion", Camera rigs and Motion). M4-P1.
 *
 * One perspective camera; each rig keeps its own state (the bird's-eye view, the ego navigation) and reduces to a
 * CameraPose. Every gesture works in both rigs: pan, zoom at the cursor, fit, go to a seat, zoom to a card; pitch is
 * the ego rig's alone. Switching rigs is a 400 ms blend that keeps the table point under the anchor (the cursor) under
 * it; reduced motion (duration 0) cuts. Pure maths and state, no Three.js: the scene copies `pose()` onto its camera.
 *
 * Screen coordinates here are CSS px relative to the canvas' top-left corner.
 */
import { GEOMETRY } from '../../core/geometry';
import type { Rect } from '../../games/types';
import { DEG, clamp } from '../math';
import { DEFAULT_EGO_RIG, type CameraBlendState, type CameraPose, type CameraRig, type EgoRigParams, type ScreenPoint, type TablePoint } from '../types';
import { BirdseyeRig, type CameraView, type FrameBox, type Insets } from './birdseye';
import { blendPose, easeBlend } from './blend';
import {
  clampEgoNav,
  defaultEgoNav,
  egoAimNav,
  egoFitNav,
  egoFrameDist,
  egoLimitsFor,
  egoLimitsWith,
  egoPanNav,
  egoPitchNav,
  egoPose,
  egoSwitchNav,
  egoZoomNav,
  type EgoNav,
  type TableSize,
} from './ego';
import { basis, dot, poseAt, poseDist, posePxPerMm, projectPoint, rayDir, sub, targetFor, unprojectToTable, type Viewport } from './pose';

/** Largest bird's-eye tilt a theme may ask for (DESIGN: Dusk is "slightly tilted"). */
export const MAX_BIRDSEYE_TILT_DEG = 30;
/** Pan inertia below this many CSS px per ms stops. */
const INERTIA_STOP_PX_PER_MS = 0.005;
/** Height of the highest thing the clip planes keep in view near the camera, mm (a lifted card on a tall pile). */
const CLIP_TOP_MM = GEOMETRY.dragLift * 4;
/** The near clip plane never comes closer than this, mm (the ego camera stays at least 120 mm above the table). */
const MIN_NEAR_MM = 1;
/** A screen point far outside any viewport: where points behind the camera "project". */
const OFF_SCREEN = -1e9;

export interface TableRigOptions {
  table: TableSize;
  viewport: Viewport;
  /** The viewer's seat angle: their side is at the bottom of the screen. */
  angle: number;
  inertiaMs: number;
  /** The rig to start in. */
  rig: CameraRig;
  /** Theme overrides of the ego rig's parameters (Theme.camera.ego). */
  ego?: Partial<EgoRigParams>;
  /** Bird's-eye tilt from straight down (Theme.camera.birdseyeTiltDeg). */
  tiltDeg?: number;
  /** The viewer's seat offset along their right axis (the ego seat sits in front of their territory). */
  lateral?: number;
}

interface RigSwitch {
  from: CameraPose;
  fromRig: CameraRig;
  toRig: CameraRig;
  start: number;
  dur: number;
  /** Raw progress 0..1. */
  t: number;
  anchor: { table: TablePoint; screen: ScreenPoint } | null;
}

export class TableRig {
  readonly bird: BirdseyeRig;
  /** The theme's ego parameters; `ego` widens their lean to the table and seat. */
  egoParams: EgoRigParams;
  nav: EgoNav;
  lateral: number;
  private tilt: number;
  private active: CameraRig;
  private egoAnim: { from: EgoNav; to: EgoNav; start: number; dur: number } | null = null;
  /** Ego pan inertia, navigation mm per ms. */
  private egoVel = { lean: 0, dolly: 0 };
  private sw: RigSwitch | null = null;

  constructor(o: TableRigOptions) {
    this.bird = new BirdseyeRig(o.table, o.viewport, o.angle, o.inertiaMs);
    this.egoParams = { ...DEFAULT_EGO_RIG, ...(o.ego ?? {}) };
    this.lateral = o.lateral ?? 0;
    this.nav = defaultEgoNav(this.ego);
    this.tilt = clamp(o.tiltDeg ?? 0, 0, MAX_BIRDSEYE_TILT_DEG);
    this.active = o.rig;
  }

  /** The ego rig's limits on this table from this seat (the lean reaches the table's far side edge). */
  get ego(): EgoRigParams {
    return egoLimitsFor(this.egoParams, this.table, this.angle, this.lateral);
  }

  get viewport(): Viewport {
    return this.bird.viewport;
  }
  get angle(): number {
    return this.bird.view.angle;
  }
  get table(): TableSize {
    return this.bird.table;
  }
  get inertiaMs(): number {
    return this.bird.inertiaMs;
  }
  set inertiaMs(ms: number) {
    this.bird.inertiaMs = ms;
  }

  /** The rig shown, or being blended to. */
  rig(): CameraRig {
    return this.active;
  }

  /** The bird's-eye pitch: straight down, less the theme's tilt. */
  birdPitch(): number {
    return 90 - this.tilt;
  }

  birdPose(v: CameraView = this.bird.view): CameraPose {
    return poseAt({ x: v.cx, y: v.cy }, v.dist, this.birdPitch(), this.bird.fovDeg, this.angle);
  }

  /**
   * The ego limits gestures and poses are clamped to: the rig's limits grown to include navigation `n` (the current one
   * by default). A switch may land beyond the limits to hold the cursor's table point; from there a gesture keeps it or
   * brings it back toward the limits, never further out, so nothing jumps (egoLimitsWith; DECISIONS [M4-P1 review]).
   */
  egoReach(n: EgoNav = this.nav): EgoRigParams {
    return egoLimitsWith(this.ego, n);
  }

  egoPoseOf(nav: EgoNav = this.nav): CameraPose {
    return egoPose(this.egoReach(), this.table, this.angle, nav, this.lateral);
  }

  /** A rig's own pose, without the blend. */
  restPose(rig: CameraRig = this.active): CameraPose {
    return rig === 'ego' ? this.egoPoseOf() : this.birdPose();
  }

  /** The camera's pose now (mid-blend while switching). */
  pose(): CameraPose {
    const sw = this.sw;
    if (!sw) return this.restPose();
    return blendPose(sw.from, this.restPose(sw.toRig), easeBlend(sw.t), this.viewport, sw.anchor, this.angle);
  }

  /** The blend in progress (anchor in canvas px), or null. */
  blendState(): CameraBlendState | null {
    const sw = this.sw;
    if (!sw) return null;
    return { from: sw.fromRig, to: sw.toRig, t: easeBlend(sw.t), durationMs: sw.dur, anchor: sw.anchor ? { table: { ...sw.anchor.table }, screen: { ...sw.anchor.screen } } : null };
  }

  /** CSS px per mm at the view centre. */
  pxPerMm(): number {
    return posePxPerMm(this.pose(), this.viewport);
  }

  /**
   * CSS px per mm at a world point (perspective: in the ego rig near cards show larger than far ones; straight down
   * every table point shows at the view centre's scale); 0 at or behind the camera.
   */
  pxPerMmAt(p: TablePoint, z = 0, pose: CameraPose = this.pose()): number {
    const depth = this.depthOf(p, z, pose);
    return depth > 1e-6 ? this.viewport.h / 2 / (depth * Math.tan((pose.fovDeg / 2) * DEG)) : 0;
  }

  /** Canvas point of a table point at height z; far off screen when it lies behind the camera. */
  tableToScreen(p: TablePoint, z = 0, pose: CameraPose = this.pose()): ScreenPoint {
    const s = projectPoint(pose, this.angle, this.viewport, [p.x, p.y, z]);
    return Number.isFinite(s.x) && Number.isFinite(s.y) ? { x: s.x, y: s.y } : { x: OFF_SCREEN, y: OFF_SCREEN };
  }

  /** Depth of a world point along the view direction (≤ 0 behind the camera). */
  depthOf(p: TablePoint, z = 0, pose: CameraPose = this.pose()): number {
    return dot(sub([p.x, p.y, z], pose.position), basis(this.angle, pose.pitchDeg).d);
  }

  /** Table point under a canvas point, or null above the horizon. */
  screenToTableOrNull(x: number, y: number, pose: CameraPose = this.pose()): TablePoint | null {
    return unprojectToTable(pose, this.angle, this.viewport, x, y);
  }

  /**
   * The (x, y) where the ray through a canvas point crosses the plane at height `z` (a card lying on a pile or lifted),
   * or null when it does not cross it in front of the camera. In the ego rig a raised card's top shows well away from
   * its footprint on the table, so picking tests each card at its own height.
   */
  screenToPlane(x: number, y: number, z: number, pose: CameraPose = this.pose()): TablePoint | null {
    return unprojectToTable(pose, this.angle, this.viewport, x, y, z);
  }

  /**
   * A card's on-screen height in CSS px (DESIGN "Specification", Texture tiers): the projected length of its long
   * axis, between the midpoints of its near and far short edges, at height `z`, the card drawn at scale `k`. Straight
   * down this is the card's height times the scale; in the ego rig it includes the foreshortening of a card lying flat.
   * 0 when the card is behind the camera; when it straddles the camera plane, the scale at its centre.
   */
  cardScreenHeight(p: { x: number; y: number; rot: number }, z = 0, k = 1, pose: CameraPose = this.pose()): number {
    const half = (GEOMETRY.card.h * k) / 2;
    const r = p.rot * DEG;
    // The card's own up axis in table space (rot is clockwise: rot2(0, 1, rot)).
    const ux = Math.sin(r) * half;
    const uy = Math.cos(r) * half;
    const a = projectPoint(pose, this.angle, this.viewport, [p.x + ux, p.y + uy, z]);
    const b = projectPoint(pose, this.angle, this.viewport, [p.x - ux, p.y - uy, z]);
    if (!(a.depth > 1e-6) || !(b.depth > 1e-6)) return GEOMETRY.card.h * k * this.pxPerMmAt(p, z, pose);
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** Table point under a canvas point; above the horizon, a point far away in that direction (nothing is there). */
  screenToTable(x: number, y: number, pose: CameraPose = this.pose()): TablePoint {
    const hit = this.screenToTableOrNull(x, y, pose);
    if (hit) return hit;
    const dir = rayDir(pose, this.angle, this.viewport, x, y);
    const h = Math.hypot(dir[0], dir[1]) || 1;
    return { x: pose.position[0] + (dir[0] / h) * 1e6, y: pose.position[1] + (dir[1] / h) * 1e6 };
  }

  /** Near and far depths of the table, its frame and a little height (for the camera's clip planes). */
  depthRange(pose: CameraPose = this.pose()): { min: number; max: number } {
    const f = this.bird.frame;
    const x0 = Math.min(-this.table.w / 2, f.x - f.w / 2);
    const x1 = Math.max(this.table.w / 2, f.x + f.w / 2);
    const y0 = Math.min(-this.table.d / 2, f.y - f.d / 2);
    const y1 = Math.max(this.table.d / 2, f.y + f.d / 2);
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

  /**
   * The nearest depth at which anything at or below CLIP_TOP_MM can show inside the view: where the view's lowest row
   * of rays (the bottom screen edge, the steepest) crosses that height. Infinity when no ray reaches it.
   */
  nearestVisibleDepth(pose: CameraPose = this.pose()): number {
    const dir = rayDir(pose, this.angle, this.viewport, this.viewport.w / 2, this.viewport.h);
    const drop = pose.position[2] - CLIP_TOP_MM;
    if (!(dir[2] < -1e-9) || !(drop > 0)) return drop > 0 ? Infinity : 0;
    return drop / -dir[2];
  }

  /**
   * The camera's clip planes: near just in front of the nearest thing that can show (the table's nearest corner, or
   * where the view's steepest ray reaches the height cards are drawn at when the camera is over the table), far behind
   * the table's farthest corner (a tilted view sees past the table: what a theme draws beyond it is kept). Near never
   * drops to a millimetre while far stays in metres: depth precision near the table stays fine (lit themes' thin card
   * boxes and decals).
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

  get moving(): boolean {
    return this.sw !== null || (this.active === 'birdseye' ? this.bird.moving : this.egoAnim !== null || this.egoVel.lean !== 0 || this.egoVel.dolly !== 0);
  }

  get switching(): boolean {
    return this.sw !== null;
  }

  /** Cancel eases and inertia (not a rig switch). */
  stop(): void {
    this.bird.stop();
    this.egoAnim = null;
    this.egoVel = { lean: 0, dolly: 0 };
  }

  /** Advance the blend, eases and inertia; returns whether the pose changed. */
  step(now: number, dtMs: number): boolean {
    let changed = false;
    const sw = this.sw;
    if (sw) {
      sw.t = sw.dur > 0 ? clamp((now - sw.start) / sw.dur, 0, 1) : 1;
      if (sw.t >= 1) this.sw = null;
      changed = true;
    }
    if (this.active === 'birdseye') return this.bird.step(now, dtMs) || changed;
    const a = this.egoAnim;
    if (a) {
      const t = a.dur > 0 ? clamp((now - a.start) / a.dur, 0, 1) : 1;
      const e = easeBlend(t);
      this.nav = clampEgoNav(this.egoReach(a.from), {
        lean: a.from.lean + (a.to.lean - a.from.lean) * e,
        dolly: a.from.dolly + (a.to.dolly - a.from.dolly) * e,
        pitchDeg: a.from.pitchDeg + (a.to.pitchDeg - a.from.pitchDeg) * e,
      });
      if (t >= 1) this.egoAnim = null;
      return true;
    }
    if (this.egoVel.lean === 0 && this.egoVel.dolly === 0) return changed;
    // Exponential decay with time constant inertiaMs, as the bird's-eye rig's pan inertia.
    const tau = this.inertiaMs;
    const decay = Math.exp(-dtMs / tau);
    const travel = tau * (1 - decay);
    const before = this.nav;
    this.nav = clampEgoNav(this.egoReach(before), { ...before, lean: before.lean + this.egoVel.lean * travel, dolly: before.dolly + this.egoVel.dolly * travel });
    this.egoVel = { lean: this.egoVel.lean * decay, dolly: this.egoVel.dolly * decay };
    const speedPx = Math.hypot(this.egoVel.lean, this.egoVel.dolly) * this.pxPerMm();
    if (speedPx < INERTIA_STOP_PX_PER_MS || (this.nav.lean === before.lean && this.nav.dolly === before.dolly)) this.egoVel = { lean: 0, dolly: 0 };
    return true;
  }

  // --- Gestures (ignored while the rigs blend: the blend owns the camera for its 400 ms) ---------------------------

  /** Move the table by (dx, dy) CSS px on screen, as if dragging it (ego: lean and dolly). */
  panBy(dx: number, dy: number): void {
    if (this.sw) return;
    if (this.active === 'ego') {
      this.egoAnim = null;
      this.nav = egoPanNav(this.egoReach(), this.table, this.angle, this.lateral, this.viewport, this.nav, dx, dy);
      return;
    }
    if (this.tilt === 0) {
      this.bird.panBy(dx, dy);
      return;
    }
    // Tilted bird's-eye: the table point that was at (centre - d) comes to the centre.
    const vp = this.viewport;
    const p = this.screenToTable(vp.w / 2 - dx, vp.h / 2 - dy);
    this.bird.view = this.bird.clampView({ ...this.bird.view, cx: p.x, cy: p.y }, this.bird.view);
  }

  /** Zoom by `factor` (> 1 zooms in) keeping the table point under (x, y) fixed (ego: dolly toward it). */
  zoomAt(x: number, y: number, factor: number): void {
    if (this.sw) return;
    if (this.active === 'ego') {
      this.stop();
      this.nav = egoZoomNav(this.egoReach(), this.table, this.angle, this.lateral, this.viewport, this.nav, { x, y }, factor);
      return;
    }
    if (this.tilt === 0) {
      this.bird.zoomAt(x, y, factor);
      return;
    }
    const b = this.bird;
    b.stop();
    const dist = clamp(b.view.dist / factor, b.minDist(), b.maxDist());
    const solve = (a: TablePoint, s: ScreenPoint) => targetFor(this.birdPitch(), dist, b.fovDeg, this.angle, this.viewport, a, s);
    const a = this.screenToTable(x, y);
    let t = solve(a, { x, y });
    const hw = this.table.w / 2;
    const hd = this.table.d / 2;
    // A centre a switch left beyond the edge: the cursor's table point holds (BirdseyeRig.zoomAt).
    const kept = !b.onTable({ x: b.view.cx, y: b.view.cy }) && b.onTable(a);
    if (kept && t) {
      const v = { cx: t.x, cy: t.y, dist, angle: b.view.angle };
      b.view = b.clampView(v, v);
      return;
    }
    if (t && (Math.abs(t.x) > hw || Math.abs(t.y) > hd)) {
      // Over the surround near an edge: pivot on the nearest table point, as the straight-down rig does.
      const q = { x: clamp(a.x, -hw, hw), y: clamp(a.y, -hd, hd) };
      t = solve(q, this.tableToScreen(q));
    }
    b.view = b.clampView({ cx: t?.x ?? b.view.cx, cy: t?.y ?? b.view.cy, dist, angle: b.view.angle }, b.view);
  }

  /** Start release inertia with a screen velocity in CSS px per ms (pan release). */
  fling(vxPx: number, vyPx: number): void {
    if (this.sw) return;
    if (this.active === 'birdseye') {
      this.bird.fling(vxPx, vyPx);
      return;
    }
    const k = this.pxPerMm();
    this.egoAnim = null;
    this.egoVel = { lean: -vxPx / k, dolly: vyPx / k };
  }

  /** Pitch the ego rig (positive looks further down); a no-op in bird's-eye and while blending. */
  pitchBy(deg: number): void {
    if (this.sw || this.active !== 'ego') return;
    this.egoAnim = null;
    this.egoVel = { lean: 0, dolly: 0 };
    this.nav = egoPitchNav(this.egoReach(), this.nav, deg);
  }

  // --- Moves (eased over `dur` ms; 0 cuts) ------------------------------------------------------------------------

  /**
   * Switch rig, blending over `dur` ms (0 cuts) and keeping the table point under `anchor` (canvas px; null means the
   * view centre) under it. Switching again mid-blend blends back from where the camera is.
   */
  setRig(rig: CameraRig, now: number, dur: number, anchor: ScreenPoint | null): void {
    if (rig === this.active) return;
    const from = this.pose();
    const vp = this.viewport;
    const centre = { x: vp.w / 2, y: vp.h / 2 };
    let screen = anchor ?? centre;
    let table = this.screenToTableOrNull(screen.x, screen.y, from);
    if (!table && anchor) {
      screen = centre;
      table = this.screenToTableOrNull(screen.x, screen.y, from);
    }
    const fromRig = this.active;
    this.stop();
    if (rig === 'ego') {
      // Within the limits when they can hold the cursor's table point, else beyond them (egoSwitchNav).
      this.nav = table ? egoSwitchNav(this.ego, this.table, this.angle, this.lateral, vp, table, screen).nav : defaultEgoNav(this.ego);
    } else if (table) {
      // Back to the bird's-eye zoom the viewer left, centred so the anchor stays put.
      // When that centre would leave the table (a table point the ego view shows near a screen edge, from a seat
      // beside the table's centre line), zoom in just enough that it stays on the table. When no zoom can keep it on
      // the table (the viewer leaned beyond the table's side edge), the centre stays beyond the edge at the zoom the
      // viewer left: a table point the ego view shows is always held. The next pan or zoom only brings the centre back
      // toward the table (BirdseyeRig.clampView with `keep`) (DECISIONS [M4-P1]).
      const b = this.bird;
      const hw = this.table.w / 2;
      const hd = this.table.d / 2;
      const at = (dist: number) => targetFor(this.birdPitch(), dist, b.fovDeg, this.angle, vp, table, screen);
      const onTable = (t: TablePoint | null) => t !== null && Math.abs(t.x) <= hw + 1e-6 && Math.abs(t.y) <= hd + 1e-6;
      const pointOnTable = Math.abs(table.x) <= hw && Math.abs(table.y) <= hd;
      let dist = clamp(b.view.dist, b.minDist(), b.maxDist());
      let t = at(dist);
      if (!onTable(t) && pointOnTable && onTable(at(b.minDist()))) {
        let lo = b.minDist();
        let hi = dist;
        for (let i = 0; i < 40; i++) {
          const mid = (lo + hi) / 2;
          if (onTable(at(mid))) lo = mid;
          else hi = mid;
        }
        dist = lo;
        t = at(dist);
      }
      if (t) {
        const v = { cx: t.x, cy: t.y, dist, angle: b.view.angle };
        b.view = pointOnTable ? b.clampView(v, v) : b.clampView(v);
      }
    }
    this.active = rig;
    this.sw = dur > 0 ? { from, fromRig, toRig: rig, start: now, dur, t: 0, anchor: table ? { table, screen } : null } : null;
  }

  /** Fit the whole table (key 0); in the ego rig: back at the seat, pitched to show the near and far edges. */
  fit(now: number, dur: number): void {
    if (this.active === 'ego') this.toNav(egoFitNav(this.ego, this.table, this.angle), now, dur);
    else this.toView(this.bird.fitView(), now, dur);
  }

  /** Frame an oriented rect (a seat's territory: keys 1–4, Home, avatar taps). */
  goToRect(r: Rect, now: number, dur: number): void {
    if (this.active === 'birdseye') {
      this.toView(this.bird.rectView(r), now, dur);
      return;
    }
    const rel = (r.rot - this.angle) * DEG;
    const w = Math.abs(Math.cos(rel)) * r.w + Math.abs(Math.sin(rel)) * r.d;
    const d = Math.abs(Math.sin(rel)) * r.w + Math.abs(Math.cos(rel)) * r.d;
    const aim = (dist: number) => egoAimNav(this.ego, this.table, this.angle, this.lateral, r, dist);
    // Depth on screen shrinks with the view's slant: frame it at the pitch the aim needs.
    const slant = Math.sin(aim(0).pitchDeg * DEG);
    this.toNav(aim(egoFrameDist(this.ego, this.viewport, w, d * slant)), now, dur);
  }

  /** Centre a table point: 'close' zooms to one card at 80% of the viewport height (key Z), 'keep' keeps the zoom. */
  focus(p: TablePoint, mode: 'close' | 'keep', now: number, dur: number): void {
    if (this.active === 'birdseye') {
      const b = this.bird;
      this.toView({ cx: p.x, cy: p.y, dist: mode === 'close' ? b.minDist() : b.view.dist, angle: b.view.angle }, now, dur);
      return;
    }
    if (mode === 'close') {
      const tanH = Math.tan((this.ego.fovDeg / 2) * DEG);
      this.toNav(egoAimNav(this.ego, this.table, this.angle, this.lateral, p, GEOMETRY.card.h / 0.8 / 2 / tanH), now, dur);
      return;
    }
    const aimed = egoAimNav(this.ego, this.table, this.angle, this.lateral, p, Infinity);
    this.toNav(clampEgoNav(this.ego, { ...aimed, dolly: this.nav.dolly }), now, dur);
  }

  /** Whether a table point shows inside the viewport inset by `marginPx`. */
  shows(p: TablePoint, marginPx = 0): boolean {
    const s = this.tableToScreen(p);
    const vp = this.viewport;
    return s.x >= marginPx && s.y >= marginPx && s.x <= vp.w - marginPx && s.y <= vp.h - marginPx;
  }

  private toView(v: CameraView, now: number, dur: number): void {
    if (this.sw || dur <= 0) {
      const from = this.sw ? this.pose() : null;
      this.bird.stop();
      this.bird.view = this.bird.clampView({ ...v, angle: this.bird.view.angle });
      if (from) this.retarget(from, now, dur);
      return;
    }
    this.bird.animateTo(v, now, dur);
  }

  private toNav(nav: EgoNav, now: number, dur: number): void {
    this.egoVel = { lean: 0, dolly: 0 };
    const to = clampEgoNav(this.ego, nav);
    if (this.sw || dur <= 0) {
      const from = this.sw ? this.pose() : null;
      this.egoAnim = null;
      this.nav = to;
      if (from) this.retarget(from, now, dur);
      return;
    }
    this.egoAnim = { from: { ...this.nav }, to, start: now, dur };
  }

  /**
   * A move (fit, seat key, avatar tap, zoom to a card, follow) arrived mid-blend and changed the blend's destination:
   * the blend starts over from where the camera is, so the camera never jumps. The cursor no longer anchors it: the
   * viewer asked to look somewhere else. With reduced motion (0 ms) the move cuts and ends the blend.
   */
  private retarget(from: CameraPose, now: number, dur: number): void {
    const sw = this.sw;
    if (!sw) return;
    this.sw = dur > 0 ? { ...sw, from, start: now, dur, t: 0, anchor: null } : null;
  }

  // --- Viewport, table and theme ----------------------------------------------------------------------------------

  resize(vp: Viewport): void {
    this.bird.resize(vp);
  }

  setInsets(insets: Insets): void {
    this.bird.setInsets(insets);
  }

  setFrame(frame: FrameBox): void {
    this.bird.setFrame(frame);
  }

  /** A new table or viewer seat: both rigs start over (fitted bird's-eye, ego at the seat); a blend is cut. */
  setTable(table: TableSize, angle: number, frame: FrameBox, lateral = 0): void {
    this.bird.setTable(table, angle, frame);
    this.lateral = lateral;
    this.sw = null;
    this.stop();
    this.nav = defaultEgoNav(this.ego);
  }

  /** A theme's camera defaults: ego parameter overrides and bird's-eye tilt (the navigation is re-clamped). */
  setTheme(ego: Partial<EgoRigParams> | undefined, tiltDeg: number | undefined): void {
    this.egoParams = { ...DEFAULT_EGO_RIG, ...(ego ?? {}) };
    this.nav = clampEgoNav(this.egoReach(), this.nav);
    this.tilt = clamp(tiltDeg ?? 0, 0, MAX_BIRDSEYE_TILT_DEG);
  }
}

/** Offset of a point along the viewer's right axis (the ego seat's lateral place in front of a territory). */
export function lateralOf(p: TablePoint, angleDeg: number): number {
  const b = basis(angleDeg, 90);
  return p.x * b.r[0] + p.y * b.r[1];
}
