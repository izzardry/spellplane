/**
 * The end of a game for the UI (contracts.md Part D: "src/session/result.ts has concede(session) and resultOf(state)").
 * Implemented by M8-C; the reducer rule is core/reducer/result.ts.
 */
import type { GameResult, SeatId, TableState } from '../core/types';
import { isOut } from '../core/reducer';
import type { TableSession } from './types';

/** Concede the current game for the session's seat (contracts.md Part D). Returns the stamped action. */
export function concede(session: TableSession): ReturnType<TableSession['dispatch']> {
  return session.dispatch({ type: 'concede' });
}

/** The result of the current game, or null while it runs. */
export function resultOf(state: TableState): GameResult | null {
  return state.result ?? null;
}

/** How the game ended for `seat`: won, lost, or still playing (null). */
export function outcomeFor(state: TableState, seat: SeatId): 'won' | 'lost' | null {
  const r = state.result;
  if (!r) return null;
  return r.winners.includes(seat) ? 'won' : 'lost';
}

/** Whether `seat` (or its team) is out of the current game. */
export function seatIsOut(state: TableState, seat: SeatId): boolean {
  return isOut(state, seat);
}
