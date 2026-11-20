/**
 * Rejoin actions (persistence.md sections 5 and 7; contracts.md Part D and Part G "Rejoin"): `seatInvite`, `seatClaim`,
 * `playOn` and the presence hook. Implementer: M8-P5.
 *
 * - `seatInvite {seat, h, exp?}`: a present player at another seat opens (`h` set) or takes back (`h` null) the one
 *   re-invite of an occupied seat marked away. In a team game only a teammate of that seat may (no exception when the
 *   whole team is away; contracts.md Part G item 1). Refused for good at a matched table (`settings.matched`).
 * - `seatClaim {seat, claim, peer, name}`: a browser without a seat takes an invited seat with the link's token: the
 *   claim hash must match the open invite. It sets `peer` and `name`, clears `away` and the invite and counts a
 *   take-over; cards, zones, commitments and life are untouched. The 24 hours, the 30 seconds of absence and "the old
 *   browser is still connected" are the sequencer's clock and view (net/engine.ts), not the reducer's.
 * - `playOn {without}`: the sender's seat marks the named seats (occupied, not its own, not away) away; an empty list
 *   applies too (`PLAY ON WITH THIS TABLE`).
 * - `onPresence`: an open invite is void once the seat's own browser is back, the chair is emptied, or it is marked
 *   away anew.
 *
 * Refusal reasons start with a stable code in brackets (`[claim:used]` …) that `claimRefusal` reads, so the claim page
 * shows the right screen without parsing prose.
 */
import type { ActionOf } from '../actions';
import { sha256Sync } from '../sha256';
import type { SeatId, TableState } from '../types';
import type { Draft } from './draft';
import { checkId, checkString, reject } from './util';

/** base64url of 32 bytes. */
const HASH_RE = /^[A-Za-z0-9_-]{43}$/;
/** A claim token: 16 random bytes, base64url (22 characters); longer ones are accepted up to 64. */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** The claim hash of a token (persistence.md section 7): base64url(SHA-256('spellplane-claim|' + seat + '|' + claim)). */
export function claimHashOf(seat: SeatId, claim: string): string {
  return sha256Sync(`spellplane-claim|${seat}|${claim}`);
}

/** Why a claim was refused, for the claim page's screens (persistence.md section 7). */
export type ClaimRefusal = 'used' | 'takenBack' | 'void' | 'wrong' | 'present' | 'noInvite' | 'seated' | 'expired' | 'otherDevice' | 'other';

/** The refusal kind of a reason string from `explain` or the sequencer (null when it is not a claim refusal). */
export function claimRefusal(reason: string): ClaimRefusal {
  const m = /^\[claim:([a-zA-Z]+)\]/.exec(reason);
  const code = m?.[1];
  switch (code) {
    case 'used':
    case 'takenBack':
    case 'void':
    case 'wrong':
    case 'present':
    case 'noInvite':
    case 'seated':
    case 'expired':
    case 'otherDevice':
      return code;
    default:
      return 'other';
  }
}

function occupied(s: { peer?: string | undefined; name: string }): boolean {
  return s.peer !== undefined;
}

/** `seatInvite {seat, h, exp?}` (persistence.md section 7; contracts.md Part G items 1 and 7). */
export function seatInvite(d: Draft, a: ActionOf<'seatInvite'>): void {
  if (d.settings.matched === true) reject('[invite:matched] a matched game takes no seat invites');
  const target = d.seats.need(checkId(a.seat, 'seat'));
  const maker = d.seats.need(checkId(a.by, 'seat'));
  if (!occupied(maker)) reject('[invite:unseated] only a player at the table can bring someone back');
  if (maker.away === true) reject('[invite:away] a player marked away cannot bring someone back');
  if (maker.id === target.id) reject('[invite:self] a player cannot invite their own seat');
  if (!occupied(target)) reject(`[invite:empty] seat ${target.id} is empty`);
  if (target.team !== undefined && maker.team !== target.team) reject(`[invite:team] only ${target.name || target.id}'s teammate can bring them back`);
  if (a.h === null) {
    if (target.invite === undefined) reject(`[invite:none] seat ${target.id} has no open invite`);
    const w = d.seats.w(target.id);
    w.closedInvite = { h: target.invite.h, end: 'takenBack' };
    delete w.invite;
    return;
  }
  if (target.away !== true) reject(`[invite:present] seat ${target.id} is not away`);
  if (typeof a.h !== 'string' || !HASH_RE.test(a.h)) reject('[invite:hash] an invite carries a 43-character claim hash');
  if (typeof a.exp !== 'number' || !Number.isInteger(a.exp) || a.exp <= 0 || a.exp > 1e15) reject('[invite:exp] an invite needs a whole expiry time');
  const w = d.seats.w(target.id);
  if (target.invite !== undefined) w.closedInvite = { h: target.invite.h, end: 'takenBack' };
  w.invite = { h: a.h, by: maker.id, atSeq: a.seq ?? d.base.seq + 1, exp: a.exp };
}

/** `seatClaim {seat, claim, peer, name}` (persistence.md section 7). */
export function seatClaim(d: Draft, a: ActionOf<'seatClaim'>): void {
  const seat = d.seats.need(checkId(a.seat, 'seat'));
  if (a.by !== seat.id) reject('[claim:by] a claim is sent as the seat it claims');
  const peer = checkId(a.peer, 'peer');
  const name = checkString(a.name, 'name', 64);
  if (name.trim() === '') reject('[claim:name] a seat needs a name');
  if (typeof a.claim !== 'string' || !TOKEN_RE.test(a.claim)) reject('[claim:wrong] this link is not valid for this seat');
  for (const s of d.seats.values()) if (s.peer === peer) reject(`[claim:seated] this browser already holds seat ${s.id}`);
  const h = claimHashOf(seat.id, a.claim);
  const open = seat.invite;
  if (open !== undefined && open.h === h) {
    const w = d.seats.w(seat.id);
    w.peer = peer;
    w.name = name;
    delete w.away;
    delete w.invite;
    w.closedInvite = { h, end: 'used' };
    w.takeovers = (seat.takeovers ?? 0) + 1;
    return;
  }
  const closed = seat.closedInvite;
  if (closed !== undefined && closed.h === h) {
    if (closed.end === 'used') reject('[claim:used] this link was already used');
    if (closed.end === 'takenBack') reject('[claim:takenBack] this link was taken back');
    reject(`[claim:void] ${seat.name || seat.id} came back from their own browser; this link no longer works`);
  }
  if (!occupied(seat)) reject(`[claim:empty] seat ${seat.id} is empty`);
  if (seat.away !== true) reject(`[claim:present] ${seat.name || seat.id} is at the table`);
  if (open !== undefined) reject('[claim:wrong] this link is not valid for this seat');
  reject(`[claim:noInvite] seat ${seat.id} has no open invite`);
}

/** `playOn {without}` (persistence.md section 5; contracts.md Part G item 4). An empty list applies. */
export function playOn(d: Draft, a: ActionOf<'playOn'>): void {
  const me = d.seats.need(checkId(a.by, 'seat'));
  if (!occupied(me)) reject('only a player at the table can play on');
  if (!Array.isArray(a.without) || a.without.length > 4) reject('play on names at most four seats');
  const named = new Set<string>();
  for (const id of a.without as unknown[]) {
    const seat = d.seats.need(checkId(id, 'seat'));
    if (named.has(seat.id)) reject(`seat ${seat.id} is named twice`);
    named.add(seat.id);
    if (seat.id === me.id) reject('a player cannot play on without their own seat');
    if (!occupied(seat)) reject(`seat ${seat.id} is empty`);
    if (seat.away === true) reject(`seat ${seat.id} is already away`);
  }
  for (const id of named) {
    d.seats.w(id).away = true;
    onPresence(d, id, false);
  }
}

/**
 * Called by `away`, `seatLeave` (core/reducer/table.ts) and `playOn` after they changed a seat's presence
 * (contracts.md Part D): an open invite is void when the seat's own browser returns or the chair is emptied.
 */
export function onPresence(d: Draft, seat: SeatId, _present: boolean): void {
  const s = d.seats.get(seat);
  if (s?.invite === undefined) return;
  const w = d.seats.w(seat);
  w.closedInvite = { h: s.invite.h, end: 'void' };
  delete w.invite;
}

/** The open invite of a seat, if any (for the session and the seat menu). */
export function openInvite(state: TableState, seat: SeatId): { h: string; by: SeatId; atSeq: number; exp: number } | null {
  return state.seats[seat]?.invite ?? null;
}
