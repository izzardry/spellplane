/**
 * The page-wide matchmaker (matchmaking.md 2.6, 2.8, 2.13, MM-4; contracts.md Part E, Part G "Matchmaking"). One per
 * page, created in main.ts, alive across routes. It owns the lobby room (src/net/lobby/room.ts) and its 250 ms tick,
 * builds and signs the ticket from the selected deck (only QueueDeckInfo's band and score leave the browser), and on a
 * formed match writes the MatchRecord and a matched GameSummary, leaves the lobby and opens `#/t/<room>/<key>`.
 *
 * - The lobby is joined only on intent (`watch(true)` or `seek`) and left when the matchmaker is off.
 * - The deck is locked while seeking (`status().deckId`); a reload ends a search (nothing is persisted but the
 *   MatchRecord); entering a networked room that is not the match's own turns the matchmaker off.
 * - The 30-second arrival rule is the matchmaker's own: from `formed`, a member that is not reported `arrived` (connected
 *   to every other member, src/session/match-room.ts) within ARRIVE_MS on the matchmaker clock is stranded: the record
 *   becomes void, the History entry is purged, the page leaves the room route (so a pending join ends) and the search
 *   resumes with its waiting time kept. Leaving the match's room route, or CANCEL, while moving abandons the match.
 * - Notices (a declined, missed or unreachable match) are taken once (`takeNotice`); a new search or CANCEL clears one.
 * - Lifecycle counters: the lobby transport is tracked as 'transports' and the tick as 'timers' while they exist.
 */
import type { Band, MatchPlayer, MatchRecord, QueueId, RatingKey, SeatId } from '../core/types';
import { queueDeckInfo } from '../data/deck/queue';
import { createNetIdentity } from '../net/identity';
import { PROTOCOL_VERSION } from '../net/messages';
import type { BrokerEffect, FormedMatch } from '../net/lobby/broker';
import { pairingKeyOf, queueParts, ratingFor, windowOf } from '../net/lobby/pairing';
import { LobbyRoom, type LobbyMessageRecord, type TicketDraft } from '../net/lobby/room';
import type { LobbyView, MatchPlan, MatchView } from '../net/lobby/types';
import type { Transport } from '../net/transport';
import type { NetIdentity } from '../net/types';
import type { DeckStore, GameStore, IdentityStore, MatchStore, RatingStore, SettingsStore, StrengthBand } from '../store/types';
import { track, untrack } from '../util/lifecycle';
import { ARRIVE_MS, setPageMatchmaker } from './match-room';
import type { Matchmaker, MatchmakerStatus } from './types';

/** What the matchmaker needs from the page (main.ts). M8-P7 may add optional members. */
export interface MatchmakerDeps {
  settings: SettingsStore;
  decks: DeckStore;
  ratings: RatingStore;
  matches: MatchStore;
  now?: () => number;
  /** Added by M8-P7. History: the matched game is listed under its code once formed. */
  games?: GameStore | null;
  /** Added by M8-P7. The identity that signs tickets and holds (else from `identityStore`, else the profile's store). */
  identity?: () => Promise<NetIdentity>;
  /** Added by M8-P7. */
  identityStore?: IdentityStore;
  /** Added by M8-P7. The lobby transport (default: the page transport, `createPageTransport()`). */
  transport?: () => Transport;
  /** Added by M8-P7. Open a route (default: `location.hash = hash`). */
  navigate?: (hash: string) => void;
  /** Added by M8-P7. Random bytes for hold nonces (default: crypto). */
  random?: (n: number) => Uint8Array;
  /** Added by M8-P7. The broker tick (default 250 ms). */
  tickMs?: number;
  /** Added by M8-P7. Follow the page's route (turn off in a networked room); default when a window exists. */
  followRoutes?: boolean;
  /**
   * Added by M8-P7. Whether the public relays that introduce players are reachable, asked JOIN_TIMEOUT_MS after the
   * lobby was opened: false fails the search with the relay text (matchmaking.md 2.14), null when unknown or not
   * applicable. Default: on the Trystero transport, whether the page is online and any relay socket is open; else null.
   */
  relays?: () => Promise<boolean | null>;
}

/** Whether this build has a working matchmaker: Home enables Quick match. */
export const MATCHMAKING_AVAILABLE: boolean = true;
/** "You are the only one looking" after this much of the own wait with no other seeker in the own queues (matchmaking.md 2.17). */
export const ALONE_AFTER_MS = 10_000;
/**
 * Join of the lobby not complete after this, or no relay reachable this long after the lobby was opened: phase failed
 * 'relays' (matchmaking.md 2.14).
 */
export const JOIN_TIMEOUT_MS = 15_000;
/** A formed match stays in the lobby this long at most, so its last messages arrive (matchmaking.md 2.6). */
export const LOBBY_LINGER_MS = 10_000;

const BANDS: Record<StrengthBand, Band> = { rough: 1, casual: 2, solid: 3, tuned: 4, fierce: 5 };

/** The status line texts Home shows (matchmaking.md 2.8; contracts.md Part G "Matchmaking" items 4 and 5). */
export const MM_TEXT = {
  firstSearch: 'Connects your browser directly to other players who are looking. They see your name and network address.',
  rankedHonesty: 'Ranked counts only when the loser concedes.',
  connecting: 'CONNECTING TO THE LOBBY…',
  alone: 'You are the only one looking right now.',
  relays: 'Cannot reach the public relays that introduce players to each other. Check your internet connection.',
  blocked: 'This browser blocks local storage, which matchmaking needs for your identity.',
  missed: 'You missed the match. Search stopped.',
  unreachable: (name: string): string => `${name} could not be reached directly. Some networks do not allow it, and Spellplane uses no relay.`,
  notAccepted: (name: string): string => `${name} did not accept. Back in the queue.`,
  notAnswered: (name: string): string => `${name} did not answer. Back in the queue.`,
} as const;

/** The queue text of the chip and the card: `1V1 RANKED`, `4 FREE-FOR-ALL CASUAL`. */
export function queueLabel(queue: QueueId): string {
  const { format, mode } = queueParts(queue);
  const f = format === '1v1' ? '1V1' : format === '2hg' ? '2V2' : format === 'ffa3' ? '3 FREE-FOR-ALL' : '4 FREE-FOR-ALL';
  return `${f} ${mode.toUpperCase()}`;
}

/** `0:42`, `12:05`. */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The status line for a status (Home and the queue bar): one honest fact at a time. */
export function statusLine(s: MatchmakerStatus, now: number): string {
  switch (s.phase) {
    case 'off':
      return MM_TEXT.firstSearch;
    case 'connecting':
      return MM_TEXT.connecting;
    case 'watching':
      return lookingText(s.lobby);
    case 'seeking': {
      if (s.alone) return MM_TEXT.alone;
      const w = s.window;
      if (w.rating === null && w.band === null) return 'RANGE: ANYONE';
      const waited = now - s.since;
      return waited >= ALONE_AFTER_MS ? `RANGE ±${w.rating ?? '∞'} · DECKS ±${w.band ?? '∞'}` : lookingText(s.lobby, s.queues);
    }
    case 'check':
      return 'MATCH FOUND';
    case 'moving':
      return 'CONNECTING TO THE TABLE…';
    case 'failed':
      return s.text;
  }
}

function lookingText(lobby: LobbyView, queues: readonly QueueId[] = []): string {
  const n = lobby.seekers.length;
  const mine = lobby.seekers.filter((x) => x.queues.some((q) => queues.includes(q))).length;
  const plus = lobby.full ? '+' : '';
  return queues.length > 0 ? `${n}${plus} LOOKING NOW · ${mine} IN YOUR QUEUE` : `${n}${plus} LOOKING NOW`;
}

/** The extra controls of the page's matchmaker (the debug hook, the match room and the UI). */
export interface MatchmakerControl extends Matchmaker {
  /** The matchmaker's clock (the page clock plus what the debug hook advanced). */
  now(): number;
  /** Move the clock forward by `ms` and tick (debug hook `mm.tick(ms)`). */
  advance(ms: number): void;
  room(): LobbyRoom | null;
  /** Every lobby message this page sent or received since load (debug hook, leak test). */
  messages(): LobbyMessageRecord[];
  /** The match room was reached by every member: the search is over. */
  arrived(roomId: string): void;
  /** The match room was not reached in time: back to seeking, waiting time kept. */
  stranded(roomId: string, missing: string | null): void;
  /** The player left the match room before its start: true when this matchmaker was moving to it and abandoned the match. */
  left(roomId: string): boolean;
  /** The pending short notice (a declined, missed or unreachable match); null when none. Does not take it. */
  notice(): string | null;
  /** Take the pending notice once (MatchHost shows it): `again` offers SEARCH AGAIN (a match that could not be reached). */
  takeNotice(): MatchNotice | null;
  /** The match room reports which member it still misses (the arrival rule's notice names it). */
  reaching(roomId: string, missing: string | null): void;
  /** `SEARCH AGAIN`: with a search config kept (after a match that could not be reached) and no search running, search again. */
  searchAgain(): void;
  /** The deck library the search reads (debug hook: a spec stores its deck first). */
  decks(): DeckStore;
  /** The formed matches of this profile (debug hook). */
  matches(): MatchStore;
  /** This profile's ratings (debug hook). */
  ratings(): RatingStore;
  /** The page went to `hash` (the hashchange listener calls it): a networked room that is not the match's turns it off. */
  route(hash: string): void;
}

/** A short notice after a match that fell through (journey.md 4.6, 4.7). */
export interface MatchNotice {
  text: string;
  /** Offer SEARCH AGAIN (the match could not be reached). */
  again: boolean;
}

interface SearchConfig {
  queues: QueueId[];
  deckId: string;
  open: boolean;
  rev: number;
}

/** One matchmaker per page (matchmaking.md 2.13). */
export function createMatchmaker(deps: MatchmakerDeps): MatchmakerControl {
  let offset = 0;
  const now = (): number => (deps.now ?? Date.now)() + offset;
  const random =
    deps.random ??
    ((n: number): Uint8Array => {
      const b = new Uint8Array(n);
      globalThis.crypto.getRandomValues(b);
      return b;
    });
  const listeners = new Set<(s: MatchmakerStatus) => void>();
  /** The page's record of lobby messages across rooms: dev and test builds only (debug hook, leak test). */
  const log: LobbyMessageRecord[] = [];
  let room: LobbyRoom | null = null;
  let transport: Transport | null = null;
  let mode: 'off' | 'connecting' | 'live' | 'moving' | 'failed' = 'off';
  let moving: Extract<MatchmakerStatus, { phase: 'moving' }> | null = null;
  let failed: Extract<MatchmakerStatus, { phase: 'failed' }> | null = null;
  let config: SearchConfig | null = null;
  /** The search's start on this clock, kept across a stranded match. */
  let since: number | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lingerTimer: ReturnType<typeof setTimeout> | null = null;
  const timerToken = {};
  let last = '';
  let pendingNotice: MatchNotice | null = null;
  /** The arrival deadline of the match being moved to (matchmaker clock), and whom the room still misses. */
  let arriveBy: number | null = null;
  let arriveMissing: string | null = null;
  let identityP: Promise<NetIdentity> | null = null;
  /** The lobby being opened (one for every caller until it is joined or failed). */
  let opening: Promise<LobbyRoom | null> | null = null;
  let relayTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let generation = 0;
  /** `watch(true)` was asked for: stay in the lobby as a watcher without a search. */
  let watching = false;

  // What main.ts does not hand over (the identity and the games store) comes from the profile's own stores, opened once.
  let storesP: Promise<{ identity: IdentityStore; games: GameStore }> | null = null;
  const ownStores = (): Promise<{ identity: IdentityStore; games: GameStore }> => {
    storesP ??= import('../store/stores').then((m) => m.openStores());
    storesP.catch(() => (storesP = null));
    return storesP;
  };
  const gamesStore = async (): Promise<GameStore | null> => {
    if (deps.games !== undefined) return deps.games;
    return (await ownStores().catch(() => null))?.games ?? null;
  };
  const identityStore = async (): Promise<IdentityStore> => deps.identityStore ?? (await ownStores()).identity;
  const identity = (): Promise<NetIdentity> => {
    identityP ??= (async () => {
      if (deps.identity) return deps.identity();
      const r = await (await identityStore()).get();
      return createNetIdentity(r.keyPair, r.peerId, r.nickname);
    })();
    identityP.catch(() => (identityP = null));
    return identityP;
  };
  /** The nickname as it is now (a rename on Home or in Settings reaches the next ticket); the keys stay cached. */
  const nickname = async (id: NetIdentity): Promise<string> => {
    if (deps.identity) return id.nickname;
    return (await (await identityStore()).get().catch(() => null))?.nickname ?? id.nickname;
  };
  const relays =
    deps.relays ??
    (deps.transport
      ? (): Promise<null> => Promise.resolve(null)
      : async (): Promise<boolean | null> => {
          if ((await import('./transports')).pageTransportKind() !== 'trystero') return null;
          if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
          const nostr = await import('trystero/nostr');
          const sockets = (nostr.getRelaySockets as () => Record<string, { readyState: number }>)();
          return Object.values(sockets).some((x) => x.readyState === 1);
        });

  const status = (): MatchmakerStatus => {
    if (mode === 'off') return { phase: 'off' };
    if (mode === 'failed' && failed) return failed;
    if (mode === 'moving' && moving) return moving;
    if (mode === 'connecting' || !room) return { phase: 'connecting' };
    const st = room.state;
    const lobby = room.view();
    const t = now();
    if (st.phase === 'check' && st.check) {
      const c = st.check;
      const names = (tid: string): string => (tid === st.tid ? (st.ticket?.name ?? '') : (st.peers[tid]?.ticket?.name ?? ''));
      const view = matchView(st, c.offer.members.map((m) => m.tid), c.offer.queue);
      const order = c.offer.members.map((m) => m.tid);
      const players = view.players.map((p, i) => ({ ...p, accepted: p.me ? c.accepted : c.ready.includes(order[i]!) }));
      return { phase: 'check', lobby, match: { ...view, players }, deadline: c.deadline, accepted: c.ready.map(names), mine: c.accepted };
    }
    if (st.ticket && config && (st.phase === 'seeking' || st.phase === 'collecting' || st.phase === 'held')) {
      const s0 = st.since ?? t;
      const waited = Math.max(0, t - s0);
      const w = windowOf(waited, st.ticket.open);
      const others = config.queues.reduce((n, q) => n + (lobby.byQueue[q] ?? 0), 0);
      return { phase: 'seeking', lobby, since: s0, window: { rating: w.rating, band: w.band }, alone: waited >= ALONE_AFTER_MS && others === 0, deckId: config.deckId, queues: [...config.queues] };
    }
    return { phase: 'watching', lobby };
  };

  const notify = (): void => {
    const s = status();
    const key = JSON.stringify(s);
    if (key === last) return;
    last = key;
    for (const l of [...listeners]) l(s);
  };

  const startTimer = (): void => {
    if (timer !== null) return;
    timer = setInterval(() => tick(), deps.tickMs ?? 250);
    track('timers', timerToken);
  };
  const stopTimer = (): void => {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
    untrack('timers', timerToken);
  };

  const tick = (): void => {
    room?.tick();
    if (mode === 'moving' && moving && arriveBy !== null && now() >= arriveBy) strand(moving.link.roomId, arriveMissing);
    notify();
  };

  const closeRoom = (): void => {
    if (lingerTimer !== null) {
      clearTimeout(lingerTimer);
      lingerTimer = null;
    }
    if (relayTimer !== null) {
      clearTimeout(relayTimer);
      relayTimer = null;
    }
    if (room) {
      room.leave();
      room = null;
    }
    if (transport) {
      untrack('transports', transport);
      transport = null;
    }
    stopTimer();
  };

  const fail = (problem: 'relays' | 'blocked', text: string): null => {
    closeRoom();
    mode = 'failed';
    failed = { phase: 'failed', problem, text };
    notify();
    return null;
  };

  /** The joined lobby, opening it first when needed; every caller waits for the same join. Null when it failed or was given up. */
  const open = (): Promise<LobbyRoom | null> => {
    if (opening) return opening;
    if (room) return Promise.resolve(room);
    const p = openRoom().finally(() => {
      if (opening === p) opening = null;
    });
    opening = p;
    return p;
  };

  const openRoom = async (): Promise<LobbyRoom | null> => {
    const gen = ++generation;
    mode = 'connecting';
    failed = null;
    notify();
    let id: NetIdentity;
    try {
      id = await identity();
    } catch {
      return disposed || gen !== generation ? null : fail('blocked', MM_TEXT.blocked);
    }
    if (disposed || gen !== generation) return null;
    let r: LobbyRoom;
    try {
      const make = deps.transport ?? (await import('./transports')).createPageTransport;
      if (disposed || gen !== generation) return null;
      transport = make();
      track('transports', transport);
      r = new LobbyRoom({
        transport,
        identity: id,
        now,
        random,
        onEffect: (e) => void onEffect(e),
        onChange: () => notify(),
      });
    } catch {
      return fail('relays', MM_TEXT.relays);
    }
    if (__SPELLPLANE_DEBUG__) {
      // Keep the page's record of lobby messages across rooms (debug hook, leak test).
      const push = r.log.push.bind(r.log);
      r.log.push = (...items: LobbyMessageRecord[]): number => {
        log.push(...items);
        if (log.length > 2000) log.splice(0, log.length - 2000);
        return push(...items);
      };
    }
    room = r;
    startTimer();
    let joined = false;
    let joinTimer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<void>((resolve) => (joinTimer = setTimeout(resolve, JOIN_TIMEOUT_MS)));
    const openedAt = now();
    try {
      await Promise.race([r.join().then(() => (joined = true)), timeout]);
    } catch {
      // The transport could not join at all (its module did not load, no WebRTC): the lobby is out of reach.
      if (joinTimer !== null) clearTimeout(joinTimer);
      return disposed || room !== r ? null : fail('relays', MM_TEXT.relays);
    }
    if (joinTimer !== null) clearTimeout(joinTimer);
    if (disposed || room !== r) return null;
    if (!joined) return fail('relays', MM_TEXT.relays);
    mode = 'live';
    notify();
    // Joined is not reached: Trystero's join returns before any relay answered. Ask the relays once the join's time
    // is up; none reachable fails the search while nothing is under way (matchmaking.md 2.14).
    relayTimer = setTimeout(() => {
      relayTimer = null;
      void relays()
        .catch(() => null)
        .then((ok) => {
          if (ok !== false || room !== r || mode !== 'live') return;
          const phase = r.state.phase;
          if (phase === 'watching' || phase === 'seeking') fail('relays', MM_TEXT.relays);
        });
    }, Math.max(0, JOIN_TIMEOUT_MS - (now() - openedAt)));
    return r;
  };

  const ticketDraft = async (c: SearchConfig): Promise<TicketDraft> => {
    const deck = await deps.decks.get(c.deckId).catch(() => null);
    const info = deck ? queueDeckInfo(deck) : null;
    const ratings: TicketDraft['ratings'] = {};
    for (const q of c.queues) {
      const key = pairingKeyOf(q);
      if (key === null || ratings[key]) continue;
      const r = await deps.ratings.get(key).catch(() => null);
      ratings[key] = { r: r?.rating ?? 1500, g: r?.games ?? 0 };
    }
    const id = await identity();
    const nick = await nickname(id);
    // Without a nickname the player is named by its peer id, so two of them are never both "Player".
    // eslint-disable-next-line no-control-regex
    const name = nick.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24) || `Player ${id.peerId.slice(0, 4).toUpperCase()}`;
    return {
      name,
      proto: PROTOCOL_VERSION,
      queues: [...c.queues],
      ratings,
      // Without a computed strength the ticket matches as average (matchmaking.md 2.7).
      band: info ? BANDS[info.band] : 3,
      score: info ? Math.max(0, Math.min(100, Math.round(info.strength))) : 50,
      open: c.open,
      nat: 'unknown',
      rev: c.rev,
    };
  };

  const announce = async (): Promise<void> => {
    const c = config;
    if (!c) return;
    const r = await open();
    if (!r || config !== c) return;
    const draft = await ticketDraft(c);
    if (config !== c || room !== r) return;
    await r.seek(draft, 0, since ?? undefined);
    since ??= r.state.since;
    notify();
  };

  const onEffect = async (e: BrokerEffect): Promise<void> => {
    if (e.kind === 'returned') {
      const who = e.name ?? 'Another player';
      pendingNotice = { text: e.reason === 'declined' ? MM_TEXT.notAccepted(who) : MM_TEXT.notAnswered(who), again: false };
    } else if (e.kind === 'stopped') {
      config = null;
      since = null;
      pendingNotice = e.reason === 'lapsed' ? { text: MM_TEXT.missed, again: false } : null;
      queueMicrotask(settle);
    } else if (e.kind === 'formed') {
      await formed(e.match);
    }
    notify();
  };

  const formed = async (f: FormedMatch): Promise<void> => {
    const r = room;
    if (!r || !config) return;
    const st = r.state;
    let plan: MatchPlan;
    try {
      plan = planOf(f, st.tid, config.deckId, now());
    } catch (err) {
      // A match this browser cannot plan (a member without a ticket) is not entered: back in the queue.
      console.warn('Spellplane: the formed match could not be planned', err);
      requeue();
      return;
    }
    moving = { phase: 'moving', link: { roomId: f.roomId, key: f.roomKey }, match: matchView(st, f.order, f.queue), plan };
    mode = 'moving';
    arriveBy = now() + ARRIVE_MS;
    // Until the match room reports otherwise, the first other member in seat order is the one missing.
    arriveMissing = plan.seats.find((x) => x.peerId !== st.peerId)?.name ?? null;
    // The room is entered; the lobby is left once every member arrived, or after 10 s (matchmaking.md 2.6), so the
    // last `ready` still reaches the others. The ticket and the waiting time stay in memory for the arrival rule, and
    // the tick keeps running for its deadline.
    lingerTimer = setTimeout(() => {
      lingerTimer = null;
      if (room === r) closeRoom();
      if (mode === 'moving') startTimer();
      notify();
    }, LOBBY_LINGER_MS);
    notify();
    try {
      await deps.matches.put(plan.record);
      const games = await gamesStore();
      await games?.create({
        code: f.roomId,
        key: f.roomKey,
        kind: 'matched',
        format: plan.format,
        decks: queueParts(f.queue).kind === 'limited' ? 'draftPrebuilt' : 'constructed',
        seat: plan.seats.find((s) => s.peerId === st.peerId)?.seat ?? null,
      });
    } catch (err) {
      console.warn('Spellplane: the match could not be saved', err);
    }
    // Abandoned or stranded while the records were written: stay where the page is, and the match is void after all
    // (the void ran before the record existed).
    if (mode !== 'moving' || moving?.link.roomId !== f.roomId) {
      voidMatch(f.roomId);
      return;
    }
    go(`#/t/${f.roomId}/${f.roomKey}`);
  };

  const go = (hash: string): void => {
    if (deps.navigate) deps.navigate(hash);
    else if (typeof location !== 'undefined') location.hash = hash;
  };

  const roomOfRoute = (hash: string): string | null => {
    const m = /^#\/t\/([^/]+)\/([^/]+)/.exec(hash);
    return m ? decodeURIComponent(m[1]!) : null;
  };

  const onRoute = (hash: string): void => {
    const roomId = roomOfRoute(hash);
    if (mode === 'moving' && moving) {
      if (roomId === moving.link.roomId) return;
      // Leaving the match's room before every member arrived abandons the match: void, not in History, search over.
      abandon();
      return;
    }
    if (roomId === null || mode === 'off') return;
    // Entering a networked room turns the matchmaker off (matchmaking.md 2.6).
    mm.cancel();
    off();
  };

  /** The match that is being moved to will not be played: its record is void and its History entry purged. */
  const voidMatch = (roomId: string): void => {
    void deps.matches
      .get(roomId)
      .then((r) => (r && r.state === 'formed' ? deps.matches.put({ ...r, state: 'void' }) : undefined))
      .catch(() => undefined);
    // A matched game that never started is not kept in History (journey.md 4.7).
    void gamesStore()
      .then((g) => g?.purge(roomId))
      .catch(() => undefined);
  };

  const abandon = (): void => {
    if (mode !== 'moving' || !moving) return;
    voidMatch(moving.link.roomId);
    pendingNotice = null;
    off();
  };

  /** The arrival rule: back to seeking with the waiting time kept, off the room route (matchmaking.md 2.6). */
  const strand = (roomId: string, missing: string | null): void => {
    if (mode !== 'moving' || moving?.link.roomId !== roomId) return;
    voidMatch(roomId);
    pendingNotice = { text: MM_TEXT.unreachable(missing ?? 'Another player'), again: true };
    moving = null;
    arriveBy = null;
    arriveMissing = null;
    // Leave the room route (a pending join there ends); `onRoute` ignores it once the matchmaker is not moving.
    const leaveRoute = !follow || typeof location === 'undefined' || roomOfRoute(location.hash) === roomId;
    requeue();
    if (leaveRoute) go('#/');
  };

  /** Back in the queue with the waiting time kept: a fresh lobby connection and the ticket again with a higher rev. */
  const requeue = (): void => {
    moving = null;
    arriveBy = null;
    closeRoom();
    if (!config) {
      off();
      return;
    }
    mode = 'connecting';
    config = { ...config, rev: config.rev + 1 };
    notify();
    void announce();
  };

  const off = (): void => {
    generation++;
    config = null;
    since = null;
    moving = null;
    arriveBy = null;
    arriveMissing = null;
    closeRoom();
    mode = 'off';
    notify();
  };

  /**
   * Without a search and without an explicit `watch(true)` the lobby is left (MM-4: joined only on intent), so a
   * cancelled, declined or missed search releases the lobby transport and the beat.
   */
  const settle = (): void => {
    if (watching || config || mode === 'moving' || mode === 'off') return;
    off();
  };

  const follow = deps.followRoutes ?? typeof window !== 'undefined';
  const onHash = (): void => onRoute(location.hash);
  if (follow) window.addEventListener('hashchange', onHash);

  const mm: MatchmakerControl = {
    status,
    subscribe(listener) {
      listeners.add(listener);
      listener(status());
      return () => void listeners.delete(listener);
    },
    watch(on) {
      watching = on;
      if (on) void open();
      else settle();
    },
    seek(c) {
      if (c.queues.length === 0 || mode === 'moving') return;
      const st = room?.state;
      if (st && (st.phase === 'check' || st.phase === 'held' || st.phase === 'collecting' || st.phase === 'seeking') && config) return;
      config = { queues: c.queues.slice(0, 4), deckId: c.deckId, open: false, rev: 1 };
      since = null;
      pendingNotice = null;
      void deps.settings.set('lastQueue', c.queues[0]!).catch(() => undefined);
      void announce();
    },
    widen() {
      if (!config || config.open) return;
      config = { ...config, open: true, rev: config.rev + 1 };
      void announce();
    },
    cancel() {
      pendingNotice = null;
      if (mode === 'moving') {
        abandon();
        return;
      }
      config = null;
      since = null;
      room?.cancel();
      notify();
      settle();
    },
    answer(accept) {
      room?.answer(accept);
      if (!accept) {
        config = null;
        since = null;
      }
      notify();
      if (!accept) settle();
    },
    avoid: () => Promise.resolve(),
    dispose() {
      disposed = true;
      if (follow) window.removeEventListener('hashchange', onHash);
      off();
      listeners.clear();
      setPageMatchmaker(null, mm);
    },
    now,
    advance(ms) {
      const d = Math.max(0, ms);
      offset += d;
      room?.skew(d);
      tick();
    },
    room: () => room,
    messages: () => [...log],
    arrived(roomId) {
      if (mode !== 'moving' || moving?.link.roomId !== roomId) return;
      arriveBy = null;
      void deps.matches
        .get(roomId)
        .then((r) => (r && r.state === 'formed' ? deps.matches.put({ ...r, state: 'playing' }) : undefined))
        .catch(() => undefined);
      off();
    },
    stranded(roomId, missing) {
      strand(roomId, missing ?? arriveMissing);
    },
    left(roomId) {
      if (mode !== 'moving' || moving?.link.roomId !== roomId) return false;
      abandon();
      return true;
    },
    reaching(roomId, missing) {
      if (mode === 'moving' && moving?.link.roomId === roomId) arriveMissing = missing;
    },
    notice: () => pendingNotice?.text ?? null,
    takeNotice() {
      const n = pendingNotice;
      pendingNotice = null;
      return n;
    },
    decks: () => deps.decks,
    matches: () => deps.matches,
    ratings: () => deps.ratings,
    route: onRoute,
    searchAgain() {
      if (!config || mode === 'moving') return;
      const st = room?.state;
      if (st && st.phase !== 'watching') return;
      void announce();
    },
  };
  setPageMatchmaker(mm);
  return mm;
}

/** What the match-found card shows (seat order, or offer order before the seats are derived). */
function matchView(st: LobbyRoom['state'], order: readonly string[], queue: QueueId): MatchView {
  const ranked = queueParts(queue).mode === 'ranked';
  const teamOf = (tid: string): 0 | 1 | undefined => st.check?.offer.members.find((m) => m.tid === tid)?.team ?? st.formed?.members.find((m) => m.tid === tid)?.team;
  return {
    matchId: st.check?.offer.mid ?? st.formed?.mid ?? '',
    queue,
    players: order.map((tid) => {
      const t = tid === st.tid ? st.ticket : (st.formed?.tickets[tid] ?? st.peers[tid]?.ticket ?? null);
      const team = teamOf(tid);
      return { name: t?.name ?? '…', rating: ranked && t ? ratingFor(t, queue) : null, band: t?.band ?? 3, me: tid === st.tid, ...(team !== undefined ? { team } : {}) };
    }),
  };
}

/** The plan and the MatchRecord of a formed match, seat `s<i>` for the i-th member of the derived order. */
export function planOf(f: FormedMatch, myTid: string, deckId: string, formedAt: number): MatchPlan {
  const { format } = queueParts(f.queue);
  const key: RatingKey | null = pairingKeyOf(f.queue);
  const players: MatchPlayer[] = f.order.map((tid) => {
    const t = f.tickets[tid]!;
    const team = f.members.find((m) => m.tid === tid)?.team;
    return { peerId: t.peerId, pubKey: t.pubKey, name: t.name, rating: ratingFor(t, f.queue) ?? 1500, games: key ? (t.ratings[key]?.g ?? 0) : 0, band: t.band, score: t.score, ...(team !== undefined ? { team } : {}) };
  });
  const record: MatchRecord = { matchId: f.mid, roomId: f.roomId, roomKey: f.roomKey, queue: f.queue, players, formedAt, state: 'formed', deckId };
  void myTid;
  return {
    matchId: f.mid,
    roomId: f.roomId,
    roomKey: f.roomKey,
    queue: f.queue,
    format,
    seats: players.map((p, i) => ({ peerId: p.peerId, name: p.name, seat: `s${i}` as SeatId, ...(p.team !== undefined ? { team: p.team } : {}) })),
    record,
  };
}

