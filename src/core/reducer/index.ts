/**
 * The reducer (DESIGN "Specification: code interfaces", Reducer contract). Implementer: M0-P1.
 * `reduce` is pure and total: an action that does not apply returns the state unchanged (same object),
 * with the reason available from `explain`. It never reads the clock, randomness or the secret store.
 */
import type { Action } from '../actions';
import type { CoreGameSpec, Format, SeatColourIndex, TableState } from '../types';

/** A seat to create at table start (DESIGN "Players, seats and formats"). */
export interface SeatInit {
  name: string;
  colour: SeatColourIndex;
  team?: string;
  peer?: string;
}

/** Options for a fresh table (DESIGN "Data model and protocol"). */
export interface CreateTableOptions {
  game: CoreGameSpec;
  format: Format;
  /** In seat-index order; seat ids become 's0'..'s3' (core/ids.ts seatIdOf). */
  seats: SeatInit[];
}

/** Apply one action; pure and total (DESIGN "Specification: code interfaces", Reducer contract). Stub: returns the state unchanged (M0-P1). */
export function reduce(state: TableState, _action: Action): TableState {
  return state;
}

/** Why `action` does not apply to `state`, or null if it applies (DESIGN "Specification: code interfaces", Reducer contract). Stub (M0-P1). */
export function explain(_state: TableState, _action: Action): string | null {
  return 'not implemented: M0-P1';
}

/** A fresh table at seq 0 with seats, teams, every zone of the game definition and the first phase (DESIGN "Data model and protocol"). Stub (M0-P1). */
export function createTable(_opts: CreateTableOptions): TableState {
  throw new Error('not implemented: M0-P1');
}
