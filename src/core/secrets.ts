/**
 * Pure helpers over the owner's SecretStore (DESIGN "Data model and protocol", SecretStore; "Multiplayer
 * architecture", Hidden information: owner-held with commitments; "Specification: network protocol and secrecy",
 * Commitments, Secret shuffle, private reorder, Audit). The store itself never leaves its owner's browser; these
 * helpers only read and update it and build the public drafts that go with each private effect. Contracts: M1-C.
 * Implementer: M1-P2.
 *
 * Randomness (salts, nonces, fresh ids) comes in through an `Entropy` the caller supplies (session/secrecy.ts in the
 * app, a seeded source in tests), so everything here stays deterministic and replayable.
 */
import type { Action, ActionOf, ActionType, Reissue } from './actions';
import { commitFor, nonceHash, verifyNonce, type RevealedCard } from './commit';
import { zoneId } from './ids';
import { explain, reduce } from './reducer/index';
import { orderHash, shuffleOutcome, shufflePeerNonces, shuffleReady, shuffleSeed } from './rng';
import type {
  AuditRecord,
  CardRef,
  InstanceId,
  ReceivedIdentity,
  ReissueRecord,
  ReorderRecord,
  SecretIdentity,
  SecretStore,
  SeatId,
  ShuffleId,
  ShuffleRecord,
  TableState,
  ZoneId,
} from './types';

/** An action as the owner's client builds it, before the session stamps `by`, `cid` and `seq`. */
export type DraftOf<T extends ActionType> = Omit<ActionOf<T>, 'by' | 'cid' | 'seq'>;

/** Randomness supplied by the caller (DESIGN "Specification: code interfaces", Reducer contract: core reads none itself). */
export interface Entropy {
  /** A fresh random opaque instance id, never derived from a card's identity. */
  id(): InstanceId;
  /** 16 random bytes, base64url: a commitment salt or a nonce. */
  salt(): string;
}

/** An empty secret store for `seat` (DESIGN "Data model and protocol", SecretStore). */
export function emptySecretStore(seat: SeatId): SecretStore {
  return { seat, identities: {}, libraryOrder: [], hand: [], audit: [], received: {} };
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ---- received identities ------------------------------------------------------------------------------------------

/**
 * The store with an identity another seat revealed to this browser only (DESIGN "Multiplayer architecture",
 * Targeted reveal; "Specification: network protocol and secrecy", prv `reveal`). The caller has verified it against
 * the sender's commitment (core/commit.ts verifyReveal). Own cards and a sender's own seat are ignored.
 */
export function receiveIdentity(secrets: SecretStore, card: RevealedCard, from: SeatId): SecretStore {
  if (from === secrets.seat || Object.hasOwn(secrets.identities, card.instanceId)) return secrets;
  const prev = Object.hasOwn(secrets.received, card.instanceId) ? secrets.received[card.instanceId]! : null;
  const ref: CardRef = card.ref.foil ? { sid: card.ref.sid, foil: true } : { sid: card.ref.sid };
  if (prev && prev.from === from && prev.salt === card.salt && prev.card.sid === ref.sid && prev.card.foil === ref.foil) return secrets;
  const entry: ReceivedIdentity = { card: ref, salt: card.salt, from };
  return { ...secrets, received: { ...secrets.received, [card.instanceId]: entry } };
}

/**
 * The store without received identities this browser may no longer see (DESIGN "Table model", Hidden cards): the
 * card left the game or was re-issued (its id is gone), went into a zone nobody sees (a library), or is public now
 * (shared state carries its identity). A card revealed in its owner's hand stays known while it is there.
 */
export function pruneReceived(secrets: SecretStore, state: TableState): SecretStore {
  let out: Record<InstanceId, ReceivedIdentity> | null = null;
  for (const id of Object.keys(secrets.received)) {
    const c = Object.hasOwn(state.cards, id) ? state.cards[id]! : null;
    const zone = c && Object.hasOwn(state.zones, c.zone) ? state.zones[c.zone]! : null;
    const keep = c !== null && zone !== null && zone.visibility !== 'nobody' && c.identity === undefined;
    if (keep) continue;
    out ??= { ...secrets.received };
    delete out[id];
  }
  return out ? { ...secrets, received: out } : secrets;
}

/** An identity revealed to this browser, if any (DESIGN "Multiplayer architecture", Targeted reveal). */
export function receivedIdentity(secrets: SecretStore, id: InstanceId): ReceivedIdentity | null {
  return Object.hasOwn(secrets.received, id) ? secrets.received[id]! : null;
}

// ---- what must never leave -----------------------------------------------------------------------------------------

/** Whether an own card is public in `state`: in a public zone with its identity shown. */
function isPublicCard(state: TableState, id: InstanceId): boolean {
  if (!Object.hasOwn(state.cards, id)) return false;
  const c = state.cards[id]!;
  const z = Object.hasOwn(state.zones, c.zone) ? state.zones[c.zone]! : null;
  return z !== null && z.visibility === 'public' && c.identity !== undefined;
}

/**
 * Every string that would leak an own card that is not public in `state`: its Scryfall id (unless a public card
 * shows the same printing), its salt and every owner or reorder nonce of the audit records (PLAN M1-P2 leak test;
 * CLAUDE.md shared leak test). Feeds tests/leak/scan.ts. Identities retired by a re-issue are history: the leak test
 * adds the ones that were never revealed itself.
 */
export function secretTokens(state: TableState, secrets: SecretStore): string[] {
  const shown = new Set<string>();
  for (const c of Object.values(state.cards)) if (c.identity !== undefined) shown.add(c.identity.sid);
  const out = new Set<string>();
  for (const [id, s] of Object.entries(secrets.identities)) {
    if (isPublicCard(state, id)) continue;
    out.add(s.salt);
    if (!shown.has(s.card.sid)) out.add(s.card.sid);
  }
  for (const r of secrets.audit) out.add(r.kind === 'shuffle' ? r.ownerNonce : r.nonce);
  return [...out].sort(byId);
}

// ---- owner side: commitments --------------------------------------------------------------------------------------

/** A card of the own store as it is revealed (publicly or on a pair channel); null for a card this store does not own. */
export function revealedCard(secrets: SecretStore, id: InstanceId): RevealedCard | null {
  if (!Object.hasOwn(secrets.identities, id)) return null;
  const s = secrets.identities[id]!;
  return { instanceId: id, ref: s.card, salt: s.salt };
}

/**
 * Own ids whose identity sequenced action `a` showed to anyone but the owner (DESIGN "Table model", Hidden cards: the
 * owner re-shuffles opaque ids where needed; "Multiplayer architecture", Hidden information 2, 4, 5): a card that
 * became public (its identity is set in `next`), the card of an own `revealTo`, and the cards another seat's `lookAt`
 * covers (the peeked card, or the top `count` of the zone in the owner's order before the action). Every disclosure
 * path has a public action, so the owner's client runs this on each sequenced action, keeps the ids, and passes them
 * to `finishShuffle`; an id that is gone (re-issued, removed) needs no tracking. `secrets` is the store as it was
 * before the action. Decision M1-P2.
 */
export function disclosedBy(secrets: SecretStore, prior: TableState, a: Action, next: TableState): InstanceId[] {
  const me = secrets.seat;
  const out = new Set<InstanceId>();
  const mine = (id: InstanceId): boolean => Object.hasOwn(next.cards, id) && next.cards[id]!.owner === me;
  for (const [id, c] of Object.entries(next.cards)) {
    if (c.owner === me && c.identity !== undefined && prior.cards[id] !== c) out.add(id);
  }
  if (a.type === 'revealTo' && a.by === me && mine(a.instanceId)) out.add(a.instanceId);
  if (a.type === 'lookAt' && a.by !== me) {
    if (a.card !== undefined) {
      if (mine(a.card)) out.add(a.card);
    } else if (Object.hasOwn(prior.zones, a.zone) && prior.zones[a.zone]!.owner === me) {
      for (const id of privateOrder(secrets, prior, a.zone).slice(0, Math.max(0, a.count))) out.add(id);
    }
  }
  return [...out].sort(byId);
}

/** What a look request asks for (net/messages.ts LookReqMessage without the envelope). */
export interface LookRequest {
  zone: ZoneId;
  count: number;
  card?: InstanceId;
}

/**
 * The owner's answer to another seat's look request (DESIGN "Multiplayer architecture", Private looks): the top
 * `count` cards of an own hidden zone in the owner's order, or exactly the peeked card when it is an own face-down
 * card in a public zone; null (refuse) for anything else. A peek never shows a hand or library card. The pair channel
 * (net/private.ts) answers only requests that match a sequenced `lookAt` of the asker and filters the answer again.
 */
export function lookAnswer(secrets: SecretStore, state: TableState, req: LookRequest): RevealedCard[] | null {
  const zone = Object.hasOwn(state.zones, req.zone) ? state.zones[req.zone]! : null;
  if (!zone) return null;
  if (req.card !== undefined) {
    const c = Object.hasOwn(state.cards, req.card) ? state.cards[req.card]! : null;
    if (!c || c.owner !== secrets.seat || c.zone !== zone.id || zone.visibility !== 'public' || c.face !== 'down' || c.identity !== undefined) return null;
    const r = revealedCard(secrets, c.id);
    return r ? [r] : null;
  }
  if (zone.visibility === 'public' || zone.owner !== secrets.seat || !Number.isInteger(req.count) || req.count < 1) return null;
  return privateOrder(secrets, state, zone.id)
    .slice(0, req.count)
    .flatMap((id) => {
      const r = revealedCard(secrets, id);
      return r ? [r] : [];
    });
}

/**
 * Commit to a deck (DESIGN "Specification: network protocol and secrecy", Commitments): every card gets a fresh
 * opaque id and salt; the `ready` draft carries the commits and the ids, both sorted, so their order says nothing
 * about the deck order. The library order is the given card order (the first shuffle randomises it).
 */
export function commitDeck(secrets: SecretStore, cards: readonly CardRef[], entropy: Entropy): { secrets: SecretStore; action: DraftOf<'ready'> } {
  const identities: Record<InstanceId, SecretIdentity> = { ...secrets.identities };
  const order: InstanceId[] = [];
  const commits: string[] = [];
  for (const card of cards) {
    const id = freshId(entropy, identities);
    const salt = entropy.salt();
    identities[id] = { card: card.foil ? { sid: card.sid, foil: true } : { sid: card.sid }, salt };
    order.push(id);
    commits.push(commitFor(id, identities[id]!.card, salt));
  }
  const zone = zoneId('library', secrets.seat);
  return {
    secrets: { ...secrets, identities, libraryOrder: [...order, ...secrets.libraryOrder] },
    action: { type: 'ready', commits: commits.sort(byId), instanceIds: [...order].sort(byId), zone },
  };
}

function freshId(entropy: Entropy, taken: Readonly<Record<InstanceId, unknown>>, also: ReadonlySet<InstanceId> = new Set()): InstanceId {
  for (let i = 0; i < 100; i++) {
    const id = entropy.id();
    if (!Object.hasOwn(taken, id) && !also.has(id)) return id;
  }
  throw new Error('the entropy source keeps repeating ids');
}

// ---- owner side: re-issue of opaque ids ---------------------------------------------------------------------------

interface Fresh {
  identities: Record<InstanceId, SecretIdentity>;
  /** old id -> new id */
  map: Map<InstanceId, InstanceId>;
  reissue: Reissue;
  retired: Record<InstanceId, SecretIdentity>;
}

/** Fresh random ids and salts for `ids` (DESIGN "Table model", Hidden cards: the owner re-shuffles opaque ids). */
function freshIdentities(secrets: SecretStore, state: TableState, ids: readonly InstanceId[], entropy: Entropy): Fresh {
  const identities = { ...secrets.identities };
  const used = new Set<InstanceId>([...Object.keys(state.cards), ...(state.commitments[secrets.seat]?.instanceIds ?? [])]);
  const map = new Map<InstanceId, InstanceId>();
  const retired: Record<InstanceId, SecretIdentity> = {};
  const commits: string[] = [];
  for (const old of ids) {
    if (!Object.hasOwn(identities, old)) throw new Error(`card ${old} is not in this secret store`);
    const prev = identities[old]!;
    const id = freshId(entropy, identities, used);
    used.add(id);
    const salt = entropy.salt();
    identities[id] = { card: prev.card, salt };
    retired[old] = prev;
    map.set(old, id);
    commits.push(commitFor(id, prev.card, salt));
  }
  for (const old of ids) delete identities[old];
  return { identities, map, retired, reissue: { ids: [...map.values()].sort(byId), commits: commits.sort(byId) } };
}

/** The private lists with `zone`'s cards replaced by `order` (library or hand), and other ids renamed by `map`. */
function withZoneOrder(secrets: SecretStore, zone: ZoneId, order: readonly InstanceId[], map?: ReadonlyMap<InstanceId, InstanceId>): Pick<SecretStore, 'libraryOrder' | 'hand'> {
  const rename = (ids: readonly InstanceId[]): InstanceId[] => (map ? ids.map((id) => map.get(id) ?? id) : [...ids]);
  return {
    libraryOrder: zone === zoneId('library', secrets.seat) ? [...order] : rename(secrets.libraryOrder),
    hand: zone === zoneId('hand', secrets.seat) ? [...order] : rename(secrets.hand),
  };
}

/** The owner's current private order of an own hidden zone: library order or hand order, else the sorted ids. */
function privateOrder(secrets: SecretStore, state: TableState, zone: ZoneId): InstanceId[] {
  const ids = Object.hasOwn(state.zones, zone) ? state.zones[zone]!.ids : [];
  const set = new Set(ids);
  const known = zone === zoneId('library', secrets.seat) ? secrets.libraryOrder : zone === zoneId('hand', secrets.seat) ? secrets.hand : [];
  const kept = known.filter((id) => set.has(id));
  const keptSet = new Set(kept);
  return [...kept, ...ids.filter((id) => !keptSet.has(id))];
}

/** Whether a hidden zone holds a suspect card: its ids are never re-issued (the reducer refuses), so the flag stays visible. */
function holdsSuspect(state: TableState, zone: ZoneId): boolean {
  const ids = Object.hasOwn(state.zones, zone) ? state.zones[zone]!.ids : [];
  return ids.some((id) => Object.hasOwn(state.cards, id) && state.cards[id]!.suspect === true);
}

/**
 * Re-issue every opaque id of an own hidden zone (DESIGN "Table model", Hidden cards): fresh random ids and salts in
 * the owner's current order, published as a `reorder` of the whole zone with `reissue` and an order hash over the new
 * ids, and an audit record keeping the old ids and identities. Use it after a public card returned to the hand or
 * library, so peers cannot link the card's later reveal to its earlier one. Null when the zone holds a suspect card
 * (its ids stay, so the table keeps seeing the flag). Decision M1-P2.
 */
export function reissueZone(secrets: SecretStore, state: TableState, zone: ZoneId, entropy: Entropy): { secrets: SecretStore; action: DraftOf<'reorder'> } | null {
  const z = Object.hasOwn(state.zones, zone) ? state.zones[zone]! : null;
  if (!z || z.visibility === 'public' || z.owner !== secrets.seat) throw new Error(`${zone} is not a hidden zone of ${secrets.seat}`);
  if (holdsSuspect(state, zone)) return null;
  const before = privateOrder(secrets, state, zone);
  const f = freshIdentities(secrets, state, before, entropy);
  const order = before.map((id) => f.map.get(id)!);
  const nonce = entropy.salt();
  const record: ReorderRecord = { kind: 'reorder', zone, count: order.length, nonce, order, reissue: { before, retired: f.retired } };
  return {
    secrets: { ...secrets, identities: f.identities, ...withZoneOrder(secrets, zone, order, f.map), audit: [...secrets.audit, record] },
    action: { type: 'reorder', zone, count: order.length, orderHash: orderHash(order, nonce), reissue: f.reissue },
  };
}

/**
 * A private reorder of an own hidden zone to `order` (scry to the bottom, put on top; DESIGN "Specification: network
 * protocol and secrecy", private reorder): public `reorder {zone, count, orderHash}` and a ReorderRecord.
 */
export function privateReorder(secrets: SecretStore, state: TableState, zone: ZoneId, order: readonly InstanceId[], count: number, entropy: Entropy): { secrets: SecretStore; action: DraftOf<'reorder'> } {
  const ids = Object.hasOwn(state.zones, zone) ? state.zones[zone]!.ids : [];
  if (order.length !== ids.length || [...order].sort(byId).some((id, i) => id !== ids[i])) throw new Error(`the order does not list the cards of ${zone}`);
  const nonce = entropy.salt();
  const record: ReorderRecord = { kind: 'reorder', zone, count, nonce, order: [...order] };
  return {
    secrets: { ...secrets, ...withZoneOrder(secrets, zone, order), audit: [...secrets.audit, record] },
    action: { type: 'reorder', zone, count, orderHash: orderHash(order, nonce) },
  };
}

// ---- owner side: the secret shuffle -------------------------------------------------------------------------------

/** The audit record of shuffle `sid`, if this store started it. */
export function shuffleRecord(secrets: SecretStore, sid: ShuffleId): ShuffleRecord | null {
  for (const r of secrets.audit) if (r.kind === 'shuffle' && r.sid === sid) return r;
  return null;
}

/**
 * Start a secret shuffle of an own hidden zone (DESIGN "Secret shuffle" 1): the draft `shuffleCommit {sid, zone, h}`
 * with `h = SHA-256(nonce)`, and a pending audit record holding the nonce, so a reload can still finish the round.
 */
export function beginShuffle(secrets: SecretStore, zone: ZoneId, sid: ShuffleId, nonce: string): { secrets: SecretStore; action: DraftOf<'shuffleCommit'> } {
  if (shuffleRecord(secrets, sid)) throw new Error(`shuffle ${sid} was started before`);
  const record: ShuffleRecord = { kind: 'shuffle', sid, zone, ownerNonce: nonce, peerNonces: [], order: [] };
  return { secrets: { ...secrets, audit: [...secrets.audit, record] }, action: { type: 'shuffleCommit', sid, zone, h: nonceHash(nonce) } };
}

/**
 * Finish shuffle `sid` once it is ready (DESIGN "Secret shuffle" 3-5): seed from the own nonce and the sequenced
 * peer nonces in seat order, Fisher–Yates over the zone's sorted ids, `shuffleDone {sid, orderHash}` and the
 * completed audit record. The ids are kept, so every later reveal is still checked live against the deck commitment
 * made at Ready. Only when the zone holds a card in `disclosed` (an id whose identity someone other than the owner
 * saw since it was issued, see `disclosedBy`) does every card get a fresh opaque id (ordered by `reissueSeed`) and
 * the action a `reissue`; a zone holding a suspect card is never re-issued. Throws when the round is not this
 * store's, not open, or still waits for nonces.
 */
export function finishShuffle(
  secrets: SecretStore,
  state: TableState,
  sid: ShuffleId,
  entropy: Entropy,
  disclosed: Iterable<InstanceId> = [],
): { secrets: SecretStore; action: DraftOf<'shuffleDone'> } {
  const rec = shuffleRecord(secrets, sid);
  const round = Object.hasOwn(state.shuffles, sid) ? state.shuffles[sid]! : null;
  if (!rec || !round || round.owner !== secrets.seat) throw new Error(`shuffle ${sid} is not this seat's`);
  if (!verifyNonce(round.h, rec.ownerNonce)) throw new Error(`the stored nonce does not open shuffle ${sid}`);
  if (!shuffleReady(state, sid)) throw new Error(`shuffle ${sid} is not ready`);
  const peerNonces = shufflePeerNonces(state, sid);
  const seed = shuffleSeed(rec.ownerNonce, peerNonces);
  const ids = Object.hasOwn(state.zones, round.zone) ? state.zones[round.zone]!.ids : [];
  const shown = new Set(disclosed);
  if (!ids.some((id) => shown.has(id)) || holdsSuspect(state, round.zone)) {
    const order = shuffleOutcome(seed, ids).order;
    const done: ShuffleRecord = { kind: 'shuffle', sid, zone: round.zone, ownerNonce: rec.ownerNonce, peerNonces, order };
    return {
      secrets: { ...secrets, ...withZoneOrder(secrets, round.zone, order), audit: secrets.audit.map((r) => (r === rec ? done : r)) },
      action: { type: 'shuffleDone', sid, orderHash: orderHash(order, rec.ownerNonce) },
    };
  }
  const f = freshIdentities(secrets, state, ids, entropy);
  const { before, order } = shuffleOutcome(seed, ids, f.reissue.ids);
  const reissue: ReissueRecord = { before, retired: f.retired };
  const done: ShuffleRecord = { kind: 'shuffle', sid, zone: round.zone, ownerNonce: rec.ownerNonce, peerNonces, order, reissue };
  // The card at position i is the one whose old id the seed put there.
  const placed = new Map<InstanceId, InstanceId>();
  before.forEach((old, i) => placed.set(old, order[i]!));
  const identities = { ...f.identities };
  before.forEach((old, i) => {
    // freshIdentities paired ids arbitrarily; re-pair so that order[i] carries before[i]'s identity.
    identities[order[i]!] = { card: f.retired[old]!.card, salt: identities[order[i]!]!.salt };
  });
  const commits = order.map((id) => commitFor(id, identities[id]!.card, identities[id]!.salt)).sort(byId);
  return {
    secrets: {
      ...secrets,
      identities,
      ...withZoneOrder(secrets, round.zone, order, placed),
      audit: secrets.audit.map((r) => (r === rec ? done : r)),
    },
    action: { type: 'shuffleDone', sid, orderHash: orderHash(order, rec.ownerNonce), reissue: { ids: f.reissue.ids, commits } },
  };
}

// ---- audit ----------------------------------------------------------------------------------------------------------

/** One finding of the post-game audit (DESIGN "Multiplayer architecture", Audit). */
export interface AuditFinding {
  seq: number;
  text: string;
}

/**
 * The post-game audit of one seat (DESIGN "Multiplayer architecture", Audit; "Specification: network protocol and
 * secrecy": the audit replays every record against the public log and checks that each drawn id was on top). Replays
 * `log` (sequenced actions after `start`) through the reducer with the seat's published records and identities (its
 * final `identities`; retired ones come from the records). Checks every shuffle (the nonce opens its commit, the
 * peer nonces are the sequenced ones, the order follows from the seed), every reorder's order hash, that a re-issue
 * kept every card's identity and commitment, and that every draw took the top card of the replayed library. Before
 * the first shuffle the library order was never committed, so draws are not checked there. Empty when all is well.
 */
export function auditSeat(
  start: TableState,
  log: readonly Action[],
  seat: SeatId,
  audit: readonly AuditRecord[],
  identities: Readonly<Record<InstanceId, SecretIdentity>>,
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const lib = zoneId('library', seat);
  const known = new Map<InstanceId, SecretIdentity>(Object.entries(identities));
  for (const r of audit) if (r.reissue) for (const [id, s] of Object.entries(r.reissue.retired)) known.set(id, s);
  const reorders = audit.filter((r): r is ReorderRecord => r.kind === 'reorder');
  const usedReorders = new Set<ReorderRecord>();
  // A record is found by its zone and order hash, not by position: a record of a refused proposal is skipped.
  const reorderRecord = (zone: ZoneId, hash: string): ReorderRecord | undefined =>
    reorders.find((r) => !usedReorders.has(r) && r.zone === zone && orderHash(r.order, r.nonce) === hash) ?? reorders.find((r) => !usedReorders.has(r) && r.zone === zone);
  let order: InstanceId[] | null = null;
  let s = start;

  const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
  const checkReissue = (seq: number, before: readonly InstanceId[], after: readonly InstanceId[], prior: TableState, next: TableState): void => {
    const was = prior.commitments[seat];
    const now = next.commitments[seat];
    before.forEach((old, i) => {
      const a = known.get(old);
      const b = known.get(after[i]!);
      if (!a || !b) return void findings.push({ seq, text: `no identity published for ${a ? after[i] : old}` });
      if (a.card.sid !== b.card.sid || a.card.foil !== b.card.foil) findings.push({ seq, text: `re-issue changed the identity of ${old}` });
      if (was && !was.commits.includes(commitFor(old, a.card, a.salt))) findings.push({ seq, text: `${old} does not match its commitment` });
      if (!now || !now.commits.includes(commitFor(after[i]!, b.card, b.salt))) findings.push({ seq, text: `${after[i]} does not match its commitment` });
    });
  };

  for (const a of log) {
    const seq = a.seq ?? s.seq + 1;
    const prior = s;
    // A refused entry changes nothing in the replay either.
    if (explain(prior, a) !== null) continue;
    s = reduce(prior, a);
    const mine = a.by === seat;
    if (mine && a.type === 'shuffleDone') {
      const round = prior.shuffles[a.sid];
      const rec = audit.find((r): r is ShuffleRecord => r.kind === 'shuffle' && r.sid === a.sid);
      if (!round || !rec) {
        findings.push({ seq, text: `no record for shuffle ${a.sid}` });
        order = null;
        continue;
      }
      if (!verifyNonce(round.h, rec.ownerNonce)) findings.push({ seq, text: `the owner nonce of shuffle ${a.sid} does not open its commit` });
      const peers = shufflePeerNonces(prior, a.sid);
      if (!sameList(peers, rec.peerNonces)) findings.push({ seq, text: `shuffle ${a.sid} used other peer nonces than the sequenced ones` });
      const ids = prior.zones[round.zone]?.ids ?? [];
      const out = shuffleOutcome(shuffleSeed(rec.ownerNonce, peers), ids, a.reissue?.ids);
      if (!sameList(out.order, rec.order)) findings.push({ seq, text: `shuffle ${a.sid} does not follow from its seed` });
      if (orderHash(out.order, rec.ownerNonce) !== a.orderHash) findings.push({ seq, text: `shuffle ${a.sid} published another order hash` });
      if (a.reissue) checkReissue(seq, out.before, out.order, prior, s);
      if (round.zone === lib) order = [...out.order];
      continue;
    }
    if (mine && a.type === 'reorder') {
      const rec = reorderRecord(a.zone, a.orderHash);
      if (rec) usedReorders.add(rec);
      if (!rec) {
        findings.push({ seq, text: `no record for the reorder of ${a.zone}` });
        if (a.zone === lib) order = null;
        continue;
      }
      if (orderHash(rec.order, rec.nonce) !== a.orderHash) findings.push({ seq, text: `the reorder of ${a.zone} published another order hash` });
      if (!sameList([...rec.order].sort(byId), s.zones[a.zone]?.ids ?? [])) findings.push({ seq, text: `the reorder of ${a.zone} does not list its cards` });
      if (a.reissue) {
        if (!rec.reissue) findings.push({ seq, text: `the re-issue of ${a.zone} has no record` });
        else checkReissue(seq, rec.reissue.before, rec.order, prior, s);
      }
      if (a.zone === lib) order = [...rec.order];
      continue;
    }
    if (a.type === 'draw' && prior.cards[a.instanceId]?.zone === lib && order !== null) {
      if (order[0] !== a.instanceId) findings.push({ seq, text: `draw of ${a.instanceId} was not the top card` });
    }
    if (order !== null) order = followLibrary(order, prior, s, a, lib);
  }
  return findings;
}

/** The replayed library order after a public action: leavers drop out, arrivals go where the action put them. */
function followLibrary(order: InstanceId[], prior: TableState, next: TableState, a: Action, lib: ZoneId): InstanceId[] | null {
  const now = new Set(next.zones[lib]?.ids ?? []);
  const was = new Set(prior.zones[lib]?.ids ?? []);
  const kept = order.filter((id) => now.has(id));
  const arrived = [...now].filter((id) => !was.has(id));
  if (arrived.length === 0) return kept;
  if (a.type === 'toZone' && arrived.length === 1 && arrived[0] === a.card) {
    if (a.position === 'top') return [a.card, ...kept];
    if (a.position === 'bottom') return [...kept, a.card];
  }
  // A mulligan or an unplaced arrival: the order is unknown until the next shuffle or reorder.
  return null;
}
