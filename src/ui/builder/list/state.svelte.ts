/**
 * The list view's own view state (filters, sort override, the search box, the library's current record), kept at module
 * level so switching to the builder table and back finds the list as it was left (DESIGN "Pre-game", Deck building:
 * "two views of the same pool, switchable at any time"; PLAN M2-P6: switch between views without losing state). The
 * deck itself is never kept here: it is the shared DeckBuild. Implementer: M2-P6.
 */
import { SvelteMap } from 'svelte/reactivity';
import type { DeckBuild } from '../../../core/types';
import type { CardData } from '../../../data/types';
import type { BuilderSort } from '../../../scene/types';
import { poolKeys, samePool, type ListFilters } from './model';

export interface ListUiState {
  filters: ListFilters;
  /** The list's own sort choice; null follows the builder's sort. */
  sort: BuilderSort | null;
  query: string;
  results: CardData[];
  /** The query the shown results answer ('' before the first search). */
  searchedFor: string;
  searchError: string;
  /** The library record this build was last saved to or opened from (Save updates it while the pool is the same). */
  savedId: string | null;
  /** poolKeys of the build when it was saved or opened: a build without them is another pool (see currentRecordId). */
  savedPool: string[] | null;
  name: string;
}

export function freshListUi(): ListUiState {
  return { filters: { text: '', colours: [], kind: 'all' }, sort: null, query: '', results: [], searchedFor: '', searchError: '', savedId: null, savedPool: null, name: '' };
}

/** The one list view state of this page. */
export const listUi: ListUiState = $state(freshListUi());

/** Card data found by the search box, so added cards show at once even before the page's card data has them. */
export const foundCards = new SvelteMap<string, CardData>();

/** Forget the list view's state (a new evening or a new pool). */
export function resetListUi(): void {
  Object.assign(listUi, freshListUi());
  foundCards.clear();
}

/** Remember that `build` is now held by library record `id` (saved or opened as `name`). */
export function markSaved(id: string, name: string, build: DeckBuild): void {
  listUi.savedId = id;
  listUi.savedPool = poolKeys(build);
  listUi.name = name;
}

/**
 * The library record "Save changes" writes to for `build`: the one last saved or opened, as long as `build` is still
 * that pool. A different pool (a new draft on the same page, without a reload) has no current record, so saving it
 * never replaces an earlier evening's pool (DESIGN "Pre-game", Local deck library: "reusable across evenings").
 */
export function currentRecordId(build: DeckBuild): string | null {
  if (listUi.savedId === null || listUi.savedPool === null) return null;
  return samePool(listUi.savedPool, build) ? listUi.savedId : null;
}

/** Forget the current record and its name when `build` is another pool than the one saved or opened. */
export function forgetOtherPool(build: DeckBuild): void {
  if (listUi.savedId !== null && currentRecordId(build) === null) {
    listUi.savedId = null;
    listUi.savedPool = null;
    listUi.name = '';
  }
}
