/** Shared helpers for the lobby tests: a networked table at seq 0 and seat actions through core's reducer. */
import type { Action, ActionDraft } from '../../../src/core/actions';
import { createTable, explain, reduce } from '../../../src/core/reducer/index';
import type { Format, SeatId, TableState } from '../../../src/core/types';
import { mtg } from '../../../src/games/index';

/** A fresh networked table as a session starts it: every chair free (DESIGN "Players, seats and formats"). */
export function freshTable(format: Format = '1v1'): TableState {
  const n = format === '1v1' ? 2 : format === 'ffa3' ? 3 : 4;
  return createTable({ game: mtg, format, seats: Array.from({ length: n }, (_, i) => ({ name: '', colour: i })) });
}

let cid = 0;
/** Apply a draft as `by` through the reducer; throws when it is refused. */
export function act(state: TableState, by: SeatId, draft: ActionDraft): TableState {
  const action = { ...draft, by, cid: `t-${++cid}`, seq: state.seq + 1 } as Action;
  const reason = explain(state, action);
  if (reason) throw new Error(reason);
  return reduce(state, action);
}

/** `peer` sits down in `seat` as `name` with `colour`. */
export function sit(state: TableState, seat: SeatId, name: string, colour: number, peer: string): TableState {
  return act(state, seat, { type: 'seatTake', seat, name, colour, peer });
}
