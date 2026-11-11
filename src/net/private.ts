/**
 * The pair channel for hidden information (DESIGN "Multiplayer architecture", Hidden information 4-5;
 * "Specification: network protocol and secrecy", prv). Contracts: M1-C (net/types.ts PrivateChannel).
 * Implementer: M1-P2.
 *
 * Every identity goes to the named seats only, one `prv` message per seat through the engine's `sendPrivate`
 * (addressed to the one peer holding that seat; the WebRTC connection of that pair encrypts it). Nothing here ever
 * broadcasts. Only the own seat's cards are sent: an identity another seat showed this browser is never forwarded.
 * Every received identity is checked against its owner's deck commitment in the shared state; one that does not
 * match is reported as unverified, never as genuine.
 */
import { verifyReveal, type RevealedCard } from '../core/commit';
import type { CardRef, InstanceId, PackId, SeatId, ZoneId } from '../core/types';
import type { LookMessage, LookReqMessage, PackMessage, PrivateMessage, RevealMessage } from './messages';
import { PROTOCOL_VERSION } from './messages';
import type { CreatePrivateChannel, NetEngine, PrivateChannel, Unsubscribe } from './types';

/** The part of a NetEngine the pair channel uses (so tests can drive it with a minimal engine). */
export type PrivateChannelHost = Pick<NetEngine, 'state' | 'onState' | 'onSequenced' | 'seat' | 'sendPrivate' | 'onPrivate' | 'peers' | 'onPeers'>;

/** Most cards one look answer or pack may carry. */
const MAX_CARDS = 500;
const MAX_TEXT = 256;
/** Most identities held back until the shared state knows their cards; the oldest is dropped as unverified beyond it. */
const MAX_WAITING = 1000;
/** How many recently sequenced action ids are remembered for targeted reveals that arrive late. */
const MAX_REMEMBERED_CIDS = 5000;

function isText(v: unknown, max = MAX_TEXT): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

/** A well-formed RevealedCard copied out of an untrusted message, or null. */
function asRevealedCard(v: unknown): RevealedCard | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const ref = o.ref;
  if (!isText(o.instanceId, 128) || !isText(o.salt) || typeof ref !== 'object' || ref === null || Array.isArray(ref)) return null;
  const r = ref as Record<string, unknown>;
  if (!isText(r.sid, 128) || (r.foil !== undefined && r.foil !== true)) return null;
  const card: CardRef = r.foil === true ? { sid: r.sid, foil: true } : { sid: r.sid };
  return { instanceId: o.instanceId, ref: card, salt: o.salt };
}

function asCardList(v: unknown): RevealedCard[] | null {
  if (!Array.isArray(v) || v.length > MAX_CARDS) return null;
  const out: RevealedCard[] = [];
  for (const x of v) {
    const c = asRevealedCard(x);
    if (!c) return null;
    out.push(c);
  }
  return out;
}

function plainCard(c: RevealedCard): RevealedCard {
  return { instanceId: c.instanceId, ref: c.ref.foil ? { sid: c.ref.sid, foil: true } : { sid: c.ref.sid }, salt: c.salt };
}

/** The pair-channel layer over any host with the engine's private-message and state members. */
export function privateChannelOver(host: PrivateChannelHost): PrivateChannel {
  const identityListeners = new Set<(card: RevealedCard, from: SeatId, verified: boolean) => void>();
  const packListeners = new Set<(packId: PackId, cards: RevealedCard[], from: SeatId) => void>();
  let answerer: ((req: LookReqMessage, from: SeatId) => RevealedCard[] | null) | null = null;
  const pending = new Map<string, { owner: SeatId; resolve: (cards: RevealedCard[]) => void }>();
  let lookCounter = 0;

  /**
   * Whether `card` opens the commitment of `from`, who must own it (DESIGN "Specification: network protocol and
   * secrecy", Commitments); null while the shared state has not caught up with the card yet (the pair channel and the
   * sequenced log travel separately, so an identity can arrive before the action that created its opaque id).
   */
  const verify = (card: RevealedCard, from: SeatId): boolean | null => {
    const st = host.state();
    const c = Object.hasOwn(st.cards, card.instanceId) ? st.cards[card.instanceId]! : null;
    const commitment = Object.hasOwn(st.commitments, from) ? st.commitments[from]! : null;
    if (c === null) return null;
    return c.owner === from && commitment !== null && verifyReveal(commitment, card);
  };

  /** Identities waiting for the shared state to know their card, oldest first. */
  let waiting: { card: RevealedCard; from: SeatId; done: (ok: boolean) => void }[] = [];

  /** Verify now, or once the state knows the card; then tell the identity listeners. */
  const decide = (card: RevealedCard, from: SeatId, done: (ok: boolean) => void = () => undefined): void => {
    const ok = verify(card, from);
    if (ok === null) {
      if (waiting.length >= MAX_WAITING) waiting.shift()!.done(false);
      waiting.push({ card, from, done });
      return;
    }
    for (const l of [...identityListeners]) l(card, from, ok);
    done(ok);
  };

  host.onState(() => {
    if (waiting.length === 0) return;
    const ready = waiting.filter((w) => verify(w.card, w.from) !== null);
    if (ready.length === 0) return;
    waiting = waiting.filter((w) => !ready.includes(w));
    for (const w of ready) decide(w.card, w.from, w.done);
  });

  /** Only own cards leave this browser (an identity received from another seat is never forwarded). */
  const ownCards = (cards: readonly RevealedCard[]): RevealedCard[] => {
    const me = host.seat();
    const st = host.state();
    if (me === null) throw new Error('an unseated browser has no cards to reveal');
    return cards.map((c) => {
      const card = Object.hasOwn(st.cards, c.instanceId) ? st.cards[c.instanceId]! : null;
      if (!card || card.owner !== me) throw new Error(`card ${c.instanceId} is not ${me}'s to reveal`);
      return plainCard(c);
    });
  };

  const targets = (to: readonly SeatId[]): SeatId[] => {
    const me = host.seat();
    return [...new Set(to)].filter((s) => s !== me && Object.hasOwn(host.state().seats, s));
  };

  const ownerConnected = (owner: SeatId): boolean => host.peers().some((p) => p.seat === owner && p.status === 'connected');

  const settle = (lookId: string, cards: RevealedCard[]): void => {
    const p = pending.get(lookId);
    if (!p) return;
    pending.delete(lookId);
    p.resolve(cards);
  };

  // A targeted reveal is taken once its public `revealTo` (cid `about`) is applied here, so the card is where that
  // action saw it (the pair channel can overtake the sequenced log).
  const sequencedCids = new Set<string>();
  const cidOrder: string[] = [];
  const afterAction = new Map<string, (() => void)[]>();
  host.onSequenced((action) => {
    sequencedCids.add(action.cid);
    cidOrder.push(action.cid);
    if (cidOrder.length > MAX_REMEMBERED_CIDS) sequencedCids.delete(cidOrder.shift()!);
    const run = afterAction.get(action.cid);
    if (!run) return;
    afterAction.delete(action.cid);
    for (const f of run) f();
  });

  const onReveal = (msg: RevealMessage, from: SeatId): void => {
    const card = asRevealedCard(msg);
    if (!card || (msg.purpose !== 'revealTo' && msg.purpose !== 'look') || !isText(msg.about, 128)) return;
    if (msg.purpose === 'look' || sequencedCids.has(msg.about)) return decide(card, from);
    if (afterAction.size >= MAX_WAITING && !afterAction.has(msg.about)) return;
    afterAction.set(msg.about, [...(afterAction.get(msg.about) ?? []), () => decide(card, from)]);
  };

  const onLookReq = (msg: LookReqMessage, from: SeatId): void => {
    if (!isText(msg.lookId, 128)) return;
    const me = host.seat();
    const st = host.state();
    const zone = Object.hasOwn(st.zones, msg.zone) ? st.zones[msg.zone]! : null;
    const card = msg.card !== undefined && Object.hasOwn(st.cards, msg.card) ? st.cards[msg.card]! : null;
    // Only the owner of the zone (or of the peeked card) answers, and only with its own cards.
    const mine = me !== null && (msg.card !== undefined ? card !== null && card.owner === me : zone !== null && zone.owner === me);
    let cards: RevealedCard[] | null = null;
    if (mine && answerer) {
      try {
        cards = answerer(msg, from);
      } catch {
        cards = null;
      }
    }
    const safe = cards === null ? null : cards.filter((c) => Object.hasOwn(st.cards, c.instanceId) && st.cards[c.instanceId]!.owner === me).map(plainCard);
    const answer: LookMessage = safe === null ? { v: PROTOCOL_VERSION, t: 'look', lookId: msg.lookId, cards: [], refused: true } : { v: PROTOCOL_VERSION, t: 'look', lookId: msg.lookId, cards: safe };
    host.sendPrivate(from, answer);
  };

  const onLook = (msg: LookMessage, from: SeatId): void => {
    if (!isText(msg.lookId, 128)) return;
    const p = pending.get(msg.lookId);
    if (!p || p.owner !== from) return;
    const cards = msg.refused === true ? [] : asCardList(msg.cards);
    if (cards === null) return settle(msg.lookId, []);
    // Resolve once every card is decided, with the verified ones in the owner's order.
    const verdicts: (boolean | undefined)[] = cards.map(() => undefined);
    const finish = (): void => {
      if (verdicts.every((v) => v !== undefined)) settle(msg.lookId, cards.filter((_, i) => verdicts[i]));
    };
    if (cards.length === 0) return finish();
    cards.forEach((c, i) =>
      decide(c, from, (ok) => {
        verdicts[i] = ok;
        finish();
      }),
    );
  };

  const onPack = (msg: PackMessage, from: SeatId): void => {
    const cards = asCardList(msg.cards);
    if (!isText(msg.packId, 128) || !cards) return;
    for (const l of [...packListeners]) l(msg.packId, cards, from);
  };

  host.onPrivate((msg: PrivateMessage, sender) => {
    const from = sender.seat;
    if (from === null || from === host.seat()) return;
    switch (msg.t) {
      case 'reveal':
        return onReveal(msg, from);
      case 'lookReq':
        return onLookReq(msg, from);
      case 'look':
        return onLook(msg, from);
      case 'pack':
        return onPack(msg, from);
      default:
        // teamHand (M3-P2) and nonce (not sent in M1) have no handler yet.
        return;
    }
  });

  host.onPeers(() => {
    for (const [lookId, p] of [...pending]) if (!ownerConnected(p.owner)) settle(lookId, []);
  });

  return {
    reveal(to, cards, purpose, about) {
      const list = ownCards(cards);
      for (const seat of targets(to)) {
        for (const c of list) {
          const msg: RevealMessage = { v: PROTOCOL_VERSION, t: 'reveal', ...c, purpose, about };
          host.sendPrivate(seat, msg);
        }
      }
    },

    requestLook(owner: SeatId, zone: ZoneId, count: number, card?: InstanceId): Promise<RevealedCard[]> {
      if (owner === host.seat() || !ownerConnected(owner)) return Promise.resolve([]);
      const lookId = `look-${host.seat() ?? 'x'}-${++lookCounter}`;
      const req: LookReqMessage = { v: PROTOCOL_VERSION, t: 'lookReq', lookId, zone, count, ...(card !== undefined ? { card } : {}) };
      return new Promise((resolve) => {
        pending.set(lookId, { owner, resolve });
        if (!host.sendPrivate(owner, req)) settle(lookId, []);
      });
    },

    answerLooks(answer): Unsubscribe {
      answerer = answer;
      return () => {
        if (answerer === answer) answerer = null;
      };
    },

    sendPack(to, packId, cards) {
      // Pack cards change hands, so the holder is not their owner; M2-P2 refines the checks.
      const msg: PackMessage = { v: PROTOCOL_VERSION, t: 'pack', packId, cards: cards.map(plainCard) };
      if (to !== host.seat()) host.sendPrivate(to, msg);
    },

    onIdentity(listener): Unsubscribe {
      identityListeners.add(listener);
      return () => identityListeners.delete(listener);
    },

    onPack(listener): Unsubscribe {
      packListeners.add(listener);
      return () => packListeners.delete(listener);
    },
  };
}

/** The pair-channel layer over a NetEngine (net/types.ts PrivateChannel). */
export const createPrivateChannel: CreatePrivateChannel = (engine) => privateChannelOver(engine);
