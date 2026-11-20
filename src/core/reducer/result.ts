/**
 * The end of a game and the opening hand (contracts.md Part D; DESIGN "Save, leave, rejoin and history"; matchmaking.md
 * 2.9 "Concede"). Implemented by M8-C because three packages need the result; frozen during the parallel phase.
 *
 * - `concede`: the sender's seat is out. In 1v1 the other seat wins; in a free-for-all the game ends when one seat is
 *   left; in Two-Headed Giant a team is out when both of its seats conceded. The table then gets `result`.
 * - `dealt { game }`: the seat marks its opening hand as dealt for game `game` (session/entry.ts dealOpening).
 * Pure and total like every handler: a refusal throws a Rejection with a reason.
 */
import type { ActionOf } from '../actions';
import type { Seat, SeatId, TableState, TeamId } from '../types';
import type { Draft } from './draft';
import { checkId, checkInt, own, reject } from './util';

/** A seat that holds a player: a name or a peer (an empty chair has neither). */
function occupied(seat: Seat): boolean {
  return seat.peer !== undefined || seat.name !== '';
}

/**
 * Whether a seat (or a 2HG team) is out of the current game (contracts.md Part D): a seat that conceded; a team whose
 * every seat conceded. Unknown ids are not out. `turnPass` skips seats and teams that are out.
 */
export function isOut(state: TableState, who: SeatId | TeamId): boolean {
  const team = own(state.teams, who);
  if (team) return team.seats.length > 0 && team.seats.every((s) => own(state.seats, s)?.conceded === true);
  return own(state.seats, who)?.conceded === true;
}

/** The seats still playing after the concessions in `seats` (team-aware): null while the game goes on, else the winners. */
function winnersOf(state: TableState, seats: Readonly<Record<SeatId, Seat>>): SeatId[] | null {
  const byIndex = (a: Seat, b: Seat): number => a.index - b.index;
  const teams = Object.values(state.teams);
  if (teams.length > 0) {
    const alive = teams.filter((t) => t.seats.some((s) => own(seats, s)?.conceded !== true && occupiedOr(seats, s)));
    if (alive.length > 1) return null;
    return alive.flatMap((t) => t.seats.map((s) => own(seats, s)).filter((s): s is Seat => s !== undefined)).sort(byIndex).map((s) => s.id);
  }
  const alive = Object.values(seats).filter((s) => occupied(s) && s.conceded !== true);
  if (alive.length > 1) return null;
  return alive.sort(byIndex).map((s) => s.id);
}

function occupiedOr(seats: Readonly<Record<SeatId, Seat>>, id: SeatId): boolean {
  const s = own(seats, id);
  return s !== undefined && occupied(s);
}

/** `concede {}`: the sender's seat concedes; when one seat or team is left the table gets `result` (contracts.md Part D). */
export function concede(d: Draft, a: ActionOf<'concede'>): void {
  const seat = d.seats.need(checkId(a.by, 'seat'));
  if (d.base.stage !== 'match') reject('a game can only be conceded while it is played');
  if (d.gameResult !== undefined) reject('the game is over');
  if (!occupied(seat)) reject(`seat ${seat.id} is empty`);
  if (seat.conceded === true) reject(`seat ${seat.id} has already conceded`);
  d.seats.w(seat.id).conceded = true;
  const seats: Record<SeatId, Seat> = {};
  for (const s of d.seats.values()) seats[s.id] = s;
  const winners = winnersOf(d.base, seats);
  if (winners !== null) d.setResult({ winners, reason: 'concede', atSeq: a.seq ?? d.base.seq + 1 });
}

/** `dealt { game }`: the seat's opening hand is dealt for the current game; once per seat and game (contracts.md Part D). */
export function dealt(d: Draft, a: ActionOf<'dealt'>): void {
  const seat = d.seats.need(checkId(a.by, 'seat'));
  const game = checkInt(a.game, 'game', 0, 1_000_000);
  if (game !== d.games) reject(`dealt names game ${game}, but the table plays game ${d.games}`);
  if (seat.dealt === game) reject(`seat ${seat.id} has already been dealt for game ${game}`);
  d.seats.w(seat.id).dealt = game;
}
