/**
 * Seat re-invite links and claims (persistence.md section 7; contracts.md Part G "Rejoin"). Implementer: M8-P5.
 *
 * A link is `<base>#/t/<room>/<key>/rejoin/<seat>/<claim>`: the room id and key as in every game link, the seat id and
 * a 16-byte random claim token (base64url, 22 characters). Nothing else: no name, state or card data. Only the token's
 * hash enters the shared log (`seatInvite.h`), so every peer checks a claim the same way in the pure reducer.
 */
import { claimHashOf, claimRefusal, type ClaimRefusal } from '../core/reducer/rejoin';
import type { SeatId } from '../core/types';

export { INVITE_AWAY_MS, INVITE_TTL_MS } from '../net/engine';

/** The claim hash of a token (persistence.md section 7: base64url(SHA-256('spellplane-claim|' + seat + '|' + claim))). */
export function claimHash(seat: SeatId, claim: string): string {
  return claimHashOf(seat, claim);
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh claim token: 16 random bytes, base64url (22 characters). */
export function newClaimToken(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return base64url(random(16));
}

/** The re-invite link of a seat (persistence.md section 7): `<base>#/t/<room>/<key>/rejoin/<seat>/<claim>`. */
export function rejoinLink(base: string, roomId: string, roomKey: string, seat: SeatId, claim: string): string {
  return `${base}#/t/${roomId}/${roomKey}/rejoin/${seat}/${claim}`;
}

/** The parts of a re-invite link's hash, or null when `hash` is not one. */
export function parseRejoinHash(hash: string): { room: string; key: string; seat: SeatId; token: string } | null {
  const m = /^#?\/t\/([A-Za-z0-9-]{1,64})\/([A-Za-z0-9_-]{22})\/rejoin\/(s[0-3])\/([A-Za-z0-9_-]{16,64})\/?$/.exec(hash);
  if (!m) return null;
  return { room: m[1]!, key: m[2]!, seat: m[3]!, token: m[4]! };
}

/** What the claim page says for a refusal (persistence.md section 7; journey.md 4.11). */
export interface ClaimScreen {
  kind: ClaimRefusal | 'otherSeat' | 'noTable';
  title: string;
  text: string;
}

/** The refusal screen for a reason from the reducer or the sequencer. */
export function claimScreen(reason: string, seatName: string): ClaimScreen {
  const kind = claimRefusal(reason);
  const name = seatName || 'this player';
  switch (kind) {
    case 'used':
    case 'takenBack':
    case 'void':
      return { kind, title: 'Link already used', text: 'This link was already used. Ask for a new one.' };
    case 'expired':
      return { kind, title: 'Link expired', text: 'This link has expired. Ask for a new one.' };
    case 'otherDevice':
      return { kind, title: `${name} is still here`, text: `${name} is still connected from another browser. Close the game there first, or ask for a new link later.` };
    case 'present':
      return { kind, title: `${name} is at the table`, text: `${name} is at the table, so this link cannot be used. Ask for a new one if you need it.` };
    case 'seated':
      return { kind, title: 'You already have a seat', text: 'This browser already holds a seat at this table.' };
    case 'wrong':
    case 'noInvite':
      return { kind, title: 'Link not valid', text: 'This link is not valid for this seat. Ask for a new one.' };
    default:
      return { kind, title: 'Could not sit down', text: reason.replace(/^\[[^\]]*\]\s*/, '') };
  }
}
