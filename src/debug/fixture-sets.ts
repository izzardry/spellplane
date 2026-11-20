/**
 * Set data from injected fixtures (dev and test builds only; PLAN M2-P7). Playwright injects the recorded MTGJSON
 * booster data of tests/fixtures/mtgjson/ as `window.__spellplaneSets` before the page loads, and main.ts then uses
 * this source instead of MTGJSON, so browser tests never touch the network (CLAUDE.md). Nothing here ships in
 * production builds.
 */
import { listSetSource } from '../data/sets';
import type { SetData, SetDataSource } from '../data/types';

declare global {
  interface Window {
    /** Trimmed MTGJSON set data (data/types.ts SetData) a test injects. */
    __spellplaneSets?: SetData[];
  }
}

/** Set data from a fixed list (data/sets.ts listSetSource); every fixture set is a core set (M8-P3). */
export function fixtureSetSource(sets: readonly SetData[]): SetDataSource {
  return listSetSource(sets);
}

/** The injected set source when a test injected set data into this page, else null. */
export function injectedSets(): SetDataSource | null {
  if (typeof window === 'undefined') return null;
  const s = window.__spellplaneSets;
  return Array.isArray(s) ? fixtureSetSource(s) : null;
}
