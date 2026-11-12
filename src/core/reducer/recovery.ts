/**
 * Lost-save recovery (DESIGN "Multiplayer architecture", Resume and failure handling: "If a player loses their local
 * save ... the player re-imports the deck, the table subtracts every card of theirs that is currently public, and the
 * remainder is committed and shuffled as a new library with a fresh hand count agreed by the table. The recovery path
 * is public and logged"). Contract: M1-C (amendment), DECISIONS `[M1-C]` lost-save recovery lines. Implementer: M1-P7.
 *
 * - `recover {hand, round}` by the recovering seat: discards every card in the seat's hidden zones (hand, library) in
 *   shared state, drops the seat's unfinished secret shuffles of them, sets `Seat.recovering` (the deck size is counted
 *   before the first discard and kept by a later proposal) and opens confirmation round `round` on the hand count.
 * - `recoverCommit {commits, instanceIds, zone}` by the same seat, once that round is the current one and has passed:
 *   creates exactly `recoveryLibrarySize` fresh opaque ids in the seat's library, appends them and their commits to the
 *   seat's commitment (as a re-issue does) and clears `Seat.recovering`. The owner then shuffles and draws as usual.
 */
import type { ActionOf } from '../actions';
import { ownDeckCards, recoveryLibrarySize } from '../recovery';
import type { Commitment, HiddenZone, InstanceId, SeatRecovery } from '../types';
import { roundPassed, startRound } from './confirm';
import type { Draft } from './draft';
import { HIDDEN_POSE, isHidden } from './place';
import { byId, checkId, checkInt, checkString, reject } from './util';

/** Longest commit string, as for `ready`. */
const MAX_COMMIT = 256;

function seqOf(d: Draft, a: { seq?: number }): number {
  return a.seq ?? d.base.seq + 1;
}

export function recover(d: Draft, a: ActionOf<'recover'>): void {
  const seat = d.seats.need(checkId(a.by, 'seat'));
  if (seat.name === '' && seat.peer === undefined) reject(`seat ${seat.id} is empty`);
  const round = checkId(a.round, 'round');
  const prior = seat.recovering;
  const deckSize = prior?.deckSize ?? ownDeckCards(d.cards.values(), seat.id).length;
  // Discard the seat's hidden zones: whatever this browser lost cannot be shown or verified any more.
  const hiddenZones = d.zones.values().filter((z): z is HiddenZone => isHidden(z) && z.owner === seat.id);
  const discarded = new Set<InstanceId>();
  for (const z of hiddenZones) {
    for (const id of z.ids) {
      discarded.add(id);
      d.cards.delete(id);
    }
    if (z.ids.length > 0) {
      const w = d.zones.w(z.id) as HiddenZone;
      w.ids = [];
      w.count = 0;
    }
  }
  const zoneIds = new Set(hiddenZones.map((z) => z.id));
  for (const s of d.shuffles.values()) if (s.orderHash === null && zoneIds.has(s.zone)) d.shuffles.delete(s.id);
  const publicLeft = ownDeckCards(d.cards.values(), seat.id).length;
  const hand = checkInt(a.hand, 'hand', 0, Math.max(0, deckSize - publicLeft));
  const next: SeatRecovery = { hand, round, deckSize, startSeq: seqOf(d, a) };
  d.seats.w(seat.id).recovering = next;
  startRound(d, a, round, undefined, `new hand of ${hand}?`);
}

export function recoverCommit(d: Draft, a: ActionOf<'recoverCommit'>): void {
  const seat = d.seats.need(checkId(a.by, 'seat'));
  const r = seat.recovering;
  if (!r) reject(`seat ${seat.id} is not recovering`);
  if (d.confirm?.id !== r.round) reject(`the recovery round ${r.round} is not the current round`);
  if (!roundPassed({ seats: d.seats.result(), confirm: d.confirm })) reject('the table has not agreed to the recovery yet');
  const zone = d.zones.need(checkId(a.zone, 'zone'));
  if (!isHidden(zone) || zone.kind !== 'library') reject(`recoverCommit creates cards in a library; ${zone.id} is not one`);
  if (zone.owner !== seat.id) reject(`zone ${zone.id} belongs to ${zone.owner ?? 'the table'}, not ${seat.id}`);
  if (!Array.isArray(a.commits) || !Array.isArray(a.instanceIds)) reject('recoverCommit needs commits and instanceIds');
  const ids = (a.instanceIds as unknown[]).map((id) => checkId(id, 'card'));
  const commits = (a.commits as unknown[]).map((c) => checkString(c, 'commit', MAX_COMMIT));
  if (commits.length !== ids.length) reject('recoverCommit needs exactly one commit per instance id');
  const size = recoveryLibrarySize({ ...d.base, seats: d.seats.result(), cards: d.cards.result() }, seat.id);
  if (ids.length !== size) reject(`recoverCommit commits ${size ?? 0} cards for ${seat.id}, not ${ids.length}`);
  if (new Set(ids).size !== ids.length) reject('instance ids must be unique');
  const prior: Commitment | undefined = d.commitments.get(seat.id);
  const used = new Set(prior?.instanceIds ?? []);
  for (const id of ids) {
    if (d.cards.has(id)) reject(`card ${id} already exists`);
    if (used.has(id)) reject(`id ${id} was used before`);
  }
  const sorted = [...ids].sort(byId);
  for (const id of sorted) {
    d.cards.set(id, { id, owner: seat.id, controller: seat.id, zone: zone.id, face: 'down', faceIndex: 0, tapped: false, pose: { ...HIDDEN_POSE }, counters: {} });
  }
  const z = d.zones.w(zone.id) as HiddenZone;
  z.ids = [...z.ids, ...sorted].sort(byId);
  z.count = z.ids.length;
  // Every id ever committed stays listed, as after a re-issue.
  d.commitments.set(seat.id, {
    seat: seat.id,
    commits: [...(prior?.commits ?? []), ...commits].sort(byId),
    instanceIds: [...(prior?.instanceIds ?? []), ...sorted].sort(byId),
    atSeq: prior?.atSeq ?? seqOf(d, a),
  });
  delete d.seats.w(seat.id).recovering;
}
