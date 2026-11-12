/**
 * Props the list view takes beyond ListViewProps (ui/types.ts): the deck library and a drafted pool's origin. Kept
 * here, not in the shared contract, until a contracts package adds them to ListViewProps (requested from the
 * integrator by M2-P6); the builder container passes them alongside the contract's props. Implementer: M2-P6.
 */
import type { DeckRecord, DeckStore } from '../../../store/types';

export interface ListLibraryProps {
  /** The local deck library (DESIGN "Pre-game", Local deck library: decks and drafted pools), absent when the browser blocks storage. */
  decks?: DeckStore | undefined;
  /** Where a drafted or sealed pool came from: a saved pool is then a 'drafted' record with this origin (store/types.ts DeckRecord). */
  origin?: DeckRecord['origin'] | undefined;
}
