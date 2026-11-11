/**
 * State invariants for property tests and debug builds (DESIGN "Table model": every card is in exactly one zone;
 * PLAN M0-P1 acceptance: contiguous pile indices). Implementer: M0-P1.
 */
import { canonicalJson } from './hash';
import { parseZoneId } from './ids';
import { normRot, pileMemberPose, q } from './reducer/util';
import type { CardInstance, TableState } from './types';

const STACK = 'stack';

/** Human-readable violations; empty when the state is consistent (DESIGN "Table model"). */
export function checkInvariants(state: TableState): string[] {
  const out: string[] = [];
  const bad = (msg: string): void => {
    out.push(msg);
  };
  const cards = state.cards;
  const zones = state.zones;
  const card = (id: string): CardInstance | undefined => (Object.hasOwn(cards, id) ? cards[id] : undefined);
  const isPublic = (zoneId: string): boolean => Object.hasOwn(zones, zoneId) && zones[zoneId]!.visibility === 'public';

  // Zones and membership: every card in exactly one zone.
  const where = new Map<string, string[]>();
  for (const [key, z] of Object.entries(zones)) {
    if (z.id !== key) bad(`zone ${key} has id ${z.id}`);
    const p = parseZoneId(z.id);
    if (p.kind !== z.kind || p.seat !== z.owner) bad(`zone ${z.id} kind/owner do not match its id`);
    if (new Set(z.ids).size !== z.ids.length) bad(`zone ${z.id} lists a card twice`);
    for (const id of z.ids) where.set(id, [...(where.get(id) ?? []), z.id]);
    if (z.visibility !== 'public') {
      if (z.count !== z.ids.length) bad(`hidden zone ${z.id} count ${z.count} != ${z.ids.length}`);
      for (let i = 1; i < z.ids.length; i++) if (!(z.ids[i - 1]! < z.ids[i]!)) bad(`hidden zone ${z.id} ids are not sorted`);
    }
  }
  for (const [id, zs] of where) {
    if (!card(id)) bad(`zone ${zs.join(', ')} lists unknown card ${id}`);
    else if (zs.length !== 1 || zs[0] !== card(id)!.zone) bad(`card ${id} is listed in ${zs.join(', ') || 'no zone'} but its zone is ${card(id)!.zone}`);
  }

  // Cards.
  const piles = new Map<string, CardInstance[]>();
  for (const [key, c] of Object.entries(cards)) {
    if (c.id !== key) bad(`card ${key} has id ${c.id}`);
    if (!where.has(c.id)) bad(`card ${c.id} is in no zone (says ${c.zone})`);
    for (const n of [c.pose.x, c.pose.y, c.pose.rot]) if (!Number.isFinite(n) || q(n) !== n) bad(`card ${c.id} pose is not quantised`);
    if (normRot(c.pose.rot) !== c.pose.rot) bad(`card ${c.id} rot ${c.pose.rot} is outside [0, 360)`);
    for (const [k, v] of Object.entries(c.counters)) if (!Number.isInteger(v) || v <= 0) bad(`card ${c.id} counter ${k} = ${v}`);
    const pub = isPublic(c.zone);
    if (!pub) {
      if (c.tapped || c.pile || c.attachedTo !== undefined || c.note !== undefined || c.home || c.combat || Object.keys(c.counters).length) {
        bad(`card ${c.id} in hidden zone ${c.zone} carries public state`);
      }
      if (c.isToken) bad(`token ${c.id} is in hidden zone ${c.zone}`);
    } else if (c.face === 'up' && c.identity === undefined && c.tokenLabel === undefined) {
      bad(`card ${c.id} is face up in ${c.zone} without an identity`);
    }
    if (c.pile) {
      piles.set(c.pile.id, [...(piles.get(c.pile.id) ?? []), c]);
      if (!pub || c.zone === STACK) bad(`card ${c.id} is in a pile outside a public table zone`);
      if (c.attachedTo !== undefined) bad(`card ${c.id} is both attached and in pile ${c.pile.id}`);
    }
    if (c.attachedTo !== undefined) {
      const host = card(c.attachedTo);
      if (c.attachedTo === c.id) bad(`card ${c.id} is attached to itself`);
      else if (!host) bad(`card ${c.id} is attached to unknown ${c.attachedTo}`);
      else if (host.zone !== c.zone) bad(`card ${c.id} is attached to ${host.id} in another zone`);
      const seen = new Set([c.id]);
      for (let h = host; h?.attachedTo !== undefined; h = card(h.attachedTo)) {
        if (seen.has(h.id)) {
          bad(`card ${c.id} is in an attachment cycle`);
          break;
        }
        seen.add(h.id);
      }
    }
  }

  // Piles: contiguous indices, one zone, one kind, laid out from the base.
  for (const [id, ms] of piles) {
    ms.sort((a, b) => a.pile!.index - b.pile!.index);
    if (ms.some((m, i) => m.pile!.index !== i)) bad(`pile ${id} indices ${ms.map((m) => m.pile!.index).join(',')} are not contiguous from 0`);
    if (new Set(ms.map((m) => m.zone)).size > 1) bad(`pile ${id} spans zones`);
    if (new Set(ms.map((m) => m.pile!.kind)).size > 1) bad(`pile ${id} mixes kinds`);
    const anchor = ms[0]!.pose;
    ms.forEach((m, i) => {
      if (canonicalJson(m.pose) !== canonicalJson(pileMemberPose(anchor, i, ms[0]!.pile!.kind))) bad(`pile ${id} member ${m.id} is off its layout`);
    });
  }

  // Stack: unique items, spell cards in the stack zone in order.
  const items = new Set<string>();
  for (const it of state.stack) {
    if (items.has(it.id)) bad(`stack item ${it.id} appears twice`);
    items.add(it.id);
    if ((it.kind === 'spell') !== (it.card !== undefined)) bad(`stack item ${it.id}: only spells carry a card`);
    if (it.card !== undefined && card(it.card)?.zone !== STACK) bad(`stack item ${it.id} card ${it.card} is not in the stack zone`);
    if (it.source !== undefined && !card(it.source)) bad(`stack item ${it.id} source ${it.source} is unknown`);
    if (!Object.hasOwn(state.seats, it.controller)) bad(`stack item ${it.id} controller ${it.controller} is unknown`);
  }
  for (const it of state.stack) if (it.copyOf !== undefined && !items.has(it.copyOf)) bad(`stack item ${it.id} copies unknown ${it.copyOf}`);
  const spells = state.stack.flatMap((i) => (i.card !== undefined ? [i.card] : []));
  if (Object.hasOwn(zones, STACK) && canonicalJson(zones[STACK]!.ids) !== canonicalJson(spells)) bad(`stack zone ids do not match the spell items`);

  // Lines: anchors exist; card anchors are public.
  for (const [key, l] of Object.entries(state.lines)) {
    if (l.id !== key) bad(`line ${key} has id ${l.id}`);
    for (const an of [l.from, l.to]) {
      const ok =
        an.kind === 'card' ? card(an.id) !== undefined && isPublic(card(an.id)!.zone) : an.kind === 'stackItem' ? items.has(an.id) : Object.hasOwn(state.seats, an.id);
      if (!ok) bad(`line ${l.id} has a dangling ${an.kind} anchor ${an.id}`);
    }
  }

  // Seats and teams.
  for (const [key, s] of Object.entries(state.seats)) {
    if (s.id !== key) bad(`seat ${key} has id ${s.id}`);
    if (s.team !== undefined && !state.teams[s.team]?.seats.includes(s.id)) bad(`seat ${s.id} is not listed by team ${s.team}`);
  }
  for (const [key, t] of Object.entries(state.teams)) {
    if (t.id !== key) bad(`team ${key} has id ${t.id}`);
    for (const s of t.seats) if (state.seats[s]?.team !== t.id) bad(`team ${t.id} lists seat ${s} of another team`);
  }
  return out;
}
