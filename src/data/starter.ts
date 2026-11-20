/**
 * Starter decks: Sparring's deck and a newcomer's first deck (computer.md 8.1 with contracts.md Part G "Computer
 * opponent" item 4: 40 cards, 17 lands, mana-value slots 3 / 7 / 6 / 4 / 2 / 1, up to 2 copies). Stub by M8-C: the
 * generator rejects naming its package, and `SIMPLE DECK` stays disabled. M8-P6 owns the file.
 */
import type { CardRef, SetCode } from '../core/types';
import type { CardData } from './types';

/** Where the generator takes its pool of one set from (the fixture source in tests, never fetched there). */
export interface StarterPoolSource {
  /** Every card of `set` the generator may choose from. */
  pool(set: SetCode): Promise<CardData[]>;
}

/** A generated deck (computer.md 8.1). */
export interface StarterDeck {
  name: string;
  main: CardRef[];
  colour: 'W' | 'U' | 'B' | 'R' | 'G';
  set: SetCode;
}

/** Whether this build has the starter generator (false for M8-C's stub). */
export const STARTER_AVAILABLE: boolean = false;

/** Build a starter deck of one colour from the set's pool, the same for the same seed (computer.md 8.1). Stub: rejects. */
export function buildStarterDeck(_source: StarterPoolSource, _opts: { colour: 'W' | 'U' | 'B' | 'R' | 'G'; seed: string; set?: SetCode }): Promise<StarterDeck> {
  return Promise.reject(new Error('not implemented: M8-P6'));
}
