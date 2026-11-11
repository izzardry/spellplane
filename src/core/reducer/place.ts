/**
 * Where cards are: zones, piles, attachments and the stack lane (DESIGN "Table model", "Card manipulation",
 * "Combat and annotation", "Specification: geometry, layout and motion"). Shared by the action handlers.
 *
 * Rules kept here (checked by core/invariants.ts):
 * - a card is in exactly one zone; hidden zones list sorted opaque ids with a count, and their cards carry no public state;
 * - pile indices are contiguous from 0; members share a public zone and kind; member i sits at pileMemberPose(base, i);
 * - an attached card shares its host's public zone, is never in a pile, and moves with its host;
 * - the 'stack' zone holds exactly the cards of spell items, in stack order.
 */
import type { CardInstance, HiddenZone, InstanceId, PileId, PileRef, Pose, SeatId, StackItemId, Zone, ZoneId } from '../types';
import type { Draft } from './draft';
import { byId, pileMemberPose, q, reject, samePose } from './util';

/** The table zone that holds spell cards (DESIGN "The effect stack"). */
export const STACK_ZONE: ZoneId = 'stack';
/** Zone kinds the engine itself refers to (DESIGN "Data model and protocol": draw, mulligan, resolve defaults). */
export const ZONE_KIND = { library: 'library', hand: 'hand', battlefield: 'battlefield', graveyard: 'graveyard', stack: 'stack' } as const;

/** Pose of cards in hidden zones: shared state keeps nothing about them. */
export const HIDDEN_POSE: Pose = { x: 0, y: 0, rot: 0 };

export function isHidden(z: Zone): z is HiddenZone {
  return z.visibility !== 'public';
}

export function cardZone(d: Draft, c: CardInstance): Zone {
  return d.zones.need(c.zone);
}

/** The card, which must be in a public zone. */
export function publicCard(d: Draft, id: InstanceId): CardInstance {
  const c = d.cards.need(id);
  if (isHidden(cardZone(d, c))) reject(`card ${id} is in a hidden zone`);
  return c;
}

// ---- piles ------------------------------------------------------------------------------------------------------

/** Members of a pile ordered by index (ties by id, which a valid state never has). */
export function members(d: Draft, pile: PileId): CardInstance[] {
  return d.cards
    .values()
    .filter((c) => c.pile?.id === pile)
    .sort((a, b) => a.pile!.index - b.pile!.index || byId(a.id, b.id));
}

/** Re-number a pile 0..n-1 and lay every member out from `anchor` (default: the base card's pose). */
export function relay(d: Draft, pile: PileId, anchor?: Pose): void {
  const ms = members(d, pile);
  const first = ms[0];
  if (!first) return;
  const a = anchor ?? first.pose;
  const kind = first.pile!.kind;
  ms.forEach((m, i) => {
    if (m.pile!.index !== i) d.cards.w(m.id).pile = { id: pile, index: i, kind };
    setPose(d, m.id, pileMemberPose(a, i, kind));
  });
}

/** Leave the current pile; when the base leaves, the next card becomes the base at the old anchor. */
export function leavePile(d: Draft, id: InstanceId): void {
  const c = d.cards.need(id);
  if (!c.pile) return;
  const { id: pile, index } = c.pile;
  const anchor = members(d, pile)[0]?.pose;
  delete d.cards.w(id).pile;
  relay(d, pile, index === 0 ? anchor : undefined);
}

/**
 * Join pile `ref` at `ref.index` (clamped). The card must be loose and in a public zone. Joining at 0 makes it the
 * base: the pile moves to `pose` when given, otherwise the card takes the current anchor. A new pile starts at the
 * card's pose (or `pose`).
 */
export function joinPile(d: Draft, id: InstanceId, ref: PileRef, pose?: Pose): void {
  const c = d.cards.need(id);
  if (c.pile) reject(`card ${id} is already in pile ${c.pile.id}`);
  const zone = cardZone(d, c);
  if (isHidden(zone)) reject(`card ${id} is in a hidden zone`);
  if (zone.id === STACK_ZONE) reject('cards on the stack do not form piles');
  const ms = members(d, ref.id);
  const first = ms[0];
  if (first && first.zone !== c.zone) reject(`pile ${ref.id} is in another zone (${first.zone})`);
  if (first && first.pile!.kind !== ref.kind) reject(`pile ${ref.id} has kind ${first.pile!.kind}, not ${ref.kind}`);
  if (c.attachedTo !== undefined) delete d.cards.w(id).attachedTo;
  // Joining a pile is a permanent placement: a displaced card forgets its home slot.
  if (c.home || c.combat) {
    const w = d.cards.w(id);
    delete w.home;
    delete w.combat;
  }
  const index = Math.min(ref.index, ms.length);
  const anchor = index === 0 ? (pose ?? first?.pose ?? c.pose) : first!.pose;
  for (const m of ms) if (m.pile!.index >= index) d.cards.w(m.id).pile = { id: ref.id, index: m.pile!.index + 1, kind: ref.kind };
  d.cards.w(id).pile = { id: ref.id, index, kind: ref.kind };
  relay(d, ref.id, anchor);
}

// ---- attachments ------------------------------------------------------------------------------------------------

export function attachments(d: Draft, host: InstanceId): CardInstance[] {
  return d.cards.values().filter((c) => c.attachedTo === host);
}

/** Set a card's pose; its attachments (recursively) follow by the same translation. */
export function setPose(d: Draft, id: InstanceId, pose: Pose): void {
  const c = d.cards.need(id);
  if (samePose(c.pose, pose)) return;
  const dx = pose.x - c.pose.x;
  const dy = pose.y - c.pose.y;
  d.cards.w(id).pose = { ...pose };
  if (dx !== 0 || dy !== 0) shiftAttachments(d, id, dx, dy, new Set([id]));
}

function shiftAttachments(d: Draft, host: InstanceId, dx: number, dy: number, seen: Set<InstanceId>): void {
  for (const a of attachments(d, host)) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    d.cards.w(a.id).pose = { x: q(a.pose.x + dx), y: q(a.pose.y + dy), rot: a.pose.rot };
    shiftAttachments(d, a.id, dx, dy, seen);
  }
}

/** Detach the card from its host and every attachment from the card. */
export function detachAll(d: Draft, id: InstanceId): void {
  if (d.cards.need(id).attachedTo !== undefined) delete d.cards.w(id).attachedTo;
  for (const a of attachments(d, id)) delete d.cards.w(a.id).attachedTo;
}

// ---- lines and stack --------------------------------------------------------------------------------------------

export function removeLinesWhere(d: Draft, pred: (from: { kind: string; id: string }, to: { kind: string; id: string }, kind: string) => boolean): void {
  for (const l of d.lines.values()) if (pred(l.from, l.to, l.kind)) d.lines.delete(l.id);
}

export function removeLinesTouching(d: Draft, kind: 'card' | 'stackItem' | 'seat', id: string): void {
  removeLinesWhere(d, (f, t) => (f.kind === kind && f.id === id) || (t.kind === kind && t.id === id));
}

/** Keep the 'stack' zone's ids equal to the spell cards in stack order. */
export function syncStackZone(d: Draft): void {
  const want = d.stack.flatMap((i) => (i.card !== undefined ? [i.card] : []));
  const z = d.zones.get(STACK_ZONE);
  if (!z) return;
  if (z.ids.length === want.length && z.ids.every((v, i) => v === want[i])) return;
  d.zones.w(STACK_ZONE).ids = want;
}

/** Remove a stack item, the lines that touch it, and copy links to it. The spell card itself is left to the caller. */
export function dropItem(d: Draft, item: StackItemId): void {
  if (!d.stack.some((i) => i.id === item)) return;
  const st = d.stackW().filter((i) => i.id !== item);
  for (const i of st) if (i.copyOf === item) delete i.copyOf;
  d.setStack(st);
  removeLinesTouching(d, 'stackItem', item);
  syncStackZone(d);
}

// ---- zones ------------------------------------------------------------------------------------------------------

function removeFromZone(d: Draft, zoneId: ZoneId, id: InstanceId): void {
  const z = d.zones.w(zoneId);
  z.ids = z.ids.filter((x) => x !== id);
  if (isHidden(z)) z.count = z.ids.length;
}

function insertSorted(ids: InstanceId[], id: InstanceId): InstanceId[] {
  const out = ids.filter((x) => x !== id);
  let i = 0;
  while (i < out.length && byId(out[i]!, id) < 0) i++;
  out.splice(i, 0, id);
  return out;
}

/** Reorder a card within its public zone: to `index` (clamped), or to the top of the draw order. */
export function reorderInZone(d: Draft, id: InstanceId, index?: number): void {
  const c = d.cards.need(id);
  const z = d.zones.need(c.zone);
  const rest = z.ids.filter((x) => x !== id);
  const at = index === undefined ? rest.length : Math.min(index, rest.length);
  rest.splice(at, 0, id);
  if (rest.every((v, i) => v === z.ids[i])) return;
  d.zones.w(c.zone).ids = rest;
}

/** Canonical record of a card in a hidden zone: identity and all public state dropped (DESIGN "Table model", Hidden cards). */
function hiddenRecord(c: CardInstance, zone: ZoneId): CardInstance {
  return {
    id: c.id,
    owner: c.owner,
    controller: c.owner,
    zone,
    face: 'down',
    faceIndex: 0,
    tapped: false,
    pose: { ...HIDDEN_POSE },
    counters: {},
    ...(c.suspect ? { suspect: true } : {}),
  };
}

export interface PlaceOptions {
  pose?: Pose;
  index?: number;
  controller?: SeatId;
}

/** Check that `to` may receive the card (hidden zones only take their owner's non-token cards). */
export function checkDestination(d: Draft, c: CardInstance, to: Zone): void {
  if (!isHidden(to)) return;
  if (c.isToken) reject('tokens cannot enter a hidden zone; remove them instead');
  if (to.owner !== null && to.owner !== c.owner) reject(`zone ${to.id} belongs to ${to.owner}, not to the card's owner ${c.owner}`);
}

/**
 * Move a card into another zone. Leaving: the pile, attachments both ways, a spell's stack item, any temporary home.
 * Entering a hidden zone: identity, public state and lines touching the card are dropped. Entering a public zone from
 * a hidden one: face up only with a public identity (or a labelled table object), else face down. Entering a public
 * zone that is not a battlefield (graveyard, exile, command, stack): untapped, no counters, no note, front face.
 */
export function relocate(d: Draft, id: InstanceId, to: ZoneId, opts: PlaceOptions = {}): void {
  const c = d.cards.need(id);
  const dest = d.zones.need(to);
  if (c.zone === to) reject(`card ${id} is already in ${to}`);
  checkDestination(d, c, dest);
  const from = cardZone(d, c);
  leavePile(d, id);
  detachAll(d, id);
  if (from.id === STACK_ZONE) for (const i of d.stack.filter((x) => x.card === id)) dropItem(d, i.id);
  removeFromZone(d, from.id, id);
  if (isHidden(dest)) {
    d.cards.set(id, hiddenRecord(d.cards.need(id), to));
    removeLinesTouching(d, 'card', id);
    const z = d.zones.w(to) as HiddenZone;
    z.ids = insertSorted(z.ids, id);
    z.count = z.ids.length;
    return;
  }
  const w = d.cards.w(id);
  w.zone = to;
  delete w.home;
  delete w.combat;
  if (isHidden(from)) w.face = w.identity !== undefined || w.tokenLabel !== undefined ? 'up' : 'down';
  if (dest.kind !== ZONE_KIND.battlefield) {
    // Outside a battlefield, as at a real table, tap state, counters, a note and a transformed face fall off.
    w.tapped = false;
    w.counters = {};
    delete w.note;
    w.faceIndex = 0;
  }
  if (opts.pose) w.pose = { ...opts.pose };
  w.controller = opts.controller ?? dest.owner ?? w.controller;
  if (to !== STACK_ZONE) {
    const z = d.zones.w(to);
    const at = opts.index === undefined ? z.ids.length : Math.min(opts.index, z.ids.length);
    z.ids = [...z.ids.slice(0, at), id, ...z.ids.slice(at)];
  }
}
