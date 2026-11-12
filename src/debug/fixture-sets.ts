/**
 * Set data from injected fixtures (dev and test builds only; PLAN M2-P7). Playwright injects the recorded MTGJSON
 * booster data of tests/fixtures/mtgjson/ as `window.__spellplaneSets` before the page loads, and main.ts then uses
 * this source instead of MTGJSON, so browser tests never touch the network (CLAUDE.md). Nothing here ships in
 * production builds.
 */
import { summaryOf } from '../data/mtgjson';
import { FEATURED_SETS, type SetCode, type SetData, type SetDataSource } from '../data/types';

declare global {
  interface Window {
    /** Trimmed MTGJSON set data (data/types.ts SetData) a test injects. */
    __spellplaneSets?: SetData[];
  }
}

/** Set data from a fixed list, featured sets first, then by release date; lookups never fetch. */
export function fixtureSetSource(sets: readonly SetData[]): SetDataSource {
  const byCode = new Map(sets.map((s) => [s.code.toUpperCase(), s] as const));
  const rank = (c: SetCode): number => {
    const i = (FEATURED_SETS as readonly string[]).indexOf(c);
    return i < 0 ? FEATURED_SETS.length : i;
  };
  return {
    listSets: () =>
      Promise.resolve(
        [...byCode.values()]
          .map((s) => ({ ...summaryOf(s), featured: rank(s.code) < FEATURED_SETS.length }))
          .sort((a, b) => rank(a.code) - rank(b.code) || (a.releaseDate < b.releaseDate ? -1 : a.releaseDate > b.releaseDate ? 1 : 0)),
      ),
    get: (code) => Promise.resolve(byCode.get(code.toUpperCase()) ?? null),
    peek: (code) => byCode.get(code.toUpperCase()) ?? null,
  };
}

/** The injected set source when a test injected set data into this page, else null. */
export function injectedSets(): SetDataSource | null {
  if (typeof window === 'undefined') return null;
  const s = window.__spellplaneSets;
  return Array.isArray(s) ? fixtureSetSource(s) : null;
}
