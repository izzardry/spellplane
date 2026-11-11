/**
 * Connection lines (DESIGN "Combat and annotation": "A line joins any two things: card to card, card to player, stack
 * item to target ... Lines glow in the owner's seat colour, follow their endpoints as cards move, and carry an optional
 * short label"; the five line kinds target, attack, block, attachment and persistent mark; "Themes and rendering":
 * Paper draws crisp 1.5 px strokes in seat colours; "Input and interaction design", Accessibility: seat colours are
 * paired with a line dash).
 *
 * Pure geometry here, no Three.js below LineLayer: which lines are drawn (the state's lines plus two derived kinds: an
 * attachment line while an attached card is pulled apart from its host, and a dashed stub on an attacker with no
 * attack target when its controller has several opponents) and how each becomes segments (trimmed to the edges of the
 * cards it joins, dashed by the theme's seat pattern in screen px, with the theme's arrowhead at the target end).
 * Ping rings (DESIGN "Combat and annotation", Ping) are drawn by the same layer type.
 * All lines share one fat-line mesh, one draw call; width and colour come from the theme's lineStyle.
 */
import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { Anchor, InstanceId, LineKind, Pose, SeatId, TableState } from '../core/types';
import type { LineStyle } from '../themes/types';
import type { Segment } from './ghost';
import { CARD_H, CARD_W, rot2 } from './math';
import type { TablePoint } from './types';

export type { Segment };

export interface LineDraw {
  from: TablePoint;
  to: TablePoint;
  colour: string;
  widthPx: number;
}

/** What a line endpoint covers on the table, so the stroke starts at its edge instead of its centre. */
export type EndShape = { kind: 'card'; pose: Pose } | { kind: 'circle'; r: number } | { kind: 'point' };

/** A line as the scene draws it this frame (DESIGN "Combat and annotation", Connection lines). */
export interface DrawnLine {
  /** The state line's id; `attach:<card>` for a derived attachment line, `stub:<card>` for an attack stub. */
  id: string;
  kind: LineKind;
  /** Seat whose colour it is drawn in. */
  by: SeatId;
  /** Endpoint centres in table mm (canonical frame), following the cards' displayed poses. */
  from: TablePoint;
  to: TablePoint;
  label?: string;
  /** 'state': a line of TableState; 'attach': an attached card pulled apart; 'stub': an attacker with no target; 'draft': the line being drawn. */
  source: 'state' | 'attach' | 'stub' | 'draft';
  /** Drawn dashed. */
  dashed: boolean;
}

/** A ping as the debug hook reports it: where its ring is drawn and how strong it still is (0 once faded). */
export interface DebugPing {
  id: string;
  target: Anchor;
  seat: SeatId;
  /** Centre of the pinged thing in table mm, or null when it is not drawn. */
  at: TablePoint | null;
  alpha: number;
}

// The scene registers these beside the design's members (dev and test builds; DESIGN "Specification: code interfaces").
declare module '../util/debug' {
  interface DebugParts {
    /** Every line drawn this frame, with its endpoint centres (state lines, derived attachment lines, attack stubs). */
    drawnLines: () => DrawnLine[];
    /** Pings being shown. */
    pings: () => DebugPing[];
  }
}

/** An attached card further than this from its host's centre (mm) is "pulled apart" and shows its attachment line. */
export const ATTACH_APART = 30;
/** Length of the dashed stub on an attacker with no attack target, mm beyond its edge. */
export const STUB_LEN = 30;
/** Gap between a card's edge and the stroke's end, mm. */
export const END_GAP = 1.5;
/** Arrowhead length and dot radius, CSS px (scaled to mm by the zoom). */
export const ARROW_PX = 9;
/** Dash pattern of a stub and of a line being drawn, CSS px. */
export const STUB_DASH = [5, 4];

/** Points of every endpoint the scene can draw a line to; null when the endpoint is not drawn. */
export interface AnchorResolver {
  point(a: Anchor): TablePoint | null;
  shape(a: Anchor): EndShape;
}

/**
 * The lines to draw: every state line whose ends are drawn, the derived attachment lines and the attack stubs.
 * `poseOf` gives a card's displayed pose on a battlefield (null when it is not there); `opponents` counts a seat's
 * opponents; `forwardOf` is a seat's forward axis (toward the table centre).
 */
export function drawnLines(
  state: TableState,
  anchors: AnchorResolver,
  poseOf: (card: InstanceId) => Pose | null,
  opponents: (seat: SeatId) => number,
  forwardOf: (seat: SeatId) => TablePoint,
): DrawnLine[] {
  const out: DrawnLine[] = [];
  const lines = Object.values(state.lines).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const attachLined = new Set<string>();
  const targeted = new Set<InstanceId>();
  for (const l of lines) {
    if (l.kind === 'attach' && l.from.kind === 'card' && l.to.kind === 'card') attachLined.add(`${l.from.id}>${l.to.id}`);
    if (l.kind === 'attack' && l.from.kind === 'card') targeted.add(l.from.id);
    const from = anchors.point(l.from);
    const to = anchors.point(l.to);
    if (!from || !to) continue;
    out.push({ id: l.id, kind: l.kind, by: l.by, from, to, ...(l.label ? { label: l.label } : {}), source: 'state', dashed: false });
  }
  for (const id of Object.keys(state.cards).sort()) {
    const c = state.cards[id]!;
    const pose = poseOf(id);
    if (!pose) continue;
    if (c.attachedTo !== undefined && !attachLined.has(`${id}>${c.attachedTo}`)) {
      const host = poseOf(c.attachedTo);
      if (host && Math.hypot(pose.x - host.x, pose.y - host.y) > ATTACH_APART) {
        out.push({ id: `attach:${id}`, kind: 'attach', by: c.controller, from: { x: pose.x, y: pose.y }, to: { x: host.x, y: host.y }, source: 'attach', dashed: false });
      }
    }
    if (c.combat === 'attack' && !targeted.has(id) && opponents(c.controller) > 1) {
      const f = forwardOf(c.controller);
      out.push({ id: `stub:${id}`, kind: 'attack', by: c.controller, from: { x: pose.x, y: pose.y }, to: { x: pose.x + f.x * STUB_LEN, y: pose.y + f.y * STUB_LEN }, source: 'stub', dashed: true });
    }
  }
  return out;
}

/** Distance from the centre of a card at `pose` to its edge along the unit direction (ux, uy). */
export function cardReach(pose: Pose, ux: number, uy: number, w = CARD_W, h = CARD_H): number {
  const [lx, ly] = rot2(ux, uy, -pose.rot);
  const ax = Math.abs(lx);
  const ay = Math.abs(ly);
  const tx = ax < 1e-9 ? Infinity : w / 2 / ax;
  const ty = ay < 1e-9 ? Infinity : h / 2 / ay;
  return Math.min(tx, ty);
}

function reach(shape: EndShape, ux: number, uy: number): number {
  if (shape.kind === 'card') return cardReach(shape.pose, ux, uy) + END_GAP;
  if (shape.kind === 'circle') return shape.r + END_GAP;
  return 0;
}

/**
 * The visible part of a line between two endpoint centres: from the edge of what `from` covers to the edge of what
 * `to` covers. Null when the two overlap so much that nothing is left (a tucked attachment, a card on its target).
 */
export function trimLine(from: TablePoint, to: TablePoint, fromShape: EndShape, toShape: EndShape): Segment | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const ux = dx / len;
  const uy = dy / len;
  const a = reach(fromShape, ux, uy);
  const b = reach(toShape, -ux, -uy);
  if (a + b >= len - 1) return null;
  return { from: { x: from.x + ux * a, y: from.y + uy * a }, to: { x: to.x - ux * b, y: to.y - uy * b } };
}

/** Split a segment into dashes; `pattern` alternates dash and gap lengths (mm), starting with a dash. */
export function dashSegment(s: Segment, pattern: readonly number[]): Segment[] {
  const total = pattern.reduce((x, y) => x + y, 0);
  const dx = s.to.x - s.from.x;
  const dy = s.to.y - s.from.y;
  const len = Math.hypot(dx, dy);
  if (!(total > 0) || len < 1e-6) return [s];
  const out: Segment[] = [];
  const at = (d: number): TablePoint => ({ x: s.from.x + (dx * d) / len, y: s.from.y + (dy * d) / len });
  let d = 0;
  let i = 0;
  // Bounded: at most len / (smallest positive step) iterations, capped for degenerate patterns.
  for (let guard = 0; d < len && guard < 10_000; guard++) {
    const step = Math.max(pattern[i % pattern.length]!, 1e-3);
    if (i % 2 === 0) out.push({ from: at(d), to: at(Math.min(len, d + step)) });
    d += step;
    i++;
  }
  return out;
}

/** Arrowhead segments at `tip` for a line arriving along (ux, uy); `size` in mm. */
export function arrowSegments(tip: TablePoint, ux: number, uy: number, kind: LineStyle['arrowhead'], size: number): Segment[] {
  if (kind === 'none') return [];
  if (kind === 'dot') {
    const r = size / 3;
    const c = { x: tip.x - ux * r, y: tip.y - uy * r };
    const n = 10;
    const out: Segment[] = [];
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      out.push({ from: { x: c.x + Math.cos(a0) * r, y: c.y + Math.sin(a0) * r }, to: { x: c.x + Math.cos(a1) * r, y: c.y + Math.sin(a1) * r } });
    }
    return out;
  }
  const back = { x: tip.x - ux * size, y: tip.y - uy * size };
  const half = kind === 'triangle' ? size * 0.45 : size * 0.6;
  const l = { x: back.x - uy * half, y: back.y + ux * half };
  const r = { x: back.x + uy * half, y: back.y - ux * half };
  const out: Segment[] = [
    { from: l, to: tip },
    { from: r, to: tip },
  ];
  if (kind === 'triangle') out.push({ from: l, to: r });
  return out;
}

/**
 * The segments of one drawn line: trimmed to its endpoints' edges, dashed (the line's own dash, else the theme's seat
 * pattern), with the theme's arrowhead at the `to` end. `pxPerMm` turns the theme's screen-px dashes into table mm.
 */
export function strokeSegments(line: Pick<DrawnLine, 'from' | 'to' | 'dashed'>, style: Pick<LineStyle, 'dash' | 'arrowhead'>, ends: { from: EndShape; to: EndShape }, pxPerMm: number, arrow = true): Segment[] {
  const seg = trimLine(line.from, line.to, ends.from, ends.to);
  if (!seg) return [];
  const mm = (px: number) => px / Math.max(pxPerMm, 1e-6);
  const pattern = line.dashed ? STUB_DASH : style.dash;
  const body = pattern && pattern.length ? dashSegment(seg, pattern.map(mm)) : [seg];
  if (!arrow) return body;
  const dx = seg.to.x - seg.from.x;
  const dy = seg.to.y - seg.from.y;
  const len = Math.hypot(dx, dy);
  const size = Math.min(mm(ARROW_PX), len / 2);
  return [...body, ...arrowSegments(seg.to, dx / len, dy / len, style.arrowhead, size)];
}

/** Ping ring (DESIGN "Combat and annotation", Ping): an outline around a card, `pad` mm outside its edges. */
export function cardRing(pose: Pose, pad: number): Segment[] {
  const w = CARD_W / 2 + pad;
  const h = CARD_H / 2 + pad;
  const pts = [
    [-w, -h],
    [w, -h],
    [w, h],
    [-w, h],
  ].map(([u, v]) => {
    const [x, y] = rot2(u!, v!, pose.rot);
    return { x: pose.x + x, y: pose.y + y };
  });
  return pts.map((p, i) => ({ from: p, to: pts[(i + 1) % 4]! }));
}

/** A circle outline of radius `r` around `c`, as segments. */
export function circleRing(c: TablePoint, r: number, n = 32): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    out.push({ from: { x: c.x + Math.cos(a0) * r, y: c.y + Math.sin(a0) * r }, to: { x: c.x + Math.cos(a1) * r, y: c.y + Math.sin(a1) * r } });
  }
  return out;
}

/** Ping strength at `ageMs` of `fadeMs`: full at once, fading to nothing (DESIGN: pings fade after two seconds). */
export function pingAlpha(ageMs: number, fadeMs: number): number {
  if (ageMs < 0) return 1;
  if (fadeMs <= 0 || ageMs >= fadeMs) return 0;
  return 1 - ageMs / fadeMs;
}

/** How far a ping ring sits outside the card at `ageMs`: it pulses out twice over the first second, mm. */
export function pingPad(ageMs: number): number {
  const t = Math.max(0, ageMs) / 500;
  return 2 + 4 * (t - Math.floor(t));
}

const tmp = new THREE.Color();

export class LineLayer {
  readonly object: LineSegments2;
  private material: LineMaterial;
  private geometry: LineSegmentsGeometry;
  private sig = '';

  /** `renderOrder` 4 (default) draws over the cards; below 2 draws under them. `opacity` applies to every line. */
  constructor(opts: { renderOrder?: number; opacity?: number; name?: string } = {}) {
    this.material = new LineMaterial({ linewidth: 1.5, vertexColors: true, worldUnits: false, transparent: true, opacity: opts.opacity ?? 1, depthTest: false, depthWrite: false });
    this.geometry = new LineSegmentsGeometry();
    this.object = new LineSegments2(this.geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = opts.renderOrder ?? 4;
    this.object.visible = false;
    this.object.name = opts.name ?? 'lines';
  }

  /** Line opacity (theme switch, ping fade). */
  setOpacity(opacity: number): void {
    this.material.opacity = opacity;
  }

  setResolution(w: number, h: number): void {
    this.material.resolution.set(w, h);
  }

  sync(lines: readonly LineDraw[]): void {
    const sig = lines.map((l) => `${l.from.x.toFixed(2)},${l.from.y.toFixed(2)},${l.to.x.toFixed(2)},${l.to.y.toFixed(2)},${l.colour}`).join(';');
    if (sig === this.sig) return;
    this.sig = sig;
    this.object.visible = lines.length > 0;
    if (!lines.length) return;
    const pos: number[] = [];
    const col: number[] = [];
    for (const l of lines) {
      pos.push(l.from.x, 30, -l.from.y, l.to.x, 30, -l.to.y);
      tmp.set(l.colour);
      col.push(tmp.r, tmp.g, tmp.b, tmp.r, tmp.g, tmp.b);
    }
    const g = new LineSegmentsGeometry();
    g.setPositions(pos);
    g.setColors(col);
    this.object.geometry.dispose();
    this.object.geometry = g;
    this.geometry = g;
    this.material.linewidth = lines[0]!.widthPx;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
