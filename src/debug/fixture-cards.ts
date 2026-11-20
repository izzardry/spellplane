/**
 * An in-memory CardDataSource over recorded card objects (dev and test builds only). Playwright injects the fixtures
 * of tests/fixtures/scryfall/ as `window.__spellplaneFixtures` before the page loads, and main.ts then uses this
 * source instead of Scryfall, so browser tests never touch the network (CLAUDE.md: tests never use the network;
 * card data comes from tests/fixtures/). Nothing here ships in production builds.
 */
import { ListCardDataSource } from '../data/deck/list-source';
import type { CardData, CardDataSource } from '../data/types';

/** What a test injects before the page loads. */
export interface InjectedFixtures {
  cards: CardData[];
}

declare global {
  interface Window {
    __spellplaneFixtures?: InjectedFixtures;
  }
}

/** Card data from a fixed list (data/deck/list-source.ts); lookups answer immediately and never fetch. */
export class FixtureCardDataSource extends ListCardDataSource {}

/** The fixture card source when a test injected fixtures into this page, else null. */
export function injectedCardData(): CardDataSource | null {
  if (typeof window === 'undefined') return null;
  const f = window.__spellplaneFixtures;
  return f && Array.isArray(f.cards) ? new FixtureCardDataSource(f.cards) : null;
}
