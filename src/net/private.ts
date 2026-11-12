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
 *
 * The disclosure policy is enforced here, not left to each answerer: a look request is answered only when it matches
 * a sequenced, not yet answered `lookAt` of the asking seat (same zone, count and card), and the answer is cut down to
 * what that look may see (at most `count` own cards of that hidden zone, or exactly the peeked card when it is an own
 * face-down card in a public zone). The cards a look shows are fixed when its `lookAt` is applied to the confirmed
 * state, not when the request arrives, so they are the cards at that point of the log (DESIGN "Multiplayer
 * architecture", Hidden information 4: the logged look is the look that happens): the answerer is asked right then,
 * and the answer is refused later if one of those cards has left the zone, or the zone was shuffled or reordered
 * since; it is refused at once while the owner has own pending actions that may change that zone (`settled`). A targeted reveal is taken only once its public `revealTo` by the sender, naming this seat and this card, is
 * applied; a look answer only for a look this browser asked for. Requests and reveals waiting for their public
 * action, and looks never asked for, expire after `EXPIRE_AFTER_ACTIONS` sequenced actions.
 *
 * Draft packs (M2-P2; DESIGN "Specification: network protocol and secrecy", Draft packs: "Handing a pack on sends
 * `pack {packId, cards}` on the pair's `prv` channel together with the public action `packPass`"): a pack's cards go
 * only to the holder of the pack's current visit in the confirmed state, and only from the holder of the visit before
 * (`packHandOver`; core/reducer/pass.ts `packVisit`): the hand-over is sent once the `packPass` is sequenced, never
 * before, so a refused pass discloses nothing. A received pack is taken once the confirmed state shows that visit (it
 * waits for the log otherwise, and expires like a reveal), and only when every card opens the pack's commitment, the
 * ids are distinct and the count is the pack's at the start of that visit (also after the pick timer took its pick,
 * and for the last visit of an emptied pack, in any later stage of the same draft). A `pack` with no cards is a
 * request from the holder of the current visit to the holder of the visit before to send it again (the hand-over was
 * lost with a reload or an outage, `packRequestOk`); it reaches the `onPack` listeners as an empty list.
 */
import type { Action } from '../core/actions';
import { verifyReveal, type RevealedCard } from '../core/commit';
import { packCountAt, packVisit, packVisitor, picksPerPass } from '../core/reducer/pass';
import type { CardRef, DraftPack, InstanceId, PackId, SeatId, TableState, ZoneId } from '../core/types';
import { isSpectatorId } from '../core/teams';
import type { SequencedAction } from './messages';
import type { LookMessage, LookReqMessage, PackMessage, PrivateMessage, RevealMessage } from './messages';
import { PROTOCOL_VERSION } from './messages';
import type { CreatePrivateChannel, NetEngine, PrivateChannel, Unsubscribe } from './types';

/**
 * The part of a NetEngine the pair channel uses (so tests can drive it with a minimal engine). `pending` is the own
 * actions applied optimistically and not sequenced yet (NetEngine `pending()`, M1-C amendment): a pending private
 * reorder (scry) changes the owner's order without changing anything the view and confirmed state could show, so a
 * zone look is answered only while no pending own action may change that zone. A host that cannot list them at run
 * time (no `pending` function) gets no zone look answered: the channel fails closed.
 */
export type PrivateChannelHost = Pick<
  NetEngine,
  'state' | 'confirmedState' | 'onState' | 'onSequenced' | 'seat' | 'sendPrivate' | 'onPrivate' | 'peers' | 'onPeers' | 'pending'
>;

/** Most cards one look answer or pack may carry. */
const MAX_CARDS = 500;
const MAX_TEXT = 256;
/** Most identities held back until the shared state knows their cards; the oldest is dropped as unverified beyond it. */
const MAX_WAITING = 1000;
/** How many recently sequenced `revealTo` actions are remembered for targeted reveals that arrive late. */
const MAX_REMEMBERED_CIDS = 5000;
/** Most sequenced `lookAt`s of one asker waiting for their request, and most requests waiting for their `lookAt`. */
const MAX_OPEN_LOOKS = 32;
/**
 * How many sequenced actions a look request or targeted reveal waits for its public action, and a sequenced `lookAt`
 * for its request, before it is dropped (an expired request is refused). Bounds what a nacked or never-sent action
 * leaves behind.
 */
export const EXPIRE_AFTER_ACTIONS = 200;

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

/**
 * Whether `cards` are pack `packId` as `from` hands it to `to` in `state` (see the module comment): the pack's current
 * visit (core/reducer/pass.ts `packVisit`) is `to`'s, `from` held the visit before it, the ids are distinct, every card
 * opens the pack's commitment, and the count is the pack's at the start of `to`'s visit. That also holds while the
 * pick of `to`'s visit is already taken by the pick timer, and for the last visit of an emptied pack, so a holder that
 * was away still gets the cards its timed-out pick took. 'wait' while the state does not show `to`'s visit (the pass
 * is not applied here yet).
 */
export function packHandOver(state: TableState, packId: PackId, cards: readonly RevealedCard[], from: SeatId, to: SeatId): 'ok' | 'wait' | 'refuse' {
  const d = state.draft;
  if (d === undefined || state.stage === 'lobby') return 'wait';
  const picks = picksPerPass(d);
  if (picks === null) return 'refuse';
  const pack: DraftPack | null = Object.hasOwn(d.packs, packId) ? d.packs[packId]! : null;
  const visit = pack === null ? null : packVisit(d, pack);
  if (pack === null || visit === null || visit.holder !== to) return 'wait';
  if (visit.k < 1 || from === to || packVisitor(d, pack, visit.k - 1) !== from) return 'refuse';
  if (cards.length === 0 || new Set(cards.map((c) => c.instanceId)).size !== cards.length) return 'refuse';
  if (cards.length !== packCountAt(pack, picks, visit.k)) return 'refuse';
  return cards.every((c) => verifyReveal(pack.commitment, c)) ? 'ok' : 'refuse';
}

/** Whether `from` may ask `me` for pack `packId` again: the pack's current visit is `from`'s and `me` held the visit before. */
export function packRequestOk(state: TableState, packId: PackId, from: SeatId, me: SeatId): boolean {
  const d = state.draft;
  if (d === undefined || picksPerPass(d) === null || !Object.hasOwn(d.packs, packId)) return false;
  const pack = d.packs[packId]!;
  const visit = packVisit(d, pack);
  return visit !== null && visit.holder === from && visit.k >= 1 && from !== me && packVisitor(d, pack, visit.k - 1) === me;
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

  // A seat of the table, or a named spectator (M3-P5: the engine routes a spectator id to that spectator's own page).
  const targets = (to: readonly SeatId[]): SeatId[] => {
    const me = host.seat();
    return [...new Set(to)].filter((s) => s !== me && (Object.hasOwn(host.state().seats, s) || isSpectatorId(s)));
  };

  const ownerConnected = (owner: SeatId): boolean => host.peers().some((p) => p.seat === owner && p.status === 'connected');

  const settle = (lookId: string, cards: RevealedCard[]): void => {
    const p = pending.get(lookId);
    if (!p) return;
    pending.delete(lookId);
    p.resolve(cards);
  };

  // A targeted reveal is taken once its public `revealTo` (cid `about`) is applied here, so the card is where that
  // action saw it (the pair channel can overtake the sequenced log), and only if that action is the sender's
  // `revealTo` of this card naming this seat.
  interface RevealToSeen {
    by: SeatId;
    card: InstanceId;
    seats: readonly SeatId[];
  }
  /** Sequenced action ids, with the revealTo they carried (null for any other action). */
  const sequencedCids = new Map<string, RevealToSeen | null>();
  /** Targeted reveals waiting for their `revealTo`, with the action count they arrived at. */
  const afterAction = new Map<string, { at: number; run: ((seen: RevealToSeen | null) => void)[] }>();
  /** Sequenced actions seen so far (the clock of every expiry here). */
  let tick = 0;

  /**
   * A sequenced `lookAt` of another seat at an own zone or card, with the cards it may show fixed at that point of
   * the log (null: refuse), and whether a later action made them stale.
   */
  interface OpenLook {
    zone: ZoneId;
    count: number;
    card?: InstanceId;
    cards: RevealedCard[] | null;
    stale: boolean;
    at: number;
  }
  /** Sequenced `lookAt`s of other seats that no request has used yet, per asker, oldest first. */
  const openLooks = new Map<SeatId, OpenLook[]>();
  /** Look requests that arrived before their `lookAt` was applied here (the pair channel can overtake the log). */
  let waitingReqs: { msg: LookReqMessage; from: SeatId; at: number }[] = [];

  const sameLook = (l: { zone: ZoneId; count: number; card?: InstanceId }, msg: LookReqMessage): boolean => l.zone === msg.zone && l.count === msg.count && l.card === msg.card;

  /** Use up the asker's sequenced `lookAt` that matches the request; null when there is none. */
  const takeLook = (msg: LookReqMessage, from: SeatId): OpenLook | null => {
    const list = openLooks.get(from);
    const i = list ? list.findIndex((l) => sameLook(l, msg)) : -1;
    if (!list || i < 0) return null;
    return list.splice(i, 1)[0]!;
  };

  /**
   * The cards a look may show, from what the answerer offered: at most `count` own cards of the requested hidden zone
   * (the answerer keeps the owner's order, top first), or exactly the peeked card when it is an own face-down card in
   * a public zone. Null when the request names nothing this seat may show.
   */
  const allowed = (msg: LookReqMessage, st: TableState, me: SeatId, offered: readonly RevealedCard[]): RevealedCard[] | null => {
    const zone = Object.hasOwn(st.zones, msg.zone) ? st.zones[msg.zone]! : null;
    if (zone === null) return null;
    if (msg.card !== undefined) {
      const c = Object.hasOwn(st.cards, msg.card) ? st.cards[msg.card]! : null;
      if (!c || c.owner !== me || c.zone !== zone.id || zone.visibility !== 'public' || c.face !== 'down' || c.identity !== undefined) return null;
      return offered.filter((x) => x.instanceId === c.id).slice(0, 1);
    }
    if (zone.visibility === 'public' || zone.owner !== me) return null;
    const members = new Set(zone.ids);
    const out: RevealedCard[] = [];
    for (const x of offered) {
      if (out.length >= msg.count) break;
      if (members.has(x.instanceId) && !out.some((y) => y.instanceId === x.instanceId)) out.push(x);
    }
    return out;
  };

  /** Whether the own pending action `a` may change the private order or the cards of the own hidden zone `zone`. */
  const touches = (a: Action, zone: ZoneId, view: TableState, conf: TableState): boolean => {
    const cardIn = (id: unknown): boolean =>
      typeof id === 'string' && ((Object.hasOwn(conf.cards, id) && conf.cards[id]!.zone === zone) || (Object.hasOwn(view.cards, id) && view.cards[id]!.zone === zone));
    const shuffleOf = (sid: unknown): ZoneId | null => {
      if (typeof sid !== 'string') return null;
      const r = Object.hasOwn(view.shuffles, sid) ? view.shuffles[sid]! : Object.hasOwn(conf.shuffles, sid) ? conf.shuffles[sid]! : null;
      return r ? r.zone : null;
    };
    const owner = Object.hasOwn(conf.zones, zone) ? conf.zones[zone]!.owner : null;
    switch (a.type) {
      case 'reorder':
      case 'shuffleCommit':
        return a.zone === zone;
      case 'shuffleDone':
        return shuffleOf(a.sid) === zone;
      case 'draw':
        return cardIn(a.instanceId);
      case 'move':
      case 'toZone':
        return a.to === zone || cardIn(a.card);
      case 'mulligan':
      case 'ready':
        return a.by === owner;
      // An undo may return a card to the zone or reorder it; a private reorder may follow it.
      case 'undo':
        return true;
      default:
        return false;
    }
  };

  /**
   * Whether the owner's private order of `zone` is the one at the confirmed state: no own pending action may change it
   * (a scry's `reorder` changes the owner's store at once but nothing public, so view and confirmed state agree), and
   * the zone and its shuffles are the same in the view as in the confirmed state. False when the host cannot list its
   * pending actions.
   */
  const settled = (zone: ZoneId): boolean => {
    const view = host.state();
    const conf = host.confirmedState();
    if (typeof host.pending !== 'function') return false;
    if (host.pending().some((a) => touches(a, zone, view, conf))) return false;
    const a = Object.hasOwn(view.zones, zone) ? view.zones[zone]!.ids : [];
    const b = Object.hasOwn(conf.zones, zone) ? conf.zones[zone]!.ids : [];
    if (a.length !== b.length || a.some((id, i) => id !== b[i])) return false;
    for (const sid of new Set([...Object.keys(view.shuffles), ...Object.keys(conf.shuffles)])) {
      const x = Object.hasOwn(view.shuffles, sid) ? view.shuffles[sid]! : null;
      const y = Object.hasOwn(conf.shuffles, sid) ? conf.shuffles[sid]! : null;
      if ((x?.zone === zone || y?.zone === zone) && x?.orderHash !== y?.orderHash) return false;
    }
    return true;
  };

  /**
   * The cards another seat's sequenced `lookAt` may show, fixed now, while the confirmed state is the state at that
   * look (a `lookAt` changes no zone). The answerer is asked now; it must answer from the confirmed state (core/secrets.ts
   * `lookAnswer(secrets, engine.confirmedState(), req, {allowZoneLook})`, the flag set only once the owner agreed to
   * show its zone), as `disclosedBy` records the look. While own pending actions
   * may change that zone (a draw, a scry's reorder or a shuffle not sequenced yet) the owner's order is not the one at
   * the look: refused (`settled`).
   */
  const bindLook = (action: { zone: ZoneId; count: number; card?: InstanceId; seq: number }, from: SeatId): RevealedCard[] | null => {
    const me = host.seat();
    if (me === null || !answerer) return null;
    const msg: LookReqMessage = { v: PROTOCOL_VERSION, t: 'lookReq', lookId: `seq-${action.seq}`, zone: action.zone, count: action.count, ...(action.card !== undefined ? { card: action.card } : {}) };
    if (action.card === undefined && !settled(action.zone)) return null;
    let cards: RevealedCard[] | null;
    try {
      cards = answerer(msg, from);
    } catch {
      cards = null;
    }
    return cards === null ? null : allowed(msg, host.confirmedState(), me, cards);
  };

  /** The bound cards of `look` if it may still be answered: every card still where the look saw it, no reorder since. */
  const stillValid = (look: OpenLook, msg: LookReqMessage): RevealedCard[] | null => {
    const me = host.seat();
    if (look.stale || look.cards === null || me === null) return null;
    const st = host.confirmedState();
    const now = allowed(msg, st, me, look.cards);
    return now !== null && now.length === look.cards.length ? look.cards : null;
  };

  const answerLook = (msg: LookReqMessage, from: SeatId, look: OpenLook): void => {
    const safe = stillValid(look, msg);
    const answer: LookMessage = safe === null ? { v: PROTOCOL_VERSION, t: 'look', lookId: msg.lookId, cards: [], refused: true } : { v: PROTOCOL_VERSION, t: 'look', lookId: msg.lookId, cards: safe.map(plainCard) };
    host.sendPrivate(from, answer);
  };

  /** Mark open looks at `zone` stale: its order changed after them (shuffle, reorder, re-issue). */
  const staleLooks = (zone: ZoneId): void => {
    for (const list of openLooks.values()) for (const l of list) if (l.zone === zone && l.card === undefined) l.stale = true;
  };

  /** Drop whatever waited too long for its public action or request. */
  const expire = (): void => {
    const old = (at: number): boolean => tick - at > EXPIRE_AFTER_ACTIONS;
    for (const w of waitingReqs.filter((x) => old(x.at))) refuseLook(w.msg, w.from);
    waitingReqs = waitingReqs.filter((x) => !old(x.at));
    for (const [cid, e] of [...afterAction]) if (old(e.at)) afterAction.delete(cid);
    for (const [seat, list] of [...openLooks]) {
      const kept = list.filter((l) => !old(l.at));
      if (kept.length) openLooks.set(seat, kept);
      else openLooks.delete(seat);
    }
  };

  const refuseLook = (msg: LookReqMessage, from: SeatId): void => {
    host.sendPrivate(from, { v: PROTOCOL_VERSION, t: 'look', lookId: msg.lookId, cards: [], refused: true });
  };

  /** The zone whose private order a sequenced action changes, if any (a shuffle, a reorder, a re-issue). */
  const reorderedZone = (action: SequencedAction): ZoneId | null => {
    if (action.type === 'reorder') return action.zone;
    if (action.type !== 'shuffleDone') return null;
    const st = host.confirmedState();
    return Object.hasOwn(st.shuffles, action.sid) ? st.shuffles[action.sid]!.zone : null;
  };

  host.onSequenced((action) => {
    const me = host.seat();
    tick++;
    const seen: RevealToSeen | null = action.type === 'revealTo' ? { by: action.by, card: action.instanceId, seats: Array.isArray(action.seats) ? action.seats : [] } : null;
    sequencedCids.set(action.cid, seen);
    if (sequencedCids.size > MAX_REMEMBERED_CIDS) sequencedCids.delete(sequencedCids.keys().next().value!);
    const run = afterAction.get(action.cid);
    if (run) {
      afterAction.delete(action.cid);
      for (const f of run.run) f(seen);
    }
    const moved = reorderedZone(action);
    if (moved !== null) staleLooks(moved);
    if (action.type === 'lookAt' && action.by !== me && me !== null) {
      const st = host.confirmedState();
      const zone = Object.hasOwn(st.zones, action.zone) ? st.zones[action.zone]! : null;
      const card = action.card !== undefined && Object.hasOwn(st.cards, action.card) ? st.cards[action.card]! : null;
      // Only a look at an own zone (or own card) is this browser's to answer.
      const mine = action.card !== undefined ? card !== null && card.owner === me : zone !== null && zone.owner === me;
      if (mine) {
        const look: OpenLook = { zone: action.zone, count: action.count, ...(action.card !== undefined ? { card: action.card } : {}), cards: bindLook(action, action.by), stale: false, at: tick };
        const waiting = waitingReqs.find((w) => w.from === action.by && sameLook(action, w.msg));
        if (waiting) {
          waitingReqs = waitingReqs.filter((w) => w !== waiting);
          answerLook(waiting.msg, waiting.from, look);
        } else {
          const list = openLooks.get(action.by) ?? [];
          list.push(look);
          if (list.length > MAX_OPEN_LOOKS) list.shift();
          openLooks.set(action.by, list);
        }
      }
    }
    expire();
  });

  const onReveal = (msg: RevealMessage, from: SeatId): void => {
    const card = asRevealedCard(msg);
    if (!card || (msg.purpose !== 'revealTo' && msg.purpose !== 'look') || !isText(msg.about, 128)) return;
    if (msg.purpose === 'look') {
      // Only for a look this browser asked that seat for.
      const p = pending.get(msg.about);
      if (p && p.owner === from) decide(card, from);
      return;
    }
    const take = (seen: RevealToSeen | null): void => {
      const me = host.seat();
      if (seen === null || me === null || seen.by !== from || seen.card !== card.instanceId || !seen.seats.includes(me)) return;
      decide(card, from);
    };
    if (sequencedCids.has(msg.about)) return take(sequencedCids.get(msg.about)!);
    const entry = afterAction.get(msg.about);
    if (entry) return void entry.run.push(take);
    // Full: the oldest waiting reveal goes (its revealTo is the least likely to still come).
    if (afterAction.size >= MAX_WAITING) afterAction.delete(afterAction.keys().next().value!);
    afterAction.set(msg.about, { at: tick, run: [take] });
  };

  const onLookReq = (msg: LookReqMessage, from: SeatId): void => {
    if (!isText(msg.lookId, 128) || !isText(msg.zone, 128) || !Number.isInteger(msg.count) || msg.count < 1 || msg.count > MAX_CARDS) return;
    if (msg.card !== undefined && !isText(msg.card, 128)) return;
    const me = host.seat();
    const st = host.state();
    const zone = Object.hasOwn(st.zones, msg.zone) ? st.zones[msg.zone]! : null;
    const card = msg.card !== undefined && Object.hasOwn(st.cards, msg.card) ? st.cards[msg.card]! : null;
    // Only the owner of the zone (or of the peeked card) answers; anyone else refuses at once.
    const mine = me !== null && (msg.card !== undefined ? card !== null && card.owner === me : zone !== null && zone.owner === me);
    if (!mine) return refuseLook(msg, from);
    // Each sequenced lookAt of the asker opens exactly one answer; a request without one waits for it.
    const look = takeLook(msg, from);
    if (look) return answerLook(msg, from, look);
    if (waitingReqs.length >= MAX_OPEN_LOOKS) {
      const oldest = waitingReqs.shift()!;
      refuseLook(oldest.msg, oldest.from);
    }
    waitingReqs.push({ msg, from, at: tick });
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

  /** Pack hand-overs waiting for their `packPass` to be applied here (the pair channel can overtake the log). */
  let waitingPacks: { packId: PackId; cards: RevealedCard[]; from: SeatId; at: number }[] = [];

  /** Hand a verified pack to the listeners, keep it waiting, or drop it (see `packHandOver`). */
  const takePack = (packId: PackId, cards: RevealedCard[], from: SeatId, at: number): void => {
    const me = host.seat();
    if (me === null) return;
    const verdict = packHandOver(host.confirmedState(), packId, cards, from, me);
    if (verdict === 'refuse') return;
    if (verdict === 'wait') {
      if (waitingPacks.length >= MAX_OPEN_LOOKS) waitingPacks.shift();
      waitingPacks.push({ packId, cards, from, at });
      return;
    }
    for (const l of [...packListeners]) l(packId, cards.map(plainCard), from);
  };

  host.onState(() => {
    if (waitingPacks.length === 0) return;
    const retry = waitingPacks;
    waitingPacks = [];
    for (const w of retry) if (tick - w.at <= EXPIRE_AFTER_ACTIONS) takePack(w.packId, w.cards, w.from, w.at);
  });

  const onPack = (msg: PackMessage, from: SeatId): void => {
    const cards = asCardList(msg.cards);
    if (!isText(msg.packId, 128) || !cards) return;
    if (cards.length > 0) return takePack(msg.packId, cards, from, tick);
    // A request to send the pack again: only from the holder of its current visit, to the holder of the visit before.
    const me = host.seat();
    if (me === null || !packRequestOk(host.confirmedState(), msg.packId, from, me)) return;
    for (const l of [...packListeners]) l(msg.packId, [], from);
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
      const me = host.seat();
      if (me === null || to === me) throw new Error('a pack goes from one seated drafter to another');
      const st = host.confirmedState();
      if (cards.length === 0) {
        // A request: only the holder of the pack's current visit asks the holder of the visit before.
        if (!packRequestOk(st, packId, me, to)) throw new Error(`${me} cannot ask ${to} for pack ${packId}`);
        host.sendPrivate(to, { v: PROTOCOL_VERSION, t: 'pack', packId, cards: [] });
        return;
      }
      const list = cards.map(plainCard);
      // Only to the drafter the sequenced pass made the holder, and only the pack's own cards.
      if (packHandOver(st, packId, list, me, to) !== 'ok') throw new Error(`pack ${packId} is not ${me}'s to hand to ${to} now`);
      const msg: PackMessage = { v: PROTOCOL_VERSION, t: 'pack', packId, cards: list };
      host.sendPrivate(to, msg);
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
