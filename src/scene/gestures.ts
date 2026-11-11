/**
 * Gestures to actions (DESIGN "Card manipulation"; CLAUDE.md conventions: the scene dispatches ActionDrafts, a
 * gesture over several cards dispatches one action per card sharing a `group`). Pure: the scene never mutates
 * state, it only turns a resolved drop or a tap into drafts for `opts.dispatch`.
 */
import type { ActionDraft } from '../core/actions';
import type { CardInstance, InstanceId, PileRef, Pose, SeatId, TableState, ZoneId, ZonePresentation } from '../core/types';
import { storedPose } from './layout';
import type { DropResult } from './snap';

export interface DropDestination {
  /** Battlefield zone the drop lands in (for rules 2 to 5). */
  zone: ZoneId;
  /** Seat whose territory it is. */
  controller: SeatId;
}

export interface DropActionOptions {
  /** Fresh client-chosen ids (piles, stack items, groups). */
  newId(prefix: string): string;
  /** The whole pile is dragged by its bottom card: members keep their pile membership. */
  keepPile: boolean;
  /** Presentation of a zone (by id), from the game definition. */
  presentation(zone: ZoneId): ZonePresentation | null;
}

const samePose = (a: Pose, b: Pose) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.rot - b.rot) < 1e-6;

/** Number of members of a pile in the state. */
function pileSize(state: TableState, pile: string, except: ReadonlySet<InstanceId>): number {
  let n = 0;
  for (const c of Object.values(state.cards)) if (c.pile?.id === pile && !except.has(c.id)) n++;
  return n;
}

/**
 * Drafts for a drop. `cards` are the dragged cards, the grabbed (anchor) card first; `start` holds their poses at
 * drag start, so a group keeps its arrangement. Returns [] when nothing would change.
 */
export function dropActions(
  state: TableState,
  cards: readonly CardInstance[],
  start: ReadonlyMap<InstanceId, Pose>,
  result: DropResult,
  dest: DropDestination,
  opts: DropActionOptions,
): ActionDraft[] {
  const anchor = cards[0];
  if (!anchor) return [];
  const out: ActionDraft[] = [];
  const dragged = new Set(cards.map((c) => c.id));

  if (result.kind === 'zone') {
    const zone = state.zones[result.zone];
    const pres = opts.presentation(result.zone);
    for (const c of cards) {
      if (c.zone === result.zone) continue;
      if (pres === 'cascade-lane') {
        // Putting an item on the stack opens a confirmation round about it (DESIGN "The effect stack", Stack and confirmation).
        out.push({ type: 'stackPush', item: opts.newId('si'), kind: 'spell', card: c.id, round: opts.newId('r') });
      } else if (zone && zone.visibility !== 'public') {
        const kind = zone.kind;
        out.push({ type: 'toZone', card: c.id, to: result.zone, position: kind === 'library' ? 'top' : 'any' });
      } else {
        out.push({ type: 'move', card: c.id, to: result.zone, pile: null });
      }
    }
    return withGroup(out, opts);
  }

  const controllerOf = (c: CardInstance) => (c.controller !== dest.controller ? { controller: dest.controller } : {});

  if (result.kind === 'squared' || result.kind === 'cascade') {
    const kind = result.kind;
    const targetId = result.kind === 'squared' ? result.onto : result.below;
    let pile: PileRef;
    if (result.pile) {
      pile = { id: result.pile.id, index: pileSize(state, result.pile.id, dragged), kind };
    } else {
      const id = opts.newId('pile');
      out.push({ type: 'pile', card: targetId, pile: { id, index: 0, kind } });
      pile = { id, index: 1, kind };
    }
    out.push({ type: 'move', card: anchor.id, to: dest.zone, pose: result.pose, pile, ...controllerOf(anchor) });
    return withGroup(out, opts);
  }

  // Rules 4 and 5: the anchor lands at the resolved pose, the rest keep their offsets.
  const a0 = start.get(anchor.id) ?? anchor.pose;
  for (const c of cards) {
    const s = start.get(c.id) ?? c.pose;
    const pose: Pose = c === anchor ? result.pose : { x: result.pose.x + (s.x - a0.x), y: result.pose.y + (s.y - a0.y), rot: s.rot };
    const pile = opts.keepPile ? (c.pile ?? null) : null;
    const unchanged = c.zone === dest.zone && samePose(c.pose, pose) && (c.pile?.id ?? null) === (pile?.id ?? null) && c.controller === dest.controller;
    if (unchanged) continue;
    out.push({ type: 'move', card: c.id, to: dest.zone, pose, pile, ...controllerOf(c) });
  }
  return withGroup(out, opts);
}

/**
 * The scene works in drawn poses (a tapped card is drawn turned by 90°); actions carry stored poses. Strips the tap
 * turn from every `move` and `moveTemp` pose of a tapped card.
 */
export function toStoredPoses(state: TableState, actions: readonly ActionDraft[]): ActionDraft[] {
  return actions.map((a) => {
    if ((a.type !== 'move' && a.type !== 'moveTemp') || !a.pose) return a;
    const c = state.cards[a.card];
    return c?.tapped ? { ...a, pose: storedPose(c, a.pose) } : a;
  });
}

/** Temporary move (Alt+drag; DESIGN "Combat and annotation", Temporary move). */
export function tempMoveActions(cards: readonly CardInstance[], start: ReadonlyMap<InstanceId, Pose>, anchorPose: Pose, opts: Pick<DropActionOptions, 'newId'>): ActionDraft[] {
  const anchor = cards[0];
  if (!anchor) return [];
  const a0 = start.get(anchor.id) ?? anchor.pose;
  const out: ActionDraft[] = cards.map((c) => {
    const s = start.get(c.id) ?? c.pose;
    const pose = c === anchor ? anchorPose : { x: anchorPose.x + (s.x - a0.x), y: anchorPose.y + (s.y - a0.y), rot: s.rot };
    return { type: 'moveTemp', card: c.id, pose };
  });
  return withGroup(out, opts);
}

/** Tap or untap: the first card decides; all cards go to that state (DESIGN "Card manipulation", Tap / untap). */
export function tapActions(cards: readonly CardInstance[], opts: Pick<DropActionOptions, 'newId'>): ActionDraft[] {
  const first = cards[0];
  if (!first) return [];
  const tapped = !first.tapped;
  const out: ActionDraft[] = cards.filter((c) => c.tapped !== tapped).map((c) => ({ type: 'tap', card: c.id, tapped }));
  return withGroup(out, opts);
}

function withGroup(actions: ActionDraft[], opts: Pick<DropActionOptions, 'newId'>): ActionDraft[] {
  if (actions.length < 2) return actions;
  const group = opts.newId('g');
  return actions.map((a) => ({ ...a, group }));
}
