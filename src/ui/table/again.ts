/**
 * The game-over overlay's primary at the frame (journey.md 4.13 "Primary"): Quick Match → FIND ANOTHER MATCH (the same
 * queue and deck, back to Home searching); Solo → REMATCH against Sparring, AGAIN alone (a new solo game of the same
 * kind with the same deck, opened the way Home's PLAY opens one). The frame leaves the table first (leave.ts). M8-P8.
 */
import type { MatchRecord } from '../../core/types';
import type { Matchmaker } from '../../session/types';
import { DEFAULT_HOME_PREFS, type DeckRecord, type HomePrefs } from '../../store/types';
import { launchSolo, type LaunchDeps } from '../play/launch';

/** FIND ANOTHER MATCH: search again with the finished match's queue and deck. False without a record. */
export function findAgain(mm: Pick<Matchmaker, 'seek'> | null | undefined, record: Pick<MatchRecord, 'queue' | 'deckId'> | null): boolean {
  if (!mm || !record) return false;
  mm.seek({ queues: [record.queue], deckId: record.deckId });
  return true;
}

/** The primary's label at a solo table (journey.md 4.13). */
export function soloAgainLabel(kind: 'computer' | 'practice'): string {
  return kind === 'computer' ? 'REMATCH' : 'AGAIN';
}

/**
 * A new solo game of the same kind as the one at `code` (computer: against Sparring; practice: alone), with the deck the
 * game was played with (its History summary), else the deck Home has selected. Resolves to the route it opened.
 */
export async function soloAgain(deps: LaunchDeps, kind: 'computer' | 'practice', code: string): Promise<string> {
  const prefs: HomePrefs = { ...DEFAULT_HOME_PREFS, ...((await deps.settings?.get('home').catch(() => null)) ?? {}) };
  const summary = (await deps.games?.get(code).catch(() => null)) ?? null;
  const deckId = summary?.deck?.id ?? prefs.deckId;
  const deck: DeckRecord | null = deckId ? ((await deps.decks?.get(deckId).catch(() => null)) ?? null) : null;
  return launchSolo(deps, prefs, deck, kind === 'computer' ? 'sparring' : 'alone');
}
