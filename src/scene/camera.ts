/**
 * Bird's-eye camera rig (DESIGN "Camera and navigation"; "Specification: geometry, layout and motion", Camera rigs).
 * One perspective camera with a 6 degree field of view looking straight down; zoom is the camera height.
 * Pure math (no Three.js): the scene copies `view` onto its PerspectiveCamera every frame.
 *
 * Screen coordinates here are CSS px relative to the canvas' top-left corner.
 */
import { CAMERA, GEOMETRY } from '../core/geometry';
import type { Rect } from '../games/types';
import { DEG, clamp, rot2 } from './math';
import type { TablePoint } from './types';

export interface CameraView {
  /** Table point at the centre of the view, mm. */
  cx: number;
  cy: number;
  /** Camera height above the table, mm. */
  dist: number;
  /** Viewer's seat angle: this seat is at the bottom of the screen. */
  angle: number;
}

export interface Viewport {
  w: number;
  h: number;
}

const TAN_HALF = Math.tan((CAMERA.birdseye.fovDeg / 2) * DEG);
/** Pan velocities below this many CSS px per ms stop the inertia. */
const INERTIA_STOP_PX_PER_MS = 0.005;

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class BirdseyeRig {
  view: CameraView;
  viewport: Viewport;
  table: { w: number; d: number };
  /** Pan inertia velocity, mm per ms in table space. */
  velocity = { x: 0, y: 0 };
  inertiaMs: number;
  private anim: { from: CameraView; to: CameraView; start: number; dur: number } | null = null;

  constructor(table: { w: number; d: number }, viewport: Viewport, angle = 0, inertiaMs = 325) {
    this.table = table;
    this.viewport = viewport;
    this.inertiaMs = inertiaMs;
    this.view = { cx: 0, cy: 0, dist: 1, angle };
    this.view = this.fitView();
  }

  readonly fovDeg = CAMERA.birdseye.fovDeg;

  /** Half the visible table height in mm at a camera height. */
  halfHeight(dist = this.view.dist): number {
    return dist * TAN_HALF;
  }

  /** CSS px per table mm at the table surface. */
  pxPerMm(dist = this.view.dist): number {
    return this.viewport.h / 2 / this.halfHeight(dist);
  }

  /** The farthest zoom: the whole table plus a 5% margin fits the viewport. */
  maxDist(): number {
    const { w, d } = this.extentInView(this.table.w, this.table.d, 0);
    const m = 1 + CAMERA.fitMargin;
    const aspect = this.viewport.w / this.viewport.h;
    const half = Math.max((d * m) / 2, (w * m) / 2 / aspect);
    return Math.max(half / TAN_HALF, this.minDist());
  }

  /** The closest zoom: one card fills 80% of the viewport height. */
  minDist(): number {
    return GEOMETRY.card.h / CAMERA.maxCardViewportFraction / 2 / TAN_HALF;
  }

  /** Width and depth of a w x d box rotated by `rot`, seen in this view's frame. */
  private extentInView(w: number, d: number, rot: number): { w: number; d: number } {
    const rel = (rot - this.view.angle) * DEG;
    const c = Math.abs(Math.cos(rel));
    const s = Math.abs(Math.sin(rel));
    return { w: c * w + s * d, d: s * w + c * d };
  }

  clampView(v: CameraView): CameraView {
    const dist = clamp(v.dist, this.minDist(), this.maxDist());
    return { cx: clamp(v.cx, -this.table.w / 2, this.table.w / 2), cy: clamp(v.cy, -this.table.d / 2, this.table.d / 2), dist, angle: v.angle };
  }

  fitView(): CameraView {
    return { cx: 0, cy: 0, dist: this.maxDist(), angle: this.view.angle };
  }

  /** View that frames an oriented rect with a 5% margin (go to a seat's territory). */
  rectView(r: Rect): CameraView {
    const { w, d } = this.extentInView(r.w, r.d, r.rot);
    const m = 1 + CAMERA.fitMargin;
    const aspect = this.viewport.w / this.viewport.h;
    const half = Math.max((d * m) / 2, (w * m) / 2 / aspect);
    return this.clampView({ cx: r.x, cy: r.y, dist: half / TAN_HALF, angle: this.view.angle });
  }

  /** Table point under a canvas point (on the table plane). */
  screenToTable(x: number, y: number, v: CameraView = this.view): TablePoint {
    const k = this.viewport.h / 2 / this.halfHeight(v.dist);
    const right = (x - this.viewport.w / 2) / k;
    const up = -(y - this.viewport.h / 2) / k;
    const [dx, dy] = rot2(right, up, v.angle);
    return { x: v.cx + dx, y: v.cy + dy };
  }

  /** Canvas point of a table point at height z (perspective: higher points spread from the centre). */
  tableToScreen(p: TablePoint, z = 0, v: CameraView = this.view): { x: number; y: number } {
    const k = (this.viewport.h / 2 / this.halfHeight(v.dist)) * (v.dist / Math.max(1e-6, v.dist - z));
    const [right, up] = rot2(p.x - v.cx, p.y - v.cy, -v.angle);
    return { x: this.viewport.w / 2 + right * k, y: this.viewport.h / 2 - up * k };
  }

  /** Zoom by `factor` (> 1 zooms in) keeping the table point under (x, y) fixed, within the zoom clamps. */
  zoomAt(x: number, y: number, factor: number): void {
    this.stop();
    const p = this.screenToTable(x, y);
    const dist = clamp(this.view.dist / factor, this.minDist(), this.maxDist());
    const k = dist / this.view.dist;
    this.view = this.clampView({ cx: p.x + (this.view.cx - p.x) * k, cy: p.y + (this.view.cy - p.y) * k, dist, angle: this.view.angle });
  }

  /** Move the table by (dx, dy) CSS px on screen, as if dragging it. */
  panBy(dx: number, dy: number): void {
    const k = this.pxPerMm();
    const [tx, ty] = rot2(-dx / k, dy / k, this.view.angle);
    this.view = this.clampView({ ...this.view, cx: this.view.cx + tx, cy: this.view.cy + ty });
  }

  /** Start release inertia with a screen velocity in CSS px per ms (pan release). */
  fling(vxPx: number, vyPx: number): void {
    const k = this.pxPerMm();
    const [tx, ty] = rot2(-vxPx / k, vyPx / k, this.view.angle);
    this.velocity = { x: tx, y: ty };
  }

  /** Ease (or cut, with reduced motion or dur 0) to a view. */
  animateTo(to: CameraView, now: number, durMs: number): void {
    const target = this.clampView({ ...to, angle: this.view.angle });
    this.velocity = { x: 0, y: 0 };
    if (durMs <= 0) {
      this.anim = null;
      this.view = target;
      return;
    }
    this.anim = { from: { ...this.view }, to: target, start: now, dur: durMs };
  }

  /** Cancel animation and inertia. */
  stop(): void {
    this.anim = null;
    this.velocity = { x: 0, y: 0 };
  }

  get moving(): boolean {
    return this.anim !== null || this.velocity.x !== 0 || this.velocity.y !== 0;
  }

  /** Advance animation and inertia; returns whether the view changed. */
  step(now: number, dtMs: number): boolean {
    if (this.anim) {
      const { from, to, start, dur } = this.anim;
      const t = clamp((now - start) / dur, 0, 1);
      const e = easeInOutCubic(t);
      this.view = {
        cx: from.cx + (to.cx - from.cx) * e,
        cy: from.cy + (to.cy - from.cy) * e,
        dist: Math.exp(Math.log(from.dist) + (Math.log(to.dist) - Math.log(from.dist)) * e),
        angle: this.view.angle,
      };
      if (t >= 1) this.anim = null;
      return true;
    }
    if (this.velocity.x === 0 && this.velocity.y === 0) return false;
    // Exponential decay with time constant inertiaMs: x(t) = v0 * tau * (1 - e^(-t/tau)).
    const tau = this.inertiaMs;
    const decay = Math.exp(-dtMs / tau);
    const travel = tau * (1 - decay);
    const before = this.view;
    this.view = this.clampView({ ...before, cx: before.cx + this.velocity.x * travel, cy: before.cy + this.velocity.y * travel });
    this.velocity = { x: this.velocity.x * decay, y: this.velocity.y * decay };
    const speedPx = Math.hypot(this.velocity.x, this.velocity.y) * this.pxPerMm();
    // Stop at the table edge or when slow.
    if (speedPx < INERTIA_STOP_PX_PER_MS || (this.view.cx === before.cx && this.view.cy === before.cy)) this.velocity = { x: 0, y: 0 };
    return true;
  }

  /** Resize the viewport; keeps the centre and re-clamps. */
  resize(vp: Viewport): void {
    this.viewport = vp;
    this.view = this.clampView(this.view);
  }

  setTable(table: { w: number; d: number }, angle: number): void {
    this.table = table;
    this.view = { ...this.view, angle };
    this.stop();
    this.view = this.fitView();
  }
}
