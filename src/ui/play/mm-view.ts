/**
 * Small view helpers shared by the matchmaking UI (QueueChip, MatchFound, MatchHost, MatchedEntry). M8-P7.
 */
import type { Matchmaker, MatchmakerStatus } from '../../session/types';

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
