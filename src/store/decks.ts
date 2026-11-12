/**
 * Local deck library (DESIGN "Pre-game: draft, sealed and deck building", Local deck library; "Specification:
 * network protocol and secrecy", Local persistence: name, card refs, sideboard, source, timestamps).
 */
import type { IDBPDatabase } from 'idb';
import type { DeckRecord, DeckStore, LibraryImport, SpellplaneDB } from './types';

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

/**
 * Serialise library records as a LibraryFile (DESIGN "Pre-game", Local deck library: exportable as files). Added by
 * M2-C; implementer: M2-P6.
 */
export function exportLibrary(_decks: readonly DeckRecord[], _now: number): string {
  throw new Error('not implemented: M2-P6');
}

/**
 * Read a LibraryFile (or a single exported deck) back into records; invalid entries are reported, never thrown on, and
 * ids that already exist are kept for the caller to overwrite or rename (DESIGN "Pre-game", Local deck library:
 * importable). Added by M2-C; implementer: M2-P6.
 */
export function importLibrary(_text: string): LibraryImport {
  throw new Error('not implemented: M2-P6');
}
