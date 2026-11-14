/**
 * A dragged carry group to actions (PLAN Milestone 6, owner decisions, Attach by overlap: Carry rule, Tuck; Paperclips:
 * "A dragged group is one gesture, undone as one step"; DESIGN "Card manipulation", Placement and piles). Pure, like
 * scene/gestures.ts: the scene's drag computes the group with core/clips.ts `carryGroup`, resolves the drop with
 * scene/snap.ts and turns it into drafts here, one per card that has to move, all sharing one `group`.
 *
 * What is dispatched for a drop of group G (anchor first) with drawn start poses `start`:
 * - a zone (rule 1): every card of G goes there (scene/gestures.ts dropActions); onto the stack lane only the anchor
 *   and the selection, each its own spell;
 * - a squared pile or a cascade (rules 2, 3; one card): as before, after a `detach` when the card leaves its host;
 * - a tuck (rule 3a; one card): `attach` to the host (after a `move` into the host's battlefield when it comes from
 *   elsewhere); the reducer puts it in the next attachment slot behind the host;
 * - a free or aligned spot (rules 4, 5): one `move` per card, the group rigid around the anchor, bottom to top in draw
 *   order (each move puts its card on top, so the group keeps its own stacking). Cards that ride on another card of G
 *   in the same battlefield are left to the reducer (an attachment follows its host's move); a whole pile moves by its
 *   bottom card (members re-join it so they rise in the draw order); cards carried off the middle of a pile form a new
 *   pile of the same kind at the drop; the anchor leaving its host sends `detach` (logged); attachments that cross to
 *   another battlefield with their host are re-attached there.
 */
import type { ActionDraft } from '../core/actions';
import type { DragGroup } from '../core/clips';
import type { CardInstance, InstanceId, PileRef, Pose, TableState } from '../core/types';
import { dropActions, type DropActionOptions, type DropDestination } from './gestures';
import { storedPose } from './layout';
import type { DropResult } from './snap';

const near = (a: Pose, b: Pose) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6 && Math.abs(a.rot - b.rot) < 1e-6;

/** The cards of a group in draw order, bottom to top (zone id, then place in the zone). */
export function drawOrder(state: TableState, ids: readonly InstanceId[]): InstanceId[] {
  const rank = (id: InstanceId): [string, number] => {
    const c = state.cards[id];
    return [c?.zone ?? '', c ? (state.zones[c.zone]?.ids.indexOf(id) ?? -1) : -1];
  };
  return [...ids].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra[0] < rb[0] ? -1 : ra[0] > rb[0] ? 1 : ra[1] - rb[1];
  });
}

/** Where every card of the group is drawn after a rigid move of the anchor to `anchor` (drawn poses). */
export function rigidPoses(group: DragGroup, start: ReadonlyMap<InstanceId, Pose>, anchor: Pose): Map<InstanceId, Pose> {
  const a0 = start.get(group.anchor);
  const out = new Map<InstanceId, Pose>();
  for (const id of group.cards) {
    const s = start.get(id);
    if (!a0 || !s) continue;
    out.set(id, id === group.anchor ? anchor : { x: anchor.x + (s.x - a0.x), y: anchor.y + (s.y - a0.y), rot: s.rot });
  }
  return out;
}

/**
 * Drafts for dropping a carry group (see the file comment); [] when nothing would change. Like scene/gestures.ts
 * dropActions, `move` poses are drawn poses (the scene's toStoredPoses strips the tap turn); `attach` poses are stored.
 * A tuck result's pose is the stored attachment slot (scene/snap.ts rule 3a).
 */
export function carryDropActions(
  state: TableState,
  group: DragGroup,
  start: ReadonlyMap<InstanceId, Pose>,
  result: DropResult,
  dest: DropDestination,
  opts: Pick<DropActionOptions, 'newId' | 'presentation'>,
): ActionDraft[] {
  const cardOf = (id: InstanceId): CardInstance | undefined => (Object.hasOwn(state.cards, id) ? state.cards[id] : undefined);
  const anchor = cardOf(group.anchor);
  if (!anchor) return [];
  const insts = group.cards.map(cardOf).filter((c): c is CardInstance => !!c);
  const grouped = (out: ActionDraft[]): ActionDraft[] => {
    if (out.length < 2) return out;
    const g = opts.newId('g');
    return out.map((a) => ({ ...a, group: g }));
  };
  const stored = (c: CardInstance, drawn: Pose): Pose => storedPose(c, drawn);

  if (result.kind === 'zone') {
    // The stack lane takes the anchor (and a dragged selection) as spells; riders are not cast with it.
    const lane = opts.presentation(result.zone) === 'cascade-lane';
    const cards = lane ? insts.filter((c) => c.id === group.anchor || group.reason[c.id] === 'selection') : insts;
    return dropActions(state, cards, start, result, dest, { ...opts, keepPile: false });
  }

  if (result.kind === 'squared' || result.kind === 'cascade') {
    const out = dropActions(state, [anchor], start, result, dest, { ...opts, keepPile: false });
    if (group.leavesHost !== null && anchor.zone === dest.zone && out.length) {
      return grouped([{ type: 'detach', card: anchor.id }, ...out.map(({ group: _g, ...a }) => a as ActionDraft)]);
    }
    return out;
  }

  if (result.kind === 'tuck') {
    const host = cardOf(result.host);
    if (!host || host.id === anchor.id) return [];
    const out: ActionDraft[] = [];
    if (anchor.zone !== host.zone) {
      // Into the host's battlefield first (the reducer attaches cards of one zone only); its controller stays.
      const drawn = { ...result.pose, rot: anchor.tapped ? (result.pose.rot + 90) % 360 : result.pose.rot };
      out.push({ type: 'move', card: anchor.id, to: host.zone, pose: drawn, pile: null, controller: anchor.controller });
    }
    out.push({ type: 'attach', card: anchor.id, to: host.id });
    return grouped(out);
  }

  // Rules 4 and 5: the group moves rigidly.
  const poses = rigidPoses(group, start, result.pose);
  const inG = new Set(group.cards);
  const same = (c: CardInstance) => c.zone === dest.zone;
  const baseOf = new Map<string, InstanceId>();
  for (const c of Object.values(state.cards)) if (c.pile?.index === 0) baseOf.set(c.pile.id, c.id);
  const anchorPile = anchor.pile;
  const split = group.leavesPile !== null && insts.filter((c) => c.pile?.id === group.leavesPile).length >= 2 ? opts.newId('pile') : null;
  const out: ActionDraft[] = [];
  const reattach: ActionDraft[] = [];
  for (const id of drawOrder(state, group.cards)) {
    const c = cardOf(id)!;
    const pose = poses.get(id);
    if (!pose) continue;
    const host = c.attachedTo !== undefined ? cardOf(c.attachedTo) : undefined;
    if (host && inG.has(host.id)) {
      // An attachment rides on its host: the host's move takes it along in the same battlefield; across battlefields
      // the host's move detaches it, so it follows and is attached again.
      if (same(c) && same(host)) continue;
      out.push({ type: 'move', card: id, to: dest.zone, pose, pile: null, ...(c.controller !== dest.controller ? { controller: dest.controller } : {}) });
      reattach.push({ type: 'attach', card: id, to: host.id, pose: stored(c, pose) });
      continue;
    }
    let pile: PileRef | null | undefined = null;
    if (c.pile) {
      const base = baseOf.get(c.pile.id);
      if (c.pile.id === group.leavesPile) {
        pile = split ? { id: split, index: c.pile.index - (anchorPile?.index ?? 0), kind: c.pile.kind } : null;
      } else if (base !== undefined && inG.has(base)) {
        // The whole pile moves: by its bottom card (members follow), members re-join to rise in the draw order.
        if (id === base) pile = undefined;
        else if (!same(c) || !same(cardOf(base)!)) continue;
        else pile = c.pile;
      }
    }
    const unchanged = same(c) && near(c.pose, stored(c, pose)) && (pile === undefined ? true : (c.pile?.id ?? null) === (pile?.id ?? null)) && c.controller === dest.controller;
    if (unchanged) continue;
    out.push({
      type: 'move',
      card: id,
      to: dest.zone,
      pose,
      ...(pile === undefined ? {} : { pile }),
      ...(c.controller !== dest.controller ? { controller: dest.controller } : {}),
    });
    if (id === group.anchor && group.leavesHost !== null && same(c)) out.push({ type: 'detach', card: id });
  }
  return grouped([...out, ...reattach]);
}
