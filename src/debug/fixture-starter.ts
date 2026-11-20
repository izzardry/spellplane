/**
 * The starter generator's pool in tests and test builds (computer.md 8.1): what the production Scryfall search
 * `e:<set> (t:creature or t:basic) r<=uncommon -is:digital` would answer, taken from recorded fixture cards. Never
 * fetched. Unit tests read `tests/fixtures/starter/starter-pool.m19.json` (derived from the M19 fixture); a test
 * build uses the cards Playwright injected (`window.__spellplaneFixtures`). Nothing here ships in production builds.
 */
import { cardsPool, starterPoolOf, type StarterPoolSource } from '../data/starter';
import type { CardData } from '../data/types';

export { starterPoolOf };

/** A pool source over fixture cards. */
export function fixtureStarterPool(cards: readonly CardData[]): StarterPoolSource {
  return cardsPool(cards);
}

/** The pool source over the cards a test injected into this page, else null. */
export function injectedStarterPool(): StarterPoolSource | null {
  if (typeof window === 'undefined') return null;
  const f = window.__spellplaneFixtures;
  return f && Array.isArray(f.cards) ? fixtureStarterPool(f.cards) : null;
}
