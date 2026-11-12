/**
 * MTGJSON per-set client and cache (DESIGN "Specification: card data, packs and draft formats", Booster data; "Card
 * data and images": MTGJSON per-set file, cached in IndexedDB). Contracts: M2-C (stubs); implementer: M2-P1.
 */
import type { SetCache } from '../store/types';
import type { SetData, SetDataSource, SetSummary } from './types';

/** Options for the set data source (DESIGN "Card data and images", Caching; M2-P1 may add fields). */
export interface SetDataSourceOptions {
  /** Injected fetch (tests never use the network). */
  fetch?: typeof fetch;
  /** null disables persistence (memory only). */
  cache?: SetCache | null;
  now?: () => number;
}

/**
 * Trim a raw MTGJSON set file (`{meta, data}`) to SetData: the preferred booster type (draft, else default, else play)
 * and the uuid → card map for every card its sheets name; null when it has none of those booster types. Implementer: M2-P1.
 */
export function trimSetFile(_raw: unknown): SetData | null {
  throw new Error('not implemented: M2-P1');
}

/** Order sets for the picker: FEATURED_SETS first in their order, then the others by release date (DESIGN "Specification: card data, packs and draft formats"). Implementer: M2-P1. */
export function orderSets(_sets: readonly SetSummary[]): SetSummary[] {
  throw new Error('not implemented: M2-P1');
}

/** The set data source over MTGJSON and the `sets` store (data/types.ts SetDataSource). Implementer: M2-P1. */
export function createSetDataSource(_opts: SetDataSourceOptions = {}): SetDataSource {
  throw new Error('not implemented: M2-P1');
}
