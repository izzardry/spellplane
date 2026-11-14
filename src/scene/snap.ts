/**
 * Drop resolution (DESIGN "Specification: geometry, layout and motion", Drop resolution; "Card manipulation",
 * Magnetic snapping). Pure: given the proposed pose of the grabbed card, the cursor and the other cards, decide
 * where the drop lands. Rules, in order:
 *   1. Over a zone pile (library, graveyard, exile), the stack lane or an avatar: that zone.
 *   2. Centre within 12 mm of another card's centre: join or create a squared pile.
 *   3. Top edge within the lower third of another card and horizontally overlapping by at least half:
 *      join or create a cascade below it (offset 14 mm toward the owner).
 *   4. Any edge within 12 mm of a neighbour's edge plus the 6 mm gap: align to it.
 *   5. Otherwise the free position, clamped to the table.
 * Holding Ctrl skips rules 2 to 4.
 */
import { GEOMETRY } from '../core/geometry';
import type { InstanceId, PileRef, Pose, ZoneId } from '../core/types';
import type { Rect } from '../games/types';
import { cardHalfExtents, normDeg, pointInRect, rot2 } from './math';
import type { TablePoint } from './types';

/** A card the drop may snap to. `frameDeg` is the seat angle of its controller (its owner's "down"). */
export interface SnapCard {
  id: InstanceId;
  pose: Pose;
  pile?: PileRef;
  frameDeg: number;
}

/** A rule-1 drop target: a zone pile footprint, the stack lane or an avatar disc. */
export interface ZoneTarget {
  zone: ZoneId;
  rect?: Rect;
  circle?: { x: number; y: number; r: number };
}

/** An axis-aligned box relative to the grabbed card's centre, canonical frame (the whole dragged group). */
export interface Extent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface DropInput {
  /** Free pose of the grabbed card where the pointer released it. */
  pose: Pose;
  /** Table point under the pointer. */
  cursor: TablePoint;
  /** One card is dragged; rules 2 and 3 apply to single cards only. */
  single: boolean;
  ctrl: boolean;
  /** Seat angle of the territory the drop lands in: the frame for edge alignment. */
  frameDeg: number;
  /** Extent of the dragged group around the grabbed card's centre; defaults to the card itself. */
  extent?: Extent;
}

export interface DropContext {
  table: DropTable;
  /** Cards on the battlefields, without the dragged ones. */
  cards: SnapCard[];
  targets: ZoneTarget[];
}

export type DropResult =
  | { rule: 1; kind: 'zone'; zone: ZoneId }
  | { rule: 2; kind: 'squared'; pose: Pose; onto: InstanceId; pile: PileRef | null }
  | { rule: 3; kind: 'cascade'; pose: Pose; below: InstanceId; pile: PileRef | null }
  | { rule: 4; kind: 'align'; pose: Pose; to: InstanceId }
  | { rule: 5; kind: 'free'; pose: Pose };

const { gap: GAP, snapRadius: R, cascadeOffset: CASCADE } = GEOMETRY;

/** The rule-1 target under a table point, if any. */
export function zoneTargetAt(p: TablePoint, targets: readonly ZoneTarget[]): ZoneTarget | null {
  for (const t of targets) {
    if (t.rect && pointInRect(p, t.rect)) return t;
    if (t.circle && Math.hypot(p.x - t.circle.x, p.y - t.circle.y) <= t.circle.r) return t;
  }
  return null;
}

/**
 * The area a drop may land in: the w × d table centred on the table centre, and, where seats do not sit at right
 * angles (the three-player table, M5-P7), the same rectangle turned by each of `turns` degrees clockwise as well: the
 * drop stays on the intersection of every viewer's turned table (scene/layout.ts dropTable), so no viewer's fitted view
 * hides a card.
 */
export interface DropTable {
  w: number;
  d: number;
  turns?: readonly number[];
}

/** Bounds of the centre in a frame turned by `turn` so the extent stays within the w × d box (lo > hi: none fits). */
function frameBounds(table: DropTable, turn: number, e: Extent): { lo: [number, number]; hi: [number, number] } {
  let minX = e.minX;
  let maxX = e.maxX;
  let minY = e.minY;
  let maxY = e.maxY;
  if (turn) {
    // The extent's box as seen in the turned frame (its bounding box there).
    minX = minY = Infinity;
    maxX = maxY = -Infinity;
    for (const [a, b] of [
      [e.minX, e.minY],
      [e.maxX, e.minY],
      [e.maxX, e.maxY],
      [e.minX, e.maxY],
    ] as const) {
      const [u, v] = rot2(a, b, -turn);
      minX = Math.min(minX, u);
      maxX = Math.max(maxX, u);
      minY = Math.min(minY, v);
      maxY = Math.max(maxY, v);
    }
  }
  return { lo: [-table.w / 2 - minX, -table.d / 2 - minY], hi: [table.w / 2 - maxX, table.d / 2 - maxY] };
}

const clampAxis = (v: number, lo: number, hi: number) => (lo > hi ? 0 : Math.min(hi, Math.max(lo, v)));

/** Clamp a pose so the dragged extent stays on the table (rule 5, also applied to snapped results). */
export function clampToTable(pose: Pose, table: DropTable, extent?: Extent): Pose {
  const e = extent ?? cardExtent(pose.rot);
  const b0 = frameBounds(table, 0, e);
  let x = clampAxis(pose.x, b0.lo[0], b0.hi[0]);
  let y = clampAxis(pose.y, b0.lo[1], b0.hi[1]);
  const turns = (table.turns ?? []).map(normDeg).filter((t) => t !== 0);
  if (turns.length) {
    const frames = [{ turn: 0, b: b0 }, ...turns.map((turn) => ({ turn, b: frameBounds(table, turn, e) }))];
    const local = (turn: number): [number, number] => (turn ? rot2(x, y, -turn) : [x, y]);
    const EPS = 1e-6;
    const inside = () =>
      frames.every(({ turn, b }) => {
        const [u, v] = local(turn);
        return (b.lo[0] > b.hi[0] ? Math.abs(u) <= EPS : u >= b.lo[0] - EPS && u <= b.hi[0] + EPS) && (b.lo[1] > b.hi[1] ? Math.abs(v) <= EPS : v >= b.lo[1] - EPS && v <= b.hi[1] + EPS);
      });
    // Projections onto each turned box in turn converge on the intersection (all convex, the centre in each).
    for (let pass = 0; pass < 32 && !inside(); pass++) {
      for (const { turn, b } of frames) {
        const [u, v] = local(turn);
        const q: [number, number] = [clampAxis(u, b.lo[0], b.hi[0]), clampAxis(v, b.lo[1], b.hi[1])];
        [x, y] = turn ? rot2(q[0], q[1], turn) : q;
      }
    }
    if (!inside()) {
      // What is left of a slow convergence: pull the point toward the centre until it lies in every box.
      let s = 1;
      for (const { turn, b } of frames) {
        const [u, v] = local(turn);
        for (const [w, lo, hi] of [
          [u, b.lo[0], b.hi[0]],
          [v, b.lo[1], b.hi[1]],
        ] as const) {
          if (lo > hi) s = 0;
          else if (w > hi) s = Math.min(s, Math.max(0, hi) / w);
          else if (w < lo) s = Math.min(s, Math.min(0, lo) / w);
        }
      }
      x *= s;
      y *= s;
    }
  }
  return { x, y, rot: pose.rot };
}

/** A single card's extent around its centre in the canonical frame. */
export function cardExtent(rot: number): Extent {
  const { hw, hh } = cardHalfExtents(rot, 0);
  return { minX: -hw, maxX: hw, minY: -hh, maxY: hh };
}

/** Resolve a drop (rules 1 to 5). */
export function resolveDrop(input: DropInput, ctx: DropContext): DropResult {
  // Rule 1: zone piles, stack lane, avatars, by the pointer position.
  const target = zoneTargetAt(input.cursor, ctx.targets);
  if (target) return { rule: 1, kind: 'zone', zone: target.zone };

  const rot = normDeg(input.pose.rot);
  const p: Pose = { x: input.pose.x, y: input.pose.y, rot };
  const clampP = (q: Pose) => clampToTable(q, ctx.table, input.extent);

  if (!input.ctrl) {
    if (input.single) {
      const squared = ruleSquared(p, ctx.cards);
      if (squared) return { ...squared, pose: clampP(squared.pose) };
      const cascade = ruleCascade(p, ctx.cards);
      if (cascade) return { ...cascade, pose: clampP(cascade.pose) };
    }
    const align = ruleAlign(p, input.frameDeg, ctx.cards);
    if (align) return { ...align, pose: clampP(align.pose) };
  }
  return { rule: 5, kind: 'free', pose: clampP(p) };
}

/** Rule 2: centre within the snap radius of a loose card or a squared pile. */
function ruleSquared(p: Pose, cards: readonly SnapCard[]): Extract<DropResult, { rule: 2 }> | null {
  const tops = topOfSquaredPiles(cards);
  let best: SnapCard | null = null;
  let bestD = Infinity;
  for (const c of cards) {
    if (c.pile && (c.pile.kind !== 'squared' || tops.get(c.pile.id) !== c.id)) continue;
    const d = Math.hypot(p.x - c.pose.x, p.y - c.pose.y);
    if (d <= R && d < bestD) {
      best = c;
      bestD = d;
    }
  }
  if (!best) return null;
  return {
    rule: 2,
    kind: 'squared',
    pose: { x: best.pose.x, y: best.pose.y, rot: p.rot },
    onto: best.id,
    pile: best.pile && best.pile.kind === 'squared' ? best.pile : null,
  };
}

/** Rule 3: the dragged card's top edge in the lower third of a loose card or the last card of a cascade. */
function ruleCascade(p: Pose, cards: readonly SnapCard[]): Extract<DropResult, { rule: 3 }> | null {
  const lastOfCascade = lastOfCascades(cards);
  let best: { c: SnapCard; d: number } | null = null;
  for (const c of cards) {
    if (c.pile && (c.pile.kind !== 'cascade' || lastOfCascade.get(c.pile.id) !== c.id)) continue;
    const f = c.frameDeg;
    const [dx, dy] = rot2(p.x - c.pose.x, p.y - c.pose.y, -f);
    const de = cardHalfExtents(p.rot, f);
    const te = cardHalfExtents(c.pose.rot, f);
    const top = dy + de.hh;
    const bottom = -te.hh;
    if (top < bottom - 1e-9 || top > bottom + (2 * te.hh) / 3 + 1e-9) continue;
    const overlap = Math.min(dx + de.hw, te.hw) - Math.max(dx - de.hw, -te.hw);
    if (overlap < de.hw - 1e-9) continue;
    const d = Math.hypot(dx, top - bottom);
    if (!best || d < best.d) best = { c, d };
  }
  if (!best) return null;
  const { c } = best;
  const [ox, oy] = rot2(0, -CASCADE, c.frameDeg);
  return {
    rule: 3,
    kind: 'cascade',
    pose: { x: c.pose.x + ox, y: c.pose.y + oy, rot: p.rot },
    below: c.id,
    pile: c.pile && c.pile.kind === 'cascade' ? c.pile : null,
  };
}

interface Box {
  l: number;
  r: number;
  b: number;
  t: number;
  cx: number;
  cy: number;
}

function boxIn(pose: Pose, frameDeg: number): Box {
  const [cx, cy] = rot2(pose.x, pose.y, -frameDeg);
  const { hw, hh } = cardHalfExtents(pose.rot, frameDeg);
  return { l: cx - hw, r: cx + hw, b: cy - hh, t: cy + hh, cx, cy };
}

/** The smallest-magnitude candidate within the snap radius, or null. */
function nearest(cands: number[]): number | null {
  let best: number | null = null;
  for (const v of cands) if (Math.abs(v) <= R + 1e-9 && (best === null || Math.abs(v) < Math.abs(best))) best = v;
  return best;
}

/**
 * Rule 4: an edge within the snap radius of a neighbour's edge plus the standard gap. The card moves on that axis
 * to sit exactly one gap away, and on the other axis aligns to the neighbour's matching edge or centre when that
 * is within the snap radius too (so rows and columns line up).
 */
function ruleAlign(p: Pose, frameDeg: number, cards: readonly SnapCard[]): Extract<DropResult, { rule: 4 }> | null {
  const d = boxIn(p, frameDeg);
  let best: { primary: number; secondary: number; dx: number; dy: number; id: InstanceId } | null = null;
  const consider = (primary: number, secondary: number, dx: number, dy: number, id: InstanceId) => {
    const a = Math.abs(primary);
    const s = Math.abs(secondary);
    if (!best || a < best.primary - 1e-9 || (Math.abs(a - best.primary) <= 1e-9 && s < best.secondary)) {
      best = { primary: a, secondary: s, dx, dy, id };
    }
  };
  for (const c of cards) {
    const n = boxIn(c.pose, frameDeg);
    // Side by side: vertical ranges overlap (or nearly).
    if (Math.min(d.t, n.t) - Math.max(d.b, n.b) > -R) {
      const dx = nearest([n.r + GAP - d.l, n.l - GAP - d.r]);
      if (dx !== null) {
        const dy = nearest([n.t - d.t, n.b - d.b, n.cy - d.cy]) ?? 0;
        consider(dx, dy, dx, dy, c.id);
      }
    }
    // Above or below: horizontal ranges overlap (or nearly).
    if (Math.min(d.r, n.r) - Math.max(d.l, n.l) > -R) {
      const dy = nearest([n.t + GAP - d.b, n.b - GAP - d.t]);
      if (dy !== null) {
        const dx = nearest([n.l - d.l, n.r - d.r, n.cx - d.cx]) ?? 0;
        consider(dy, dx, dx, dy, c.id);
      }
    }
  }
  if (!best) return null;
  const b = best as { dx: number; dy: number; id: InstanceId };
  const [x, y] = rot2(d.cx + b.dx, d.cy + b.dy, frameDeg);
  return { rule: 4, kind: 'align', pose: { x, y, rot: p.rot }, to: b.id };
}

function topOfSquaredPiles(cards: readonly SnapCard[]): Map<string, InstanceId> {
  const top = new Map<string, { id: InstanceId; index: number }>();
  for (const c of cards) {
    if (c.pile?.kind !== 'squared') continue;
    const cur = top.get(c.pile.id);
    if (!cur || c.pile.index > cur.index) top.set(c.pile.id, { id: c.id, index: c.pile.index });
  }
  return new Map([...top].map(([k, v]) => [k, v.id]));
}

function lastOfCascades(cards: readonly SnapCard[]): Map<string, InstanceId> {
  const last = new Map<string, { id: InstanceId; index: number }>();
  for (const c of cards) {
    if (c.pile?.kind !== 'cascade') continue;
    const cur = last.get(c.pile.id);
    if (!cur || c.pile.index > cur.index) last.set(c.pile.id, { id: c.id, index: c.pile.index });
  }
  return new Map([...last].map(([k, v]) => [k, v.id]));
}
