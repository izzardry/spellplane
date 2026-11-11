/**
 * Local deck library (DESIGN "Pre-game: draft, sealed and deck building", Local deck library; "Specification:
 * network protocol and secrecy", Local persistence: name, card refs, sideboard, source, timestamps).
 */
import type { IDBPDatabase } from 'idb';
import type { DeckRecord, DeckStore, SpellplaneDB } from './types';

/** The DeckStore on an open database (store/types.ts DeckStore). `list()` returns the most recently updated first. */
export function createDeckStore(db: IDBPDatabase<SpellplaneDB>): DeckStore {
  return {
    async list(): Promise<DeckRecord[]> {
      const ascending = await db.getAllFromIndex('decks', 'updatedAt');
      return ascending.reverse();
    },
    async get(id: string): Promise<DeckRecord | null> {
      return (await db.get('decks', id)) ?? null;
    },
    async put(deck: DeckRecord): Promise<void> {
      if (!deck.id) throw new TypeError('deck needs an id');
      await db.put('decks', deck);
    },
    async delete(id: string): Promise<void> {
      await db.delete('decks', id);
    },
  };
}

/** A new random deck id. */
export function newDeckId(): string {
  return crypto.randomUUID();
}
