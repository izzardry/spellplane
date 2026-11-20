/**
 * Set picker data (DESIGN "Specification: card data, packs and draft formats": the lobby lists M10, M11, M12, M13,
 * M14, M15, Magic Origins, M19, M20 and M21 first; every other set with booster data follows by release date).
 * Implementer: M2-P1.
 *
 * Only set codes, names and release dates live here, so the featured sets are listed even before (or without) any
 * network access; their card and booster data is fetched from MTGJSON at runtime like every other set.
 */
import type { SetCode, SetSummary } from './types';
import { FEATURED_SETS } from './types';

/** Names and release dates of the featured sets, in FEATURED_SETS order. */
export const FEATURED_SET_INFO: readonly SetSummary[] = [
  { code: 'M10', name: 'Magic 2010', releaseDate: '2009-07-17', featured: true, type: 'core' },
  { code: 'M11', name: 'Magic 2011', releaseDate: '2010-07-16', featured: true, type: 'core' },
  { code: 'M12', name: 'Magic 2012', releaseDate: '2011-07-15', featured: true, type: 'core' },
  { code: 'M13', name: 'Magic 2013', releaseDate: '2012-07-13', featured: true, type: 'core' },
  { code: 'M14', name: 'Magic 2014', releaseDate: '2013-07-19', featured: true, type: 'core' },
  { code: 'M15', name: 'Magic 2015', releaseDate: '2014-07-18', featured: true, type: 'core' },
  { code: 'ORI', name: 'Magic Origins', releaseDate: '2015-07-17', featured: true, type: 'core' },
  { code: 'M19', name: 'Core Set 2019', releaseDate: '2018-07-13', featured: true, type: 'core' },
  { code: 'M20', name: 'Core Set 2020', releaseDate: '2019-07-12', featured: true, type: 'core' },
  { code: 'M21', name: 'Core Set 2021', releaseDate: '2020-07-03', featured: true, type: 'core' },
];

/** Normalised set code: MTGJSON codes are upper case. */
export function normaliseSetCode(code: string): SetCode {
  return code.trim().toUpperCase();
}

/** Whether a set code is one of the ten featured sets. */
export function isFeatured(code: string): boolean {
  return FEATURED_SETS.includes(normaliseSetCode(code));
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Order sets for the picker (DESIGN "Specification: card data, packs and draft formats"): FEATURED_SETS first in
 * their order, then every other set by release date, oldest first, ties by code. Duplicate codes keep the first entry;
 * `featured` is recomputed from the code.
 */
export function orderSets(sets: readonly SetSummary[]): SetSummary[] {
  const byCode = new Map<SetCode, SetSummary>();
  for (const s of sets) {
    const code = normaliseSetCode(s.code);
    if (!byCode.has(code)) byCode.set(code, { ...s, code, featured: FEATURED_SETS.includes(code) });
  }
  const featured = FEATURED_SETS.flatMap((c) => (byCode.has(c) ? [byCode.get(c)!] : []));
  const rest = [...byCode.values()].filter((s) => !s.featured).sort((a, b) => compareStrings(a.releaseDate, b.releaseDate) || compareStrings(a.code, b.code));
  return [...featured, ...rest];
}

/** The fallback default set (decks.md D9): the newest of the ten verified sets. Added by M8-P3. */
export const FALLBACK_CORE_SET: SetCode = 'M21';

/**
 * The newest set of type `core` by release date (decks.md D9, section 6), else M21. A summary without a `type` counts
 * as core when it is one of the featured sets (the featured sets are all core sets). Added by M8-P3.
 */
export function latestCoreSet(summaries: readonly SetSummary[]): SetCode {
  let best: SetSummary | null = null;
  for (const s of summaries) {
    const core = s.type === 'core' || (s.type === undefined && isFeatured(s.code));
    if (!core) continue;
    if (!best || s.releaseDate > best.releaseDate || (s.releaseDate === best.releaseDate && s.code < best.code)) best = s;
  }
  return best ? normaliseSetCode(best.code) : FALLBACK_CORE_SET;
}

/**
 * The booster setup's set order (decks.md D3): the latest core set first, then the other core sets newest first, then
 * every other set newest first. Added by M8-P3.
 */
export function boosterSetOrder(summaries: readonly SetSummary[]): SetSummary[] {
  const latest = latestCoreSet(summaries);
  const core = (s: SetSummary): boolean => s.type === 'core' || (s.type === undefined && isFeatured(s.code));
  const newest = (a: SetSummary, b: SetSummary): number => compareStrings(b.releaseDate, a.releaseDate) || compareStrings(a.code, b.code);
  const list = orderSets(summaries);
  const first = list.filter((s) => s.code === latest);
  const cores = list.filter((s) => s.code !== latest && core(s)).sort(newest);
  const rest = list.filter((s) => s.code !== latest && !core(s)).sort(newest);
  return [...first, ...cores, ...rest];
}
