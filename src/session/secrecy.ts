/**
 * The owner's private effects (DESIGN "Specification: network protocol and secrecy": Commitments, Secret shuffle,
 * private reorder; "Multiplayer architecture", Hidden information). Pure apart from `crypto.getRandomValues`, and only
 * in the functions named `random*`; everything else is deterministic so the post-game audit can replay it.
 */
import { base64url } from '../core/hash';

/** `n` cryptographically random bytes. */
export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

/** A commitment salt or a shuffle nonce: 16 random bytes, base64url (DESIGN "Commitments"). */
export function randomSalt(): string {
  return base64url(randomBytes(16));
}

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuv';

/**
 * A random opaque id: `prefix` plus 16 base-32 characters (80 bits). Instance ids are never derived from a card's
 * identity (core/types.ts InstanceId), so they carry nothing about the card.
 */
export function randomId(prefix: string): string {
  const bytes = randomBytes(16);
  let s = prefix;
  for (const b of bytes) s += ID_ALPHABET[b & 31];
  return s;
}

// The deterministic parts moved to core (M1-C): commitments to core/commit.ts, shuffle derivation to core/rng.ts.
export { commitFor } from '../core/commit';
export { ByteStream, orderHash, shuffledOrder, shuffleSeed } from '../core/rng';
