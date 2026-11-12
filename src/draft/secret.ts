/**
 * The private side of the hidden-pack formats: pass draft, Pick-Two and sealed (DESIGN "Specification: network
 * protocol and secrecy", Draft packs: "Pack contents are generated with the secret-shuffle seed protocol (purpose
 * `pack`), so only the generating player knows them. The generator publishes commitments for the pack's cards").
 * Implementer: M2-P2. Shared by draft/pass.ts and draft/sealed.ts.
 *
 * Everything here lives in the own SecretStore (`SecretStore.draft`, persisted with the log), so a reload keeps it:
 * - `held[packId]`: the cards of every pack this browser holds (queued, being picked from, or picked from and not
 *   passed yet), in pack order;
 * - `held[POOL_KEY]`: the own picks with their ids and salts, in pick order (`SecretStore.pool` holds their refs);
 * - `held[SENT_PREFIX + packId]`: a pack as this browser handed it on, kept until the receiver passed it on in turn,
 *   so a hand-over lost with a reload or an outage can be sent again when the receiver asks;
 * - `generated`: the audit record of every pack this browser generated (seed nonces and cards), written before its
 *   `packOpen` is proposed, so a reload between the two opens the same pack instead of a new one.
 */
import { shuffleReady, shuffleSeed } from '../core/rng';
import type { RevealedCard } from '../core/commit';
import type { CardRef, DraftSecrets, PackId, PackRecord, SecretStore, SetCode, TableState } from '../core/types';
import { draftSecretsOf, generateOwnPack, OPEN_POOL, OPEN_SEEN, packOpenDraft, WINSTON_SEEN } from './open';
import type { DraftHost, PackSeed } from './types';

/** `DraftSecrets.held` key of the own picks of a hidden-pack format, with ids and salts, in pick order. */
export const POOL_KEY = 'pool:hidden';
/** `DraftSecrets.held` key prefix of a pack as this browser handed it on (kept for a re-send). */
export const SENT_PREFIX = 'sent:';

/**
 * Whether `key` can name a held pack: not the pool, a handed-on copy or one of the open formats' keys (draft/open.ts).
 * A pack whose id is one of those is never held, so another drafter cannot overwrite them by naming a pack so.
 */
export function isPackKey(key: string): boolean {
  return key !== POOL_KEY && !key.startsWith(SENT_PREFIX) && key !== OPEN_POOL && key !== OPEN_SEEN && key !== WINSTON_SEEN;
}

export function plainRef(r: CardRef): CardRef {
  return r.foil === true ? { sid: r.sid, foil: true } : { sid: r.sid };
}

export function plainCard(c: RevealedCard): RevealedCard {
  return { instanceId: c.instanceId, ref: plainRef(c.ref), salt: c.salt };
}

/** Replace the own draft secrets through `f` (and the pool refs, when `f` returns them). */
export function updateSecrets(host: DraftHost, f: (ds: DraftSecrets, s: SecretStore) => { draft: DraftSecrets; pool?: CardRef[] }): void {
  const s = host.secrets();
  const out = f(draftSecretsOf(s), s);
  host.setSecrets({ ...s, draft: out.draft, ...(out.pool !== undefined ? { pool: out.pool } : {}) });
}

/** The own picks with ids (POOL_KEY). */
export function poolCards(s: SecretStore): RevealedCard[] {
  return draftSecretsOf(s).held[POOL_KEY] ?? [];
}

/** Append `cards` to the own pool (refs to `SecretStore.pool`, the cards with ids to POOL_KEY), skipping any already in it. */
export function addToPool(ds: DraftSecrets, s: SecretStore, cards: readonly RevealedCard[]): { draft: DraftSecrets; pool: CardRef[] } {
  const mine = ds.held[POOL_KEY] ?? [];
  const have = new Set(mine.map((c) => c.instanceId));
  const add = cards.filter((c) => !have.has(c.instanceId)).map(plainCard);
  return {
    draft: { ...ds, held: { ...ds.held, [POOL_KEY]: [...mine, ...add] } },
    pool: [...(s.pool ?? []), ...add.map((c) => c.ref)],
  };
}

/** Keep the audit record of a generated pack, and (`hold`) its cards as a held pack. */
export function recordGenerated(host: DraftHost, record: PackRecord, hold: boolean): void {
  updateSecrets(host, (ds) => ({
    draft: {
      ...ds,
      held: hold ? { ...ds.held, [record.packId]: record.cards.map(plainCard) } : ds.held,
      generated: [...ds.generated.filter((g) => g.packId !== record.packId), { ...record, cards: record.cards.map(plainCard), peerNonces: [...record.peerNonces] }],
    },
  }));
}

/** The seed of a generated pack's record. */
export function seedOf(r: PackRecord): PackSeed {
  return { sid: r.sid, seed: shuffleSeed(r.ownerNonce, r.peerNonces), ownerNonce: r.ownerNonce, peerNonces: [...r.peerNonces] };
}

/**
 * A pack this browser generated for set `set` whose `packOpen` is not in `state` yet and whose seed round can still
 * back it (the opener's latest pack-seed round, sealed, newer than its last opened pack; core/reducer/pass.ts): a
 * reload between generating and opening opens that pack, not a new one. Null when there is none.
 */
export function unopenedGenerated(host: DraftHost, state: TableState, set: SetCode): PackRecord | null {
  const d = state.draft;
  if (!d) return null;
  const me = host.seat;
  let latest: { id: string; startSeq: number } | null = null;
  for (const r of Object.values(state.shuffles)) {
    if (r.purpose === 'pack' && r.owner === me && (latest === null || r.startSeq > latest.startSeq)) latest = { id: r.id, startSeq: r.startSeq };
  }
  if (latest === null) return null;
  const round = state.shuffles[latest.id]!;
  if (round.orderHash === null && !shuffleReady(state, latest.id)) return null;
  if (Object.values(d.packs).some((p) => p.opener === me && p.commitment.atSeq >= latest.startSeq)) return null;
  const record = draftSecretsOf(host.secrets()).generated.find((g) => g.sid === latest.id && !Object.hasOwn(d.packs, g.packId));
  return record !== undefined && record.set === set ? record : null;
}

/**
 * Open the own pack number `number` of set `set` face down: the unopened generated one when there is one (unless
 * `reuse` is false), else a new one from a fresh pack seed. The record (and, with `hold`, the cards as a held pack) is
 * saved before the `packOpen` is proposed. `still()` is asked again after the seed round, which takes a while; when
 * it no longer holds, nothing is proposed. Resolves with the opened pack id, or null.
 */
export async function openHiddenPack(host: DraftHost, number: number, set: SetCode, hold: boolean, reuse: boolean, still: () => boolean): Promise<PackId | null> {
  const old = reuse ? unopenedGenerated(host, host.confirmedState?.() ?? host.state(), set) : null;
  let record: PackRecord;
  if (old !== null) {
    record = old;
  } else {
    const pack = await generateOwnPack(host, set);
    record = { packId: pack.packId, sid: pack.seed.sid, ownerNonce: pack.seed.ownerNonce, peerNonces: [...pack.seed.peerNonces], set, cards: pack.cards };
  }
  if (!still()) {
    // Keep the audit record of a generated pack even if it is not opened now; it can still be opened after a reload.
    if (old === null) recordGenerated(host, record, false);
    return null;
  }
  recordGenerated(host, record, hold);
  host.dispatch(packOpenDraft(record.packId, record.cards, seedOf(record), number, set, 'down'));
  return record.packId;
}
