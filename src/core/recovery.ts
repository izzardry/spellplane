/**
 * Lost-save recovery arithmetic (DESIGN "Multiplayer architecture", Resume and failure handling: "the player
 * re-imports the deck, the table subtracts every card of theirs that is currently public, and the remainder is
 * committed and shuffled as a new library with a fresh hand count agreed by the table"). Pure. Contracts: M1-C
 * (amendment). Implementer: M1-P7. The flow is the public actions `recover` and `recoverCommit` (core/actions.ts),
 * the confirmation round of M1-P3, and M1-P2's commitments and secret shuffle; there is no recovery wire message.
 */
import type { CardRef, SeatId, TableState } from './types';

/**
 * How many cards `recoverCommit` must commit for `seat`: `Seat.recovering.deckSize` minus the seat's non-token cards
 * still on the table (all public once `recover` discarded the hidden zones). After the agreed hand is drawn the
 * library holds this minus `Seat.recovering.hand` (PLAN M1-P7 acceptance). Null while the seat is not recovering.
 * Implementer: M1-P7 (the stub throws).
 */
export function recoveryLibrarySize(_state: TableState, _seat: SeatId): number | null {
  throw new Error('not implemented: M1-P7');
}

/**
 * The owner side of the re-import: the re-imported `deck` minus every public identity of the seat's cards (multiset
 * subtraction by `sid` and foil), then shortened to `recoveryLibrarySize` by dropping cards for the seat's public
 * cards whose identity is unknown (face down); the owner chooses which, and the audit cannot check it. Null when the
 * deck cannot cover the public cards or the seat is not recovering. Implementer: M1-P7 (the stub throws).
 */
export function recoveryRemainder(_deck: readonly CardRef[], _state: TableState, _seat: SeatId): CardRef[] | null {
  throw new Error('not implemented: M1-P7');
}
