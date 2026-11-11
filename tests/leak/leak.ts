/**
 * The shared leak scanner for two browsers (PLAN M1-P2 leak test; CLAUDE.md: any code touching hidden information
 * adds its scenario to the shared leak test). M1-P2 runs it over a scripted game on LoopbackNetwork
 * (tests/sim/secrecy/leak.test.ts); M1-P8 runs the same scanner over real networked sessions.
 *
 * Given what the observing browser B holds or received (`observed`: every delivered message, its TableState, its
 * SecretStore, its IndexedDB records) and the owner A's final state and secret store, it reports:
 *
 * - forbidden tokens anywhere: the Scryfall id of any A card that is not public and was never disclosed to B, the salt
 *   of any such card (with an id and the salt B could test every printing against the commitment), every owner and
 *   reorder nonce of A's audit records (with the public peer nonces they give the library order), and the salt of
 *   every identity a re-issue retired that was never disclosed;
 * - forbidden pairs close together (within two levels of one object): an A card's current opaque id next to its
 *   Scryfall id (the instance-to-card mapping) unless A disclosed exactly that card to B, and a re-issued card's old id
 *   next to its new id (which would let B link a card's hidden history to a later reveal).
 *
 * `disclosed` lists what A deliberately showed B (public reveals and flips, targeted reveals, look answers); the
 * caller takes it from A's side, never from B's observations, so a leak cannot whitelist itself.
 */
import { secretTokens } from '../../src/core/secrets';
import type { InstanceId, SecretStore, TableState } from '../../src/core/types';
import { scan, type LeakHit } from './scan';

/** One identity A showed B on purpose, under the instance id it had then. */
export interface Disclosure {
  instanceId: InstanceId;
  sid: string;
  salt: string;
  /**
   * Set once the card went back into a hidden zone after the disclosure: B may remember the identity, but must not be
   * able to tell which hidden card it is any more (DESIGN "Table model", Hidden cards).
   */
  lapsed?: boolean;
}

export interface LeakScanInput {
  /** Everything B could have seen. */
  observed: readonly unknown[];
  /** A's final shared state and secret store. */
  owner: { state: TableState; secrets: SecretStore };
  /** What A deliberately disclosed to B. */
  disclosed: readonly Disclosure[];
}

/** A pair of strings that must never appear close together in what B holds. */
export interface LeakPairHit {
  index: number;
  path: string;
  pair: [string, string];
  why: 'mapping' | 'relink';
}

export interface LeakReport {
  tokens: LeakHit[];
  pairs: LeakPairHit[];
}

/** Arrays longer than this are id lists (zone ids, commitments), not records: their elements do not pair. */
const MAX_PAIRING_ARRAY = 4;

/** The strings of a node within two levels (its own key included), skipping the elements of long arrays. */
function near(node: unknown, key: string | null): Set<string> {
  const out = new Set<string>();
  if (key !== null) out.add(key);
  const add = (v: unknown, depth: number): void => {
    if (depth > 2) return;
    if (typeof v === 'string') return void out.add(v);
    if (typeof v !== 'object' || v === null) return;
    if (Array.isArray(v)) {
      if (v.length > MAX_PAIRING_ARRAY) return;
      for (const x of v) add(x, depth + 1);
      return;
    }
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      add(x, depth + 1);
    }
  };
  if (typeof node === 'object' && node !== null && !Array.isArray(node)) {
    for (const [k, x] of Object.entries(node)) {
      out.add(k);
      add(x, 1);
    }
  } else if (Array.isArray(node) && node.length <= MAX_PAIRING_ARRAY) {
    for (const x of node) add(x, 1);
  }
  return out;
}

/** Every object node of `values` where both strings of a pair appear within two levels. */
export function scanPairs(values: readonly unknown[], pairs: readonly { pair: [string, string]; why: LeakPairHit['why'] }[]): LeakPairHit[] {
  // One hit per value and pair: the innermost node (nodes are visited outside in, so later ones win).
  const hits = new Map<string, LeakPairHit>();
  if (pairs.length === 0) return [];
  const byFirst = new Map<string, { pair: [string, string]; why: LeakPairHit['why'] }[]>();
  for (const p of pairs) byFirst.set(p.pair[0], [...(byFirst.get(p.pair[0]) ?? []), p]);
  const seen = new WeakSet<object>();
  const walk = (index: number, path: string, v: unknown, key: string | null): void => {
    if (typeof v !== 'object' || v === null || seen.has(v)) return;
    seen.add(v);
    const strings = near(v, key);
    for (const s of strings) {
      for (const p of byFirst.get(s) ?? []) {
        if (!strings.has(p.pair[1])) continue;
        hits.set(`${index}|${p.pair.join('|')}`, { index, path, pair: p.pair, why: p.why });
      }
    }
    if (Array.isArray(v)) v.forEach((x, i) => walk(index, `${path}[${i}]`, x, null));
    else for (const [k, x] of Object.entries(v)) walk(index, `${path}.${k}`, x, k);
  };
  values.forEach((v, i) => walk(i, '$', v, null));
  return [...hits.values()];
}

/** Whether an own card of A is public in `state` (public zone, identity shown). */
function isPublic(state: TableState, id: InstanceId): boolean {
  const c = state.cards[id];
  return c !== undefined && c.identity !== undefined && state.zones[c.zone]?.visibility === 'public';
}

/** The forbidden tokens and pairs for B given A's final state and secrets and what A disclosed (see the module comment). */
export function forbiddenFor(input: Omit<LeakScanInput, 'observed'>): { tokens: string[]; pairs: { pair: [string, string]; why: LeakPairHit['why'] }[] } {
  const { state, secrets } = input.owner;
  const sids = new Set(input.disclosed.map((d) => d.sid));
  const salts = new Set(input.disclosed.map((d) => d.salt));
  const disclosedIds = new Set(input.disclosed.filter((d) => d.lapsed !== true).map((d) => d.instanceId));
  const tokens = secretTokens(state, secrets).filter((t) => !sids.has(t) && !salts.has(t));
  for (const r of secrets.audit) {
    if (!r.reissue) continue;
    for (const s of Object.values(r.reissue.retired)) if (!salts.has(s.salt)) tokens.push(s.salt);
  }
  const pairs: { pair: [string, string]; why: LeakPairHit['why'] }[] = [];
  for (const [id, s] of Object.entries(secrets.identities)) {
    if (isPublic(state, id) || disclosedIds.has(id)) continue;
    pairs.push({ pair: [id, s.card.sid], why: 'mapping' });
  }
  for (const r of secrets.audit) {
    if (!r.reissue) continue;
    r.reissue.before.forEach((old, i) => pairs.push({ pair: [old, r.order[i]!], why: 'relink' }));
  }
  return { tokens: [...new Set(tokens)], pairs };
}

/** Scan everything B holds for what it must not know about A's hidden cards. Both lists are empty when nothing leaked. */
export function leakScan(input: LeakScanInput): LeakReport {
  const f = forbiddenFor(input);
  return { tokens: scan(input.observed, f.tokens), pairs: scanPairs(input.observed, f.pairs) };
}
