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
import type { ActionDraft } from '../core/actions';
import type { Anchor, InstanceId, Line, LineKind, Pose, SeatId, TableState } from '../core/types';
import type { TableLayout } from '../games/types';
import type { LineStyle, Theme } from '../themes/types';
import { lineKindFor, opposing } from './combat';
import type { Segment } from './ghost';
import { seatLayoutOf, viewerAngle } from './layout';
import { CARD_H, CARD_W, forward, rot2 } from './math';
import type { TextSpec } from './text';
import type { ActivePing, TablePoint } from './types';

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

/** One ping pulse, ms; the ring pulses out twice over the first second, then rests 2 mm out while it fades. */
export const PING_PULSE_MS = 500;

/** How far a ping ring sits outside the card at `ageMs`, mm: 2 to 6 twice over the first second, then 2. */
export function pingPad(ageMs: number): number {
  const age = Math.max(0, ageMs);
  if (age >= 2 * PING_PULSE_MS) return 2;
  const t = age / PING_PULSE_MS;
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


// --- The scene's lines and pings ---------------------------------------------------------------------------------

/** A state line as the debug hook reports it: plus the centres its ends are drawn at, or null while one is not drawn. */
export interface SceneDebugLine extends Line {
  ends: { from: TablePoint; to: TablePoint } | null;
}

/** A line being drawn by right-drag: from `source` toward `cur`, over `target` when something is under the pointer. */
export interface LineDraft {
  pointerId: number;
  source: Anchor;
  sourceCard: InstanceId;
  target: Anchor | null;
  cur: TablePoint;
  shift: boolean;
}

/** What the line view reads from the scene. */
export interface LineViewHost {
  state(): TableState | null;
  pings(): readonly ActivePing[];
  layout(): TableLayout;
  viewerSeat(): SeatId | null;
  theme(): Theme;
  /** Displayed pose of a drawn card (any placement), null when it is not drawn. */
  cardPose(id: InstanceId): Pose | null;
  /** Displayed pose of a card drawn on a battlefield, null otherwise. */
  freePose(id: InstanceId): Pose | null;
  pxPerMm(): number;
  reduced(): boolean;
}

/** Radius of a seat's avatar spot on the table (line end, line target, ping ring), mm. */
export const AVATAR_R = 30;
/** Line label type size on the table, mm; like counter badges it keeps LABEL_MIN_PX on screen, up to LABEL_MAX_SCALE. */
const LABEL_SIZE = 4.5;
const LABEL_MIN_PX = 11;
const LABEL_MAX_SCALE = 3;
/** Stroke width of a ping ring, CSS px. */
const PING_WIDTH_PX = 2.5;

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const sameAnchor = (a: Anchor, b: Anchor) => a.kind === b.kind && a.id === b.id;

/** The anchor a right-drag from a card draws from: the card, or its stack item while it is a spell on the stack; null for a hidden card. */
export function lineSourceOf(state: TableState, card: InstanceId): Anchor | null {
  const c = state.cards[card];
  const z = c ? state.zones[c.zone] : undefined;
  if (!z || z.visibility !== 'public') return null;
  const item = state.stack.find((i) => i.card === card);
  return item ? { kind: 'stackItem', id: item.id } : { kind: 'card', id: card };
}

/** The seat whose avatar spot covers table point `p`, as a line end. */
export function avatarAt(state: TableState, layout: TableLayout, p: TablePoint): Anchor | null {
  for (const seat of Object.values(state.seats).sort((a, b) => a.index - b.index)) {
    const sl = seatLayoutOf(state, layout, seat.id);
    if (sl && Math.hypot(p.x - sl.zones.avatar.x, p.y - sl.zones.avatar.y) <= AVATAR_R) return { kind: 'seat', id: seat.id };
  }
  return null;
}

/**
 * Drafts for releasing a right-drag from `source` over `to` (DESIGN "Combat and annotation", Connection lines): a line
 * of the kind lineKindFor picks. Drawing a line that already exists (same kind and ends) removes it, the manual
 * removal. An attacker has one attack target: a new attack line replaces the old.
 */
export function lineDrafts(state: TableState, source: Anchor, to: Anchor | null, shift: boolean, newId: (prefix: string) => string): ActionDraft[] {
  if (!to || sameAnchor(to, source)) return [];
  const kind = lineKindFor(state, source, to, shift);
  const lines = Object.values(state.lines).sort(byId);
  const same = lines.find((l) => l.kind === kind && sameAnchor(l.from, source) && sameAnchor(l.to, to));
  if (same) return [{ type: 'lineRemove', line: same.id }];
  const out: ActionDraft[] = kind === 'attack' ? lines.filter((l) => l.kind === 'attack' && sameAnchor(l.from, source)).map((l): ActionDraft => ({ type: 'lineRemove', line: l.id })) : [];
  out.push({ type: 'lineAdd', line: newId('ln'), kind, from: source, to });
  if (out.length < 2) return out;
  const group = newId('g');
  return out.map((a) => ({ ...a, group }));
}

/**
 * The scene's connection lines and ping rings: resolves line ends to displayed cards and avatar spots, draws every
 * line (and the one being drawn) on one layer and the ping rings on another, and places line labels. The scene keeps
 * only the call sites (sync per frame, the right-drag gesture, the debug hook).
 */
export class LineView {
  readonly lines = new LineLayer();
  /**
   * Ping rings over everything (DESIGN "Combat and annotation", Ping): one layer per ping, so each fades on its own
   * schedule (a layer's opacity applies to all its lines).
   */
  readonly pingRings = new THREE.Group();
  private readonly pingLayers = new Map<string, LineLayer>();
  private resolution: { w: number; h: number } | null = null;
  /** The line being drawn, if any. */
  draft: LineDraft | null = null;
  readonly anchors: AnchorResolver;
  private drawn: DrawnLine[] = [];
  /** The ends each drawn line covers, by drawn line id (filled with `drawn`). */
  private readonly ends = new Map<string, { from: EndShape; to: EndShape }>();
  /** First time this page drew each ping (its fade starts there). */
  private readonly pingSeen = new Map<string, number>();

  constructor(private readonly host: LineViewHost) {
    this.anchors = { point: (a) => this.point(a), shape: (a) => this.shape(a) };
  }

  /** Where a line end is drawn: a card's displayed centre, a seat's avatar spot, a stack item's card (else the lane). */
  point(a: Anchor): TablePoint | null {
    const state = this.host.state();
    if (!state) return null;
    if (a.kind === 'card') {
      const p = this.host.cardPose(a.id);
      return p ? { x: p.x, y: p.y } : null;
    }
    if (a.kind === 'seat') {
      const sl = seatLayoutOf(state, this.host.layout(), a.id);
      return sl ? { x: sl.zones.avatar.x, y: sl.zones.avatar.y } : null;
    }
    const item = state.stack.find((s) => s.id === a.id);
    if (!item) return null;
    const card = item.card ?? item.source;
    const p = card ? this.host.cardPose(card) : null;
    const lane = this.host.layout().stackLane;
    return p ? { x: p.x, y: p.y } : { x: lane.x, y: lane.y };
  }

  /** What a line end covers, so strokes start at its edge. */
  shape(a: Anchor): EndShape {
    if (a.kind === 'seat') return { kind: 'circle', r: AVATAR_R };
    const state = this.host.state();
    const item = a.kind === 'stackItem' ? state?.stack.find((s) => s.id === a.id) : undefined;
    const id = a.kind === 'card' ? a.id : (item?.card ?? item?.source);
    const pose = id ? this.host.cardPose(id) : null;
    return pose ? { kind: 'card', pose } : { kind: 'point' };
  }

  private seatAngle(seat: SeatId): number {
    const state = this.host.state();
    return state ? (seatLayoutOf(state, this.host.layout(), seat)?.angle ?? 0) : 0;
  }

  /** Seats that are not `seat` and not its teammates (DESIGN "Combat and annotation", Attack target). */
  private opponents(seat: SeatId): number {
    const state = this.host.state();
    if (!state) return 0;
    return Object.values(state.seats).filter((s) => opposing(state, seat, s.id)).length;
  }

  private seatColour(seat: SeatId) {
    const theme = this.host.theme();
    const c = this.host.state()?.seats[seat]?.colour ?? 0;
    return theme.tokens.colours.seats[c] ?? theme.tokens.colours.seats[0]!;
  }

  /** Every line to draw now: state lines, derived attachment lines, attack stubs and the line being drawn. */
  compute(): DrawnLine[] {
    this.ends.clear();
    const state = this.host.state();
    if (!state) return [];
    const out = drawnLines(state, this.anchors, (id) => this.host.freePose(id), (seat) => this.opponents(seat), (seat) => forward(this.seatAngle(seat)));
    for (const l of out) {
      if (l.source === 'state') {
        const sl = state.lines[l.id]!;
        this.ends.set(l.id, { from: this.shape(sl.from), to: this.shape(sl.to) });
      } else if (l.source === 'attach') {
        const c = state.cards[l.id.slice('attach:'.length)]!;
        this.ends.set(l.id, { from: this.shape({ kind: 'card', id: c.id }), to: this.shape({ kind: 'card', id: c.attachedTo! }) });
      } else {
        this.ends.set(l.id, { from: this.shape({ kind: 'card', id: l.id.slice('stub:'.length) }), to: { kind: 'point' } });
      }
    }
    const g = this.draft;
    if (g) {
      const from = this.point(g.source);
      const viewer = this.host.viewerSeat();
      const by = viewer && state.seats[viewer] ? viewer : (Object.keys(state.seats).sort()[0] ?? '');
      if (from) {
        out.push({ id: 'draft', kind: lineKindFor(state, g.source, g.target, g.shift), by, from, to: g.cur, source: 'draft', dashed: true });
        this.ends.set('draft', { from: this.shape(g.source), to: { kind: 'point' } });
      }
    }
    return out;
  }

  /** Redraw the line layer for this frame. */
  sync(): void {
    this.drawn = this.compute();
    const theme = this.host.theme();
    const px = this.host.pxPerMm();
    const out: LineDraw[] = [];
    for (const l of this.drawn) {
      const st = theme.lineStyle(l.kind, this.seatColour(l.by));
      const ends = this.ends.get(l.id) ?? { from: { kind: 'point' }, to: { kind: 'point' } };
      for (const sgm of strokeSegments(l, st, ends, px, l.source !== 'stub')) out.push({ ...sgm, colour: st.colour, widthPx: st.widthPx });
    }
    this.lines.sync(out);
  }

  /** Line labels at their midpoints, upright for the viewer (DESIGN "Combat and annotation": an optional short label). */
  labelSpecs(specs: Map<string, TextSpec>): void {
    const t = this.host.theme().tokens.colours;
    const rot = viewerAngle(this.host.state(), this.host.layout(), this.host.viewerSeat());
    const scale = Math.min(LABEL_MAX_SCALE, Math.max(1, Math.ceil((LABEL_MIN_PX / (LABEL_SIZE * this.host.pxPerMm())) * 4) / 4));
    for (const l of this.drawn) {
      if (!l.label) continue;
      specs.set(`ln:${l.id}`, { text: l.label.slice(0, 40), x: (l.from.x + l.to.x) / 2, y: (l.from.y + l.to.y) / 2, z: 30, rot, size: LABEL_SIZE, scale, colour: t.fg, outline: t.surface, anchorX: 'center', anchorY: 'middle' });
    }
  }

  private pingAge(id: string, now: number): number {
    let t0 = this.pingSeen.get(id);
    if (t0 === undefined) {
      t0 = now;
      this.pingSeen.set(id, t0);
    }
    return now - t0;
  }

  /** The ring a ping draws around its target, `pad` mm out. */
  private pingRing(target: Anchor, pad: number): Segment[] {
    const sh = target.kind === 'seat' ? null : this.shape(target);
    if (sh?.kind === 'card') return cardRing(sh.pose, pad);
    const at = this.point(target);
    return at ? circleRing(at, (target.kind === 'seat' ? AVATAR_R : 20) + pad) : [];
  }

  /** Draw the pings of the view; returns whether one is still fading. */
  syncPings(now: number): boolean {
    const fade = this.host.theme().motion.pingFadeMs;
    const pings = this.host.pings();
    const live = new Set(pings.map((p) => p.id));
    for (const id of [...this.pingSeen.keys()]) if (!live.has(id)) this.pingSeen.delete(id);
    const shown = new Set<string>();
    for (const p of pings) {
      const age = this.pingAge(p.id, now);
      const a = pingAlpha(age, fade);
      if (a <= 0) continue;
      // With reduced motion the ring does not pulse; it still fades.
      const pad = this.host.reduced() ? 3 : pingPad(age);
      const colour = this.seatColour(p.seat).colour;
      const segs = this.pingRing(p.target, pad).map((sgm): LineDraw => ({ ...sgm, colour, widthPx: PING_WIDTH_PX }));
      let layer = this.pingLayers.get(p.id);
      if (!layer) {
        layer = new LineLayer({ renderOrder: 5, name: `ping:${p.id}` });
        if (this.resolution) layer.setResolution(this.resolution.w, this.resolution.h);
        this.pingLayers.set(p.id, layer);
        this.pingRings.add(layer.object);
      }
      layer.setOpacity(a);
      layer.sync(segs);
      shown.add(p.id);
    }
    for (const [id, layer] of this.pingLayers) {
      if (shown.has(id)) continue;
      this.pingRings.remove(layer.object);
      layer.dispose();
      this.pingLayers.delete(id);
    }
    return shown.size > 0;
  }

  /** The line end under table point `p` that is not a card (a seat's avatar spot). */
  avatarAt(p: TablePoint): Anchor | null {
    const state = this.host.state();
    return state ? avatarAt(state, this.host.layout(), p) : null;
  }

  /** Release of the line being drawn over `to`: the drafts to dispatch (empty when it ends on nothing). */
  finish(to: Anchor | null, shift: boolean, newId: (prefix: string) => string): ActionDraft[] {
    const g = this.draft;
    const state = this.host.state();
    this.draft = null;
    if (!g || !state) return [];
    return lineDrafts(state, g.source, to, shift || g.shift, newId);
  }

  setResolution(w: number, h: number): void {
    this.lines.setResolution(w, h);
    this.resolution = { w, h };
    for (const layer of this.pingLayers.values()) layer.setResolution(w, h);
  }

  debugLines(): SceneDebugLine[] {
    const state = this.host.state();
    if (!state) return [];
    return Object.values(state.lines)
      .sort(byId)
      .map((l) => {
        const from = this.point(l.from);
        const to = this.point(l.to);
        return { ...l, ends: from && to ? { from, to } : null };
      });
  }

  debugDrawn(): DrawnLine[] {
    return this.compute().map((l) => ({ ...l, from: { ...l.from }, to: { ...l.to } }));
  }

  debugPings(now: number): DebugPing[] {
    const fade = this.host.theme().motion.pingFadeMs;
    return this.host.pings().map((p) => ({ id: p.id, target: p.target, seat: p.seat, at: this.point(p.target), alpha: pingAlpha(this.pingAge(p.id, now), fade) }));
  }

  dispose(): void {
    this.lines.dispose();
    for (const layer of this.pingLayers.values()) layer.dispose();
    this.pingLayers.clear();
    this.pingRings.clear();
  }
}
