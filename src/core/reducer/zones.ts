/**
 * Zone and secrecy family, public parts only (DESIGN "Table model", Hidden cards; "Specification: network protocol
 * and secrecy"). The reducer never sees secrets: a draw names an opaque id, a reveal carries the identity in the
 * action. Shuffles (shuffleCommit, shuffleNonce, shuffleDone) and commitment verification belong to M1-P2.
 */
import type { ActionOf } from '../actions';
import type { Draft } from './draft';
import { ZONE_KIND, isHidden, relocate } from './place';
import { checkId, checkInt, checkRef, checkString, reject } from './util';

export function toZone(d: Draft, a: ActionOf<'toZone'>): void {
  const c = d.cards.need(checkId(a.card, 'card'));
  const to = d.zones.need(checkId(a.to, 'zone'));
  if (!isHidden(to)) reject(`toZone targets hidden zones; ${to.id} is public (use move)`);
  if (a.position !== 'top' && a.position !== 'bottom' && a.position !== 'any') reject('position must be top, bottom or any');
  // The position only orders the owner's private list; within the same zone there is no public effect.
  if (c.zone === to.id) return;
  relocate(d, c.id, to.id);
}

export function draw(d: Draft, a: ActionOf<'draw'>): void {
  const c = d.cards.need(checkId(a.instanceId, 'card'));
  const from = d.zones.need(c.zone);
  if (from.kind !== ZONE_KIND.library || !isHidden(from)) reject(`card ${c.id} is not in a library`);
  const toId = a.to === undefined ? `${ZONE_KIND.hand}:${checkId(a.by, 'seat')}` : checkId(a.to, 'zone');
  const to = d.zones.need(toId);
  if (!isHidden(to)) reject(`draw puts a card into a hidden zone; ${to.id} is public (reveal and move instead)`);
  if (to.id === from.id) reject(`card ${c.id} is already in ${to.id}`);
  relocate(d, c.id, to.id);
}

export function reveal(d: Draft, a: ActionOf<'reveal'>): void {
  const c = d.cards.need(checkId(a.instanceId, 'card'));
  const ref = checkRef(a.ref);
  checkString(a.salt, 'salt', 256);
  // Commitment verification (and the suspect flag) is M1-P2's; here the identity becomes public.
  if (c.identity && c.identity.sid === ref.sid && c.identity.foil === ref.foil) return;
  d.cards.w(c.id).identity = ref;
}

export function revealTo(d: Draft, a: ActionOf<'revealTo'>): void {
  d.cards.need(checkId(a.instanceId, 'card'));
  if (!Array.isArray(a.seats) || a.seats.length === 0) reject('revealTo needs at least one seat');
  for (const s of a.seats) d.seats.need(checkId(s, 'seat'));
}

export function hide(d: Draft, a: ActionOf<'hide'>): void {
  const c = d.cards.need(checkId(a.card, 'card'));
  if (isHidden(d.zones.need(c.zone))) reject(`card ${c.id} is in a hidden zone`);
  if (c.identity === undefined) reject(`card ${c.id} has no public identity`);
  const w = d.cards.w(c.id);
  delete w.identity;
  w.face = 'down';
}

export function lookAt(d: Draft, a: ActionOf<'lookAt'>): void {
  const z = d.zones.need(checkId(a.zone, 'zone'));
  const count = checkInt(a.count, 'count', 0, 1e6);
  if (a.card !== undefined) {
    d.cards.need(checkId(a.card, 'card'));
  } else if (count > z.ids.length) {
    reject(`count ${count} exceeds the ${z.ids.length} cards in ${z.id}`);
  }
}

export function reorder(d: Draft, a: ActionOf<'reorder'>): void {
  const z = d.zones.need(checkId(a.zone, 'zone'));
  if (!isHidden(z)) reject(`reorder records a private reorder of a hidden zone; ${z.id} is public`);
  const count = checkInt(a.count, 'count', 0, 1e6);
  if (count > z.ids.length) reject(`count ${count} exceeds the ${z.ids.length} cards in ${z.id}`);
  checkString(a.orderHash, 'orderHash', 256);
}

export function mulligan(d: Draft, a: ActionOf<'mulligan'>): void {
  const seat = d.seats.need(checkId(a.by, 'seat')).id;
  checkInt(a.count, 'count', 0, 100);
  const hand = d.zones.need(`${ZONE_KIND.hand}:${seat}`);
  const lib = d.zones.need(`${ZONE_KIND.library}:${seat}`);
  if (!isHidden(hand) || !isHidden(lib)) reject('mulligan needs a hidden hand and library');
  for (const id of [...hand.ids]) relocate(d, id, lib.id);
}
