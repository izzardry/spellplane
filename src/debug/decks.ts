/**
 * The debug hook's `decks` part (decks.md; PLAN M8-P3: `decks.edit(id, …)` answers `notInPool`). Stub by M8-C: lists
 * the library. M8-P3 owns the file.
 */
import type { DeckStore } from '../store/types';
import { registerDebug } from '../util/debug';

/** Register `window.__spellplane.decks` over the page's deck library (null when storage cannot be opened). */
export function registerDecksDebug(decks: DeckStore | null): void {
  registerDebug({
    decks: {
      list: async () => (decks ? (await decks.list()).map((d) => ({ id: d.id, name: d.name })) : []),
    },
  });
}
