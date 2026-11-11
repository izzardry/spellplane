/**
 * Blocks and the blocker fan (DESIGN "Combat and annotation", Combat shortcuts 3: "A defender drags a creature onto an
 * attacker. The blocker moves temporarily to sit in front of it and a block line joins the pair. Several blockers on
 * one attacker fan out; their left-to-right order is the damage order and can be rearranged by dragging";
 * "Specification: geometry, layout and motion": blocker position 96 in front of the attacker on the defender's side,
 * further blockers offset 69 sideways).
 *
 * Pure: turns a drop into ActionDrafts (moveTemp with combat 'block', lineAdd/lineRemove of block lines), so it is
 * unit-testable without WebGL. The fan is not stored anywhere: who blocks whom is the set of block lines (blocker ->
 * attacker), and the damage order is the blockers' left-to-right order, read from their poses.
 *
 * Frame: the fan is centred on the attacker, one blocker distance toward the defender (against the defender's forward
 * axis). Left to right is as the attacking player sees it facing the defender (the attacker orders damage), so in
 * 1v1 the order runs along the attacker's own x axis. Blockers keep their own (untapped) rotation.
 */
import type { ActionDraft } from '../core/actions';
import { GEOMETRY } from '../core/geometry';
import type { CardInstance, InstanceId, Line, Pose, SeatId, TableState } from '../core/types';
import { rot2 } from './math';
import type { TablePoint } from './types';

export interface CombatContext {
  /** A seat's angle in degrees (its layout), 0 for an unknown seat. */
  angleOf(seat: SeatId): number;
  /** Fresh client-chosen ids (lines, groups). */
  newId(prefix: string): string;
}

/** A block drop: the drafts to dispatch and the stored pose each blocker of the fan ends at. */
export interface BlockPlan {
  actions: ActionDraft[];
  poses: Map<InstanceId, Pose>;
}

const round = (v: number): number => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
};

const onBattlefield = (state: TableState, c: CardInstance): boolean => state.zones[c.zone]?.kind === 'battlefield';

/** Block lines (card to card), sorted by id. */
function blockLines(state: TableState): Line[] {
  return Object.values(state.lines)
    .filter((l) => l.kind === 'block' && l.from.kind === 'card' && l.to.kind === 'card')
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The attackers a card blocks (targets of its block lines). */
export function blockedBy(state: TableState, blocker: InstanceId): InstanceId[] {
  return [...new Set(blockLines(state).filter((l) => l.from.id === blocker).map((l) => l.to.id))];
}

/**
 * The fan's axes for an attacker at `attackerAt` blocked by a seat at `defenderAngle`: `out` points from the attacker
 * toward the defender, `side` runs left to right as the attacking player sees the fan.
 */
export function fanAxes(defenderAngle: number): { out: TablePoint; side: TablePoint } {
  const [fx, fy] = rot2(0, 1, defenderAngle);
  const [rx, ry] = rot2(1, 0, defenderAngle);
  return { out: { x: -fx, y: -fy }, side: { x: -rx, y: -ry } };
}

/** Stored poses of `n` blockers fanned in front of an attacker at `at`, in damage order (left to right). */
export function fanPositions(at: TablePoint, defenderAngle: number, n: number): TablePoint[] {
  const { out, side } = fanAxes(defenderAngle);
  const out96 = GEOMETRY.blockerDistance;
  const out69 = GEOMETRY.blockerSpacing;
  const res: TablePoint[] = [];
  for (let i = 0; i < n; i++) {
    const s = (i - (n - 1) / 2) * out69;
    res.push({ x: round(at.x + out.x * out96 + side.x * s), y: round(at.y + out.y * out96 + side.y * s) });
  }
  return res;
}

/** Projection of `p` on the fan's left-to-right axis, relative to the attacker. */
function along(p: TablePoint, at: TablePoint, defenderAngle: number): number {
  const { side } = fanAxes(defenderAngle);
  return (p.x - at.x) * side.x + (p.y - at.y) * side.y;
}

/** The seat whose angle frames an attacker's fan: the controller of its first blocker, else the given fallback. */
function defenderOf(state: TableState, blockers: readonly InstanceId[], fallback: SeatId | null): SeatId | null {
  for (const id of blockers) {
    const c = state.cards[id];
    if (c) return c.controller;
  }
  return fallback;
}

/** The blockers of an attacker in damage order: left to right as the attacking player sees them. */
export function blockersOf(state: TableState, attacker: InstanceId, ctx: Pick<CombatContext, 'angleOf'>): InstanceId[] {
  const a = state.cards[attacker];
  if (!a) return [];
  const ids = [...new Set(blockLines(state).filter((l) => l.to.id === attacker && state.cards[l.from.id]).map((l) => l.from.id))];
  const defender = defenderOf(state, [...ids].sort(), null);
  if (defender === null) return [];
  const angle = ctx.angleOf(defender);
  const key = new Map(ids.map((id) => [id, along(state.cards[id]!.pose, a.pose, angle)]));
  return ids.sort((x, y) => key.get(x)! - key.get(y)! || (x < y ? -1 : x > y ? 1 : 0));
}

/**
 * The attacker a drop onto `target` blocks: the target itself when it attacks, or the attacker the target blocks
 * (dropping onto a fan member joins or reorders that fan). Null when the target is neither.
 */
export function fanAttacker(state: TableState, target: InstanceId): InstanceId | null {
  const t = state.cards[target];
  if (!t || !onBattlefield(state, t)) return null;
  if (t.combat === 'attack') return t.id;
  for (const id of blockedBy(state, t.id)) if (state.cards[id]?.combat === 'attack' && onBattlefield(state, state.cards[id])) return id;
  return null;
}

/**
 * Whether dropping `dragged` onto `attacker` declares (or rearranges) blocks: the attacker is attacking on a
 * battlefield, and every dragged card is another seat's card on a battlefield (a card dropped onto its own
 * controller's attacker is an ordinary drop: a pile).
 */
export function canBlock(state: TableState, dragged: readonly InstanceId[], attacker: InstanceId): boolean {
  const a = state.cards[attacker];
  if (!a || a.combat !== 'attack' || !onBattlefield(state, a) || dragged.length === 0) return false;
  return dragged.every((id) => {
    const c = state.cards[id];
    return !!c && id !== attacker && c.controller !== a.controller && onBattlefield(state, c) && c.attachedTo === undefined;
  });
}

/** moveTemp drafts that put `order` (damage order) on its fan in front of `attacker`; unchanged blockers are left alone. */
function fanDrafts(state: TableState, attacker: CardInstance, order: readonly InstanceId[], ctx: CombatContext, poses: Map<InstanceId, Pose>): ActionDraft[] {
  const defender = defenderOf(state, order, null);
  if (defender === null) return [];
  const spots = fanPositions(attacker.pose, ctx.angleOf(defender), order.length);
  const out: ActionDraft[] = [];
  order.forEach((id, i) => {
    const c = state.cards[id]!;
    const pose: Pose = { x: spots[i]!.x, y: spots[i]!.y, rot: c.pose.rot };
    poses.set(id, pose);
    const same = c.pose.x === pose.x && c.pose.y === pose.y && c.combat === 'block' && c.home !== undefined;
    if (same) return;
    out.push({ type: 'moveTemp', card: id, pose, combat: 'block' });
  });
  return out;
}

/**
 * Drafts for dropping `moved` (the dragged cards, grabbed one first) onto `attacker`'s fan with the pointer at `at`
 * (table point). The moved cards enter the damage order where they were dropped (left to right), keeping their own
 * order; the whole fan re-spaces around the attacker. A moved card that blocked another attacker leaves that fan (its
 * block line goes and the fan closes up). Every new pair gets a block line, blocker to attacker. Returns null when the
 * drop is not a block (see canBlock).
 */
export function blockPlan(state: TableState, moved: readonly InstanceId[], attacker: InstanceId, at: TablePoint, ctx: CombatContext): BlockPlan | null {
  if (!canBlock(state, moved, attacker)) return null;
  const a = state.cards[attacker]!;
  const movedSet = new Set(moved);
  const current = blockersOf(state, attacker, ctx);
  const staying = current.filter((id) => !movedSet.has(id));
  // The fan is framed by its defender: the dragged card's controller when the fan is new.
  const defender = defenderOf(state, staying.length ? staying : [...moved], null)!;
  const angle = ctx.angleOf(defender);
  const t = along(at, a.pose, angle);
  const index = staying.filter((id) => along(state.cards[id]!.pose, a.pose, angle) < t).length;
  const order = [...staying.slice(0, index), ...moved, ...staying.slice(index)];

  const poses = new Map<InstanceId, Pose>();
  const removes: ActionDraft[] = [];
  const refans: ActionDraft[] = [];
  const left = new Set<InstanceId>();
  for (const l of blockLines(state)) {
    if (!movedSet.has(l.from.id) || l.to.id === attacker) continue;
    removes.push({ type: 'lineRemove', line: l.id });
    left.add(l.to.id);
  }
  for (const other of [...left].sort()) {
    const o = state.cards[other];
    if (!o) continue;
    const rest = blockersOf(state, other, ctx).filter((id) => !movedSet.has(id));
    refans.push(...fanDrafts(state, o, rest, ctx, poses));
  }
  const moves = fanDrafts(state, a, order, ctx, poses);
  const lined = new Set(blockLines(state).filter((l) => l.to.id === attacker).map((l) => l.from.id));
  const adds: ActionDraft[] = moved
    .filter((id) => !lined.has(id))
    .map((id) => ({ type: 'lineAdd', line: ctx.newId('ln'), kind: 'block', from: { kind: 'card', id }, to: { kind: 'card', id: attacker } }));
  return { actions: regroup([...removes, ...refans, ...moves, ...adds], ctx), poses };
}

/**
 * Drafts that take `moved` out of every fan they block in (dragged away from it): their block lines go and each
 * fan they leave closes up. Empty when none of them blocks.
 */
export function unblockDrafts(state: TableState, moved: readonly InstanceId[], ctx: CombatContext): ActionDraft[] {
  const movedSet = new Set(moved);
  const removes: ActionDraft[] = [];
  const left = new Set<InstanceId>();
  for (const l of blockLines(state)) {
    if (!movedSet.has(l.from.id)) continue;
    removes.push({ type: 'lineRemove', line: l.id });
    left.add(l.to.id);
  }
  const poses = new Map<InstanceId, Pose>();
  const refans: ActionDraft[] = [];
  for (const other of [...left].sort()) {
    const o = state.cards[other];
    if (!o) continue;
    const rest = blockersOf(state, other, ctx).filter((id) => !movedSet.has(id));
    refans.push(...fanDrafts(state, o, rest, ctx, poses));
  }
  return [...removes, ...refans];
}

/** One group id over a list of drafts, so the gesture is undone as one step (a single draft needs none). */
export function regroup(actions: ActionDraft[], ctx: Pick<CombatContext, 'newId'>): ActionDraft[] {
  if (actions.length < 2) return actions;
  const group = ctx.newId('g');
  return actions.map((a) => ({ ...a, group }));
}
