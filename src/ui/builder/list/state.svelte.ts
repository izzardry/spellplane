/**
 * The list view's own view state (filters, sort override, the search box, the library's current record), kept at module
 * level so switching to the builder table and back finds the list as it was left (DESIGN "Pre-game", Deck building:
 * "two views of the same pool, switchable at any time"; PLAN M2-P6: switch between views without losing state). The
 * deck itself is never kept here: it is the shared DeckBuild. Implementer: M2-P6.
 */
import type { CardData } from '../../../data/types';
import type { BuilderSort } from '../../../scene/types';
import type { ListFilters } from './model';

export interface ListUiState {
  filters: ListFilters;
  /** The list's own sort choice; null follows the builder's sort. */
  sort: BuilderSort | null;
  query: string;
  results: CardData[];
  /** The library record this build was last saved to or opened from (Save updates it). */
  savedId: string | null;
  name: string;
}

export function freshListUi(): ListUiState {
  return { filters: { text: '', colours: [], kind: 'all' }, sort: null, query: '', results: [], savedId: null, name: '' };
}

/** The one list view state of this page. */
export const listUi: ListUiState = $state(freshListUi());

/** Forget the list view's state (a new evening or a new pool). */
export function resetListUi(): void {
  Object.assign(listUi, freshListUi());
}
