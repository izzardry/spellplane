/**
 * Practice alone: a solo table with its own room id, saved and listed like any game, with the deck dealt (computer.md
 * section 11; journey.md 4.1 `ALONE`: "creates `#/p/<room>` … the selected deck is imported, shuffled, seven cards are
 * dealt"; contracts.md Part D: `importIfNeeded`, `dealOpening`). M8-P2.
 */
import type { TableSession, DeckImport } from './types';
import { dealOpening, importIfNeeded } from './entry';

/** The room id prefix of a practice table (computer.md section 11: 'p-' + id). */
export const PRACTICE_PREFIX = 'p-';

/** Whether a room id names a practice table. */
export function isPracticeRoom(roomId: string): boolean {
  return roomId.startsWith(PRACTICE_PREFIX);
}

/** Lower-case letters and digits a practice id is made of. */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/** A fresh practice room id: `p-` and twelve random characters, as a computer room id (a valid room id, store/tables key). */
export function newPracticeRoomId(random: (n: number) => Uint8Array = cryptoBytes): string {
  return PRACTICE_PREFIX + [...random(12)].map((b) => ALPHABET[b % ALPHABET.length]!).join('');
}

function cryptoBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

/**
 * Prepare an opened practice session: turn on the automatic setup, commit `deck` when the seat has none, and deal the
 * opening hand once per game. Opening the same room again (from History or the CONTINUE strip) changes nothing.
 */
export async function preparePractice(session: TableSession, deck: DeckImport | null): Promise<void> {
  if (session.getState().settings.autoSetup !== true) session.dispatch({ type: 'settings', settings: { autoSetup: true } });
  if (deck && (deck.main.length > 0 || deck.side.length > 0)) await importIfNeeded(session, deck);
  if (session.getState().stage === 'match') await dealOpening(session);
}

/** What opening a practice table needs: a factory for the solo session saved under `roomId`. */
export interface PracticeDeps {
  createSession(roomId: string): Promise<TableSession>;
}

/** Open (or resume) the practice table `roomId` with `deck` dealt (the route `#/p/<room>`). */
export async function openPractice(deps: PracticeDeps, roomId: string, deck: DeckImport | null): Promise<TableSession> {
  const session = await deps.createSession(roomId);
  try {
    await preparePractice(session, deck);
  } catch (e) {
    session.dispose();
    throw e;
  }
  return session;
}
