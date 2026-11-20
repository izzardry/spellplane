/**
 * Seat re-invite links and claims (persistence.md section 7). Stub by M8-C with the link format; M8-P5 owns the file.
 */
import type { SeatId } from '../core/types';

/** The claim hash of a token (persistence.md section 7: base64url(SHA-256('spellplane-claim|' + seat + '|' + claim))). M8-P5 implements it. */
export function claimHash(_seat: SeatId, _claim: string): string {
  throw new Error('not implemented: M8-P5');
}

/** The re-invite link of a seat (persistence.md section 7): `<base>#/t/<room>/<key>/rejoin/<seat>/<claim>`. */
export function rejoinLink(base: string, roomId: string, roomKey: string, seat: SeatId, claim: string): string {
  return `${base}#/t/${roomId}/${roomKey}/rejoin/${seat}/${claim}`;
}
