/**
 * Opening hands and the automatic setup (contracts.md Part D "Opening hands"; PLAN Milestone 8, Decisions: "Automatic
 * setup is opt-in per table"). Implemented by M8-C and frozen during the parallel phase; M8-P8 may fix it.
 *
 * - `importIfNeeded(session, deck)`: import and commit the deck only when the seat has none committed.
 * - `dealOpening(session)`: shuffle, draw seven and mark the seat `dealt { game }`; nothing when the seat was dealt for
 *   the current game; after a reload in the middle of the deal it draws only the rest.
 * - `rollFirstPlayer(session)`: the creator (or seat 0) rolls once per game.
 * - `enterMatch(session, plan)`: seat, colour, `autoSetup`, `matched`, then the deck and, once the table plays, the deal.
 * - `startAutoSetup(session, opts)`: run the two steps above whenever a game starts at a table with `autoSetup`.
 */
import { zoneId } from '../core/ids';
import type { SeatColourIndex, SeatId, TableState } from '../core/types';
import type { DeckImport, TableSession } from './types';

/** The opening hand (DESIGN "Turn flow and confirmation": seven cards). */
export const OPENING_HAND = 7;

/** Whether `seat` has committed a deck at this table. */
export function hasCommitted(state: TableState, seat: SeatId): boolean {
  return Object.hasOwn(state.commitments, seat);
}

/** Import and commit `deck` only when the session's seat has none committed (contracts.md Part D). Resolves true when it imported. */
export async function importIfNeeded(session: TableSession, deck: DeckImport): Promise<boolean> {
  if (hasCommitted(session.getState(), session.seat)) return false;
  await session.importDeck(deck);
  return true;
}

/** The current game number (TableState.games ?? 0). */
export function gameNumber(state: TableState): number {
  return state.games ?? 0;
}

/** Cards in a seat's hand (hidden zone count, or the ids of a public one). */
function handCount(state: TableState, seat: SeatId): number {
  const z = state.zones[zoneId('hand', seat)];
  if (!z) return 0;
  return z.visibility === 'public' ? z.ids.length : (z.count ?? z.ids.length);
}

/** Whether the session's seat still needs its opening hand for the current game. */
export function needsDeal(state: TableState, seat: SeatId): boolean {
  const s = state.seats[seat];
  return s !== undefined && s.dealt !== gameNumber(state) && hasCommitted(state, seat);
}

/**
 * Shuffle, draw seven and dispatch `dealt { game }` (contracts.md Part D). Does nothing when the seat was dealt for the
 * current game or has no deck. A reload in the middle of the deal (some cards already in hand) draws only the rest and
 * does not shuffle again. Resolves true when it dealt.
 */
export async function dealOpening(session: TableSession): Promise<boolean> {
  const seat = session.seat;
  const before = session.getState();
  if (!needsDeal(before, seat)) return false;
  const game = gameNumber(before);
  const inHand = handCount(before, seat);
  if (inHand === 0) await session.shuffle();
  const missing = Math.max(0, OPENING_HAND - handCount(session.getState(), seat));
  if (missing > 0) await session.draw(missing);
  // A concurrent deal of the same game (two triggers) is refused by the reducer, so it is marked once.
  if (session.getState().seats[seat]?.dealt !== game) session.dispatch({ type: 'dealt', game });
  return true;
}

/**
 * Whether the first player of the current game was rolled: a `firstPlayer` round that started after the newest deck
 * commitment (each game commits its decks again), or the game has moved past turn 1.
 */
export function firstPlayerRolled(state: TableState): boolean {
  if (state.turn.number > 1) return true;
  const committed = Math.max(0, ...Object.values(state.commitments).map((c) => c.atSeq));
  return Object.values(state.rng).some((r) => r.purpose === 'firstPlayer' && r.startSeq > committed);
}

/** Seats that hold a player, in seat order. */
function occupiedSeats(state: TableState): SeatId[] {
  return Object.values(state.seats)
    .filter((s) => s.peer !== undefined || s.name !== '')
    .sort((a, b) => a.index - b.index)
    .map((s) => s.id);
}

/**
 * The creator (or seat 0) rolls for the first player once per game (contracts.md Part D). The outcome's seat takes the
 * turn (until M6-P3's `rngApply` lands, by `turnPass`); a session that cannot roll (the solo table) leaves seat 0 first.
 * Resolves to the first player's seat, or null when this session does not roll.
 */
export async function rollFirstPlayer(session: TableSession, opts: { creator?: boolean } = {}): Promise<SeatId | null> {
  const state = session.getState();
  if (!(opts.creator === true || session.seat === 's0')) return null;
  if (state.stage !== 'match' || firstPlayerRolled(state)) return null;
  const seats = occupiedSeats(state);
  if (seats.length < 2) return seats[0] ?? null;
  let n: number;
  try {
    n = await session.roll('firstPlayer', seats.length);
  } catch {
    return seats[0] ?? null;
  }
  const first = seats[n] ?? seats[0]!;
  const now = session.getState();
  const active = now.seats[first]?.team ?? first;
  if (now.turn.active !== active) session.dispatch({ type: 'turnPass', to: active });
  return first;
}

/** What a launcher or a formed match asks of a session entering its table (contracts.md Part D). */
export interface EntryPlan {
  seat: SeatId;
  colour: SeatColourIndex;
  /** The deck to commit, or null to bring none (the sandbox, a draft table). */
  deck: DeckImport | null;
  /** Matched in the public lobby: no seat invites, rating rules apply. */
  matched?: boolean;
  /** This browser creates the table (seat 0 of a match plan): it sets the table's settings and rolls. */
  creator?: boolean;
}

/**
 * Enter a table formed by a launcher or the lobby (contracts.md Part D): take the seat and colour, the creator sets
 * `autoSetup` (and `matched`), commit the deck if none is committed, and deal once the table plays.
 */
export async function enterMatch(session: TableSession, plan: EntryPlan): Promise<void> {
  const state = session.getState();
  const own = state.seats[plan.seat];
  if (own && (own.colour !== plan.colour || session.seat !== plan.seat)) session.takeSeat(plan.seat, plan.colour);
  if (plan.creator === true) {
    const s = session.getState().settings;
    const want = { autoSetup: true, ...(plan.matched === true ? { matched: true } : {}) };
    if (s.autoSetup !== true || (plan.matched === true && s.matched !== true)) session.dispatch({ type: 'settings', settings: want });
  }
  if (plan.deck) await importIfNeeded(session, plan.deck);
  if (session.getState().stage === 'match') {
    await dealOpening(session);
    if (plan.creator === true) await rollFirstPlayer(session, { creator: true });
  }
}

/**
 * Run the automatic setup whenever a game starts at a table with `settings.autoSetup` (PLAN Milestone 8, Decisions):
 * deal once per seat and game, and the creator rolls. Returns the stop function. One step runs at a time.
 */
export function startAutoSetup(session: TableSession, opts: { creator?: boolean } = {}): () => void {
  let busy = false;
  let again = false;
  let stopped = false;
  const run = async (): Promise<void> => {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      do {
        again = false;
        const st = session.getState();
        if (stopped || st.settings.autoSetup !== true || st.stage !== 'match') break;
        await dealOpening(session).catch(() => false);
        if (!stopped) await rollFirstPlayer(session, opts).catch(() => null);
      } while (again && !stopped);
    } finally {
      busy = false;
    }
  };
  const off = session.subscribe(() => void run());
  void run();
  return () => {
    stopped = true;
    off();
  };
}
