/**
 * Joint randomness without a trusted party (DESIGN "Specification: network protocol and secrecy", Public randomness
 * and Secret shuffle; "Multiplayer architecture", Hidden information 3). Seed and order derivation are pure and
 * deterministic so the post-game audit can replay them; the random nonces themselves are drawn outside core
 * (session/secrecy.ts). Contracts: M1-C (moved the shuffle derivation from session/secrecy.ts, M0-P7).
 * Implementer of the stubs: M1-P2.
 */
import type { Deadline, InstanceId, RngId, SeatId, ShuffleId, TableState } from './types';
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

/**
 * The seed that orders the fresh ids of a re-issuing shuffle: `SHA-256(seed + '|reissue')`. It is independent of the
 * permutation of the old ids, so peers cannot pair old and new ids by rank, yet anyone holding the owner nonce can
 * replay both (PLAN M1-P2: the order is reproducible from public messages plus the owner's nonce). Decision M1-P2.
 */
export function reissueSeed(seed: string): string {
  return sha256Sync(`${seed}|reissue`);
}

/**
 * The outcome of a secret shuffle (DESIGN "Secret shuffle" 4): `before` is the zone's current ids shuffled by the
 * seed (index 0 = top), so `before[i]` is the card that lands at position i; with re-issued ids, `order` is the fresh
 * ids shuffled by `reissueSeed(seed)` and labels those positions, else `order` equals `before`.
 */
export function shuffleOutcome(seed: string, ids: readonly InstanceId[], freshIds?: readonly InstanceId[]): { before: InstanceId[]; order: InstanceId[] } {
  const before = shuffledOrder(ids, seed);
  if (freshIds === undefined) return { before, order: before };
  if (freshIds.length !== ids.length) throw new RangeError('a re-issue needs one fresh id per card');
  return { before, order: shuffledOrder(freshIds, reissueSeed(seed)) };
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

/** Seats in seat-index order (ties by id), the order nonces are concatenated in (DESIGN "Public randomness" 4, "Secret shuffle" 3). */
export function participantOrder(state: TableState, seats: readonly SeatId[]): SeatId[] {
  const index = (s: SeatId): number => (Object.hasOwn(state.seats, s) ? state.seats[s]!.index : Number.MAX_SAFE_INTEGER);
  return [...new Set(seats)].sort((a, b) => index(a) - index(b) || (a < b ? -1 : a > b ? 1 : 0));
}

/** A seat that takes part in joint randomness: taken (named) and not away (DESIGN "Public randomness" 2: connected seated peers). */
function seated(state: TableState, seat: SeatId): boolean {
  if (!Object.hasOwn(state.seats, seat)) return false;
  const s = state.seats[seat]!;
  return s.name.trim() !== '' && s.away !== true;
}

/**
 * The seats a randomness round or shuffle waits for: every other connected (not away) seated seat (DESIGN "Public
 * randomness" 2, "Secret shuffle" 2), in seat order. "Other" is relative to the round's initiator (rng) or the zone's
 * owner (shuffle). Evaluated on the current state, so a seat that goes away is no longer waited for. Empty for an
 * unknown id or a finished round; a closed window waits for nobody.
 */
export function expectedParticipants(state: TableState, id: RngId): SeatId[] {
  const r = Object.hasOwn(state.rng, id) ? state.rng[id]! : null;
  const sh = Object.hasOwn(state.shuffles, id) ? state.shuffles[id]! : null;
  const by = r ? r.by : sh ? sh.owner : null;
  if (by === null) return [];
  return participantOrder(
    state,
    Object.keys(state.seats).filter((s) => s !== by && seated(state, s)),
  );
}

/** Whether a secret shuffle may finish: every expected peer nonce arrived, or the window closed (DESIGN "Secret shuffle" 2-3). */
export function shuffleReady(state: TableState, sid: ShuffleId): boolean {
  if (!Object.hasOwn(state.shuffles, sid)) return false;
  const r = state.shuffles[sid]!;
  if (r.orderHash !== null) return false;
  if (r.closedSeq !== undefined) return true;
  return expectedParticipants(state, sid).every((s) => Object.hasOwn(r.nonces, s));
}

/** The peer nonces of a shuffle in seat order, as the seed concatenates them (DESIGN "Secret shuffle" 3). */
export function shufflePeerNonces(state: TableState, sid: ShuffleId): string[] {
  if (!Object.hasOwn(state.shuffles, sid)) return [];
  const r = state.shuffles[sid]!;
  return participantOrder(state, Object.keys(r.nonces)).map((s) => r.nonces[s]!);
}

/** Whether every commit of a randomness round is in: all expected seats committed, or the window closed (DESIGN "Public randomness" 3). */
export function rngCommitPhaseComplete(state: TableState, rid: RngId): boolean {
  if (!Object.hasOwn(state.rng, rid)) return false;
  const r = state.rng[rid]!;
  if (r.closedSeq !== undefined) return true;
  return expectedParticipants(state, rid).every((s) => Object.hasOwn(r.commits, s));
}

/**
 * Commit windows the sequencer's clock closes (DESIGN "Public randomness" 2, "Secret shuffle" 2): for each
 * randomness round still waiting for commits and each shuffle still waiting for peer nonces, `COMMIT_WINDOW_MS`
 * after the round's start the sequencer proposes `commitClose`. A round that has everything it waits for yields no
 * deadline, so its timer is disarmed.
 */
export function commitWindowDeadlines(state: TableState): Deadline[] {
  const out: Deadline[] = [];
  for (const rid of Object.keys(state.rng).sort()) {
    const r = state.rng[rid]!;
    if (r.result !== null || r.closedSeq !== undefined || rngCommitPhaseComplete(state, rid)) continue;
    out.push({ key: `rng:${rid}`, fromSeq: r.startSeq, afterMs: COMMIT_WINDOW_MS, emit: [{ type: 'commitClose', kind: 'rng', id: rid }] });
  }
  for (const sid of Object.keys(state.shuffles).sort()) {
    const r = state.shuffles[sid]!;
    if (r.orderHash !== null || r.closedSeq !== undefined || shuffleReady(state, sid)) continue;
    out.push({ key: `shuffle:${sid}`, fromSeq: r.startSeq, afterMs: COMMIT_WINDOW_MS, emit: [{ type: 'commitClose', kind: 'shuffle', id: sid }] });
  }
  return out;
}
