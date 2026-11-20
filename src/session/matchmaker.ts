/**
 * The page-wide matchmaker (matchmaking.md 2.13). Stub by M8-C: the phase stays `off` and every call does nothing, so
 * Home shows Quick match as unavailable. M8-P7 owns the file.
 */
import type { MatchStore, RatingStore, SettingsStore, DeckStore } from '../store/types';
import type { Matchmaker, MatchmakerStatus } from './types';

/** What the matchmaker needs from the page (main.ts). M8-P7 may add optional members. */
export interface MatchmakerDeps {
  settings: SettingsStore;
  decks: DeckStore;
  ratings: RatingStore;
  matches: MatchStore;
  now?: () => number;
}

/** Whether this build has a working matchmaker (false for M8-C's stub): Home disables Quick match with "Matchmaking is not in this build yet.". */
export const MATCHMAKING_AVAILABLE: boolean = false;

/** One matchmaker per page (matchmaking.md 2.13). Stub: phase `off`. */
export function createMatchmaker(_deps: MatchmakerDeps): Matchmaker {
  const off: MatchmakerStatus = { phase: 'off' };
  return {
    status: () => off,
    subscribe: () => () => undefined,
    watch: () => undefined,
    seek: () => undefined,
    widen: () => undefined,
    cancel: () => undefined,
    answer: () => undefined,
    avoid: () => Promise.resolve(),
    dispose: () => undefined,
  };
}
