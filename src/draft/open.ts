/**
 * What the open-format drivers share (draft/rochester.ts, draft/winston.ts, draft/grid.ts; DESIGN "Specification: card
 * data, packs and draft formats", Draft formats; "Specification: network protocol and secrecy", Draft packs).
 * Implementer: M2-P3.
 *
 * - Pack generation: every pack comes from a fresh pack seed (`DraftHost.packSeed`, the secret-shuffle seed protocol
 *   with purpose 'pack'), whose byte stream drives `generatePack` and, for a grid, the shuffle that picks its nine
 *   cards, so the audit can replay it from the PackRecord. The instance ids are drawn from the same stream after the
 *   pack (core/open.ts `seededCardId`), so the opener cannot choose them (they order the Winston stack); salts come
 *   from the host's entropy. Neither is derived from a card's identity.
 * - The pool: shared state lists the ids each drafter took (`DraftState.taken`); the driver adds the matching
 *   identities to the own `SecretStore.pool` in pick order, once each (tracked by id in `DraftSecrets.held[OPEN_POOL]`),
 *   so a reload or a repeated call never adds a card twice. A taken card whose identity is not known yet (a Winston
 *   disclosure still on its way) holds back every later one, so the pool never leaves pick order.
 */
import { makeCommitments, verifyReveal, type RevealedCard } from '../core/commit';
import { seededCardId } from '../core/open';
import { ByteStream } from '../core/rng';
import type { ActionDraft } from '../core/actions';
import type { CardRef, DraftCard, DraftSecrets, DraftState, InstanceId, PackId, PackRecord, SecretStore, SetCode, TableState } from '../core/types';
import type { DraftHost, DraftPrivateView, PackSeed } from './types';

/** `DraftSecrets.held` key of the own picks of an open format (with ids, in pick order). */
export const OPEN_POOL = 'open:pool';
/** `DraftSecrets.held` key of the Winston identities the dealer showed this (non-dealer) browser. */
export const WINSTON_SEEN = 'winston:seen';

/** The own draft secrets, empty when there are none yet. */
export function draftSecretsOf(s: SecretStore): DraftSecrets {
  return s.draft ?? { held: {}, generated: [], marked: [] };
}

/** Replace the own draft secrets through `f`. */
export function updateDraftSecrets(host: DraftHost, f: (ds: DraftSecrets, s: SecretStore) => DraftSecrets): void {
  const s = host.secrets();
  host.setSecrets({ ...s, draft: f(draftSecretsOf(s), s) });
}

function plainRef(r: CardRef): CardRef {
  return r.foil === true ? { sid: r.sid, foil: true } : { sid: r.sid };
}

/** A generated pack: its seed, its cards in pack order with fresh ids and salts, and the seed's stream after generation. */
export interface OwnPack {
  packId: PackId;
  seed: PackSeed;
  set: SetCode;
  cards: RevealedCard[];
  stream: ByteStream;
}

/** Generate one pack of `set` from a fresh pack seed (see the module comment). Throws when the set has no booster data. */
export async function generateOwnPack(host: DraftHost, set: SetCode): Promise<OwnPack> {
  const data = host.sets.peek(set) ?? (await host.sets.get(set));
  if (data === null) throw new Error(`no booster data for ${set}`);
  const seed = await host.packSeed();
  const stream = new ByteStream(seed.seed);
  const generated = host.generatePack(data, stream);
  const cards = generated.cards.map((c) => ({ instanceId: seededCardId(stream), ref: plainRef(c.ref), salt: host.entropy.salt() }));
  return { packId: `pk-${seed.sid}`, seed, set, cards, stream };
}

/** Keep the audit record and the own copy of a generated pack (DraftSecrets.generated and held). */
export function keepGenerated(host: DraftHost, pack: OwnPack, held: readonly RevealedCard[] = pack.cards): void {
  const record: PackRecord = {
    packId: pack.packId,
    sid: pack.seed.sid,
    ownerNonce: pack.seed.ownerNonce,
    peerNonces: [...pack.seed.peerNonces],
    set: pack.set,
    cards: pack.cards.map((c) => ({ ...c })),
  };
  updateDraftSecrets(host, (ds) => ({
    ...ds,
    held: { ...ds.held, [pack.packId]: held.map((c) => ({ ...c })) },
    generated: [...ds.generated.filter((g) => g.packId !== pack.packId), record],
  }));
}

/** The `packOpen` of `cards` (commitments and ids sorted; face up with the cards when `face` is 'up'). */
export function packOpenDraft(packId: PackId, cards: readonly RevealedCard[], seed: PackSeed, number: number, set: SetCode, face: 'up' | 'down'): ActionDraft {
  return {
    type: 'packOpen',
    packId,
    commits: makeCommitments(cards),
    count: cards.length,
    instanceIds: cards.map((c) => c.instanceId).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    sid: seed.sid,
    number,
    set,
    ...(face === 'up' ? { public: true, cards: cards.map((c) => ({ ...c })) } : {}),
  };
}

/**
 * The face-down `packOpen` of a Winston pack: its sorted commitments and no ids, so shared state never ties a stack
 * card to its pack. The dealing (last) pack passes `stack`, the ids of every pack's cards, listed sorted (the reducer
 * deals them; DECISIONS [M2-P3]).
 */
export function winstonOpenDraft(packId: PackId, cards: readonly RevealedCard[], seed: PackSeed, number: number, set: SetCode, stack: readonly InstanceId[] | null): ActionDraft {
  return {
    type: 'packOpen',
    packId,
    commits: makeCommitments(cards),
    count: cards.length,
    ...(stack !== null ? { instanceIds: [...stack].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)) } : {}),
    sid: seed.sid,
    number,
    set,
  };
}

/** Shuffle `items` with the stream (Fisher–Yates from the last position down). */
export function shuffleWith<T>(items: readonly T[], stream: ByteStream): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = stream.below(i + 1);
    const t = out[i]!;
    out[i] = out[j]!;
    out[j] = t;
  }
  return out;
}

/** Every identity this browser holds for the draft: own and remembered packs (held), by instance id. */
export function heldIdentities(s: SecretStore): Map<InstanceId, RevealedCard> {
  const out = new Map<InstanceId, RevealedCard>();
  for (const list of Object.values(draftSecretsOf(s).held)) for (const c of list) if (!out.has(c.instanceId)) out.set(c.instanceId, c);
  return out;
}

/** Face-up cards of the shared state (Rochester packs, grid cells) as identities without a salt (only the ref is needed for the pool). */
export function publicIdentities(state: TableState): Map<InstanceId, RevealedCard> {
  const out = new Map<InstanceId, RevealedCard>();
  const add = (c: DraftCard | null | undefined): void => {
    if (c) out.set(c.id, { instanceId: c.id, ref: c.ref, salt: '' });
  };
  const d = state.draft;
  if (!d) return out;
  for (const p of Object.values(d.packs)) for (const c of p.cards ?? []) add(c);
  for (const c of d.grid?.cells ?? []) add(c);
  return out;
}

/** The identity of a card this browser saw face up: remembered packs first, then the table (Rochester, Grid). */
export function faceUpIdentity(host: DraftHost, state: TableState): (id: InstanceId) => RevealedCard | null {
  const held = heldIdentities(host.secrets());
  const table = publicIdentities(state);
  return (id) => held.get(id) ?? table.get(id) ?? null;
}

/** Whether `c` has the shape of a revealed card (a refused action's cards are unchecked). */
function isRevealedCard(c: unknown): c is RevealedCard {
  if (typeof c !== 'object' || c === null) return false;
  const r = c as { instanceId?: unknown; salt?: unknown; ref?: unknown };
  if (typeof r.instanceId !== 'string' || typeof r.salt !== 'string' || typeof r.ref !== 'object' || r.ref === null) return false;
  const ref = r.ref as { sid?: unknown; foil?: unknown };
  return typeof ref.sid === 'string' && (ref.foil === undefined || typeof ref.foil === 'boolean');
}

/**
 * Remember the face-up cards of a sequenced public `packOpen` (salts included) so the pool can name them after they
 * left the table. A sequenced action may still have been refused, so only cards that open the commitments of the pack
 * of that id in the confirmed `state`, opened by the action's sender, are kept, and only once they cover the whole
 * pack: a refused `packOpen` under another pack's id never takes its place.
 */
export function rememberPublicPack(host: DraftHost, state: TableState, a: { packId: PackId; by: string; cards?: readonly unknown[] }): void {
  const pack = state.draft?.packs[a.packId];
  if (pack === undefined || pack.opener !== a.by || !Array.isArray(a.cards)) return;
  if (Object.hasOwn(draftSecretsOf(host.secrets()).held, a.packId)) return;
  const verified = new Map<InstanceId, RevealedCard>();
  for (const c of a.cards) if (isRevealedCard(c) && verifyReveal(pack.commitment, c)) verified.set(c.instanceId, c);
  if (verified.size !== pack.commitment.instanceIds.length) return;
  const cards = a.cards.filter((c): c is RevealedCard => isRevealedCard(c) && verified.get(c.instanceId) === c);
  updateDraftSecrets(host, (ds) => ({ ...ds, held: { ...ds.held, [a.packId]: cards.map((c) => ({ instanceId: c.instanceId, ref: plainRef(c.ref), salt: c.salt })) } }));
}

/** Add the own taken cards of `state` that the pool lacks, in pick order, up to the first one with no known identity (see the module comment). */
export function reconcilePool(host: DraftHost, state: TableState, identity: (id: InstanceId) => RevealedCard | null): void {
  const taken = state.draft?.taken?.[host.seat];
  if (taken === undefined || taken.length === 0) return;
  const s = host.secrets();
  const ds = draftSecretsOf(s);
  const mine = ds.held[OPEN_POOL] ?? [];
  const have = new Set(mine.map((c) => c.instanceId));
  const add: RevealedCard[] = [];
  for (const id of taken) {
    if (have.has(id)) continue;
    const c = identity(id);
    if (c === null) break;
    add.push({ instanceId: id, ref: plainRef(c.ref), salt: c.salt });
    have.add(id);
  }
  if (add.length === 0) return;
  host.setSecrets({
    ...s,
    pool: [...(s.pool ?? []), ...add.map((c) => c.ref)],
    draft: { ...ds, held: { ...ds.held, [OPEN_POOL]: [...mine, ...add] } },
  });
}

/** The running draft of `format` in `state`, or null (another format, no draft, not the draft stage). */
export function openDraftOf(state: TableState, format: 'rochester' | 'winston' | 'grid'): DraftState | null {
  const d = state.draft;
  if (!d || d.settings.format !== format || state.stage !== 'draft') return null;
  return d;
}

/** The view fields every open format shares. */
export function baseView(host: DraftHost, format: 'rochester' | 'winston' | 'grid', waitingOn: string[]): DraftPrivateView {
  const s = host.secrets();
  return {
    format,
    pack: null,
    picks: 0,
    marked: [...draftSecretsOf(s).marked],
    queued: 0,
    pool: [...(s.pool ?? [])],
    timer: null,
    waitingOn,
  };
}

/** Set the own marked cards. */
export function setMarked(host: DraftHost, cards: readonly InstanceId[]): void {
  updateDraftSecrets(host, (ds) => ({ ...ds, marked: [...cards] }));
}
