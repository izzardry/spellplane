/**
 * The owner's private effects (DESIGN "Specification: network protocol and secrecy": Commitments, Secret shuffle,
 * private reorder; "Multiplayer architecture", Hidden information). Pure apart from `crypto.getRandomValues`, and only
 * in the functions named `random*`; everything else is deterministic so the post-game audit can replay it.
 */
import { base64url } from '../core/hash';
import type { CardRef, InstanceId } from '../core/types';
import { sha256Sync, sha256TextBytes } from './sha256';

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

/** `commit = base64url(SHA-256(instanceId + '|' + sid + '|' + (foil ? 'f' : 'n') + '|' + salt))` (DESIGN "Commitments"). */
export function commitFor(instanceId: InstanceId, ref: CardRef, salt: string): string {
  return sha256Sync(`${instanceId}|${ref.sid}|${ref.foil ? 'f' : 'n'}|${salt}`);
}

/**
 * The secret-shuffle seed (DESIGN "Secret shuffle" 3): `SHA-256(ownerNonce + peer nonces in seat order)`, base64url.
 * Solo play has no peers, so the seed is `SHA-256(ownerNonce)`.
 */
export function shuffleSeed(ownerNonce: string, peerNonces: readonly string[]): string {
  return sha256Sync(ownerNonce + peerNonces.join(''));
}

/** The deterministic byte stream `SHA-256(seed + counter)`, counter 0, 1, 2, … in decimal (DESIGN "Secret shuffle" 4). */
export class ByteStream {
  private block: Uint8Array = new Uint8Array(0);
  private pos = 0;
  private counter = 0;

  constructor(private readonly seed: string) {}

  next(): number {
    if (this.pos >= this.block.length) {
      this.block = sha256TextBytes(this.seed + String(this.counter++));
      this.pos = 0;
    }
    return this.block[this.pos++]!;
  }

  /** Uniform integer in [0, n) by rejection sampling on 32-bit draws, so there is no modulo bias. */
  below(n: number): number {
    if (!Number.isInteger(n) || n < 1 || n > 0x100000000) throw new RangeError(`below(${n})`);
    const limit = Math.floor(0x100000000 / n) * n;
    for (;;) {
      const x = ((this.next() << 24) | (this.next() << 16) | (this.next() << 8) | this.next()) >>> 0;
      if (x < limit) return x % n;
    }
  }
}

/**
 * The shuffled order (index 0 = top) of a zone's ids (DESIGN "Secret shuffle" 4): sort the ids lexicographically,
 * then Fisher–Yates from the last position down, each swap partner drawn from the seed's byte stream.
 */
export function shuffledOrder(ids: readonly InstanceId[], seed: string): InstanceId[] {
  const order = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const stream = new ByteStream(seed);
  for (let i = order.length - 1; i > 0; i--) {
    const j = stream.below(i + 1);
    const t = order[i]!;
    order[i] = order[j]!;
    order[j] = t;
  }
  return order;
}

/** `orderHash = SHA-256(order joined by ',' + '|' + nonce)` (DESIGN "Secret shuffle" 5; private reorder). */
export function orderHash(order: readonly InstanceId[], nonce: string): string {
  return sha256Sync(`${order.join(',')}|${nonce}`);
}
