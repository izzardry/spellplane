/**
 * What Deck mode works on (decks.md section 1; contracts.md Part C): the profile's deck and settings stores, card data,
 * set data, faces, a clock, an id factory and navigation. DecksRoute builds it from its props (the app passes the
 * stores; the decks harness passes fixture sources). Implementer: M8-P3.
 */
import type { CardData, CardDataSource, FaceSource, SetDataSource } from '../../data/types';
import type { DeckRecord, DeckStore, SettingsStore } from '../../store/types';

export interface DecksEnv {
  decks: DeckStore;
  settings: SettingsStore | null;
  cardData: CardDataSource;
  sets: SetDataSource;
  faces: FaceSource;
  now: () => number;
  newId: () => string;
  /** Go to a hash route (`#/decks/<id>`, `#/` for Home). */
  go: (hash: string) => void;
  /**
   * Go to a hash route in place of the current history entry: for redirects (a finished opening to its deck page, a
   * deck still opening to its opening, `#/decks/new/custom` to the deck it made), so the browser's Back walks the path
   * backwards instead of landing on the redirect again (decks.md section 1).
   */
  replace: (hash: string) => void;
  /** True while a matchmaking search runs (the selected deck is locked; contracts.md Part E). */
  searching: () => boolean;
  /** True while card search cannot reach its source (offline, or the debug hook set it). */
  offline: () => boolean;
  /** Subscribe to `offline()` changes. */
  onOffline: (fn: (on: boolean) => void) => () => void;
}

/** An in-memory deck store (no IndexedDB: decks.md section 7 "No storage"). */
export function memoryDeckStore(): DeckStore {
  const m = new Map<string, DeckRecord>();
  return {
    list: () => Promise.resolve([...m.values()].sort((a, b) => b.updatedAt - a.updatedAt)),
    get: (id) => Promise.resolve(m.get(id) ?? null),
    put: (d) => {
      m.set(d.id, structuredClone(d));
      return Promise.resolve();
    },
    delete: (id) => {
      m.delete(id);
      return Promise.resolve();
    },
  };
}

/** A card's accessible name: name, mana cost and type line (decks.md "Keyboard and accessibility"). */
export function cardLabel(card: CardData | null, count = 0): string {
  if (!card) return 'Unknown card';
  const cost = card.mana_cost ?? card.card_faces?.[0]?.mana_cost ?? '';
  const parts = [card.name, cost.replace(/[{}]/g, ''), card.type_line].filter(Boolean);
  return count > 0 ? `${parts.join(', ')}, ${count} in deck` : parts.join(', ');
}
