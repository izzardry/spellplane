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
 * - `applyRatedResult(...)`: when a ranked 1v1 matched game gets `TableState.result`, the rating change is applied
 *   once, locally, and stored as `MatchRecord.rated` (no change with a take-over or a recovery on either seat).
 */
import type { Format, MatchRecord, SeatColourIndex, SeatId, TableState } from '../core/types';
import { applyRating, freshRating, ratingChanges } from '../net/lobby/rating';
import { ratingKeyOf, type MatchPlan } from '../net/lobby/types';
import type { MatchStore, RatingStore } from '../store/types';
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
}

let pageMatchmaker: MatchRoomMatchmaker | null = null;
/** The page's matchmaker registers itself here (one per page). */
export function setPageMatchmaker(mm: MatchRoomMatchmaker | null): void {
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

/** How a matched room's session opens (for main.ts openRoom): the queue's format; seat 0 creates, the others never sit alone. */
export function matchSessionInternals(record: Pick<MatchRecord, 'players' | 'queue'>, peerId: string): { format: Format; createdHere: boolean; neverAlone: boolean } {
  const creator = createsMatchTable(record, peerId);
  return { format: formatOf(record), createdHere: creator, neverAlone: !creator };
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

export interface MatchedEntryOptions {
  session: TableSession;
  record: MatchRecord;
  /** This browser's identity peer id. */
  me: string;
  /** The deck to commit (the one the ticket was made for), or null when it cannot be read. */
  deck: DeckImport | null;
  /** The member could not reach everyone: leave the room (the matchmaker already went back to seeking). */
  onStranded?: (text: string) => void;
  onStage?: (stage: MatchedEntryStage) => void;
  matchmaker?: MatchRoomMatchmaker | null;
  ratings?: RatingStore | null;
  matches?: MatchStore | null;
  arriveMs?: number;
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
  let stopped = false;
  let stage: MatchedEntryStage = 'connecting';
  let arrived = false;
  let entered = false;
  let entering = false;
  let started = false;
  let stopAuto: (() => void) | null = null;
  const setStage = (s: MatchedEntryStage): void => {
    if (stage === s) return;
    stage = s;
    o.onStage?.(s);
  };
  o.onStage?.(stage);

  const checkArrival = (): void => {
    if (arrived || stopped) return;
    const peers = connectedPeers(session);
    const missing = others.find((s) => !peers.has(s.peerId));
    if (!missing) {
      arrived = true;
      clearTimeout(timer);
      mm?.arrived(record.roomId);
    } else mm?.reaching?.(record.roomId, missing.name);
  };
  const timer = setTimeout(() => {
    if (stopped || arrived) return;
    const peers = connectedPeers(session);
    const missing = others.find((s) => !peers.has(s.peerId));
    setStage('stranded');
    stop();
    ratingWatchers.get(`${record.roomId}|${me}`)?.();
    mm?.stranded(record.roomId, missing?.name ?? null);
    o.onStranded?.(unreachableText(missing?.name ?? 'Another player'));
  }, o.arriveMs ?? ARRIVE_MS);

  const seatedMembers = (st: TableState): boolean =>
    plan.seats.every((s) => Object.values(st.seats).some((x) => x.peer === s.peerId)) && plan.seats.every((s) => {
      const seat = Object.values(st.seats).find((x) => x.peer === s.peerId);
      return seat !== undefined && Object.hasOwn(st.commitments, seat.id);
    });

  const step = async (): Promise<void> => {
    if (stopped || entering) return;
    const st = session.getState();
    if (st.stage !== 'lobby') {
      if (st.stage === 'match') setStage('match');
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
      entering = true;
      setStage('entering');
      try {
        const want = plan.seats[mine]!.seat;
        const holder = st.seats[want];
        const free = holder !== undefined && (holder.peer === undefined || holder.peer === me) && (holder.peer !== undefined || holder.name.trim() === '');
        const seat = free ? want : session.seat;
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

  // The rating watcher outlives the entry (MatchedEntry unmounts when the stage leaves the lobby): it runs until the
  // result is applied or another entry for the same room replaces it.
  if (o.ratings && o.matches) watchRatedResult({ session, roomId: record.roomId, me, ratings: o.ratings, matches: o.matches });
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
    offState();
    offNet();
    stopAuto?.();
  }
  return stop;
}

const ratingWatchers = new Map<string, () => void>();

/**
 * Watch a matched table for its sequenced result and apply the rating change once (applyRatedResult). One watcher per
 * room and identity; a new one replaces the old. Returns the stop function.
 */
export function watchRatedResult(o: { session: TableSession; roomId: string; me: string; ratings: RatingStore; matches: MatchStore }): () => void {
  const id = `${o.roomId}|${o.me}`;
  ratingWatchers.get(id)?.();
  let done = false;
  let stopped = false;
  let off: (() => void) | null = null;
  const stop = (): void => {
    done = true;
    stopped = true;
    off?.();
    off = null;
    if (ratingWatchers.get(id) === stop) ratingWatchers.delete(id);
  };
  const check = (): void => {
    if (done) return;
    const st = o.session.getState();
    if (!st.result) return;
    done = true;
    void applyRatedResult({ state: st, roomId: o.roomId, me: o.me, ratings: o.ratings, matches: o.matches, recovered: recoveredSeats(o.session) }).then(
      () => stop(),
      (e: unknown) => {
        done = false;
        console.warn('Spellplane: the rating change could not be saved', e);
      },
    );
  };
  ratingWatchers.set(id, stop);
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
