/**
 * The `SIMPLE DECK` mark (contracts.md Part G "Decks" item 3): one or two colours, at least 15 creatures per 40
 * cards, lands within 1 of the suggestion, at most 4 cards of mana value 5 or more per 40. Pure. Implementer: M8-P3.
 */
import type { DeckAnalysis } from './analyse';
import { suggestedLands } from './lands';

/** Whether a deck of target size `size` is a simple deck. A deck without cards is not. */
export function isSimpleDeck(a: DeckAnalysis, size: number): boolean {
  if (a.cards === 0) return false;
  const per40 = a.cards / 40;
  if (a.colours.length < 1 || a.colours.length > 2) return false;
  if (a.creatures < 15 * per40) return false;
  if (Math.abs(a.lands - suggestedLands(a, size)) > 1) return false;
  if (a.fivePlus > 4 * per40) return false;
  return true;
}
