/**
 * The `sets` store: trimmed MTGJSON sets with their fetched-at time (DESIGN "Specification: network protocol and
 * secrecy", Local persistence; "Card data and images", Caching). Contracts: M2-C (stub); implementer: M2-P1.
 */
import type { IDBPDatabase } from 'idb';
import type { SetCache, SpellplaneDB } from './types';

/** The SetCache on an open database (store/types.ts SetCache). Implementer: M2-P1. */
export function createSetCache(_db: IDBPDatabase<SpellplaneDB>): SetCache {
  throw new Error('not implemented: M2-P1');
}
