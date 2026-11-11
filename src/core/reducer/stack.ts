/**
 * Stack family (DESIGN "The effect stack"). Items pile up bottom to top; a spell's card sits in the 'stack' zone.
 * Starting a confirmation round on push (`round`) and the `force` record of an early resolve belong to M1-P3.
 *
 * Default destinations: the reducer has no card data, so the client passes `to` from
 * GameDefinition.defaultDestination; without it a resolving spell goes to its controller's battlefield and a
 * countered one to its owner's graveyard.
 */
import type { ActionOf } from '../actions';
import type { StackItem } from '../types';
import type { Draft } from './draft';
import { STACK_ZONE, ZONE_KIND, dropItem, relocate, removeLinesWhere, syncStackZone } from './place';
import { checkId, checkInt, checkPose, checkString, reject } from './util';

const KINDS: readonly StackItem['kind'][] = ['spell', 'ability', 'trigger', 'copy'];

function item(d: Draft, id: unknown): StackItem {
  const sid = checkId(id, 'stack item');
  const it = d.stack.find((i) => i.id === sid);
  if (!it) reject(`unknown stack item ${sid}`);
  return it;
}

export function stackPush(d: Draft, a: ActionOf<'stackPush'>): void {
  const id = checkId(a.item, 'stack item');
  if (d.stack.some((i) => i.id === id)) reject(`stack item ${id} already exists`);
  if (!KINDS.includes(a.kind)) reject('invalid stack item kind');
  if (!d.zones.has(STACK_ZONE)) reject('this table has no stack zone');
  const controller = a.controller === undefined ? d.seats.need(checkId(a.by, 'seat')).id : d.seats.need(checkId(a.controller, 'seat')).id;
  const note = a.note === undefined ? '' : checkString(a.note, 'note', 500);
  const it: StackItem = { id, kind: a.kind, controller };
  if (a.kind === 'spell') {
    if (a.card === undefined) reject('a spell needs a card');
    const c = d.cards.need(checkId(a.card, 'card'));
    if (c.zone === STACK_ZONE) reject(`card ${c.id} is already on the stack`);
    it.card = c.id;
  } else if (a.card !== undefined) {
    reject('only spells carry a card; abilities and triggers name a source');
  }
  if (a.source !== undefined) it.source = d.cards.need(checkId(a.source, 'card')).id;
  if (a.kind === 'copy') {
    // copyOf names the copied item; it is absent once that item has left the stack.
    if (a.copyOf !== undefined) it.copyOf = item(d, a.copyOf).id;
  } else if (a.copyOf !== undefined) {
    reject('only copy markers carry copyOf');
  }
  if (note !== '') it.note = note;
  if (it.card !== undefined) relocate(d, it.card, STACK_ZONE, { controller });
  d.stackW().push(it);
  syncStackZone(d);
}

export function stackNote(d: Draft, a: ActionOf<'stackNote'>): void {
  const it = item(d, a.item);
  const note = checkString(a.note, 'note', 500);
  if ((it.note ?? '') === note) return;
  const w = d.stackW().find((i) => i.id === it.id)!;
  if (note === '') delete w.note;
  else w.note = note;
}

/** Take the top item off the stack, sending a spell's card to `to`; markers vanish. Target lines go with the item. */
function leaveTop(d: Draft, a: { item: unknown; to?: unknown; pose?: unknown }, verb: string, defaultTo: (it: StackItem) => string): void {
  const it = item(d, a.item);
  if (d.stack[d.stack.length - 1]?.id !== it.id) reject(`only the top item can ${verb}; ${it.id} is not on top`);
  const pose = a.pose === undefined ? undefined : checkPose(a.pose);
  if (it.card === undefined) {
    dropItem(d, it.id);
    return;
  }
  const card = d.cards.need(it.card);
  const to = a.to === undefined ? defaultTo(it) : checkId(a.to, 'zone');
  const dest = d.zones.need(to);
  if (dest.id === STACK_ZONE) reject('the destination cannot be the stack');
  removeLinesWhere(d, (f, _t, kind) => kind === 'target' && f.kind === 'card' && f.id === card.id);
  dropItem(d, it.id);
  relocate(d, card.id, dest.id, { pose, controller: dest.owner ?? it.controller });
}

export function stackResolve(d: Draft, a: ActionOf<'stackResolve'>): void {
  if (a.force !== undefined && typeof a.force !== 'boolean') reject('force must be a boolean');
  leaveTop(d, a, 'resolve', (it) => `${ZONE_KIND.battlefield}:${it.controller}`);
}

export function stackCounter(d: Draft, a: ActionOf<'stackCounter'>): void {
  leaveTop(d, a, 'be countered', (it) => `${ZONE_KIND.graveyard}:${d.cards.need(it.card!).owner}`);
}

export function stackReorder(d: Draft, a: ActionOf<'stackReorder'>): void {
  const it = item(d, a.item);
  const index = Math.min(checkInt(a.index, 'index', 0, 1e6), d.stack.length - 1);
  const from = d.stack.findIndex((i) => i.id === it.id);
  if (from === index) return;
  const st = d.stackW();
  const [moved] = st.splice(from, 1);
  st.splice(index, 0, moved!);
  syncStackZone(d);
}
