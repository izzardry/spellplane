/**
 * Card family handlers (DESIGN "Card manipulation", "Combat and annotation"; "Data model and protocol", Action
 * families). moveTemp and settle are in core/reducer/temp.ts.
 */
import type { ActionOf } from '../actions';
import type { CardInstance, PileRef, Pose } from '../types';
import type { Draft } from './draft';
import {
  STACK_ZONE,
  ZONE_KIND,
  attachments,
  cardZone,
  isHidden,
  joinPile,
  leavePile,
  members,
  publicCard,
  relay,
  relocate,
  removeLinesTouching,
  reorderInZone,
  setPose,
} from './place';
import { byId, checkId, checkInt, checkPileRef, checkPose, checkRef, checkString, isObj, normRot, pileMemberPose, q, reject, samePose, tuckPose } from './util';

function optPose(v: unknown): Pose | undefined {
  return v === undefined ? undefined : checkPose(v);
}

function optSeat(d: Draft, v: unknown): string | undefined {
  if (v === undefined) return undefined;
  const id = checkId(v, 'seat');
  d.seats.need(id);
  return id;
}

export function move(d: Draft, a: ActionOf<'move'>): void {
  const c = d.cards.need(checkId(a.card, 'card'));
  const to = d.zones.need(checkId(a.to, 'zone'));
  if (isHidden(to)) reject(`move targets public zones; use toZone for the hidden zone ${to.id}`);
  if (to.id === STACK_ZONE) reject('use stackPush to put a card on the stack, stackReorder to move it there');
  const pose = optPose(a.pose);
  const index = a.index === undefined ? undefined : checkInt(a.index, 'index', 0, 1e6);
  const controller = optSeat(d, a.controller);
  const pile = a.pile === undefined || a.pile === null ? a.pile : checkPileRef(a.pile);

  if (c.zone !== to.id) {
    const opts = { pose, index, controller: controller ?? to.owner ?? c.controller };
    if (pile === undefined && c.pile?.index === 0 && to.kind === ZONE_KIND.battlefield && cardZone(d, c).kind === ZONE_KIND.battlefield) {
      // Dragging a pile by its bottom card onto another battlefield takes the whole pile (DESIGN "Card manipulation").
      movePile(d, c.pile, to.id, opts);
      return;
    }
    relocate(d, c.id, to.id, opts);
    if (pile) joinPile(d, c.id, pile, pose);
    return;
  }

  reorderInZone(d, c.id, index);
  if (pose && (c.home || c.combat)) {
    // A normal drag is a permanent move: a displaced card's new place is its home (DESIGN "Combat and annotation").
    const w = d.cards.w(c.id);
    delete w.home;
    delete w.combat;
  }
  if (controller !== undefined && controller !== c.controller) d.cards.w(c.id).controller = controller;
  if (pile === undefined) {
    if (c.pile && c.pile.index === 0) {
      // Dragging a pile by its bottom card moves the pile (DESIGN "Card manipulation").
      if (pose) relay(d, c.pile.id, pose);
    } else if (c.pile) {
      // Any other card pulls out singly.
      if (pose && !samePose(pose, c.pose)) {
        leavePile(d, c.id);
        setPose(d, c.id, pose);
      }
    } else if (pose) {
      setPose(d, c.id, pose);
    }
  } else if (pile === null) {
    leavePile(d, c.id);
    if (pose) setPose(d, c.id, pose);
  } else {
    leavePile(d, c.id);
    joinPile(d, c.id, pile, pose);
  }
}

/** Move every member of pile `ref` to zone `to`, laid out from `opts.pose` (default: the base's pose), in pile order. */
function movePile(d: Draft, ref: PileRef, to: string, opts: { pose?: Pose; index?: number; controller: string }): void {
  const ms = members(d, ref.id);
  const anchor = opts.pose ?? ms[0]!.pose;
  for (const m of ms) delete d.cards.w(m.id).pile;
  ms.forEach((m, i) => {
    relocate(d, m.id, to, { pose: pileMemberPose(anchor, i, ref.kind), index: opts.index === undefined ? undefined : opts.index + i, controller: opts.controller });
  });
  ms.forEach((m, i) => {
    d.cards.w(m.id).pile = { id: ref.id, index: i, kind: ref.kind };
  });
}

export function tap(d: Draft, a: ActionOf<'tap'>): void {
  const c = publicCard(d, checkId(a.card, 'card'));
  if (typeof a.tapped !== 'boolean') reject('tapped must be a boolean');
  if (c.tapped !== a.tapped) d.cards.w(c.id).tapped = a.tapped;
}

export function flip(d: Draft, a: ActionOf<'flip'>): void {
  const c = publicCard(d, checkId(a.card, 'card'));
  if (a.face !== 'up' && a.face !== 'down') reject('face must be up or down');
  const ref = a.ref === undefined ? undefined : checkRef(a.ref);
  if (ref && typeof a.salt !== 'string') reject('turning a card up with its identity needs the salt');
  if (a.face === 'up' && !ref && c.identity === undefined && c.tokenLabel === undefined) {
    reject(`card ${c.id} has no public identity: turning it up needs its ref and salt`);
  }
  if (c.face === a.face && !ref) return;
  const w = d.cards.w(c.id);
  w.face = a.face;
  if (ref) w.identity = ref;
}

export function transform(d: Draft, a: ActionOf<'transform'>): void {
  const c = publicCard(d, checkId(a.card, 'card'));
  if (a.faceIndex !== 0 && a.faceIndex !== 1) reject('faceIndex must be 0 or 1');
  if (c.faceIndex !== a.faceIndex) d.cards.w(c.id).faceIndex = a.faceIndex;
}

export function rotate(d: Draft, a: ActionOf<'rotate'>): void {
  const c = publicCard(d, checkId(a.card, 'card'));
  if (typeof a.delta !== 'number' || !Number.isFinite(a.delta) || Math.abs(a.delta) > 1e6) reject('delta must be a finite number of degrees');
  const delta = q(a.delta);
  // A pile turns as one around its base, so its layout stays valid.
  const target = c.pile ? (members(d, c.pile.id)[0] ?? c) : c;
  const pose = { ...target.pose, rot: normRot(target.pose.rot + delta) };
  if (c.pile) relay(d, c.pile.id, pose);
  else setPose(d, c.id, pose);
}

export function counter(d: Draft, a: ActionOf<'counter'>): void {
  const c = publicCard(d, checkId(a.card, 'card'));
  const kind = checkString(a.kind, 'counter kind', 64);
  if (kind === '' || kind === '__proto__') reject('invalid counter kind');
  const delta = checkInt(a.delta, 'delta');
  const next = Math.max(0, (Object.hasOwn(c.counters, kind) ? (c.counters[kind] ?? 0) : 0) + delta);
  const w = d.cards.w(c.id);
  if (next === 0) delete w.counters[kind];
  else w.counters[kind] = next;
}

export function note(d: Draft, a: ActionOf<'note'>): void {
  const c = publicCard(d, checkId(a.card, 'card'));
  const text = checkString(a.text, 'note', 500);
  if ((c.note ?? '') === text) return;
  const w = d.cards.w(c.id);
  if (text === '') delete w.note;
  else w.note = text;
}

export function attach(d: Draft, a: ActionOf<'attach'>): void {
  const c = publicCard(d, checkId(a.card, 'card'));
  const host = publicCard(d, checkId(a.to, 'host card'));
  if (c.id === host.id) reject('a card cannot be attached to itself');
  if (c.zone !== host.zone) reject(`${c.id} and ${host.id} are in different zones`);
  if (c.zone === STACK_ZONE) reject('cards on the stack cannot be attached');
  const seen = new Set<string>();
  for (let h: CardInstance | undefined = host; h?.attachedTo !== undefined; h = d.cards.get(h.attachedTo)) {
    if (h.attachedTo === c.id) reject(`attaching ${c.id} to ${host.id} would make a cycle`);
    if (seen.has(h.id)) break;
    seen.add(h.id);
  }
  const pose = optPose(a.pose);
  leavePile(d, c.id);
  const k = attachments(d, host.id).filter((x) => x.id !== c.id).length + 1;
  d.cards.w(c.id).attachedTo = host.id;
  setPose(d, c.id, pose ?? tuckPose(host.pose, k));
}

export function detach(d: Draft, a: ActionOf<'detach'>): void {
  const c = publicCard(d, checkId(a.card, 'card'));
  if (c.attachedTo === undefined) reject(`card ${c.id} is not attached`);
  const pose = optPose(a.pose);
  delete d.cards.w(c.id).attachedTo;
  if (pose) setPose(d, c.id, pose);
}

export function pile(d: Draft, a: ActionOf<'pile'>): void {
  const c = publicCard(d, checkId(a.card, 'card'));
  if (c.zone === STACK_ZONE) reject('cards on the stack do not form piles');
  const pose = optPose(a.pose);
  if (a.pile === null) {
    leavePile(d, c.id);
    if (pose) setPose(d, c.id, pose);
    return;
  }
  const ref = checkPileRef(a.pile);
  leavePile(d, c.id);
  joinPile(d, c.id, ref, pose);
}

export function tidy(d: Draft, a: ActionOf<'tidy'>): void {
  const seat = d.seats.need(checkId(a.seat, 'seat')).id;
  const zone = `battlefield:${seat}`;
  d.zones.need(zone);
  if (!isObj(a.poses)) reject('poses must be an object');
  const listed = Object.keys(a.poses).sort(byId);
  const final = new Map<string, Pose>();
  for (const id of listed) {
    const c = d.cards.need(checkId(id, 'card'));
    if (c.zone !== zone) reject(`card ${id} is not on ${zone}`);
    final.set(id, checkPose(a.poses[id]));
  }
  // Piles keep their shape around their (possibly new) base.
  const piles = [...new Set(listed.flatMap((id) => (d.cards.need(id).pile ? [d.cards.need(id).pile!.id] : [])))].sort(byId);
  for (const p of piles) {
    const ms = members(d, p);
    const anchor = final.get(ms[0]!.id) ?? ms[0]!.pose;
    ms.forEach((m, i) => final.set(m.id, pileMemberPose(anchor, i, m.pile!.kind)));
  }
  // Attachments not given a pose of their own follow their host.
  const queue = [...final.keys()].sort(byId);
  const listedSet = new Set(listed);
  for (let i = 0; i < queue.length; i++) {
    const host = d.cards.need(queue[i]!);
    const to = final.get(host.id)!;
    const dx = to.x - host.pose.x;
    const dy = to.y - host.pose.y;
    if (dx === 0 && dy === 0) continue;
    for (const at of attachments(d, host.id)) {
      if (listedSet.has(at.id) || final.has(at.id)) continue;
      final.set(at.id, { x: q(at.pose.x + dx), y: q(at.pose.y + dy), rot: at.pose.rot });
      queue.push(at.id);
    }
  }
  for (const [id, pose] of [...final.entries()].sort((x, y) => byId(x[0], y[0]))) {
    const c = d.cards.need(id);
    if (!samePose(c.pose, pose)) d.cards.w(id).pose = pose;
    if (c.home || c.combat) {
      // Tidy is a permanent placement: displaced cards forget their home slot.
      const w = d.cards.w(id);
      delete w.home;
      delete w.combat;
    }
  }
}

export function createToken(d: Draft, a: ActionOf<'createToken'>): void {
  const id = checkId(a.card, 'card');
  if (d.cards.has(id)) reject(`card ${id} already exists`);
  const zone = d.zones.need(checkId(a.zone, 'zone'));
  if (isHidden(zone)) reject(`tokens are created in public zones; ${zone.id} is hidden`);
  if (zone.id === STACK_ZONE) reject('tokens are not created on the stack; use a copy marker');
  const pose = checkPose(a.pose);
  const ref = a.ref === undefined ? undefined : checkRef(a.ref);
  const label = a.label === undefined ? undefined : checkString(a.label, 'label', 200);
  if (!ref && !label) reject('a token needs a ref or a label');
  const owner = optSeat(d, a.controller) ?? zone.owner ?? d.seats.need(checkId(a.by, 'seat')).id;
  d.cards.set(id, {
    id,
    owner,
    controller: owner,
    zone: zone.id,
    ...(ref ? { identity: ref } : {}),
    face: 'up',
    faceIndex: 0,
    tapped: false,
    pose,
    counters: {},
    isToken: true,
    ...(label ? { tokenLabel: label } : {}),
  });
  d.zones.w(zone.id).ids.push(id);
}

export function copy(d: Draft, a: ActionOf<'copy'>): void {
  const id = checkId(a.card, 'card');
  if (d.cards.has(id)) reject(`card ${id} already exists`);
  const of = publicCard(d, checkId(a.of, 'card'));
  if (of.zone === STACK_ZONE) reject('copy a spell with a copy marker (stackPush kind copy)');
  if (of.identity === undefined && of.tokenLabel === undefined) reject(`card ${of.id} has no public identity to copy`);
  const pose = checkPose(a.pose);
  d.cards.set(id, {
    id,
    owner: of.controller,
    controller: of.controller,
    zone: of.zone,
    ...(of.identity ? { identity: { ...of.identity } } : {}),
    face: 'up',
    faceIndex: of.faceIndex,
    tapped: false,
    pose,
    counters: {},
    isToken: true,
    ...(of.tokenLabel !== undefined ? { tokenLabel: of.tokenLabel } : {}),
  });
  d.zones.w(of.zone).ids.push(id);
}

export function remove(d: Draft, a: ActionOf<'remove'>): void {
  const c = d.cards.need(checkId(a.card, 'card'));
  if (!c.isToken) reject(`only tokens and table objects can be removed; ${c.id} is a card`);
  const zone = cardZone(d, c);
  if (zone.id === STACK_ZONE) reject('move the token off the stack first');
  leavePile(d, c.id);
  for (const at of attachments(d, c.id)) delete d.cards.w(at.id).attachedTo;
  removeLinesTouching(d, 'card', c.id);
  if (d.stack.some((i) => i.source === c.id)) {
    for (const i of d.stackW()) if (i.source === c.id) delete i.source;
  }
  const z = d.zones.w(zone.id);
  z.ids = z.ids.filter((x) => x !== c.id);
  d.cards.delete(c.id);
}
