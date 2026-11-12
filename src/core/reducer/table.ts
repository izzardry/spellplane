/**
 * Lines, turn, players and meta handlers (DESIGN "Combat and annotation", "Turn flow and confirmation",
 * "Players, seats and formats"). Confirmation rounds (ask, respond, autoPass) belong to M1-P3.
 */
import type { ActionOf } from '../actions';
import { enterStage, stageProblem } from '../stage';
import type { Anchor } from '../types';
import type { Draft, RecordDraft } from './draft';
import { HIDDEN_POSE, isHidden } from './place';
import { byId, checkAnchor, checkId, checkInt, checkString, isObj, reject } from './util';

/** An anchor that exists: a card in a public zone, a stack item or a seat. */
export function checkAnchorExists(d: Draft, v: unknown): Anchor {
  const an = checkAnchor(v);
  if (an.kind === 'card') {
    const c = d.cards.need(an.id);
    if (isHidden(d.zones.need(c.zone))) reject(`card ${an.id} is in a hidden zone`);
  } else if (an.kind === 'stackItem') {
    if (!d.stack.some((i) => i.id === an.id)) reject(`unknown stack item ${an.id}`);
  } else {
    d.seats.need(an.id);
  }
  return an;
}

const LINE_KINDS = ['target', 'attack', 'block', 'attach', 'mark'] as const;

export function lineAdd(d: Draft, a: ActionOf<'lineAdd'>): void {
  const id = checkId(a.line, 'line');
  if (d.lines.has(id)) reject(`line ${id} already exists`);
  if (!LINE_KINDS.includes(a.kind)) reject('invalid line kind');
  const from = checkAnchorExists(d, a.from);
  const to = checkAnchorExists(d, a.to);
  if (from.kind === to.kind && from.id === to.id) reject('a line cannot join a thing to itself');
  const by = checkId(a.by, 'seat');
  const label = a.label === undefined ? '' : checkString(a.label, 'label', 200);
  d.lines.set(id, { id, kind: a.kind, from, to, by, ...(label !== '' ? { label } : {}) });
}

export function lineRemove(d: Draft, a: ActionOf<'lineRemove'>): void {
  d.lines.need(checkId(a.line, 'line'));
  d.lines.delete(a.line);
}

export function ping(d: Draft, a: ActionOf<'ping'>): void {
  checkAnchorExists(d, a.target);
}

export function phaseSet(d: Draft, a: ActionOf<'phaseSet'>): void {
  const phase = checkId(a.phase, 'phase');
  if (d.turn.phase !== phase) d.turnW().phase = phase;
}

/**
 * Pass the turn: the number goes up, `to` becomes active and every auto-pass clears. The phase is left as it is;
 * the client dispatches `phaseSet` to the game's first phase in the same group (the reducer holds no phase list).
 */
export function turnPass(d: Draft, a: ActionOf<'turnPass'>): void {
  const to = checkId(a.to, 'seat or team');
  if (!d.seats.has(to) && !d.teams.has(to)) reject(`unknown seat or team ${to}`);
  const t = d.turnW();
  t.number += 1;
  t.active = to;
  for (const s of d.seats.values()) if (s.autoPass) d.seats.w(s.id).autoPass = false;
}

export function life(d: Draft, a: ActionOf<'life'>): void {
  const seat = d.seats.need(checkId(a.seat, 'seat'));
  const delta = checkInt(a.delta, 'delta');
  if (delta === 0) return;
  const team = seat.team !== undefined ? d.teams.get(seat.team) : undefined;
  if (team) d.teams.w(team.id).life += delta;
  else d.seats.w(seat.id).life += delta;
}

export function playerCounter(d: Draft, a: ActionOf<'playerCounter'>): void {
  const seat = d.seats.need(checkId(a.seat, 'seat'));
  const kind = checkString(a.kind, 'counter kind', 64);
  if (kind === '' || kind === '__proto__') reject('invalid counter kind');
  const delta = checkInt(a.delta, 'delta');
  const next = Math.max(0, (Object.hasOwn(seat.counters, kind) ? (seat.counters[kind] ?? 0) : 0) + delta);
  const w = d.seats.w(seat.id);
  if (next === 0) delete w.counters[kind];
  else w.counters[kind] = next;
}

export function seatTake(d: Draft, a: ActionOf<'seatTake'>): void {
  const seat = d.seats.need(checkId(a.seat, 'seat'));
  const name = checkString(a.name, 'name', 64);
  if (name.trim() === '') reject('a seat needs a name');
  const colour = checkInt(a.colour, 'seat colour', 0, 7);
  const peer = a.peer === undefined ? undefined : checkId(a.peer, 'peer');
  const team = a.team === undefined ? undefined : d.teams.need(checkId(a.team, 'team')).id;
  if (seat.peer !== undefined && seat.peer !== peer) reject(`seat ${seat.id} is taken`);
  const w = d.seats.w(seat.id);
  w.name = name;
  w.colour = colour;
  if (peer !== undefined) w.peer = peer;
  delete w.away;
  if (team !== undefined && team !== seat.team) {
    if (seat.team !== undefined && d.teams.has(seat.team)) {
      const old = d.teams.w(seat.team);
      old.seats = old.seats.filter((s) => s !== seat.id);
    }
    const t = d.teams.w(team);
    t.seats = [...t.seats, seat.id].sort((x, y) => (d.seats.need(x).index ?? 0) - (d.seats.need(y).index ?? 0));
    w.team = team;
  }
}

export function seatLeave(d: Draft, a: ActionOf<'seatLeave'>): void {
  const seat = d.seats.need(checkId(a.seat, 'seat'));
  const w = d.seats.w(seat.id);
  w.name = '';
  w.ready = false;
  delete w.peer;
  delete w.away;
}

/**
 * Away: the sequencer marks a seated player's seat away when its peer has gone silent, and back when it returns (DESIGN
 * "Multiplayer architecture", Resume: "A disconnected player's seat is marked away"). Only a taken chair can be away;
 * marking it as it already is changes nothing. Who may propose it is the sequencer's check (DECISIONS [M1-C]).
 */
export function away(d: Draft, a: ActionOf<'away'>): void {
  const seat = d.seats.need(checkId(a.seat, 'seat'));
  if (typeof a.away !== 'boolean') reject('away needs true or false');
  if (a.away && seat.peer === undefined && seat.name === '') reject(`seat ${seat.id} is empty`);
  if ((seat.away === true) === a.away) reject(`seat ${seat.id} is already ${a.away ? 'away' : 'present'}`);
  const w = d.seats.w(seat.id);
  if (a.away) w.away = true;
  else delete w.away;
}

/** Ready: publish the deck commitment and create the seat's hidden cards as opaque ids (DESIGN "Specification: network protocol and secrecy", Commitments). */
export function ready(d: Draft, a: ActionOf<'ready'>): void {
  const seat = d.seats.need(checkId(a.by, 'seat'));
  const zone = d.zones.need(checkId(a.zone, 'zone'));
  if (!isHidden(zone)) reject(`ready creates cards in a hidden zone; ${zone.id} is public`);
  if (zone.owner !== seat.id) reject(`zone ${zone.id} belongs to ${zone.owner ?? 'the table'}, not ${seat.id}`);
  if (!Array.isArray(a.commits) || !Array.isArray(a.instanceIds)) reject('ready needs commits and instanceIds');
  if (a.commits.length !== a.instanceIds.length) reject('ready needs exactly one commit per instance id');
  const commits = a.commits.map((c) => checkString(c, 'commit', 256));
  const ids = a.instanceIds.map((id) => checkId(id, 'card'));
  const unique = new Set(ids);
  if (unique.size !== ids.length) reject('instance ids must be unique');
  for (const id of ids) if (d.cards.has(id)) reject(`card ${id} already exists`);
  const sorted = [...ids].sort(byId);
  for (const id of sorted) {
    d.cards.set(id, { id, owner: seat.id, controller: seat.id, zone: zone.id, face: 'down', faceIndex: 0, tapped: false, pose: { ...HIDDEN_POSE }, counters: {} });
  }
  const z = d.zones.w(zone.id);
  z.ids = [...z.ids, ...sorted].sort(byId);
  if (isHidden(z)) z.count = z.ids.length;
  d.seats.w(seat.id).ready = true;
  d.commitments.set(seat.id, { seat: seat.id, commits, instanceIds: sorted, atSeq: a.seq ?? d.base.seq });
}

export function settings(d: Draft, a: ActionOf<'settings'>): void {
  if (!isObj(a.settings)) reject('settings must be an object');
  for (const k of Object.keys(a.settings)) {
    const v = (a.settings as Record<string, unknown>)[k];
    if (k === 'passTimerMs') {
      if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 2000 || v > 30000)) reject('the pass timer is 2000 to 30000 ms, or null for off');
      d.settingsW().passTimerMs = v as number | null;
    } else if (k === 'teamHandsVisible') {
      if (typeof v !== 'boolean') reject('teamHandsVisible must be a boolean');
      d.settingsW().teamHandsVisible = v;
    } else {
      reject(`unknown setting ${k}`);
    }
  }
}

/** Copy every changed record of `next` into the draft (keys `next` lacks are deleted). */
function syncRecord<T>(r: RecordDraft<T>, next: Readonly<Record<string, T>>): void {
  for (const k of r.keys()) if (!Object.hasOwn(next, k)) r.delete(k);
  for (const [k, v] of Object.entries(next)) if (r.get(k) !== v) r.set(k, v);
}

/**
 * `stageSet {stage, round?}`: move the evening on (DESIGN "Specification: card data, packs and draft formats", Evening
 * stages). The rules are core/stage.ts `stageProblem`; what the new stage does to the table is `enterStage` (M2-P7).
 */
export function stageSet(d: Draft, a: ActionOf<'stageSet'>): void {
  const problem = stageProblem(d.base, a);
  if (problem !== null) reject(problem);
  const next = enterStage(d.base, a.stage, a.seq ?? d.base.seq + 1);
  syncRecord(d.cards, next.cards);
  syncRecord(d.zones, next.zones);
  syncRecord(d.lines, next.lines);
  syncRecord(d.seats, next.seats);
  syncRecord(d.teams, next.teams);
  syncRecord(d.commitments, next.commitments);
  syncRecord(d.rng, next.rng);
  syncRecord(d.shuffles, next.shuffles);
  if (next.stack !== d.base.stack) d.setStack(next.stack);
  if (next.turn !== d.base.turn) Object.assign(d.turnW(), next.turn);
  if (next.confirm !== d.base.confirm) d.setConfirm(next.confirm);
  if (next.draft !== d.base.draft) d.setDraftState(next.draft ?? null);
  if (next.games !== undefined && next.games !== d.base.games) d.setGames(next.games);
  d.setStage(next.stage);
}
