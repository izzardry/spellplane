/**
 * Secrecy and joint randomness in the reducer (DESIGN "Specification: network protocol and secrecy": Commitments,
 * Public randomness, Secret shuffle; "Multiplayer architecture", Hidden information; "Table model", Hidden cards).
 * Implementer: M1-P2.
 *
 * - `reveal` and a `flip` carrying an identity are checked against the owner's deck commitment. A mismatch is not
 *   refused: the identity becomes public and the card is marked `suspect` in shared state, so every peer flags it.
 * - The secret shuffle: `shuffleCommit` (owner, `h = SHA-256(ownerNonce)`), `shuffleNonce` (every other connected
 *   seated seat, in the clear), `shuffleDone` (owner, order hash, fresh opaque ids). A round's owner nonce is fixed by
 *   its commit, and a zone with an open round that already holds peer nonces takes no new round, so the owner cannot
 *   change its nonce after seeing the others'.
 * - Public randomness: `rngCommit` per seat, `rngReveal` once the commit phase is complete, the result drawn from the
 *   seed of all reveals. `commitClose` (proposed by the sequencer's clock) excludes the seats that missed the window.
 * - Re-issue of opaque ids (`shuffleDone.reissue`, `reorder.reissue`): every id of the zone is replaced by a fresh one
 *   with a fresh commitment, in sorted order, so peers cannot link a card's hidden history to a later reveal.
 *
 * Pure and total like the rest of the reducer: no clock, randomness or secret store.
 */
import type { ActionOf, Reissue } from '../actions';
import { commitFor, verifyNonce } from '../commit';
import { expectedParticipants, participantOrder, rngCommitPhaseComplete, rngOutcome, rngSeed, shuffleReady } from '../rng';
import type { CardRef, Commitment, HiddenZone, InstanceId, RngPurpose, SeatId } from '../types';
import { flip as plainFlip } from './cards';
import type { Draft } from './draft';
import { HIDDEN_POSE, isHidden } from './place';
import { byId, checkId, checkInt, checkRef, checkString, isObj, own, reject } from './util';
import { reorder as plainReorder, reveal as plainReveal } from './zones';

/** Longest nonce, hash or commit string accepted (base64url of 32 bytes is 43 characters; hex nonces are longer). */
const MAX_SECRET = 256;
/** Most outcomes of a public random round (DESIGN "Card manipulation": dice of any size). */
const MAX_OUTCOMES = 0x7fffffff;
const RNG_PURPOSES: readonly RngPurpose[] = ['die', 'coin', 'firstPlayer', 'seatShuffle'];

/** The seq this action gets: its own once sequenced, else the next one (an optimistic copy). */
function seqOf(d: Draft, a: { seq?: number }): number {
  return a.seq ?? d.base.seq + 1;
}

// ---- commitments and reveals ------------------------------------------------------------------------------------

/** Whether `ref` with `salt` opens one of the commitments `owner` published for `instanceId` (DESIGN "Commitments"). */
function matchesCommitment(d: Draft, owner: SeatId, instanceId: InstanceId, ref: CardRef, salt: string): boolean {
  const c = d.commitments.get(owner);
  if (!c) return false;
  return c.instanceIds.includes(instanceId) && c.commits.includes(commitFor(instanceId, ref, salt));
}

/** Mark a card whose revealed identity did not match its owner's commitment (DESIGN "Commitments": the card stays suspect). */
function markSuspect(d: Draft, id: InstanceId): void {
  if (d.cards.need(id).suspect !== true) d.cards.w(id).suspect = true;
}

/**
 * `reveal {instanceId, ref, salt}`: only the card's owner holds the salt, so only the owner reveals. The identity
 * becomes public either way; a reveal that does not open the owner's commitment marks the card suspect on every peer.
 */
export function reveal(d: Draft, a: ActionOf<'reveal'>): void {
  const c = d.cards.need(checkId(a.instanceId, 'card'));
  if (checkId(a.by, 'seat') !== c.owner) reject(`only ${c.owner} can reveal card ${c.id}`);
  if (c.isToken) reject(`token ${c.id} has no committed identity`);
  const ref = checkRef(a.ref);
  const salt = checkString(a.salt, 'salt', MAX_SECRET);
  const verified = matchesCommitment(d, c.owner, c.id, ref, salt);
  plainReveal(d, a);
  if (!verified) markSuspect(d, c.id);
}

/** `flip`: turning a card up with its identity is a reveal and is verified the same way. */
export function flip(d: Draft, a: ActionOf<'flip'>): void {
  if (a.ref === undefined) return plainFlip(d, a);
  const c = d.cards.need(checkId(a.card, 'card'));
  if (checkId(a.by, 'seat') !== c.owner) reject(`only ${c.owner} can reveal card ${c.id}`);
  if (c.isToken) reject(`token ${c.id} has no committed identity`);
  const ref = checkRef(a.ref);
  const salt = checkString(a.salt, 'salt', MAX_SECRET);
  const verified = matchesCommitment(d, c.owner, c.id, ref, salt);
  plainFlip(d, a);
  if (!verified) markSuspect(d, c.id);
}

// ---- re-issue of opaque ids ---------------------------------------------------------------------------------------

/**
 * Replace every opaque id of the hidden zone `zoneId` (owned by `seat`) with `r.ids`, and add `r.commits` to the
 * seat's commitment (DESIGN "Table model", Hidden cards). The new ids must be fresh: neither a current card nor an id
 * the seat ever committed to, so an old commitment can never be reused for a second card.
 */
function reissue(d: Draft, seat: SeatId, zoneId: string, r: unknown, seq: number): void {
  if (!isObj(r) || !Array.isArray(r.ids) || !Array.isArray(r.commits)) reject('reissue needs ids and commits');
  const zone = d.zones.need(zoneId);
  if (!isHidden(zone)) reject(`only a hidden zone's ids are re-issued; ${zone.id} is public`);
  if (zone.owner !== seat) reject(`zone ${zone.id} does not belong to ${seat}`);
  const ids = (r.ids as unknown[]).map((id) => checkId(id, 'card'));
  const commits = (r.commits as unknown[]).map((c) => checkString(c, 'commit', MAX_SECRET));
  if (ids.length !== zone.ids.length) reject(`reissue names ${ids.length} ids for the ${zone.ids.length} cards in ${zone.id}`);
  if (commits.length !== ids.length) reject('reissue needs exactly one commit per id');
  for (let i = 1; i < ids.length; i++) if (!(ids[i - 1]! < ids[i]!)) reject('re-issued ids must be sorted and unique');
  for (let i = 1; i < commits.length; i++) if (commits[i - 1]! > commits[i]!) reject('re-issued commits must be sorted');
  const prior: Commitment | undefined = d.commitments.get(seat);
  const used = new Set(prior?.instanceIds ?? []);
  for (const id of ids) {
    if (d.cards.has(id)) reject(`card ${id} already exists`);
    if (used.has(id)) reject(`id ${id} was used before`);
  }
  for (const old of zone.ids) d.cards.delete(old);
  for (const id of ids) {
    d.cards.set(id, { id, owner: seat, controller: seat, zone: zone.id, face: 'down', faceIndex: 0, tapped: false, pose: { ...HIDDEN_POSE }, counters: {} });
  }
  const z = d.zones.w(zone.id) as HiddenZone;
  z.ids = [...ids];
  z.count = ids.length;
  // Every id ever committed stays listed (an old commit cannot be told apart from the others, so it stays too).
  d.commitments.set(seat, {
    seat,
    commits: [...(prior?.commits ?? []), ...commits].sort(byId),
    instanceIds: [...(prior?.instanceIds ?? []), ...ids].sort(byId),
    atSeq: prior?.atSeq ?? seq,
  });
}

/** `reorder`: the public trace of a private reorder; with `reissue` the whole zone gets fresh ids. */
export function reorder(d: Draft, a: ActionOf<'reorder'>): void {
  plainReorder(d, a);
  const z = d.zones.need(a.zone);
  // Only the owner holds a hidden zone's order (DESIGN "Specification: network protocol and secrecy", Sequencing 3).
  if (z.owner !== checkId(a.by, 'seat')) reject(`only ${z.owner ?? 'the zone owner'} reorders ${z.id}`);
  if (a.reissue === undefined) return;
  if (a.count !== z.ids.length) reject('a reorder that re-issues ids covers the whole zone');
  reissue(d, a.by, z.id, a.reissue as Reissue, seqOf(d, a));
}

// ---- secret shuffle -----------------------------------------------------------------------------------------------

/** `shuffleCommit {sid, zone, h}`: the owner starts a secret shuffle of its hidden zone (Secret shuffle 1). */
export function shuffleCommit(d: Draft, a: ActionOf<'shuffleCommit'>): void {
  const sid = checkId(a.sid, 'shuffle');
  const by = d.seats.need(checkId(a.by, 'seat')).id;
  if (own(d.base.shuffles, sid)) reject(`shuffle ${sid} already exists: a round's nonce commitment cannot change`);
  const zone = d.zones.need(checkId(a.zone, 'zone'));
  if (!isHidden(zone)) reject(`only a hidden zone is shuffled in secret; ${zone.id} is public`);
  if (zone.owner !== by) reject(`zone ${zone.id} belongs to ${zone.owner ?? 'the table'}, not ${by}`);
  const h = checkString(a.h, 'nonce hash', MAX_SECRET);
  if (h === '') reject('a shuffle needs the hash of the owner nonce');
  const purpose = a.purpose ?? 'shuffle';
  if (purpose !== 'shuffle' && purpose !== 'pack') reject('purpose must be shuffle or pack');
  for (const r of Object.values(d.base.shuffles)) {
    if (r.zone !== zone.id || r.orderHash !== null) continue;
    // Restarting after the peers' nonces arrived would let the owner pick among orders it can already compute.
    if (Object.keys(r.nonces).length > 0) reject(`shuffle ${r.id} of ${zone.id} already has peer nonces; finish it first`);
  }
  // A round abandoned before any peer nonce taught the owner anything is dropped.
  for (const r of d.shuffles.values()) if (r.zone === zone.id && r.orderHash === null) d.shuffles.delete(r.id);
  d.shuffles.set(sid, { id: sid, zone: zone.id, owner: by, purpose, h, startSeq: seqOf(d, a), nonces: {}, orderHash: null });
}

/** `shuffleNonce {sid, nonce}`: another connected seated seat's nonce, once, before the window closes (Secret shuffle 2). */
export function shuffleNonce(d: Draft, a: ActionOf<'shuffleNonce'>): void {
  const sid = checkId(a.sid, 'shuffle');
  const by = d.seats.need(checkId(a.by, 'seat')).id;
  const r = own(d.base.shuffles, sid);
  if (!r) reject(`unknown shuffle ${sid}`);
  if (r.owner === by) reject("the owner's nonce is committed, not sent");
  if (r.orderHash !== null) reject(`shuffle ${sid} is finished`);
  if (r.closedSeq !== undefined) reject(`the nonce window of shuffle ${sid} is closed`);
  if (Object.hasOwn(r.nonces, by)) reject(`${by} already sent its nonce for shuffle ${sid}`);
  if (!expectedParticipants(d.base, sid).includes(by)) reject(`${by} is not a connected seated player of this shuffle`);
  const nonce = checkString(a.nonce, 'nonce', MAX_SECRET);
  if (nonce === '') reject('a nonce cannot be empty');
  d.shuffles.w(sid).nonces[by] = nonce;
}

/** `shuffleDone {sid, orderHash, reissue?}`: the owner finishes once every expected nonce arrived or the window closed (Secret shuffle 5). */
export function shuffleDone(d: Draft, a: ActionOf<'shuffleDone'>): void {
  const sid = checkId(a.sid, 'shuffle');
  const by = checkId(a.by, 'seat');
  const r = own(d.base.shuffles, sid);
  if (!r) reject(`unknown shuffle ${sid}`);
  if (r.owner !== by) reject(`only ${r.owner} finishes shuffle ${sid}`);
  if (r.orderHash !== null) reject(`shuffle ${sid} is finished`);
  if (!shuffleReady(d.base, sid)) reject(`shuffle ${sid} still waits for peer nonces`);
  const orderHash = checkString(a.orderHash, 'order hash', MAX_SECRET);
  if (orderHash === '') reject('a finished shuffle needs its order hash');
  d.shuffles.w(sid).orderHash = orderHash;
  if (a.reissue !== undefined) reissue(d, by, r.zone, a.reissue, seqOf(d, a));
}

// ---- public randomness --------------------------------------------------------------------------------------------

/** `rngCommit {rid, purpose, n, h}`: the first commit opens the round; every other participant commits once (Public randomness 1-2). */
export function rngCommit(d: Draft, a: ActionOf<'rngCommit'>): void {
  const rid = checkId(a.rid, 'randomness round');
  const by = d.seats.need(checkId(a.by, 'seat')).id;
  if (!RNG_PURPOSES.includes(a.purpose)) reject('invalid randomness purpose');
  const n = checkInt(a.n, 'n', 1, MAX_OUTCOMES);
  const h = checkString(a.h, 'nonce hash', MAX_SECRET);
  if (h === '') reject('a commit needs the hash of a nonce');
  const r = own(d.base.rng, rid);
  if (!r) {
    if (!isSeated(d, by)) reject(`${by} is not a connected seated player`);
    d.rng.set(rid, { id: rid, purpose: a.purpose, n, by, startSeq: seqOf(d, a), commits: { [by]: h }, reveals: {}, result: null });
    return;
  }
  if (r.purpose !== a.purpose || r.n !== n) reject(`round ${rid} is a ${r.purpose} with ${r.n} outcomes`);
  if (r.result !== null) reject(`round ${rid} is decided`);
  if (r.closedSeq !== undefined) reject(`the commit window of round ${rid} is closed`);
  if (Object.keys(r.reveals).length > 0) reject(`round ${rid} is already revealing`);
  if (Object.hasOwn(r.commits, by)) reject(`${by} already committed to round ${rid}`);
  if (!expectedParticipants(d.base, rid).includes(by)) reject(`${by} is not a connected seated player of round ${rid}`);
  d.rng.w(rid).commits[by] = h;
}

/** `rngReveal {rid, nonce}`: once every commit is in (or the window closed); the last reveal decides the result (Public randomness 3-4). */
export function rngReveal(d: Draft, a: ActionOf<'rngReveal'>): void {
  const rid = checkId(a.rid, 'randomness round');
  const by = checkId(a.by, 'seat');
  const r = own(d.base.rng, rid);
  if (!r) reject(`unknown randomness round ${rid}`);
  if (r.result !== null) reject(`round ${rid} is decided`);
  if (!Object.hasOwn(r.commits, by)) reject(`${by} did not commit to round ${rid}`);
  if (Object.hasOwn(r.reveals, by)) reject(`${by} already revealed for round ${rid}`);
  if (!rngCommitPhaseComplete(d.base, rid)) reject(`round ${rid} still waits for commits`);
  const nonce = checkString(a.nonce, 'nonce', MAX_SECRET);
  // A nonce that does not open the commit would let its sender pick the result after seeing the others' nonces.
  if (!verifyNonce(r.commits[by]!, nonce)) reject(`the nonce does not match ${by}'s commit for round ${rid}`);
  const w = d.rng.w(rid);
  w.reveals[by] = nonce;
  const committed = Object.keys(w.commits);
  if (committed.every((s) => Object.hasOwn(w.reveals, s))) {
    w.result = rngOutcome(rngSeed(w.reveals, participantOrder(d.base, committed)), w.n);
  }
}

/** `commitClose {kind, id}`: the sequencer's clock closes a commit window; later commits and nonces are refused (Public randomness 2, Secret shuffle 2). */
export function commitClose(d: Draft, a: ActionOf<'commitClose'>): void {
  const id = checkId(a.id, 'round');
  if (a.kind === 'rng') {
    const r = own(d.base.rng, id);
    if (!r) reject(`unknown randomness round ${id}`);
    if (r.result !== null) reject(`round ${id} is decided`);
    if (r.closedSeq !== undefined) reject(`round ${id} is closed`);
    d.rng.w(id).closedSeq = seqOf(d, a);
  } else if (a.kind === 'shuffle') {
    const r = own(d.base.shuffles, id);
    if (!r) reject(`unknown shuffle ${id}`);
    if (r.orderHash !== null) reject(`shuffle ${id} is finished`);
    if (r.closedSeq !== undefined) reject(`shuffle ${id} is closed`);
    d.shuffles.w(id).closedSeq = seqOf(d, a);
  } else {
    reject('commitClose kind must be rng or shuffle');
  }
}

function isSeated(d: Draft, seat: SeatId): boolean {
  const s = d.seats.get(seat);
  return s !== undefined && s.name.trim() !== '' && s.away !== true;
}
