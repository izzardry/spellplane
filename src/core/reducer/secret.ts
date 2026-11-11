/**
 * Secrecy and joint randomness in the reducer (DESIGN "Specification: network protocol and secrecy": Commitments,
 * Public randomness, Secret shuffle; "Multiplayer architecture", Hidden information; "Table model", Hidden cards).
 * Implementer: M1-P2.
 *
 * - `reveal` and a `flip` carrying an identity are checked against the owner's deck commitment. A mismatch is not
 *   refused: the identity becomes public and the card is marked `suspect` in shared state, so every peer flags it.
 * - The secret shuffle: `shuffleCommit` (owner, `h = SHA-256(ownerNonce)`), `shuffleNonce` (every other seated
 *   seat, in the clear; an away seat is still waited for, `expectedParticipants`), `shuffleDone` (owner, order hash, fresh opaque ids only where needed). A round's
 *   owner nonce is fixed by its commit, and a zone with an unfinished round takes no new round, so the owner cannot
 *   change its nonce after seeing the others' (a sequencer owner sees a peer's nonce proposal before it sequences
 *   it). From the commit until `shuffleDone` the zone's cards are frozen (`checkFrozenZones`), so the owner cannot
 *   pick the order by choosing which ids get shuffled.
 * - Public randomness: `rngCommit` per seat, `rngReveal` once the commit phase is complete, the result drawn from the
 *   seed of all reveals. `commitClose` (proposed by the sequencer's clock) excludes the seats that missed the window;
 *   a round's own initiator (or a shuffle's owner) cannot close it, or it could decide alone. For the same reason
 *   marking a seat away does not stop it being waited for, and the owner or initiator cannot make a seat its round
 *   waits for leave (`checkRoundParticipants`): in 1v1 the sequencer is that owner and could otherwise shut the peer
 *   out after committing and decide alone with a nonce ground offline. Nor can any seat empty another seat's chair
 *   unless the sequencer marked that seat away (`checkSeatLeave`), so nobody can shut the peers out before committing
 *   either; only the sequencer, through `away`, still can (it can also forge unsigned actions, DESIGN Handshake).
 * - A round is sealed (`closedSeq` set) in the step that completes it, whatever that step was (the last nonce or
 *   commit, or a seat leaving), so its participant set and nonces never change once the owner could
 *   compute the result: a seat that sits down or comes back later does not join it (`sealCompleteRounds`).
 * - Rng ids and shuffle ids are separate namespaces; an id already used by the other kind is refused.
 * - Re-issue of opaque ids (`shuffleDone.reissue`, `reorder.reissue`): every id of the zone is replaced by a fresh one
 *   with a fresh commitment, in sorted order, so peers cannot link a card's hidden history to a later reveal. The
 *   reducer cannot tell whether a re-issue was needed (no public record of disclosures), so commitments made by a
 *   re-issue are checked live for consistency only and against the deck commitment by the audit. A zone holding a
 *   suspect card is never re-issued, so the flag cannot be washed off.
 *
 * Pure and total like the rest of the reducer: no clock, randomness or secret store.
 */
import type { ActionOf, Reissue } from '../actions';
import { commitFor, verifyNonce } from '../commit';
import { expectedParticipants, participantOrder, rngCommitPhaseComplete, rngOutcome, rngSeed, shuffleReady } from '../rng';
import type { CardRef, Commitment, HiddenZone, InstanceId, RngPurpose, RngRound, SeatId, ShuffleRound, TableState } from '../types';
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
  // Fresh ids cannot carry the mark over without linking old and new ids, so a suspect card keeps its id.
  for (const old of zone.ids) if (d.cards.need(old).suspect === true) reject(`${zone.id} holds suspect card ${old}; its id is not re-issued`);
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
  if (own(d.base.rng, sid)) reject(`${sid} already names a randomness round`);
  const zone = d.zones.need(checkId(a.zone, 'zone'));
  if (!isHidden(zone)) reject(`only a hidden zone is shuffled in secret; ${zone.id} is public`);
  if (zone.owner !== by) reject(`zone ${zone.id} belongs to ${zone.owner ?? 'the table'}, not ${by}`);
  const h = checkString(a.h, 'nonce hash', MAX_SECRET);
  if (h === '') reject('a shuffle needs the hash of the owner nonce');
  const purpose = a.purpose ?? 'shuffle';
  if (purpose !== 'shuffle' && purpose !== 'pack') reject('purpose must be shuffle or pack');
  for (const r of Object.values(d.base.shuffles)) {
    // Restarting would let the owner pick among orders it can compute as soon as it sees a peer nonce, which a
    // sequencer owner does before it sequences that nonce.
    if (r.zone === zone.id && isOpen(r)) reject(`shuffle ${r.id} of ${zone.id} is not finished; finish it first`);
  }
  d.shuffles.set(sid, { id: sid, zone: zone.id, owner: by, purpose, h, startSeq: seqOf(d, a), nonces: {}, orderHash: null });
}

/**
 * Whether a shuffle round is unfinished (committed, no `shuffleDone` yet). An open round cannot be replaced and its
 * zone's cards are frozen (`checkFrozenZones`) from the commit on, not only from the first sequenced peer nonce: the
 * owner may see a nonce before it is sequenced (the 1v1 sequencer receives the peer's proposal), so the set of ids and
 * the round must be fixed before any nonce exists, or the owner could pick among outcomes it can already compute.
 */
export function isOpen(r: ShuffleRound): boolean {
  return r.orderHash === null;
}

/** `shuffleNonce {sid, nonce}`: another seated seat's nonce, once, before the window closes (Secret shuffle 2). */
export function shuffleNonce(d: Draft, a: ActionOf<'shuffleNonce'>): void {
  const sid = checkId(a.sid, 'shuffle');
  const by = d.seats.need(checkId(a.by, 'seat')).id;
  const r = own(d.base.shuffles, sid);
  if (!r) reject(`unknown shuffle ${sid}`);
  if (r.owner === by) reject("the owner's nonce is committed, not sent");
  if (r.orderHash !== null) reject(`shuffle ${sid} is finished`);
  if (r.closedSeq !== undefined) reject(`the nonce window of shuffle ${sid} is closed`);
  if (Object.hasOwn(r.nonces, by)) reject(`${by} already sent its nonce for shuffle ${sid}`);
  if (!expectedParticipants(d.base, sid, 'shuffle').includes(by)) reject(`${by} is not a seated player of this shuffle`);
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
    if (own(d.base.shuffles, rid)) reject(`${rid} already names a shuffle`);
    if (!isSeated(d, by)) reject(`${by} is not a connected seated player`);
    d.rng.set(rid, { id: rid, purpose: a.purpose, n, by, startSeq: seqOf(d, a), commits: { [by]: h }, reveals: {}, result: null });
    return;
  }
  if (r.purpose !== a.purpose || r.n !== n) reject(`round ${rid} is a ${r.purpose} with ${r.n} outcomes`);
  if (r.result !== null) reject(`round ${rid} is decided`);
  if (r.closedSeq !== undefined) reject(`the commit window of round ${rid} is closed`);
  if (Object.keys(r.reveals).length > 0) reject(`round ${rid} is already revealing`);
  if (Object.hasOwn(r.commits, by)) reject(`${by} already committed to round ${rid}`);
  if (!expectedParticipants(d.base, rid, 'rng').includes(by)) reject(`${by} is not a seated player of round ${rid}`);
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
  const by = checkId(a.by, 'seat');
  if (a.kind === 'rng') {
    const r = own(d.base.rng, id);
    if (!r) reject(`unknown randomness round ${id}`);
    if (r.result !== null) reject(`round ${id} is decided`);
    if (r.closedSeq !== undefined) reject(`round ${id} is closed`);
    // The initiator closing its own window could shut the others out and decide alone with a nonce it ground offline.
    if (r.by === by) reject(`${by} opened round ${id} and cannot close its window`);
    d.rng.w(id).closedSeq = seqOf(d, a);
  } else if (a.kind === 'shuffle') {
    const r = own(d.base.shuffles, id);
    if (!r) reject(`unknown shuffle ${id}`);
    if (r.orderHash !== null) reject(`shuffle ${id} is finished`);
    if (r.closedSeq !== undefined) reject(`shuffle ${id} is closed`);
    // Likewise the owner: a seed from its own nonce alone is one it could choose.
    if (r.owner === by) reject(`${by} owns shuffle ${id} and cannot close its window`);
    d.shuffles.w(id).closedSeq = seqOf(d, a);
  } else {
    reject('commitClose kind must be rng or shuffle');
  }
}

function isSeated(d: Draft, seat: SeatId): boolean {
  const s = d.seats.get(seat);
  return s !== undefined && s.name.trim() !== '' && s.away !== true;
}

/**
 * Seal every open round that has everything it waits for: a randomness round whose expected commits are all in, a
 * shuffle whose expected peer nonces are all in (DESIGN "Public randomness" 2-3, "Secret shuffle" 2-3). Run after
 * every applied action, so a round is sealed in the very step that completes it, also when that step is a seat
 * leaving. From then on no commit or nonce is taken, so the owner's order (or the dice result) is
 * computed from a set that cannot grow behind its back. `closedSeq` is the seq of that step. Pure; returns `state`
 * itself when nothing is sealed.
 */
export function sealCompleteRounds(state: TableState, seq: number): TableState {
  let rng: Record<string, RngRound> | null = null;
  let shuffles: Record<string, ShuffleRound> | null = null;
  for (const id of Object.keys(state.rng)) {
    const r = state.rng[id]!;
    if (r.result !== null || r.closedSeq !== undefined || !rngCommitPhaseComplete(state, id)) continue;
    rng ??= { ...state.rng };
    rng[id] = { ...r, closedSeq: seq };
  }
  for (const id of Object.keys(state.shuffles)) {
    const r = state.shuffles[id]!;
    if (r.orderHash !== null || r.closedSeq !== undefined || !shuffleReady(state, id)) continue;
    shuffles ??= { ...state.shuffles };
    shuffles[id] = { ...r, closedSeq: seq };
  }
  if (!rng && !shuffles) return state;
  return { ...state, ...(rng ? { rng } : {}), ...(shuffles ? { shuffles } : {}) };
}

/** The ids of zone `zone` in `state`, sorted (empty for an unknown zone). */
function zoneIds(state: TableState, zone: string): string {
  const z = own(state.zones, zone);
  return z ? [...z.ids].sort(byId).join(',') : '';
}

/**
 * Refuse a step that changes the cards of a zone with an open shuffle round (`isOpen`) that is not finished by this
 * very step (DESIGN "Specification: network protocol and secrecy", Secret shuffle 3: "the owner could not choose it,
 * having committed first"). Once it sees the peers' nonces (as the sequencer, even before they are sequenced) the
 * owner can compute the outcome for any set of ids, so adding, removing or re-issuing a card before `shuffleDone`
 * would let it pick the order. Checked for every action (draws, moves, mills, re-issues, undo), whoever sends it.
 * A lost peer still unblocks the round when another seat sequences (its `commitClose`); a sequencer owner's round
 * waits for the peer to return or leave (M1-P7 recovery), see `checkRoundParticipants`.
 */
export function checkFrozenZones(prior: TableState, next: TableState, action: { type: string; sid?: unknown }): void {
  for (const r of Object.values(prior.shuffles)) {
    if (!isOpen(r)) continue;
    if (action.type === 'shuffleDone' && action.sid === r.id) continue;
    if (own(prior.zones, r.zone) === own(next.zones, r.zone)) continue;
    if (zoneIds(prior, r.zone) !== zoneIds(next, r.zone)) reject(`${r.zone} is being shuffled (${r.id}); its cards cannot change until the shuffle is done`);
  }
}

/** The seats an open round still waits for (expected and not yet contributed), or null for a sealed or finished round. */
function stillWaiting(state: TableState, kind: 'rng' | 'shuffle', id: string): SeatId[] | null {
  if (kind === 'rng') {
    const r = state.rng[id]!;
    if (r.result !== null || r.closedSeq !== undefined) return null;
    return expectedParticipants(state, id, 'rng').filter((s) => !Object.hasOwn(r.commits, s));
  }
  const r = state.shuffles[id]!;
  if (r.orderHash !== null || r.closedSeq !== undefined) return null;
  return expectedParticipants(state, id, 'shuffle').filter((s) => !Object.hasOwn(r.nonces, s));
}

/**
 * Refuse a step by a round's own initiator (rng) or owner (shuffle) that stops that round waiting for a seat that has
 * not contributed yet (DESIGN "Multiplayer architecture", Hidden information 3: "The owner cannot choose the order";
 * "Dice and coin flips use the same commit-then-reveal exchange, so no single browser picks the result"). Today the
 * only such step is a `seatLeave` of the peer's chair sent under the owner's name; the check is generic so no later
 * action opens the same hole. The seat itself may still leave, and a third seat's `commitClose` still excludes it.
 */
export function checkRoundParticipants(prior: TableState, next: TableState, action: { by?: unknown }): void {
  const rounds: ['rng' | 'shuffle', string, SeatId][] = [
    ...Object.values(prior.rng).map((r): ['rng', string, SeatId] => ['rng', r.id, r.by]),
    ...Object.values(prior.shuffles).map((r): ['shuffle', string, SeatId] => ['shuffle', r.id, r.owner]),
  ];
  for (const [kind, id, owner] of rounds) {
    if (owner !== action.by) continue;
    const before = stillWaiting(prior, kind, id);
    if (!before || before.length === 0) continue;
    const after = new Set(expectedParticipants(next, id, kind));
    const dropped = before.find((s) => !after.has(s));
    if (dropped !== undefined) reject(`${owner} cannot stop its ${kind === 'rng' ? 'round' : 'shuffle'} ${id} waiting for ${dropped}`);
  }
}

/**
 * Refuse a `seatLeave` of another seat's chair unless the sequencer marked that seat away (DESIGN "Multiplayer
 * architecture", Hidden information 3: "The owner cannot choose the order"; "Dice and coin flips use the same
 * commit-then-reveal exchange, so no single browser picks the result"; "Secret shuffle" 3). Otherwise any seat could
 * empty the other chairs before it commits a shuffle or opens a roll; the round would then wait for nobody and the
 * result would follow from a nonce it ground offline, and the emptied seats could sit down again afterwards. A seat
 * leaves its own chair freely (a chair move stamps the leave with the old chair, local-session `takeSeat`), and a
 * player gone for good is cleared through the sequencer's away mark (M1-P7). `checkRoundParticipants` still stops a
 * round's owner or initiator emptying an away chair its open round waits for.
 */
export function checkSeatLeave(prior: TableState, action: { type: string; by?: unknown; seat?: unknown }): void {
  if (action.type !== 'seatLeave' || action.seat === action.by) return;
  const seat = typeof action.seat === 'string' && Object.hasOwn(prior.seats, action.seat) ? prior.seats[action.seat]! : undefined;
  if (seat && seat.away !== true) reject(`${String(action.by)} cannot empty ${seat.id}'s chair; only a seat marked away can be cleared by another seat`);
}
