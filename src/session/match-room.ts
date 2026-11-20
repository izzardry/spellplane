/**
 * The hand-over from a formed match to its game room (matchmaking.md 2.6 and 2.9). Stub by M8-C; M8-P7 owns the file.
 */
import type { MatchPlan } from '../net/lobby/types';
import type { MatchRecord } from '../store/types';

/** The plan of a formed match as the table entry needs it, from its stored record (matchmaking.md 2.6). Stub: null until M8-P7. */
export function planOfRecord(_record: MatchRecord, _me: string): MatchPlan | null {
  return null;
}

/** Whether this identity creates the table of a matched room: seat 0 of the plan (contracts.md Part G "Matchmaking" item 3). */
export function createsMatchTable(record: Pick<MatchRecord, 'players'>, peerId: string): boolean {
  return record.players[0]?.peerId === peerId;
}
