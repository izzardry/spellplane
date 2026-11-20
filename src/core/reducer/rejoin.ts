/**
 * Rejoin actions (persistence.md sections 5 and 7; contracts.md Part D and Part G "Rejoin"): `seatInvite`, `seatClaim`,
 * `playOn` and the presence hook. Registered by M8-C; until M8-P5 fills this file each action is refused with a reason
 * and the state is left unchanged. `seatInvite` is refused for good at a matched table (`settings.matched`).
 */
import type { ActionOf } from '../actions';
import type { SeatId } from '../types';
import type { Draft } from './draft';
import { reject } from './util';

/** `seatInvite {seat, h, exp?}` (persistence.md section 7). M8-P5 implements the rules; refused until then. */
export function seatInvite(d: Draft, _a: ActionOf<'seatInvite'>): void {
  if (d.settings.matched === true) reject('a matched game takes no seat invites');
  reject('not implemented: M8-P5 (seat invites)');
}

/** `seatClaim {seat, claim, peer, name}` (persistence.md section 7). M8-P5 implements the rules; refused until then. */
export function seatClaim(_d: Draft, _a: ActionOf<'seatClaim'>): void {
  reject('not implemented: M8-P5 (seat claims)');
}

/** `playOn {without}` (persistence.md section 5; contracts.md Part G item 4). M8-P5 implements it; refused until then. M8-P5 calls onPresence for each seat it marks away. */
export function playOn(_d: Draft, _a: ActionOf<'playOn'>): void {
  reject('not implemented: M8-P5 (play on without)');
}

/**
 * Called by `away`, `seatLeave` (core/reducer/table.ts) and `playOn` after they changed a seat's presence
 * (contracts.md Part D). M8-P5 fills it: an open invite is cleared when the seat's own browser returns or the chair is
 * emptied. M8-C's stub changes nothing.
 */
export function onPresence(_d: Draft, _seat: SeatId, _present: boolean): void {
  // M8-P5: delete Seat.invite here (persistence.md section 7: "away {away: false} and seatLeave also delete an open invite").
}
