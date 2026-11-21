/**
 * Small view helpers shared by the matchmaking UI (QueueChip, MatchFound, MatchHost, MatchedEntry). M8-P7.
 */
import type { Matchmaker, MatchmakerStatus } from '../../session/types';
import type { SettingsStore } from '../../store/types';
import { playMatchFound } from '../sound';

export { clockText, MM_TEXT, queueLabel, statusLine } from '../../session/matchmaker';

/** The matchmaker's clock when it has one (the debug hook moves it), else the page clock. */
export function mmNow(mm: Matchmaker): number {
  const c = mm as Matchmaker & { now?: () => number };
  return typeof c.now === 'function' ? c.now() : Date.now();
}

/** Others looking in the own queues (seeking) or at all (watching). */
export function lookingCount(s: MatchmakerStatus): number {
  if (s.phase === 'seeking') return s.queues.reduce((n, q) => n + (s.lobby.byQueue[q] ?? 0), 0);
  if (s.phase === 'watching' || s.phase === 'check') return s.lobby.seekers.length;
  return 0;
}

/** The tab title while a match waits for an answer (journey.md 4.6). */
export const MATCH_FOUND_TITLE = 'Match found · Spellplane';

/** The ready check's length in seconds (matchmaking.md 2.5, CHECK_MS). */
export const CHECK_SECONDS = 20;

/** `CUSTOM DECKS` or `BOOSTER DECKS` for a queue. */
export function deckKindLabel(queue: string): string {
  return queue.includes('.limited.') ? 'BOOSTER DECKS' : 'CUSTOM DECKS';
}

/** The seat colour of seat `i` as a CSS value: the look's seat colour where one is set, else ink. */
export function seatColourVar(i: number): string {
  return `var(--sp-seat-${i}, var(--ds-ink))`;
}

let chimes = 0;
/** Ask for the matchFound chime (the given player, else nothing audible) and count it (debug hook `mm.chimes()`). */
export function ringChime(chime: (() => void) | undefined): void {
  chimes++;
  try {
    chime?.();
  } catch {
    // A chime that fails stays silent.
  }
}
/** The page's match-found chime under the viewer's sound setting (Settings `sound`; 'off' plays nothing). */
export function settingsChime(settings: SettingsStore | null): () => void {
  return () => {
    if (!settings) {
      playMatchFound('theme');
      return;
    }
    void settings.get('sound').then(
      (mode) => void playMatchFound(mode),
      () => void playMatchFound('theme'),
    );
  };
}

/** How often the matchFound chime was asked for on this page. */
export function chimeCount(): number {
  return chimes;
}

/**
 * Take the matchmaker's pending short notice (a declined, missed or unreachable match) once: shown on the next status
 * outside the ready check and the move, whether the host was mounted when it was set or mounts later.
 */
export function takeNoticeOf(mm: Matchmaker): { text: string; again: boolean } | null {
  const c = mm as Matchmaker & { takeNotice?: () => { text: string; again: boolean } | null };
  return typeof c.takeNotice === 'function' ? c.takeNotice() : null;
}

/** `SEARCH AGAIN` after a match that could not be reached: the search resumes if it is not running already. */
export function searchAgain(mm: Matchmaker): void {
  const c = mm as Matchmaker & { searchAgain?: () => void };
  if (typeof c.searchAgain === 'function') c.searchAgain();
}
