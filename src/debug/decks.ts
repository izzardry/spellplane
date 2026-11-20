/**
 * The `decks` part of the debug hook (decks.md section 7 "Debug hook"; contracts.md Part C). The implementation is
 * ui/decks/debug.ts (the decks harness registers it too, and ui may not import debug/); this file declares the members
 * beyond the contract's `list()` and registers the part over the app's deck store. Owner: M8-P3.
 */
import type { EditOp, EditResult } from '../data/deck/edit';
import type { DeckRecord, DeckStore, DeckSummary } from '../store/types';
import { registerDecksPart } from '../ui/decks/debug';

declare module './types' {
  // Members of the `decks` part beyond the contract's `list()` (M8-P3; module augmentation, the contract file is untouched).
  interface DecksDebug {
    get(id: string): Promise<DeckRecord | null>;
    /** The stored summary, or one computed now from the card data when the record has none. */
    summary(id: string): Promise<DeckSummary | null>;
    /** Apply one edit and save it; refusals are answered and nothing is saved. */
    edit(id: string, op: EditOp): Promise<EditResult | { ok: false; reason: 'gone' }>;
    /** The card source's search fails while on (the fixture source); the deck page's search field disables. */
    setOffline(on: boolean): void;
    /** Pin the seed of the next OPEN. */
    nextSeed(hex: string | null): void;
    /** Settings.home.deckId. */
    select(id: string | null): Promise<void>;
    selected(): Promise<string | null>;
  }
}

/** Register `window.__spellplane.decks` over the page's deck library (null when storage cannot be opened). */
export function registerDecksDebug(decks: DeckStore | null): void {
  registerDecksPart(decks);
}
