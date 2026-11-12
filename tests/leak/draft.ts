/**
 * The hidden-pack scenarios of the shared leak test (CLAUDE.md: any code touching hidden information adds its scenario
 * to the shared leak test; PLAN M2-P2: "no peer's messages contain a pack it did not hold at that pick"; DESIGN
 * "Pre-game", Hidden information: booster draft "a pack is visible only to its current holder", sealed "own pool
 * only"). Used by tests/sim/draft/pass/leak.test.ts over pass drafts and sealed pools on LoopbackNetwork.
 *
 * Given every card every seat generated (from the owners' own records) and the cards observer B may know (its own
 * packs, and each pack's remaining cards at each of B's turns at it, derived by the caller from the public log and
 * the owners' pools), it reports any trace of another card in what B holds or received: its salt, its Scryfall id
 * (unless B legitimately knows a card of that printing), its opaque id next to its Scryfall id, and the owner nonce
 * of any other seat's pack seed.
 */
import type { RevealedCard } from '../../src/core/commit';
import { scanPairs, type LeakPairHit } from './leak';
import { scan, type LeakHit } from './scan';

export interface PackLeakInput {
  /** Everything B could have seen (received messages, its shared state and log, its secret store, its view). */
  observed: readonly unknown[];
  /** Every card some other seat generated (opened or not). */
  others: readonly RevealedCard[];
  /** The owner nonces of the other seats' pack seeds. */
  nonces: readonly string[];
  /** Instance ids B may know (own packs, and the remaining cards of each pack at each of B's turns). */
  allowed: ReadonlySet<string>;
  /** Every card B may know, own ones included (for the printings B legitimately knows). */
  known: readonly RevealedCard[];
}

export interface PackLeakReport {
  tokens: LeakHit[];
  pairs: LeakPairHit[];
  /** How many cards were forbidden (a scenario where B may know everything proves nothing). */
  forbidden: number;
}

/** Scan what B holds for another seat's pack cards it never held (see the module comment). */
export function packLeakScan(input: PackLeakInput): PackLeakReport {
  const knownSids = new Set(input.known.map((c) => c.ref.sid));
  const hidden = input.others.filter((c) => !input.allowed.has(c.instanceId));
  const tokens = [...hidden.flatMap((c) => [c.salt, ...(knownSids.has(c.ref.sid) ? [] : [c.ref.sid])]), ...input.nonces];
  const pairs = hidden.map((c) => ({ pair: [c.instanceId, c.ref.sid] as [string, string], why: 'mapping' as const }));
  return { tokens: scan(input.observed, tokens), pairs: scanPairs(input.observed, pairs), forbidden: hidden.length };
}
