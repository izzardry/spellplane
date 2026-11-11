/**
 * Confirmation rounds (DESIGN "Turn flow and confirmation", Confirmation rounds; "Specification: network protocol and
 * secrecy", Timers). Contracts: M1-C. Implementer: M1-P3, who also adds the `ask`, `respond` and `autoPass` handlers
 * here and wires them into reducer/index.ts (they are refused until then).
 */
import type { ConfirmRound, Deadline, SeatId, TableState } from '../types';

/** The seq from which a round's countdown runs: the release of the last hold, else the round's start (DESIGN "Turn flow and confirmation", Hold). */
export function timerStartSeq(round: ConfirmRound): number {
  return round.timerSeq ?? round.startSeq;
}

/**
 * Seats that have not answered the current round and are not holding (DESIGN "Turn flow and confirmation": silence
 * counts as OK when the timer runs out; an away player is treated as passing after the timer). Implementer: M1-P3
 * (the stub returns none).
 */
export function silentSeats(_state: TableState): SeatId[] {
  return [];
}

/**
 * The pass timer of the current round as a sequencer deadline: `durationMs` after `timerStartSeq`, emitting
 * `respond {seat, response: 'timeout'}` for every silent seat; none while nobody is silent, a seat holds, or the
 * timer is off (DESIGN "Specification: network protocol and secrecy", Timers). Implementer: M1-P3 (the stub returns none).
 */
export function confirmDeadlines(_state: TableState): Deadline[] {
  return [];
}
