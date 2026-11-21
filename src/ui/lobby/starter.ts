/**
 * USE A STARTER DECK in the waiting room (journey.md 4.8, a first-time visitor without a deck): M8-P6's starter
 * generator over the page's card source, as a library record (the room saves and selects it). The pool is the injected
 * fixture cards in a test build (never fetched), else the card source's search, as Sparring's pool
 * (ui/computer/page.ts pageStarterPool, not imported here so the table chunk does not pull in the computer's stores).
 * M8-P4 fix.
 */
import { buildStarterDeck, cardSourcePool, cardsPool, type StarterPoolSource } from '../../data/starter';
import type { CardDataSource } from '../../data/types';
import type { DeckRecord } from '../../store/types';
import { STARTER_COLOUR, starterRecord } from '../play/launch';

/** The starter pool for the room: injected fixture cards in a test build, else the card source's search. */
export function roomStarterPool(cardData: Pick<CardDataSource, 'searchCards'>): StarterPoolSource {
  const injected = __SPELLPLANE_DEBUG__ && typeof window !== 'undefined' ? window.__spellplaneFixtures : undefined;
  return injected && Array.isArray(injected.cards) ? cardsPool(injected.cards) : cardSourcePool(cardData);
}

/** Makes the room's starter deck: green, seeded by the time (a fresh deck each press), as a custom library record. */
export function roomStarter(pool: StarterPoolSource, now: () => number = Date.now): () => Promise<DeckRecord> {
  return async () => {
    const at = now();
    const deck = await buildStarterDeck(pool, { colour: STARTER_COLOUR, seed: String(at) });
    return starterRecord(deck, `starter-${at.toString(36)}`, at);
  };
}
