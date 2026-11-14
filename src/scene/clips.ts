/**
 * Paperclips on the table (PLAN Milestone 6, owner decisions, Paperclips; DESIGN "Card manipulation", Clip).
 * Implementer: M6-P1.
 *
 * - Pure geometry (no Three.js): where a clip lies and how it turns (its anchor card's stored frame, so it follows the
 *   card as the group moves and never turns with a tap), whether a point hits it, which cards a point covers, where
 *   the overlap of some cards is (the keyboard and menu routes), and the clip a press-and-hold would make.
 * - ClipView: the clip object drawn over the cards, about CLIP.w × CLIP.h mm, in the theme's own material: Paper draws
 *   it as an ink line drawing, lit themes as bent wire with a metal sheen (a matcap, so it needs no lights in the
 *   overlay pass). It is an object on top of the cards, like a counter badge: it never tints, crops or distorts a face.
 */
import * as THREE from 'three';
import { CLIP } from '../core/geometry';
import { anchorOffset, anchorPoint } from '../core/reducer/clips';
import type { Clip, ClipAnchor, InstanceId, Pose, TableState } from '../core/types';
import { CARD_H, CARD_W, cardCorners, normDeg, pointInCard, rot2 } from './math';
import type { TablePoint } from './types';

// --- Geometry ---------------------------------------------------------------------------------------------------

/** A clip's frame on the table: its centre and the turn of its long axis (the anchor card's stored rotation). */
export interface ClipFrame {
  x: number;
  y: number;
  rot: number;
}

/** The stored pose of a card drawn at `drawn` (strips the tap turn: a clip lies in the card's untapped frame). */
const storedRot = (drawnRot: number, tapped: boolean) => normDeg(drawnRot - (tapped ? 90 : 0));

/** Where a clip lies for its anchor card drawn at `drawn` (tapped: drawn turned by 90°). */
export function clipFrame(anchor: Pick<ClipAnchor, 'x' | 'y'>, drawn: Pose, tapped: boolean): ClipFrame {
  const pose = { x: drawn.x, y: drawn.y, rot: storedRot(drawn.rot, tapped) };
  const p = anchorPoint(pose, anchor);
  return { x: p.x, y: p.y, rot: pose.rot };
}

/** Whether table point `p` hits a clip lying at `f`, with `margin` mm around it (fingers need more). */
export function pointInClip(p: TablePoint, f: ClipFrame, margin = 2): boolean {
  return pointInCard(p, { x: f.x, y: f.y, rot: f.rot }, CLIP.w + 2 * margin, CLIP.h + 2 * margin);
}

/** The corners of a clip lying at `f` (debug rectangles). */
export function clipCorners(f: ClipFrame): TablePoint[] {
  return cardCorners({ x: f.x, y: f.y, rot: f.rot }, CLIP.w, CLIP.h);
}

/** A battlefield card as the clip routes see it: drawn pose and tap. */
export interface ClipCard {
  id: InstanceId;
  pose: Pose;
  tapped: boolean;
}

/**
 * The clip a press at table point `p` makes over `under` (the cards there, top first): every card under the point,
 * anchored on the topmost at that point. Null for fewer than CLIP.minCards cards, or when exactly these cards are
 * already clipped together (by a clip other than `ignore`, the clip being moved).
 */
export function clipHere(state: TableState, under: readonly ClipCard[], p: TablePoint, ignore: string | null = null): { cards: InstanceId[]; anchor: ClipAnchor } | null {
  if (under.length < CLIP.minCards) return null;
  const cards = [...new Set(under.map((c) => c.id))].sort();
  if (cards.length < CLIP.minCards) return null;
  const key = cards.join('\u0000');
  if (Object.values(state.clips ?? {}).some((c) => c.id !== ignore && c.cards.join('\u0000') === key)) return null;
  const top = under[0]!;
  const off = anchorOffset({ x: top.pose.x, y: top.pose.y, rot: storedRot(top.pose.rot, top.tapped) }, p);
  return { cards, anchor: { card: top.id, x: off.x, y: off.y } };
}

/** Separating-axis test of two card rectangles (drawn poses). */
export function cardsOverlap(a: Pose, b: Pose): boolean {
  const ca = cardCorners(a);
  const cb = cardCorners(b);
  const axes = [a.rot, a.rot + 90, b.rot, b.rot + 90].map((deg) => {
    const [x, y] = rot2(1, 0, deg);
    return { x, y };
  });
  for (const ax of axes) {
    const pa = ca.map((c) => c.x * ax.x + c.y * ax.y);
    const pb = cb.map((c) => c.x * ax.x + c.y * ax.y);
    if (Math.max(...pa) <= Math.min(...pb) + 1e-6 || Math.max(...pb) <= Math.min(...pa) + 1e-6) return false;
  }
  return true;
}

/**
 * A point over the overlap of `cards` (drawn poses): the centre of the box their bounding boxes share, or, when they
 * share none (a selection spread apart), the middle of their centres.
 */
export function overlapPoint(cards: readonly Pose[]): TablePoint {
  let minX = -Infinity;
  let minY = -Infinity;
  let maxX = Infinity;
  let maxY = Infinity;
  for (const p of cards) {
    const cs = cardCorners(p);
    minX = Math.max(minX, Math.min(...cs.map((c) => c.x)));
    maxX = Math.min(maxX, Math.max(...cs.map((c) => c.x)));
    minY = Math.max(minY, Math.min(...cs.map((c) => c.y)));
    maxY = Math.min(maxY, Math.max(...cs.map((c) => c.y)));
  }
  if (minX <= maxX && minY <= maxY) return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const n = Math.max(1, cards.length);
  return { x: cards.reduce((s, c) => s + c.x, 0) / n, y: cards.reduce((s, c) => s + c.y, 0) / n };
}

/** Draws the drawn pose of a public battlefield card from the state (tap turn included). */
function drawnOf(state: TableState, id: InstanceId): ClipCard | null {
  const c = Object.hasOwn(state.cards, id) ? state.cards[id] : undefined;
  const z = c ? state.zones[c.zone] : undefined;
  if (!c || !z || z.visibility !== 'public' || z.kind !== 'battlefield') return null;
  return { id, pose: { ...c.pose, rot: normDeg(c.pose.rot + (c.tapped ? 90 : 0)) }, tapped: c.tapped };
}

/**
 * The clip the keyboard or a menu makes (PLAN Milestone 6, owner decisions, Paperclips, Keyboard: "clips the selection
 * together, or the focused card with the cards it overlaps"): with two or more battlefield cards in `selection`, those;
 * else `card` with every battlefield card overlapping it. Anchored on the first card, over the overlap. Null when that
 * leaves fewer than two cards or exactly these are clipped already.
 */
export function clipForCards(state: TableState, card: InstanceId | null, selection: readonly InstanceId[]): { cards: InstanceId[]; anchor: ClipAnchor } | null {
  const sel = selection.map((id) => drawnOf(state, id)).filter((c): c is ClipCard => !!c);
  let cards: ClipCard[];
  if (sel.length >= CLIP.minCards && (card === null || sel.some((c) => c.id === card))) cards = sel;
  else {
    const me = card ? drawnOf(state, card) : null;
    if (!me) return null;
    const others = Object.keys(state.cards)
      .sort()
      .filter((id) => id !== me.id)
      .map((id) => drawnOf(state, id))
      .filter((c): c is ClipCard => !!c && cardsOverlap(me.pose, c.pose));
    cards = [me, ...others];
  }
  if (cards.length < CLIP.minCards) return null;
  const first = cards[0]!;
  const at = overlapPoint(cards.map((c) => c.pose));
  const ids = cards.map((c) => c.id).sort();
  const key = ids.join('\u0000');
  if (Object.values(state.clips ?? {}).some((c) => c.cards.join('\u0000') === key)) return null;
  const off = anchorOffset({ x: first.pose.x, y: first.pose.y, rot: storedRot(first.pose.rot, first.tapped) }, at);
  const lim = (v: number) => Math.max(-100, Math.min(100, v));
  return { cards: ids, anchor: { card: first.id, x: lim(off.x), y: lim(off.y) } };
}

/** Clips that hold `card`, newest id last. */
export function clipsHolding(state: TableState, card: InstanceId): Clip[] {
  const clips = state.clips ?? {};
  return Object.keys(clips)
    .sort()
    .map((id) => clips[id]!)
    .filter((c) => c.cards.includes(card));
}

// --- The paperclip's shape --------------------------------------------------------------------------------------

/**
 * The centre line of a gem paperclip in clip-local mm (x across, y along; CLIP.w × CLIP.h): three nested U bends, the
 * wire's ends inside. Arcs are subdivided so the line drawing and the wire read round at play zoom.
 */
export function clipPath(): TablePoint[] {
  const pts: TablePoint[] = [];
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    pts.push({ x: x0, y: y0 }, { x: x1, y: y1 });
  };
  const arc = (cx: number, cy: number, r: number, from: number, to: number) => {
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const t = ((from + ((to - from) * i) / n) * Math.PI) / 180;
      pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
    }
  };
  const hw = CLIP.w / 2; // 6
  const hh = CLIP.h / 2; // 16
  // Inner leg down, a small bend at the bottom, up the inner right side.
  line(-hw * 0.4, hh * 0.45, -hw * 0.4, -hh + hw * 0.4 + 5);
  arc(0, -hh + hw * 0.4 + 5, hw * 0.4, 180, 360);
  line(hw * 0.4, -hh + hw * 0.4 + 5, hw * 0.4, hh - hw * 0.7);
  // The middle bend at the top, down the left side.
  arc(-hw * 0.15, hh - hw * 0.7, hw * 0.55, 0, 180);
  line(-hw * 0.7, hh - hw * 0.7, -hw * 0.7, -hh + hw);
  // The outer bend at the bottom, up the outer right side, the outer bend at the top, down to the outer end.
  arc(hw * 0.15, -hh + hw, hw * 0.85, 180, 360);
  line(hw, -hh + hw, hw, hh - hw);
  arc(0, hh - hw, hw, 0, 180);
  line(-hw, hh - hw, -hw, -hh * 0.1);
  // Collapse consecutive duplicates.
  return pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y) > 1e-6);
}

// --- Drawing ----------------------------------------------------------------------------------------------------

/** One clip to draw this frame. */
export interface ClipDraw {
  id: string;
  frame: ClipFrame;
  /** Height over the table (mm): over the cards it holds. */
  z: number;
  /** Hovered or held: drawn a little larger. */
  lifted: boolean;
}

/** How the theme draws clips: Paper an ink line drawing, lit themes metal wire. */
export interface ClipStyle {
  lit: boolean;
  /** The ink of the line drawing (Paper), or the tint of the metal (lit). */
  colour: string;
}

/** A silver matcap: the wire's sheen without lights in the overlay pass. */
function metalMatcap(): THREE.DataTexture {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  const l = new THREE.Vector3(-0.45, 0.55, 0.7).normalize();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      const y = (j / (n - 1)) * 2 - 1;
      const r2 = x * x + y * y;
      const z = r2 < 1 ? Math.sqrt(1 - r2) : 0;
      const d = Math.max(0, x * l.x + y * l.y + z * l.z);
      const v = Math.min(1, 0.28 + 0.45 * z + 0.55 * Math.pow(d, 28) + 0.15 * d);
      const k = (j * n + i) * 4;
      data[k] = Math.round(255 * v * 0.96);
      data[k + 1] = Math.round(255 * v * 0.97);
      data[k + 2] = Math.round(255 * Math.min(1, v * 1.02));
      data[k + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** A flat ribbon along a polyline (the Paper line drawing), `width` mm wide, in the x/-z plane. */
function ribbonGeometry(path: readonly TablePoint[], width: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const h = width / 2;
  path.forEach((p, i) => {
    const a = path[Math.max(0, i - 1)]!;
    const b = path[Math.min(path.length - 1, i + 1)]!;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // Normal to the left of the direction.
    const nx = -dy;
    const ny = dx;
    pos.push(p.x + nx * h, 0, -(p.y + ny * h), p.x - nx * h, 0, -(p.y - ny * h));
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** A round wire along a polyline (lit themes), `radius` mm thick. */
function wireGeometry(path: readonly TablePoint[], radius: number): THREE.BufferGeometry {
  const curve = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    curve.add(new THREE.LineCurve3(new THREE.Vector3(a.x, radius, -a.y), new THREE.Vector3(b.x, radius, -b.y)));
  }
  return new THREE.TubeGeometry(curve, path.length * 2, radius, 8, false);
}

/** The paperclips drawn over the cards (overlay scene, after the cards). */
export class ClipView {
  readonly object = new THREE.Group();
  private readonly meshes = new Map<string, THREE.Mesh>();
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.Material | null = null;
  private matcap: THREE.DataTexture | null = null;
  private style: string = '';

  constructor() {
    this.object.name = 'clips';
    this.object.renderOrder = 3.5;
  }

  setStyle(style: ClipStyle): void {
    const key = `${style.lit ? 'lit' : 'ink'}:${style.colour}`;
    if (key === this.style) return;
    this.style = key;
    this.release();
    const path = clipPath();
    if (style.lit) {
      this.matcap = metalMatcap();
      this.geometry = wireGeometry(path, 0.55);
      this.material = new THREE.MeshMatcapMaterial({ matcap: this.matcap, color: new THREE.Color(style.colour), depthTest: false, depthWrite: false, transparent: true });
    } else {
      this.geometry = ribbonGeometry(path, 0.7);
      this.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(style.colour), side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true, toneMapped: false });
    }
    for (const m of this.meshes.values()) {
      m.geometry = this.geometry;
      m.material = this.material;
    }
  }

  sync(draws: readonly ClipDraw[]): void {
    if (!this.geometry || !this.material) return;
    const live = new Set(draws.map((d) => d.id));
    for (const [id, m] of this.meshes) {
      if (live.has(id)) continue;
      this.object.remove(m);
      this.meshes.delete(id);
    }
    for (const d of draws) {
      let m = this.meshes.get(d.id);
      if (!m) {
        m = new THREE.Mesh(this.geometry, this.material);
        m.renderOrder = 3.5;
        m.frustumCulled = false;
        m.name = `clip:${d.id}`;
        this.meshes.set(d.id, m);
        this.object.add(m);
      }
      m.position.set(d.frame.x, d.z, -d.frame.y);
      // Table rot is clockwise seen from above; three's y axis points up, so a clockwise turn is a negative y rotation.
      m.rotation.set(0, (-d.frame.rot * Math.PI) / 180, 0);
      const s = d.lifted ? 1.12 : 1;
      m.scale.set(s, 1, s);
    }
  }

  get count(): number {
    return this.meshes.size;
  }

  private release(): void {
    this.geometry?.dispose();
    this.material?.dispose();
    this.matcap?.dispose();
    this.geometry = null;
    this.material = null;
    this.matcap = null;
  }

  dispose(): void {
    for (const m of this.meshes.values()) this.object.remove(m);
    this.meshes.clear();
    this.release();
  }
}

/** Card footprint constants re-exported for the scene's clip routes. */
export const CLIP_CARD = { w: CARD_W, h: CARD_H } as const;
