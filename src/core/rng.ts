/**
 * Joint randomness without a trusted party (DESIGN "Specification: network protocol and secrecy", Public randomness
 * and Secret shuffle; "Multiplayer architecture", Hidden information 3). Seed and order derivation are pure and
 * deterministic so the post-game audit can replay them; the random nonces themselves are drawn outside core
 * (session/secrecy.ts). Contracts: M1-C (moved the shuffle derivation from session/secrecy.ts, M0-P7).
 * Implementer of the stubs: M1-P2.
 */
import type { Deadline, InstanceId, RngId, SeatId, TableState } from './types';
import { sha256Sync, sha256TextBytes } from './sha256';

/** Peers commit (rngCommit) or send their shuffle nonce within 3 s; later ones are excluded (DESIGN "Specification: network protocol and secrecy", Public randomness 2, Secret shuffle 2). */
export const COMMIT_WINDOW_MS = 3000;

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

/**
 * The public-randomness seed (DESIGN "Public randomness" 4): `SHA-256(nonces concatenated in seat order)`, base64url.
 * `seatOrder` lists the participating seats by seat index; a seat without a reveal is skipped.
 */
export function rngSeed(reveals: Readonly<Record<SeatId, string>>, seatOrder: readonly SeatId[]): string {
  return sha256Sync(seatOrder.flatMap((s) => (Object.hasOwn(reveals, s) ? [reveals[s]!] : [])).join(''));
}

/** The 0-based outcome in [0, n) drawn from a seed's byte stream by rejection sampling, so there is no modulo bias (DESIGN "Public randomness" 4). */
export function rngOutcome(seed: string, n: number): number {
  return new ByteStream(seed).below(n);
}

/**
 * The seats a randomness round or shuffle waits for: every other connected (not away) seated seat at the round's
 * start (DESIGN "Public randomness" 2, "Secret shuffle" 2). Implementer: M1-P2 (the stub returns none).
 */
export function expectedParticipants(_state: TableState, _id: RngId): SeatId[] {
  return [];
}

/**
 * Commit windows the sequencer's clock closes (DESIGN "Public randomness" 2, "Secret shuffle" 2): for each open
 * rngCommit or shuffleCommit round, `COMMIT_WINDOW_MS` after its start the sequencer proposes `commitClose`.
 * Implementer: M1-P2 (the stub returns none, so no window ever closes by time).
 */
export function commitWindowDeadlines(_state: TableState): Deadline[] {
  return [];
}
