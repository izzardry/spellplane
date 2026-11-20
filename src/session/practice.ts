/**
 * Practice alone: a solo table with its own room id, the deck dealt (computer.md section 11; contracts.md Part G
 * "Computer opponent"). Stub by M8-C; M8-P2 owns the file.
 */

/** The room id prefix of a practice table (computer.md section 11: 'p-' + id). */
export const PRACTICE_PREFIX = 'p-';

/** Whether a room id names a practice table. */
export function isPracticeRoom(roomId: string): boolean {
  return roomId.startsWith(PRACTICE_PREFIX);
}
