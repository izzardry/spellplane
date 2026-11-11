/**
 * Temporary move and settle (DESIGN "Combat and annotation": Temporary move, Settle; "Data model and protocol",
 * Card family). M1-P4 builds the attack and block shortcuts, ghosts and lines on top of these.
 *
 * - moveTemp: the card must be on a battlefield. It remembers its home slot (only the first time), leaves its pile
 *   (any pile member pulls out singly), takes the new pose (attachments follow), takes the optional combat role and
 *   taps when `tap` is true. It never untaps.
 * - settle: every displaced card (or those listed in `cards`) goes back to its home pose (attachments follow) and
 *   loses `home` and `combat`; attack and block lines go (all of them, or those touching the listed cards), marks and
 *   every other line stay. The tapped state is left alone: attackers stay tapped. Hosts go home before the cards
 *   attached to them, so a displaced attachment ends at its own home slot even when its host was displaced too (the
 *   host's move drags its attachments along by the same translation).
 */
import type { ActionOf } from '../actions';
import type { InstanceId } from '../types';
import type { Draft } from './draft';
import { ZONE_KIND, cardZone, leavePile, publicCard, removeLinesWhere, setPose } from './place';
import { byId, checkId, checkPose, reject, samePose } from './util';

export function moveTemp(d: Draft, a: ActionOf<'moveTemp'>): void {
  const c = publicCard(d, checkId(a.card, 'card'));
  const zone = cardZone(d, c);
  if (zone.kind !== ZONE_KIND.battlefield) reject(`only cards on a battlefield move temporarily; ${c.id} is in ${zone.id}`);
  const pose = checkPose(a.pose);
  if (a.combat !== undefined && a.combat !== 'attack' && a.combat !== 'block') reject('combat must be attack or block');
  if (a.tap !== undefined && typeof a.tap !== 'boolean') reject('tap must be a boolean');
  const home = c.home ?? c.pose;
  leavePile(d, c.id);
  if (!c.home) d.cards.w(c.id).home = { ...home };
  if (a.combat !== undefined && c.combat !== a.combat) d.cards.w(c.id).combat = a.combat;
  if (a.tap === true && !c.tapped) d.cards.w(c.id).tapped = true;
  setPose(d, c.id, pose);
}

export function settle(d: Draft, a: ActionOf<'settle'>): void {
  let ids: string[];
  if (a.cards === undefined) {
    ids = d.cards.keys();
  } else {
    if (!Array.isArray(a.cards) || a.cards.length > 10_000) reject('cards must be a list of card ids');
    ids = [...new Set(a.cards.map((id) => d.cards.need(checkId(id, 'card')).id))].sort(byId);
  }
  const chosen = new Set(ids);
  for (const id of hostsFirst(d, ids)) {
    const c = d.cards.need(id);
    const home = c.home;
    if (!home) continue;
    const w = d.cards.w(id);
    delete w.home;
    delete w.combat;
    if (!samePose(c.pose, home)) setPose(d, id, home);
  }
  const touches = (an: { kind: string; id: string }): boolean => an.kind === 'card' && chosen.has(an.id);
  removeLinesWhere(d, (f, t, kind) => (kind === 'attack' || kind === 'block') && (a.cards === undefined || touches(f) || touches(t)));
}

/** `ids` (sorted by id) reordered so every card comes after the card it is attached to (shallower hosts first). */
function hostsFirst(d: Draft, ids: readonly InstanceId[]): InstanceId[] {
  const depth = (id: InstanceId): number => {
    let n = 0;
    const seen = new Set<InstanceId>([id]);
    for (let h = d.cards.need(id).attachedTo; h !== undefined && !seen.has(h); h = d.cards.get(h)?.attachedTo) {
      seen.add(h);
      n++;
    }
    return n;
  };
  const depths = new Map(ids.map((id) => [id, depth(id)]));
  return [...ids].sort((a, b) => depths.get(a)! - depths.get(b)! || byId(a, b));
}
