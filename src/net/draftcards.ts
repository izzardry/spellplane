/**
 * The `draftCards` pair message (DESIGN "Pre-game: draft, sealed and deck building", Hidden information column:
 * Winston "pile contents visible to whoever looks"; "Specification: network protocol and secrecy", prv: one pair
 * only). Implementer: M2-P3; the Two-Headed Giant team packs (M3-P2) can reuse it.
 *
 * Draft card identities go to one named seat only, through the engine's `sendPrivate` (never a broadcast). Received
 * messages are shape-checked here and handed on with the sender's seat; checking them against the pack commitments in
 * shared state is the draft driver's job (draft/winston.ts), since only it knows which pack and pile they belong to.
 */
import type { RevealedCard } from '../core/commit';
import type { CardRef, SeatId } from '../core/types';
import type { DraftCardsMessage, PrivateMessage } from './messages';
import { PROTOCOL_VERSION } from './messages';
import type { NetEngine, Unsubscribe } from './types';

/** The part of a NetEngine the channel uses (tests drive it with a minimal engine). */
export type DraftCardsHost = Pick<NetEngine, 'seat' | 'sendPrivate' | 'onPrivate'>;

/** Most cards one message may carry (a whole Winston stack is under 100). */
export const MAX_DRAFT_CARDS = 500;
const MAX_TEXT = 256;

export interface DraftCardsChannel {
  /** Send `cards` to the peer holding seat `to` only; false when that seat has no connected peer or is this browser. */
  send(to: SeatId, about: string, cards: readonly RevealedCard[]): boolean;
  /** Well-formed `draftCards` from a seated peer, with its seat. */
  on(listener: (about: string, cards: RevealedCard[], from: SeatId) => void): Unsubscribe;
}

function isText(v: unknown, max = MAX_TEXT): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

/** A plain copy of a well-formed RevealedCard, or null. */
function asCard(v: unknown): RevealedCard | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const ref = o.ref;
  if (!isText(o.instanceId, 128) || !isText(o.salt) || typeof ref !== 'object' || ref === null || Array.isArray(ref)) return null;
  const r = ref as Record<string, unknown>;
  if (!isText(r.sid, 128) || (r.foil !== undefined && r.foil !== true)) return null;
  const card: CardRef = r.foil === true ? { sid: r.sid, foil: true } : { sid: r.sid };
  return { instanceId: o.instanceId, ref: card, salt: o.salt };
}

/** The cards of an untrusted `draftCards` payload, or null when any is malformed or there are too many. */
export function asDraftCards(msg: unknown): { about: string; cards: RevealedCard[] } | null {
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return null;
  const m = msg as Record<string, unknown>;
  if (m.t !== 'draftCards' || !isText(m.about) || !Array.isArray(m.cards) || m.cards.length > MAX_DRAFT_CARDS) return null;
  const cards: RevealedCard[] = [];
  for (const c of m.cards) {
    const card = asCard(c);
    if (card === null) return null;
    cards.push(card);
  }
  return { about: m.about, cards };
}

/** The `draftCards` channel over an engine's pair channel. */
export function draftCardsOver(host: DraftCardsHost): DraftCardsChannel {
  return {
    send(to, about, cards) {
      const me = host.seat();
      if (to === me || !isText(about) || cards.length > MAX_DRAFT_CARDS) return false;
      const plain: RevealedCard[] = [];
      for (const c of cards) {
        const card = asCard(c);
        if (card === null) throw new Error('malformed draft card');
        plain.push(card);
      }
      const msg: DraftCardsMessage = { v: PROTOCOL_VERSION, t: 'draftCards', about, cards: plain };
      return host.sendPrivate(to, msg);
    },
    on(listener) {
      return host.onPrivate((msg: PrivateMessage, from) => {
        if (msg.t !== 'draftCards' || from.seat === null || from.seat === host.seat()) return;
        const parsed = asDraftCards(msg);
        if (parsed === null) return;
        listener(parsed.about, parsed.cards, from.seat);
      });
    },
  };
}
