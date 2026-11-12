/**
 * Roles on the wire: players and spectators (DESIGN "Players, seats and formats", Spectators: "A spectator joins by the
 * same link without taking a chair, sees only public zones, can chat and ping, and cannot move cards. A player may
 * reveal their hand to a named spectator"; "Specification: network protocol and secrecy", Sequencing 1 and 3: spectators
 * are never sequencer, and the sequencer checks that "the actor's role allows the action family").
 * Contracts: M3-C; implementer: M3-P5 (wires `roleProblem` into the sequencer's check in net/sequencer.ts and
 * `sendPrivate` to a spectator id into net/engine.ts).
 *
 * A spectator holds no secret store and no chair. What it may know of hidden cards arrives only as a targeted reveal
 * naming it: a `reveal` on the pair channel from the card's owner, taken once the owner's public `revealTo` naming this
 * spectator and that card is applied, and checked against the owner's deck commitment (`spectatorRevealsOver`).
 */
import type { Action, ActionType } from '../core/actions';
import { verifyReveal, type RevealedCard } from '../core/commit';
import { revealedCard } from '../core/secrets';
import type { CardRef, InstanceId, SecretStore, SeatId, TableState, ZoneId } from '../core/types';
import { isSpectatorId, peerOfSpectator, spectatorIdOf, type SpectatorId } from '../core/teams';
import { PROTOCOL_VERSION, type PeerRole, type PrivateMessage, type SequencedAction } from './messages';
import type { PeerInfo, Unsubscribe } from './types';

export type { PeerRole };

/**
 * The action types a spectator may propose (DESIGN "Players, seats and formats", Spectators: "can chat and ping, and
 * cannot move cards"). A spectator's actions carry `by` = its spectator id (core/teams.ts `spectatorIdOf`); a `chat`
 * goes on the 'spectator' or 'table' tab and carries the spectator's nickname in `name` (DECISIONS [M3-C]).
 */
export const SPECTATOR_ACTIONS: readonly ActionType[] = ['chat', 'ping'];

/** Longest spectator nickname a chat line may carry (the lobby's nickname limit, ui/lobby/seats.ts). */
export const SPECTATOR_NAME_MAX = 40;

/** A spectator as a player's browser knows it from the handshake (DESIGN "Players, seats and formats", Spectators: reveal to a named spectator). */
export interface SpectatorInfo {
  id: SpectatorId;
  /** Identity peer id (first 16 hex of SHA-256 of the public key). */
  peerId: string;
  nickname: string;
  /** Connected now (a spectator that left keeps no state). */
  connected: boolean;
}

/**
 * Why `sender` may not propose `action` because of its role, or null when the role allows it (DESIGN "Specification:
 * network protocol and secrecy", Sequencing 3: "the actor's role allows the action family"). For a spectator: only
 * SPECTATOR_ACTIONS, and `by` must be the sender's own spectator id. For a player: null (the seat checks stay in the
 * sequencer). Implementer: M3-P5.
 *
 * Beyond the action type and `by`: a spectator's chat goes on the table or spectator tab (never the team tab, which
 * is the teammates' pair channel) and may carry its nickname in `name`; a spectator never acts for a seat, even when
 * its key pair also holds a chair at this table (its chair is played from a player's page).
 */
export function roleProblem(state: TableState, action: Action, sender: { role: PeerRole; peerId: string; seat: SeatId | null }): string | null {
  if (sender.role !== 'spectator') return null;
  const why = spectatorActionProblem(state, action);
  if (why !== null) return why;
  if (!sender.peerId || action.by !== spectatorIdOf(sender.peerId)) return `a spectator acts as ${sender.peerId ? spectatorIdOf(sender.peerId) : 'its own spectator id'} only`;
  return null;
}

/**
 * The part of `roleProblem` that needs no sender identity: the action type, never a seat's `by`, and a chat's tab and
 * name. The sequencer's check (net/sequencer.ts, whose `Sequencer.sequence` contract carries no peer id) runs this for
 * every spectator sender; the engine, which knows the sender's identity and handshake nickname, runs `roleProblem` and
 * `spectatorNameProblem` before handing the action to the sequencer (net/engine.ts `senderPeerCheck`).
 */
export function spectatorActionProblem(state: TableState, action: Action): string | null {
  const a = action as unknown as Record<string, unknown>;
  const type = typeof a.type === 'string' ? a.type : '';
  if (!(SPECTATOR_ACTIONS as readonly string[]).includes(type)) return `a spectator may chat and ping only, not send ${type || 'this action'}`;
  const by = a.by;
  if (typeof by === 'string' && Object.hasOwn(state.seats, by)) return 'a spectator may not act for a seat';
  if (type === 'chat') {
    if (a.channel !== 'table' && a.channel !== 'spectator') return 'a spectator chats on the table or spectator tab';
    if (a.name !== undefined && (typeof a.name !== 'string' || a.name.trim() === '' || a.name.length > SPECTATOR_NAME_MAX)) return 'a spectator’s chat name is its nickname';
  }
  return null;
}

/** The nickname a spectator without one goes by. */
export const SPECTATOR_DEFAULT_NAME = 'Spectator';

/** The nickname a spectator's chat line carries: its handshake nickname, trimmed and cut to SPECTATOR_NAME_MAX, or SPECTATOR_DEFAULT_NAME. */
export function spectatorChatName(nickname: string): string {
  return nickname.trim().slice(0, SPECTATOR_NAME_MAX) || SPECTATOR_DEFAULT_NAME;
}

/**
 * Why a spectator's chat `name` is not the nickname its connection announced in the handshake (`hello.nickname`), or
 * null. The log names a spectator by its chat name (ui/describe.ts), and players list it by its handshake nickname
 * (`spectatorsOf`): binding the two means a spectator cannot post under another name than the one the table sees.
 */
export function spectatorNameProblem(action: Action, handshakeNickname: string): string | null {
  if (action.type !== 'chat' || action.name === undefined) return null;
  return action.name === spectatorChatName(handshakeNickname) ? null : 'a spectator’s chat name is the nickname it joined with';
}

/** The spectators among the engine's peers, nickname order (DESIGN "Players, seats and formats", Spectators). Implementer: M3-P5. */
export function spectatorsOf(peers: readonly PeerInfo[]): SpectatorInfo[] {
  const byPeer = new Map<string, SpectatorInfo>();
  for (const p of peers) {
    // Only verified peers have an identity; a handshake in progress names nobody yet.
    if (p.role !== 'spectator' || !p.peerId || p.status === 'handshake') continue;
    const info: SpectatorInfo = { id: spectatorIdOf(p.peerId), peerId: p.peerId, nickname: p.nickname, connected: p.status === 'connected' };
    const prev = byPeer.get(p.peerId);
    // One identity on two connections (a reload): the connected one wins.
    if (!prev || (!prev.connected && info.connected)) byPeer.set(p.peerId, info);
  }
  return [...byPeer.values()].sort((x, y) => x.nickname.localeCompare(y.nickname) || (x.peerId < y.peerId ? -1 : x.peerId > y.peerId ? 1 : 0));
}

/** The name a spectator's log lines carry: its nickname from the chat line, else a neutral label (DESIGN "Players, seats and formats", Spectators). */
export function spectatorLabel(name: string | undefined): string {
  const n = typeof name === 'string' ? name.trim() : '';
  return n ? `${n} (spectator)` : 'A spectator';
}

/**
 * Whether a peer may receive a pair-channel message addressed to spectator id `to` (net/engine.ts `sendPrivate`): the
 * verified connection of exactly that identity, which joined as a spectator and holds no chair. Only a targeted reveal
 * ever goes to a spectator.
 */
export function spectatorRoute(to: SpectatorId, peer: Pick<PeerInfo, 'peerId' | 'role' | 'status'>, seated: boolean, msg: PrivateMessage): boolean {
  const target = peerOfSpectator(to);
  return target !== null && msg.t === 'reveal' && msg.purpose === 'revealTo' && peer.role === 'spectator' && peer.status !== 'handshake' && peer.peerId === target && !seated;
}

// ---------------------------------------------------------------------------------------------------------------------
// Receiving a reveal as a spectator.
// ---------------------------------------------------------------------------------------------------------------------

/** The part of a NetEngine a spectator's reveal receiver uses (so tests can drive it with a minimal host). */
export interface SpectatorRevealHost {
  state(): TableState;
  onState(listener: (state: TableState) => void): Unsubscribe;
  onSequenced(listener: (action: SequencedAction, own: boolean) => void): Unsubscribe;
  onPrivate(listener: (msg: PrivateMessage, from: { seat: SeatId | null; peerId: string }) => void): Unsubscribe;
}

/** A card shown to this spectator, as the receiver hands it on. */
export interface SpectatorReveal {
  card: RevealedCard;
  from: SeatId;
  /** The identity opens the owner's deck commitment; an unverified card is flagged, never shown as genuine. */
  verified: boolean;
}

/** How many sequenced actions a reveal waits for its `revealTo` (as net/private.ts EXPIRE_AFTER_ACTIONS). */
const EXPIRE_AFTER = 200;
/** Most reveals held back at once, and most sequenced `revealTo`s remembered. */
const MAX_HELD = 500;

function revealedCardOf(msg: PrivateMessage): RevealedCard | null {
  if (msg.t !== 'reveal' || msg.purpose !== 'revealTo') return null;
  const ref = msg.ref as unknown;
  if (typeof msg.instanceId !== 'string' || typeof msg.salt !== 'string' || typeof ref !== 'object' || ref === null) return null;
  const r = ref as { sid?: unknown; foil?: unknown };
  if (typeof r.sid !== 'string' || r.sid === '' || (r.foil !== undefined && r.foil !== true)) return null;
  const card: CardRef = r.foil === true ? { sid: r.sid, foil: true } : { sid: r.sid };
  return { instanceId: msg.instanceId, ref: card, salt: msg.salt };
}

/**
 * The reveals a spectator receives (DESIGN "Players, seats and formats", Spectators: "A player may reveal their hand to
 * a named spectator"; "Multiplayer architecture", Targeted reveal). A `reveal` from seat S is taken only once S's
 * sequenced `revealTo` (cid = the reveal's `about`) of that very card names `me` among its spectators; it is then
 * checked against S's deck commitment, and S must own the card. Anything else (a look answer, a pack, a reveal no
 * `revealTo` names this spectator in, a message from a peer without a chair) is dropped. A reveal that arrives before
 * this page has caught up (the owner sends owed reveals as soon as a returning spectator is verified) comes from a
 * peer whose chair the replica does not know yet; its seat is the one that peer holds once the `revealTo` is applied.
 */
export function spectatorRevealsOver(host: SpectatorRevealHost, me: SpectatorId, listener: (reveal: SpectatorReveal) => void): Unsubscribe {
  if (!isSpectatorId(me)) throw new Error(`${me} is not a spectator id`);
  /** Sequenced `revealTo`s naming this spectator, by cid (null: another action, or one that does not name it). */
  const seen = new Map<string, { by: SeatId; card: InstanceId } | null>();
  /**
   * Reveals waiting for their `revealTo`, with the action count they arrived at. `from` is null when the sender's
   * chair was not known yet (a page that just (re)joined and has not caught up): its seat is looked up by peer id
   * once the `revealTo` is applied.
   */
  let held: { about: string; card: RevealedCard; from: SeatId | null; peerId: string; at: number }[] = [];
  /** Accepted cards waiting for the state to know them. */
  let unknown: { card: RevealedCard; from: SeatId }[] = [];
  let tick = 0;

  const verdict = (card: RevealedCard, from: SeatId): boolean | null => {
    const st = host.state();
    const c = Object.hasOwn(st.cards, card.instanceId) ? st.cards[card.instanceId]! : null;
    if (c === null) return null;
    const commitment = Object.hasOwn(st.commitments, from) ? st.commitments[from]! : null;
    return c.owner === from && commitment !== null && verifyReveal(commitment, card);
  };
  const decide = (card: RevealedCard, from: SeatId): void => {
    const ok = verdict(card, from);
    if (ok === null) {
      if (unknown.length >= MAX_HELD) unknown.shift();
      unknown.push({ card, from });
      return;
    }
    listener({ card, from, verified: ok });
  };
  /** The chair `peerId` holds in the current state, or null. */
  const seatOf = (peerId: string): SeatId | null => {
    if (!peerId) return null;
    for (const seat of Object.values(host.state().seats)) if (seat.peer === peerId) return seat.id;
    return null;
  };
  const take = (about: string, card: RevealedCard, sender: SeatId | null, peerId: string): void => {
    const from = sender ?? seatOf(peerId);
    const s = seen.get(about);
    if (from !== null && s && s.by === from && s.card === card.instanceId) decide(card, from);
  };

  const offSeq = host.onSequenced((a) => {
    tick++;
    const names = a.type === 'revealTo' && Array.isArray(a.spectators) && a.spectators.includes(me);
    seen.set(a.cid, names ? { by: a.by, card: a.instanceId } : null);
    if (seen.size > MAX_HELD * 10) seen.delete(seen.keys().next().value!);
    const ready = held.filter((h) => h.about === a.cid);
    if (ready.length) held = held.filter((h) => h.about !== a.cid);
    for (const h of ready) take(h.about, h.card, h.from, h.peerId);
    held = held.filter((h) => tick - h.at <= EXPIRE_AFTER);
  });
  const offState = host.onState(() => {
    if (unknown.length === 0) return;
    const now = unknown.filter((u) => verdict(u.card, u.from) !== null);
    if (now.length === 0) return;
    unknown = unknown.filter((u) => !now.includes(u));
    for (const u of now) decide(u.card, u.from);
  });
  const offPrv = host.onPrivate((msg, sender) => {
    const card = revealedCardOf(msg);
    if (card === null || msg.t !== 'reveal' || typeof msg.about !== 'string') return;
    if (seen.has(msg.about)) return take(msg.about, card, sender.seat, sender.peerId);
    if (held.length >= MAX_HELD) held.shift();
    held.push({ about: msg.about, card, from: sender.seat, peerId: sender.peerId, at: tick });
  });
  return () => {
    offSeq();
    offState();
    offPrv();
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Sending a reveal to a spectator (the owner's side).
// ---------------------------------------------------------------------------------------------------------------------

/** The part of a NetEngine the owner's reveal sender uses (so tests can drive it with a minimal host). */
export interface SpectatorRevealSenderHost {
  confirmedState(): TableState;
  seat(): SeatId | null;
  peers(): PeerInfo[];
  onSequenced(listener: (action: SequencedAction, own: boolean) => void): Unsubscribe;
  onPeers(listener: (peers: PeerInfo[]) => void): Unsubscribe;
  sendPrivate(seat: SeatId, msg: PrivateMessage): boolean;
}

/** Most reveals to spectators an owner keeps owing at once. */
const MAX_OWED = 500;
/**
 * When owed reveals go again to a spectator that came back, after the first try at once (ms). The spectator's engine
 * drops a pair-channel message from a peer it has not verified yet, and its side of the handshake may finish after
 * ours; the receiver takes a repeated reveal once and ignores the rest.
 */
export const SPECTATOR_RESEND_MS: readonly number[] = [1500, 5000, 15000];

/**
 * The owner's side of "A player may reveal their hand to a named spectator" (DESIGN "Players, seats and formats",
 * Spectators; "Multiplayer architecture", Targeted reveal). Once an own `revealTo` naming spectators is sequenced, each
 * named spectator's page gets the card's identity on its pair channel (net/engine.ts `sendPrivate` to a spectator id,
 * which reaches only that spectator's own verified, unseated connection). The reveal stays owed while the card is
 * still hidden, still this seat's and still in the zone it was shown in: a named spectator whose page was not
 * reachable then, or that comes back (a reconnect or a reload, since spectators keep nothing), gets it again when its
 * connection is verified, and a few times after (SPECTATOR_RESEND_MS). The spectator takes it only against the sequenced `revealTo` (`spectatorRevealsOver`).
 * Mounted by session/net.ts; the seats a `revealTo` names stay with the pair channel (net/private.ts).
 */
export function spectatorRevealSender(host: SpectatorRevealSenderHost, secrets: () => SecretStore): Unsubscribe {
  const owed = new Map<string, { card: InstanceId; zone: ZoneId; to: SpectatorId[] }>();
  const reachable = (peers: readonly PeerInfo[]): Set<string> =>
    new Set(peers.flatMap((p) => (p.role === 'spectator' && p.status === 'connected' && p.peerId ? [spectatorIdOf(p.peerId)] : [])));
  let present = reachable(host.peers());

  const stillOwed = (o: { card: InstanceId; zone: ZoneId }): boolean => {
    const st = host.confirmedState();
    const c = Object.hasOwn(st.cards, o.card) ? st.cards[o.card]! : null;
    return c !== null && c.identity === undefined && c.zone === o.zone && c.owner === host.seat();
  };
  const send = (about: string, id: InstanceId, to: readonly SpectatorId[]): void => {
    const card = revealedCard(secrets(), id);
    if (card === null) return;
    for (const v of to) host.sendPrivate(v, { v: PROTOCOL_VERSION, t: 'reveal', ...card, purpose: 'revealTo', about });
  };
  const prune = (): void => {
    for (const [cid, o] of owed) if (!stillOwed(o)) owed.delete(cid);
  };

  const offSeq = host.onSequenced((a, own) => {
    if (owed.size) prune();
    if (!own || a.type !== 'revealTo' || a.by !== host.seat() || !Array.isArray(a.spectators)) return;
    const to = [...new Set(a.spectators.filter((v) => isSpectatorId(v)))];
    const st = host.confirmedState();
    const c = Object.hasOwn(st.cards, a.instanceId) ? st.cards[a.instanceId]! : null;
    if (to.length === 0 || c === null || c.identity !== undefined) return;
    send(a.cid, a.instanceId, to);
    owed.set(a.cid, { card: a.instanceId, zone: c.zone, to });
    if (owed.size > MAX_OWED) owed.delete(owed.keys().next().value!);
  });
  const resend = (back: readonly SpectatorId[]): void => {
    const here = back.filter((v) => present.has(v));
    if (here.length === 0 || owed.size === 0) return;
    prune();
    for (const [cid, o] of owed) {
      const to = o.to.filter((v) => here.includes(v));
      if (to.length) send(cid, o.card, to);
    }
  };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const offPeers = host.onPeers((peers) => {
    const now = reachable(peers);
    const back = [...now].filter((v) => !present.has(v));
    present = now;
    if (back.length === 0 || owed.size === 0 || ![...owed.values()].some((o) => o.to.some((v) => back.includes(v)))) return;
    resend(back);
    for (const ms of SPECTATOR_RESEND_MS) {
      const t = setTimeout(() => {
        timers.delete(t);
        resend(back);
      }, ms);
      timers.add(t);
    }
  });
  return () => {
    offSeq();
    offPeers();
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };
}
