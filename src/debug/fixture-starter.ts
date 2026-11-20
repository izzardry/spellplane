/**
 * The starter generator's pool in tests and test builds (computer.md 8.1): what the production Scryfall search
 * `e:<set> (t:creature or t:basic) r<=uncommon -is:digital` would answer, taken from recorded fixture cards. Never
 * fetched. Unit tests read `tests/fixtures/starter/starter-pool.m19.json` (derived from the M19 fixture); a test
 * build uses the cards Playwright injected (`window.__spellplaneFixtures`). Nothing here ships in production builds.
 */
import type { SetCode } from '../core/types';
import type { StarterPoolSource } from '../data/starter';
import type { CardData } from '../data/types';

/** What the production pool query keeps of a set's cards: creatures and basic lands of rarity up to uncommon. */
export function starterPoolOf(cards: readonly CardData[], set: SetCode): CardData[] {
  const s = set.toLowerCase();
  return cards.filter((c) => c.set === s && (/\bBasic\b/.test(c.type_line) || (/\bCreature\b/.test(c.type_line) && (c.rarity === 'common' || c.rarity === 'uncommon'))));
}

/** A pool source over fixture cards. */
export function fixtureStarterPool(cards: readonly CardData[]): StarterPoolSource {
  return { pool: (set) => Promise.resolve(starterPoolOf(cards, set)) };
}

/** The pool source over the cards a test injected into this page, else null. */
export function injectedStarterPool(): StarterPoolSource | null {
  if (typeof window === 'undefined') return null;
  const f = window.__spellplaneFixtures;
  return f && Array.isArray(f.cards) ? fixtureStarterPool(f.cards) : null;
}
