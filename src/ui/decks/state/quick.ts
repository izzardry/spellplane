/**
 * A first booster deck with no reveal (decks.md section 9, "First game without a deck"; journey `OPEN SIX BOOSTERS`):
 * D3's steps with the defaults, the suggestion applied, saved as `FIRST BOOSTERS`. Fails with the same errors as OPEN.
 * Implementer: M8-P3.
 */
import type { SetCode } from '../../../core/types';
import { latestCoreSet } from '../../../data/sets';
import { finishOpening, openBoosterDeck, type OpenDeps } from './open';

export const QUICK_DECK_NAME = 'FIRST BOOSTERS';
export const DEFAULT_PACKS = 6;

/** Open six boosters of `sets` (default: the latest core set the source lists), build 40 and save; returns the id. */
export async function quickBoosterDeck(deps: OpenDeps, sets?: readonly SetCode[]): Promise<string> {
  const chosen = sets && sets.length > 0 ? sets : [latestCoreSet(await deps.sets.listSets().catch(() => []))];
  const opened = await openBoosterDeck(deps, DEFAULT_PACKS, chosen, { revealed: 'all', name: QUICK_DECK_NAME });
  const { deck } = await finishOpening(deps, opened);
  return deck.id;
}
