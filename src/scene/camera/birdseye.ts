/**
 * Bird's-eye camera rig (DESIGN "Camera and navigation"; "Specification: geometry, layout and motion", Camera rigs).
 * One perspective camera with a 6 degree field of view looking straight down; zoom is the camera height.
 * Pure math (no Three.js): the scene copies `view` onto its PerspectiveCamera every frame.
 *
 * Screen coordinates here are CSS px relative to the canvas' top-left corner.
 */
import { CAMERA, GEOMETRY } from '../../core/geometry';
import type { Rect } from '../../games/types';
import { DEG, clamp, rot2 } from '../math';
import type { TablePoint } from '../types';
import { clampToTable, fromTableLocal, onCameraTable, toTableLocal, type CameraTable } from './table';

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

/**
 * Screen space the screen-anchored layer covers (hand fan, log, avatars), CSS px from each canvas edge (DESIGN
 * "Camera and navigation", Screen-anchored layer). Fitting the table, a seat or the zoom-out limit frames the table in
 * the rest of the viewport, so nothing the HUD draws covers it at the fitted view.
 */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** A box in table space (mm): centre and size, axis-aligned, or turned by `rot` degrees clockwise (M5-P7). */
export interface FrameBox {
  x: number;
  y: number;
  w: number;
  d: number;
  /** The box's turn; absent: axis-aligned in the canonical frame. The three-player table frames each viewer's view. */
  rot?: number;
}
/** The framed area never shrinks below this fraction of the viewport in either direction, whatever the insets. */
const MIN_SAFE_FRACTION = 0.4;

const TAN_HALF = Math.tan((CAMERA.birdseye.fovDeg / 2) * DEG);
/** Pan velocities below this many CSS px per ms stop the inertia. */
const INERTIA_STOP_PX_PER_MS = 0.005;

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class BirdseyeRig {
  view: CameraView;
  viewport: Viewport;
  table: CameraTable;
  /** Pan inertia velocity, mm per ms in table space. */
  velocity = { x: 0, y: 0 };
  inertiaMs: number;
  insets: Insets = NO_INSETS;
  /**
   * What the fitted view frames: the table, plus what the scene draws outside its edges for others to see (the other
   * seats' hand rows of card backs), so the fitted view shows those too. Defaults to the table.
   */
  frame: FrameBox;
  private anim: { from: CameraView; to: CameraView; start: number; dur: number } | null = null;

  constructor(table: CameraTable, viewport: Viewport, angle = 0, inertiaMs = 325) {
    this.table = table;
    this.frame = { x: 0, y: 0, w: table.w, d: table.d, ...(table.rot ? { rot: table.rot } : {}) };
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

  /** The farthest zoom: the whole table (its frame) plus a 5% margin fits the viewport, clear of the insets. */
  maxDist(): number {
    return Math.max(this.frameDist(this.frame.w, this.frame.d, this.frame.rot ?? 0), this.minDist());
  }

  /** The part of the viewport not covered by the insets, CSS px. */
  safeArea(): { x: number; y: number; w: number; h: number } {
    const vp = this.viewport;
    const i = this.insets;
    let l = Math.max(0, i.left);
    let r = Math.max(0, i.right);
    let t = Math.max(0, i.top);
    let b = Math.max(0, i.bottom);
    const minW = vp.w * MIN_SAFE_FRACTION;
    const minH = vp.h * MIN_SAFE_FRACTION;
    if (vp.w - l - r < minW) {
      const k = Math.max(0, vp.w - minW) / Math.max(1e-9, l + r);
      l *= k;
      r *= k;
    }
    if (vp.h - t - b < minH) {
      const k = Math.max(0, vp.h - minH) / Math.max(1e-9, t + b);
      t *= k;
      b *= k;
    }
    return { x: l, y: t, w: vp.w - l - r, h: vp.h - t - b };
  }

  /** Camera height that frames a w x d box rotated by `rot` with a 5% margin inside the safe area. */
  private frameDist(w0: number, d0: number, rot: number): number {
    const { w, d } = this.extentInView(w0, d0, rot);
    const m = 1 + CAMERA.fitMargin;
    const safe = this.safeArea();
    // Pixels per mm that fit the box into the safe area; the camera height follows from pxPerMm.
    const k = Math.min(safe.h / (d * m), safe.w / (w * m));
    return this.viewport.h / 2 / k / TAN_HALF;
  }

  /** View centred so that table point (x, y) appears at the centre of the safe area, at camera height `dist`. */
  private framedView(x: number, y: number, dist: number): CameraView {
    const safe = this.safeArea();
    const k = this.viewport.h / 2 / this.halfHeight(dist);
    const sx = safe.x + safe.w / 2 - this.viewport.w / 2;
    const sy = safe.y + safe.h / 2 - this.viewport.h / 2;
    const [dx, dy] = rot2(-sx / k, sy / k, this.view.angle);
    return { cx: x + dx, cy: y + dy, dist, angle: this.view.angle };
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

  /**
   * Clamp a view to the zoom limits with its centre on the table. With `keep`, the centre may also stay as far beyond
   * the table as `keep`'s centre is (the box grows to include it): a view whose centre a rig switch left beyond the
   * table edge (to hold the cursor's table point) never jumps on the next pan, zoom or resize; panning only brings it
   * back toward the table.
   */
  clampView(v: CameraView, keep?: { cx: number; cy: number }): CameraView {
    const dist = clamp(v.dist, this.minDist(), this.maxDist());
    // In the table's own frame (the three-player table is turned to the viewer; M5-P7).
    const t = this.table;
    const hw = t.w / 2;
    const hd = t.d / 2;
    const k = keep ? toTableLocal({ x: keep.cx, y: keep.cy }, t) : null;
    const x0 = k ? Math.min(-hw, k.x) : -hw;
    const x1 = k ? Math.max(hw, k.x) : hw;
    const y0 = k ? Math.min(-hd, k.y) : -hd;
    const y1 = k ? Math.max(hd, k.y) : hd;
    const c = toTableLocal({ x: v.cx, y: v.cy }, t);
    const out = fromTableLocal({ x: clamp(c.x, x0, x1), y: clamp(c.y, y0, y1) }, t);
    return { cx: out.x, cy: out.y, dist, angle: v.angle };
  }

  fitView(): CameraView {
    return this.framedView(this.frame.x, this.frame.y, this.maxDist());
  }

  /** View that frames an oriented rect with a 5% margin in the safe area (go to a seat's territory). */
  rectView(r: Rect): CameraView {
    return this.clampView(this.framedView(r.x, r.y, clamp(this.frameDist(r.w, r.d, r.rot), this.minDist(), this.maxDist())));
  }

  /** Whether the view is (within a pixel) the fitted whole-table view. */
  atFit(v: CameraView = this.view): boolean {
    const f = this.fitView();
    const k = this.pxPerMm(f.dist);
    return Math.abs(v.dist - f.dist) / f.dist < 1e-3 && Math.hypot(v.cx - f.cx, v.cy - f.cy) * k < 1;
  }

  /** Change the insets; a view that was fitted stays fitted. */
  setInsets(insets: Insets): void {
    const i = { top: insets.top, right: insets.right, bottom: insets.bottom, left: insets.left };
    if (i.top === this.insets.top && i.right === this.insets.right && i.bottom === this.insets.bottom && i.left === this.insets.left) return;
    const wasFit = !this.anim && this.atFit();
    this.insets = i;
    this.view = wasFit ? this.fitView() : this.clampView(this.view, this.view);
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

  /** Whether a table point lies on the table (not over the surround). */
  onTable(p: TablePoint): boolean {
    return onCameraTable(p, this.table);
  }

  /**
   * Zoom by `factor` (> 1 zooms in) keeping the table point under (x, y) fixed, within the zoom clamps. When that
   * would put the view centre off the table (cursor over the surround near an edge), the pivot is the nearest table
   * point instead, so the clamp never makes the table jump under the cursor. A centre a rig switch left beyond the
   * table edge (clampView's `keep`) is not re-clamped while the cursor is over the table: zooming out there moves it
   * further out with the cursor's point held, as zooming in brings it back (DECISIONS [M4-P1 review]).
   */
  zoomAt(x: number, y: number, factor: number): void {
    this.stop();
    const dist = clamp(this.view.dist / factor, this.minDist(), this.maxDist());
    const k = dist / this.view.dist;
    const around = (p: TablePoint): CameraView => ({ cx: p.x + (this.view.cx - p.x) * k, cy: p.y + (this.view.cy - p.y) * k, dist, angle: this.view.angle });
    const q = this.screenToTable(x, y);
    let v = around(q);
    if (!this.onTable({ x: this.view.cx, y: this.view.cy }) && this.onTable(q)) {
      this.view = this.clampView(v, v);
      return;
    }
    if (!this.onTable({ x: v.cx, y: v.cy })) v = around(clampToTable(q, this.table));
    this.view = this.clampView(v, this.view);
  }

  /** Move the table by (dx, dy) CSS px on screen, as if dragging it. */
  panBy(dx: number, dy: number): void {
    const k = this.pxPerMm();
    const [tx, ty] = rot2(-dx / k, dy / k, this.view.angle);
    this.view = this.clampView({ ...this.view, cx: this.view.cx + tx, cy: this.view.cy + ty }, this.view);
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
    this.view = this.clampView({ ...before, cx: before.cx + this.velocity.x * travel, cy: before.cy + this.velocity.y * travel }, before);
    this.velocity = { x: this.velocity.x * decay, y: this.velocity.y * decay };
    const speedPx = Math.hypot(this.velocity.x, this.velocity.y) * this.pxPerMm();
    // Stop at the table edge or when slow.
    if (speedPx < INERTIA_STOP_PX_PER_MS || (this.view.cx === before.cx && this.view.cy === before.cy)) this.velocity = { x: 0, y: 0 };
    return true;
  }

  /** Resize the viewport; a fitted view stays fitted, any other keeps its centre and is re-clamped. */
  resize(vp: Viewport): void {
    const wasFit = !this.anim && this.atFit();
    this.viewport = vp;
    this.view = wasFit ? this.fitView() : this.clampView(this.view, this.view);
  }

  /** Change what the fitted view frames; a view that was fitted stays fitted. */
  setFrame(frame: FrameBox): void {
    const f = this.frame;
    if (f.x === frame.x && f.y === frame.y && f.w === frame.w && f.d === frame.d) return;
    const wasFit = !this.anim && this.atFit();
    this.frame = frame;
    this.view = wasFit ? this.fitView() : this.clampView(this.view, this.view);
  }

  setTable(table: CameraTable, angle: number, frame: FrameBox = { x: 0, y: 0, w: table.w, d: table.d, ...(table.rot ? { rot: table.rot } : {}) }): void {
    this.table = table;
    this.frame = frame;
    this.view = { ...this.view, angle };
    this.stop();
    this.view = this.fitView();
  }
}
