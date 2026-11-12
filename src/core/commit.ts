/**
 * Commitments: salted hashes of card identities and hashes of secret nonces (DESIGN "Specification: network protocol
 * and secrecy", Commitments, Public randomness 1, Secret shuffle 1; "Multiplayer architecture", Hidden information
 * 1-2). Pure and synchronous (core/sha256.ts), so the reducer and every peer can verify a reveal the same way.
 * Contracts: M1-C (moved `commitFor` from session/secrecy.ts, M0-P7); M1-P2 uses them for Ready, reveals and the
 * shuffle and randomness protocols.
 */
import type { CardRef, Commitment, InstanceId } from './types';
import { sha256Sync } from './sha256';

/** A card identity with its salt as it is revealed: publicly (`reveal` action) or on a pair channel (DESIGN "Specification: network protocol and secrecy", Commitments). A type alias, so wire messages built from it stay assignable to transport's Message. */
export type RevealedCard = {
  instanceId: InstanceId;
  ref: CardRef;
  /** 16 random bytes, base64url. */
  salt: string;
};

/** `commit = base64url(SHA-256(instanceId + '|' + sid + '|' + (foil ? 'f' : 'n') + '|' + salt))` (DESIGN "Specification: network protocol and secrecy", Commitments). */
export function commitFor(instanceId: InstanceId, ref: CardRef, salt: string): string {
  return sha256Sync(`${instanceId}|${ref.sid}|${ref.foil ? 'f' : 'n'}|${salt}`);
}

/**
 * The commitments a seat publishes on Ready, sorted (DESIGN "Specification: network protocol and secrecy",
 * Commitments: "in random order"; salted hashes sorted say nothing about ids or deck order, DECISIONS M0-P7).
 */
export function makeCommitments(cards: readonly RevealedCard[]): string[] {
  return cards.map((c) => commitFor(c.instanceId, c.ref, c.salt)).sort();
}

/**
 * Whether a revealed identity matches one of its owner's published commitments (DESIGN "Specification: network
 * protocol and secrecy", Commitments: a mismatch is a table-wide integrity warning and the card stays suspect).
 * The instance must be one of the commitment's public ids and its salted hash one of the commits.
 */
export function verifyReveal(commitment: Commitment, card: RevealedCard): boolean {
  return commitment.instanceIds.includes(card.instanceId) && commitment.commits.includes(commitFor(card.instanceId, card.ref, card.salt));
}

/** `h = SHA-256(nonce)`, base64url: the commit of a secret nonce (DESIGN "Specification: network protocol and secrecy", Public randomness 1, Secret shuffle 1). */
export function nonceHash(nonce: string): string {
  return sha256Sync(nonce);
}

/**
 * Whether `nonce` opens the commit `h` (DESIGN "Specification: network protocol and secrecy", Public randomness 3:
 * the owner cannot change its nonce after the peers' nonces arrived).
 */
export function verifyNonce(h: string, nonce: string): boolean {
  return nonceHash(nonce) === h;
}
