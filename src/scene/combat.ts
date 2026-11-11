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
import type { Anchor, CardInstance, InstanceId, Line, LineKind, Pose, SeatId, TableState } from '../core/types';
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

/** Quantise to 0.01 mm as the reducer stores poses (core/reducer/util.ts q), so a planned fan pose equals the stored one. */
const round = (v: number): number => {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
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
  // Only blockers still on a battlefield: a blocker that died and went to the graveyard by hand keeps its line (lines
  // drop only on entering a hidden zone) but is no longer part of the fan.
  const live = (id: InstanceId): boolean => {
    const c = state.cards[id];
    return !!c && onBattlefield(state, c);
  };
  const ids = [...new Set(blockLines(state).filter((l) => l.to.id === attacker && live(l.from.id)).map((l) => l.from.id))];
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
 * The attacker whose fan a drop of `moved` lands in when nothing is under the pointer: every moved card blocks that one
 * attacker and the pointer `at` is within the fan's footprint (its spots, a card each, grown by the snap radius). Such
 * a drop rearranges the fan (or changes nothing) instead of unblocking, so a lone blocker lifted and put back stays.
 */
export function fanUnder(state: TableState, moved: readonly InstanceId[], at: TablePoint, ctx: Pick<CombatContext, 'angleOf'>): InstanceId | null {
  if (moved.length === 0) return null;
  const targets = new Set(moved.flatMap((id) => blockedBy(state, id)));
  if (targets.size !== 1) return null;
  const attacker = [...targets][0]!;
  const a = state.cards[attacker];
  if (!a || a.combat !== 'attack' || !onBattlefield(state, a)) return null;
  const fan = blockersOf(state, attacker, ctx);
  if (!moved.every((id) => fan.includes(id))) return null;
  const angle = ctx.angleOf(state.cards[fan[0]!]!.controller);
  const { out, side } = fanAxes(angle);
  const dx = at.x - a.pose.x;
  const dy = at.y - a.pose.y;
  const s = dx * side.x + dy * side.y;
  const o = dx * out.x + dy * out.y;
  const halfW = ((fan.length - 1) * GEOMETRY.blockerSpacing) / 2 + GEOMETRY.card.w / 2 + GEOMETRY.snapRadius;
  const halfH = GEOMETRY.card.h / 2 + GEOMETRY.snapRadius;
  return Math.abs(s) <= halfW && Math.abs(o - GEOMETRY.blockerDistance) <= halfH ? attacker : null;
}

/** Whether two seats oppose each other: different seats, not teammates (DESIGN "Players, seats and formats", Two-Headed Giant). */
export function opposing(state: TableState, a: SeatId, b: SeatId): boolean {
  if (a === b) return false;
  const ta = state.seats[a]?.team;
  return ta === undefined || ta !== state.seats[b]?.team;
}

/**
 * Whether dropping `dragged` onto `attacker` declares (or rearranges) blocks: the attacker is attacking on a
 * battlefield, and every dragged card is an opposing seat's card on a battlefield (a card dropped onto its own or a
 * teammate's attacker is an ordinary drop: a pile).
 */
export function canBlock(state: TableState, dragged: readonly InstanceId[], attacker: InstanceId): boolean {
  const a = state.cards[attacker];
  if (!a || a.combat !== 'attack' || !onBattlefield(state, a) || dragged.length === 0) return false;
  return dragged.every((id) => {
    const c = state.cards[id];
    return !!c && id !== attacker && opposing(state, c.controller, a.controller) && onBattlefield(state, c) && c.attachedTo === undefined;
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

/**
 * An ordinary drop of `moved` (its `actions`) plus the unblocking of any blockers among them, as one undo group. The
 * unblocking goes first: a drop into a hidden zone (a bounce to hand) drops the card's lines itself, so a lineRemove
 * after it would name a line that is gone and be refused.
 */
export function withUnblock(state: TableState, actions: ActionDraft[], moved: readonly InstanceId[], ctx: CombatContext): ActionDraft[] {
  const unblock = unblockDrafts(state, moved, ctx);
  return unblock.length ? regroup([...unblock, ...actions], ctx) : actions;
}

/**
 * The kind of line a right-drag from `source` to `target` draws (DESIGN "Combat and annotation", Connection lines):
 * Shift draws a persistent mark; from an attacking creature to an opposing seat's avatar or to an opposing seat's
 * permanent (a planeswalker or battle it attacks) it is the attack line; everything else is a target line, so an
 * attacker can still point at the target of an ability. With nothing under the pointer yet (the line being drawn),
 * an attacker's line previews as an attack line.
 */
export function lineKindFor(state: TableState, source: Anchor, target: Anchor | null, shift: boolean): LineKind {
  if (shift) return 'mark';
  if (source.kind !== 'card') return 'target';
  const a = state.cards[source.id];
  if (!a || a.combat !== 'attack' || !onBattlefield(state, a)) return 'target';
  if (target === null) return 'attack';
  if (target.kind === 'seat') return opposing(state, a.controller, target.id) ? 'attack' : 'target';
  if (target.kind !== 'card') return 'target';
  const t = state.cards[target.id];
  return t && onBattlefield(state, t) && opposing(state, a.controller, t.controller) ? 'attack' : 'target';
}

/**
 * Which cards a state change sends home in a settle, with their stagger slot (DESIGN "Specification: geometry, layout
 * and motion", Motion: settle 260 ms with a 20 ms stagger per card). A card goes home when it had a home slot, has none
 * now and stands on it. An attachment of a card going home takes its host's slot (it rides along), unless it goes home
 * itself. `ids` is the drawing order the slots are dealt in; `prevOf` gives a card as it was before the change.
 */
export function settleSlots(state: TableState, ids: Iterable<InstanceId>, prevOf: (id: InstanceId) => CardInstance | undefined): Map<InstanceId, number> {
  const slots = new Map<InstanceId, number>();
  const all = [...ids];
  for (const id of all) {
    const c = state.cards[id];
    const p = prevOf(id);
    if (!c || !p?.home || c.home !== undefined || !onBattlefield(state, c)) continue;
    if (c.pose.x === p.home.x && c.pose.y === p.home.y && c.pose.rot === p.home.rot) slots.set(id, slots.size);
  }
  for (const id of all) {
    if (slots.has(id)) continue;
    // Follow the attachment chain up to the first host going home (bounded by the card count against cycles).
    let host = state.cards[id]?.attachedTo;
    for (let guard = 0; host !== undefined && !slots.has(host) && guard < all.length; guard++) host = state.cards[host]?.attachedTo;
    if (host !== undefined && slots.has(host)) slots.set(id, slots.get(host)!);
  }
  return slots;
}

/** One group id over a list of drafts, so the gesture is undone as one step (a single draft needs none). */
export function regroup(actions: ActionDraft[], ctx: Pick<CombatContext, 'newId'>): ActionDraft[] {
  if (actions.length < 2) return actions;
  const group = ctx.newId('g');
  return actions.map((a) => ({ ...a, group }));
}
