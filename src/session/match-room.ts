/**
 * The hand-over from a formed match to its game room (matchmaking.md 2.6 and 2.9; contracts.md Part D, Part G
 * "Matchmaking" items 2 to 4). M8-P7.
 *
 * - `matchSessionInternals(record, me)`: the member in seat 0 of the plan creates the table, every other member never
 *   sits alone; the session opens with the queue's table format.
 * - `runMatchedEntry(...)`: the automatic setup of a matched table: the creator sets the format, every member takes its
 *   seat and colour by the plan's order and enters with `enterMatch` (autoSetup and matched), the creator starts the
 *   match once every member's deck is committed, and the opening hands are dealt (session/entry.ts). A member that is
 *   not connected to every other member within 30 s goes back to seeking with its waiting time kept and leaves the
 *   room, so nobody ever ends in two rooms.
 * - `watchRatedResult(...)`: the table frame watches every networked table with a MatchRecord while it is mounted;
 *   `applyRatedResult(...)`: when a ranked 1v1 matched game gets `TableState.result`, the rating change is applied
 *   once, locally, and stored as `MatchRecord.rated` (no change with a take-over or a recovery on either seat).
 * - `abandonMatchedTable(...)`: a matched game left or given up before its start is void and not in History.
 */
import type { Format, MatchRecord, SeatColourIndex, SeatId, TableState } from '../core/types';
import { applyRating, freshRating, ratingChanges } from '../net/lobby/rating';
import { ratingKeyOf, type MatchPlan } from '../net/lobby/types';
import type { GameStore, MatchStore, RatingStore } from '../store/types';
import { enterMatch, startAutoSetup } from './entry';
import type { DeckImport, TableSession } from './types';

/** A member must reach every other member of its match within this (contracts.md Part G "Matchmaking" item 2). */
export const ARRIVE_MS = 30_000;

/** What the match room needs of the page's matchmaker (session/matchmaker.ts registers itself). */
export interface MatchRoomMatchmaker {
  arrived(roomId: string): void;
  stranded(roomId: string, missing: string | null): void;
  /** Which member this room still misses (the matchmaker's own arrival deadline names it). */
  reaching?(roomId: string, missing: string | null): void;
  /**
   * The player left this matched room before its game started. True when the matchmaker was moving to it and took
   * care of it (void record, purged History entry, search over); false otherwise.
   */
  left?(roomId: string): boolean;
}

let pageMatchmaker: MatchRoomMatchmaker | null = null;
/** The page's matchmaker registers itself here (one per page); `null` with `only` clears it only while `only` is registered. */
export function setPageMatchmaker(mm: MatchRoomMatchmaker | null, only?: MatchRoomMatchmaker): void {
  if (mm === null && only !== undefined && pageMatchmaker !== only) return;
  pageMatchmaker = mm;
}

const FORMAT_SEATS: Record<Format, number> = { '1v1': 2, ffa3: 3, ffa4: 4, '2hg': 4 };

/** The format of a queue id. */
function formatOf(record: Pick<MatchRecord, 'queue'>): Format {
  return record.queue.split('.')[0] as Format;
}

/** The plan of a formed match as the table entry needs it, from its stored record (matchmaking.md 2.6); null when `me` is not a member. */
export function planOfRecord(record: MatchRecord, me: string): MatchPlan | null {
  if (!record.players.some((p) => p.peerId === me)) return null;
  const format = formatOf(record);
  if (record.players.length !== FORMAT_SEATS[format]) return null;
  return {
    matchId: record.matchId,
    roomId: record.roomId,
    roomKey: record.roomKey,
    queue: record.queue,
    format,
    seats: record.players.map((p, i) => ({ peerId: p.peerId, name: p.name, seat: `s${i}` as SeatId, ...(p.team !== undefined ? { team: p.team } : {}) })),
    record,
  };
}

/** Whether this identity creates the table of a matched room: seat 0 of the plan (contracts.md Part G "Matchmaking" item 3). */
export function createsMatchTable(record: Pick<MatchRecord, 'players'>, peerId: string): boolean {
  return record.players[0]?.peerId === peerId;
}

/**
 * How a matched room's session opens (for main.ts openRoom): the queue's format; seat 0 creates, the others never sit
 * alone; each member sits in its planned chair (`s<i>` for the i-th player of the record), so the table's seats and
 * Two-Headed Giant teams follow the offer whatever order the members arrive in.
 */
export function matchSessionInternals(record: Pick<MatchRecord, 'players' | 'queue'>, peerId: string): { format: Format; createdHere: boolean; neverAlone: boolean; preferSeat?: SeatId } {
  const creator = createsMatchTable(record, peerId);
  const i = record.players.findIndex((p) => p.peerId === peerId);
  return { format: formatOf(record), createdHere: creator, neverAlone: !creator, ...(i >= 0 ? { preferSeat: `s${i}` as SeatId } : {}) };
}

/** The starting life of a format (DESIGN "Players, seats and formats": 20, Two-Headed Giant 30). */
function startingLife(format: Format): number {
  return format === '2hg' ? 30 : 20;
}

/** Which plan members this session is connected to. */
function connectedPeers(session: TableSession): Set<string> {
  return new Set(
    session
      .netStatus()
      .peers.filter((p) => p.status === 'connected' && p.peerId !== '')
      .map((p) => p.peerId),
  );
}

export type MatchedEntryStage = 'connecting' | 'entering' | 'match' | 'stranded';

/** Once every member is connected, the match must start within this, or the entry gives up (decision M8-P7). */
export const START_MS = 30_000;

export interface MatchedEntryOptions {
  session: TableSession;
  record: MatchRecord;
  /** This browser's identity peer id. */
  me: string;
  /** The deck to commit (the one the ticket was made for), or null when it cannot be read. */
  deck: DeckImport | null;
  /** The member could not reach everyone: leave the room (the matchmaker already went back to seeking). */
  onStranded?: (text: string) => void;
  /**
   * Every member was reached but the match did not start within START_MS (a deck that could not be read, a member that
   * closed its page before the start): the entry gave up with this text; leave the room.
   */
  onStalled?: (text: string) => void;
  onStage?: (stage: MatchedEntryStage) => void;
  matchmaker?: MatchRoomMatchmaker | null;
  arriveMs?: number;
  startMs?: number;
  /**
   * Run the automatic setup (deal and roll once the table plays) here too. Default true; the table frame runs its own
   * (`startAutoSetup` on mount), so MatchedEntry.svelte passes false and two deals never race.
   */
  autoSetup?: boolean;
}

/** The unreachable text (matchmaker.ts MM_TEXT.unreachable). */
export function unreachableText(name: string): string {
  return `${name} could not be reached directly. Some networks do not allow it, and Spellplane uses no relay.`;
}

/** The text when the own deck cannot be read at a matched table (decision M8-P7). */
export const DECK_UNREADABLE = 'Your deck could not be read, so the match could not start.';

/** The text when a member never got ready at a matched table (decision M8-P7). */
export function notStartedText(name: string): string {
  return `${name} did not get to the table, so the match could not start.`;
}

/**
 * Drive a matched table from the first connection to the opening hands (matchmaking.md 2.6; contracts.md Part D).
 * Returns the stop function.
 */
export function runMatchedEntry(o: MatchedEntryOptions): () => void {
  const { session, record, me } = o;
  const plan = planOfRecord(record, me);
  const mm = o.matchmaker === undefined ? pageMatchmaker : o.matchmaker;
  if (!plan) return () => undefined;
  const mine = plan.seats.findIndex((s) => s.peerId === me);
  const creator = mine === 0;
  const others = plan.seats.filter((s) => s.peerId !== me);
  const want = plan.seats[mine]!.seat;
  let stopped = false;
  let stage: MatchedEntryStage = 'connecting';
  let arrived = false;
  let entered = false;
  let entering = false;
  let started = false;
  let seatTries = 0;
  let stopAuto: (() => void) | null = null;
  let startTimer: ReturnType<typeof setTimeout> | null = null;
  const setStage = (s: MatchedEntryStage): void => {
    if (stage === s) return;
    stage = s;
    o.onStage?.(s);
  };
  o.onStage?.(stage);

  const seatOfPeer = (st: TableState, peer: string): TableState['seats'][SeatId] | undefined => Object.values(st.seats).find((x) => x.peer === peer);
  const committed = (st: TableState, peer: string): boolean => {
    const seat = seatOfPeer(st, peer);
    return seat !== undefined && Object.hasOwn(st.commitments, seat.id);
  };
  const seatedMembers = (st: TableState): boolean => plan.seats.every((s) => committed(st, s.peerId));

  const checkArrival = (): void => {
    if (arrived || stopped) return;
    const peers = connectedPeers(session);
    const missing = others.find((s) => !peers.has(s.peerId));
    if (!missing) {
      arrived = true;
      clearTimeout(timer);
      mm?.arrived(record.roomId);
      // Reached everyone: the match must now start in time, or the entry gives up with the reason.
      startTimer = setTimeout(stall, o.startMs ?? START_MS);
    } else mm?.reaching?.(record.roomId, missing.name);
  };
  const stall = (): void => {
    if (stopped) return;
    const st = session.getState();
    if (st.stage !== 'lobby') return;
    const text = o.deck === null || !committed(st, me) ? DECK_UNREADABLE : notStartedText(plan.seats.find((s) => !committed(st, s.peerId))?.name ?? 'Another player');
    setStage('stranded');
    stop();
    o.onStalled?.(text);
  };
  const timer = setTimeout(() => {
    if (stopped || arrived) return;
    const peers = connectedPeers(session);
    const missing = others.find((s) => !peers.has(s.peerId));
    setStage('stranded');
    stop();
    mm?.stranded(record.roomId, missing?.name ?? null);
    o.onStranded?.(unreachableText(missing?.name ?? 'Another player'));
  }, o.arriveMs ?? ARRIVE_MS);

  /**
   * Sit in the planned chair (seats and Two-Headed Giant teams follow the offer). The session took one on its own when
   * it opened (the planned one when free, main.ts `preferSeat`); while another member that is not in its own planned
   * chair holds this one, wait: it moves on. Resolves the chair to commit in, or null to wait for the next change.
   */
  const planned = (st: TableState): SeatId | null => {
    if (session.seat === want && st.seats[want]?.peer === me) return want;
    const holder = st.seats[want];
    if (!holder) return session.seat;
    const free = holder.peer === undefined && holder.name.trim() === '';
    if (free && seatTries < 8) {
      seatTries++;
      session.takeSeat(want, mine as SeatColourIndex);
      return null;
    }
    const other = holder.peer === undefined ? -1 : plan.seats.findIndex((s) => s.peerId === holder.peer);
    // Another member sits here and is not in its own planned chair: it moves to it, then this chair frees.
    // (Two members in each other's chairs never free one: both stay where they sit rather than wait for ever.)
    if (other >= 0 && other !== mine && plan.seats[other]!.seat !== want && plan.seats[other]!.seat !== session.seat && seatTries < 8) return null;
    return session.seat;
  };

  const step = async (): Promise<void> => {
    if (stopped || entering) return;
    const st = session.getState();
    if (st.stage !== 'lobby') {
      if (st.stage === 'match') {
        setStage('match');
        if (startTimer !== null) clearTimeout(startTimer);
      }
      if (!entered && st.seats[session.seat]) {
        // A member that arrives after the start (a reload) still deals its hand.
        entered = true;
        if (o.autoSetup !== false) stopAuto ??= startAutoSetup(session, { creator });
      }
      return;
    }
    if (creator && st.format !== plan.format) {
      if (!Object.values(st.seats).some((s) => s.ready) && Object.keys(st.commitments).length === 0) {
        session.dispatch({ type: 'formatSet', format: plan.format, life: startingLife(plan.format) });
      }
      return;
    }
    // The others wait for the creator's format before they commit (the format cannot change once a player is Ready).
    if (st.format !== plan.format) return;
    if (!entered) {
      const seat = planned(st);
      if (seat === null) return;
      entering = true;
      setStage('entering');
      try {
        await enterMatch(session, { seat, colour: mine as SeatColourIndex, deck: o.deck, matched: true, creator });
        entered = true;
        if (o.autoSetup !== false) stopAuto ??= startAutoSetup(session, { creator });
      } catch (e) {
        console.warn('Spellplane: the matched entry failed a step', e);
      } finally {
        entering = false;
      }
    }
    const now = session.getState();
    if (creator && !started && now.stage === 'lobby' && seatedMembers(now) && session.evening) {
      started = true;
      try {
        session.evening.setLobby({ draft: null, sets: now.lobby?.sets ?? ['M19'], pickTimer: false });
        session.evening.start();
      } catch (e) {
        started = false;
        console.warn('Spellplane: the matched table did not start', e);
      }
    }
  };

  const onState = (): void => {
    checkArrival();
    void step();
  };
  const offState = session.subscribe(onState);
  const offNet = session.subscribeNet(() => checkArrival());
  onState();

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    if (startTimer !== null) clearTimeout(startTimer);
    offState();
    offNet();
    stopAuto?.();
  }
  return stop;
}

/**
 * A matched game that will not be played after all (the entry gave up, or the player left before the start): its record
 * becomes void and its History entry is purged (journey.md 4.7). The page's matchmaker does it when it is still moving
 * to this room (and goes back to its search as designed); otherwise it is done here. A game that started is kept.
 */
export async function abandonMatchedTable(o: { session: Pick<TableSession, 'getState'>; roomId: string; matches: MatchStore | null; games: GameStore | null; matchmaker?: MatchRoomMatchmaker | null }): Promise<void> {
  if (o.session.getState().stage !== 'lobby') return;
  const mm = o.matchmaker === undefined ? pageMatchmaker : o.matchmaker;
  if (mm?.left?.(o.roomId) === true) return;
  const r = await o.matches?.get(o.roomId).catch(() => null);
  if (r && (r.state === 'formed' || r.state === 'playing')) await o.matches?.put({ ...r, state: 'void' }).catch(() => undefined);
  await o.games?.purge(o.roomId).catch(() => undefined);
}

/**
 * Watch a matched table for its sequenced result and apply the rating change once (applyRatedResult). The table frame
 * starts one for every networked table with a MatchRecord, at any stage, and stops it when it unmounts: a reload, a
 * re-entry from History or CONTINUE, or a result that arrived while the player was away is applied when the table is
 * open again (matchmaking.md 2.9: the absent player's browser applies it when it next syncs the room). `me` defaults to
 * the peer of the session's own seat. Returns the stop function; nothing outlives it.
 */
export function watchRatedResult(o: { session: Pick<TableSession, 'getState' | 'subscribe' | 'seat' | 'log'>; roomId: string; me?: string; ratings: RatingStore; matches: MatchStore }): () => void {
  let done = false;
  let stopped = false;
  let off: (() => void) | null = null;
  const stop = (): void => {
    done = true;
    stopped = true;
    off?.();
    off = null;
  };
  const check = (): void => {
    if (done) return;
    const st = o.session.getState();
    if (!st.result) return;
    const me = o.me ?? st.seats[o.session.seat]?.peer;
    if (!me) return;
    done = true;
    void applyRatedResult({ state: st, roomId: o.roomId, me, ratings: o.ratings, matches: o.matches, recovered: recoveredSeats(o.session) }).then(
      () => stop(),
      (e: unknown) => {
        if (!stopped) done = false;
        console.warn('Spellplane: the rating change could not be saved', e);
      },
    );
  };
  const unsubscribe = o.session.subscribe(check);
  if (stopped) unsubscribe();
  else off = unsubscribe;
  check();
  return stop;
}

/** The seats that went through a lost-save recovery in this table's log. */
export function recoveredSeats(session: Pick<TableSession, 'log' | 'getState'>): SeatId[] {
  const out = new Set<SeatId>();
  for (const s of Object.values(session.getState().seats)) if (s.recovering) out.add(s.id);
  for (const e of session.log()) if (e.kind === 'action' && (e.action.type === 'recover' || e.action.type === 'recoverCommit')) out.add(e.action.by as SeatId);
  return [...out];
}

const applying = new Set<string>();

/**
 * Apply the rating change of a ranked 1v1 matched game once (matchmaking.md 2.7, 2.9; contracts.md Part G
 * "Matchmaking" item 4): from the frozen MatchRecord and the sequenced result; stored as `MatchRecord.rated`. Resolves
 * to the stored record, or null when nothing was applied (casual, no result, already applied, or not counted).
 */
export async function applyRatedResult(o: { state: TableState; roomId: string; me: string; ratings: RatingStore; matches: MatchStore; recovered?: readonly SeatId[]; now?: number }): Promise<MatchRecord | null> {
  const result = o.state.result;
  const key0 = `${o.roomId}|${o.me}`;
  if (!result || applying.has(key0)) return null;
  applying.add(key0);
  try {
    const record = await o.matches.get(o.roomId);
    if (!record || record.rated) return null;
    const key = ratingKeyOf(record.queue);
    if (key === null || record.players.length !== 2) {
      if (record.state !== 'finished') await o.matches.put({ ...record, state: 'finished' });
      return null;
    }
    const seatOf = (peerId: string): SeatId | null => Object.values(o.state.seats).find((s) => s.peer === peerId)?.id ?? null;
    const seats = record.players.map((p) => seatOf(p.peerId));
    // A player whose peer holds no seat any more (taken over by an invitee) is not counted, never read as no take-over.
    if (seats.some((x) => x === null)) {
      if (record.state !== 'finished') await o.matches.put({ ...record, state: 'finished' });
      return null;
    }
    const winnerIdx = seats.findIndex((s) => s !== null && result.winners.includes(s));
    const mineIdx = record.players.findIndex((p) => p.peerId === o.me);
    if (winnerIdx < 0 || mineIdx < 0) return null;
    const changes = ratingChanges(
      record.players.map((p, i) => {
        const seat = seats[i] ? o.state.seats[seats[i]!] : undefined;
        return { rating: p.rating, games: p.games, band: p.band, side: i as 0 | 1, takeovers: seat?.takeovers ?? 0, recovered: seats[i] !== null && (o.recovered ?? []).includes(seats[i]!) };
      }),
      winnerIdx as 0 | 1,
    );
    const now = o.now ?? Date.now();
    if (!changes) {
      await o.matches.put({ ...record, state: 'finished' });
      return null;
    }
    const own = changes[mineIdx]!;
    // The own record is the source of truth for the own rating; the change is computed from the frozen inputs.
    const stored = (await o.ratings.get(key)) ?? freshRating(key, now);
    const change = { before: stored.rating, after: Math.max(100, stored.rating + own.delta), delta: 0 };
    change.delta = change.after - change.before;
    // The record says `rated` first: a failure before the rating is stored loses this one change rather than applying it
    // twice on the next try.
    const next: MatchRecord = { ...record, state: 'finished', rated: { key, before: change.before, after: change.after }, delta: change.delta };
    await o.matches.put(next);
    await o.ratings.put(applyRating(stored, change, mineIdx === winnerIdx, now));
    return next;
  } finally {
    applying.delete(key0);
  }
}
