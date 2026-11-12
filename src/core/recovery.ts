/**
 * Lost-save recovery arithmetic (DESIGN "Multiplayer architecture", Resume and failure handling: "the player
 * re-imports the deck, the table subtracts every card of theirs that is currently public, and the remainder is
 * committed and shuffled as a new library with a fresh hand count agreed by the table"). Pure. Contracts: M1-C
 * (amendment). Implementer: M1-P7. The flow is the public actions `recover` and `recoverCommit` (core/actions.ts),
 * the confirmation round of M1-P3, and M1-P2's commitments and secret shuffle; there is no recovery wire message.
 */
import type { CardInstance, CardRef, SeatId, TableState } from './types';

/** The seat's non-token cards among `cards` (tokens are not part of a deck). */
export function ownDeckCards(cards: Iterable<Readonly<CardInstance>>, seat: SeatId): Readonly<CardInstance>[] {
  const out: Readonly<CardInstance>[] = [];
  for (const c of cards) if (c.owner === seat && c.isToken !== true) out.push(c);
  return out;
}

/**
 * How many cards `recoverCommit` must commit for `seat`: `Seat.recovering.deckSize` minus the seat's non-token cards
 * still on the table (all public once `recover` discarded the hidden zones). After the agreed hand is drawn the
 * library holds this minus `Seat.recovering.hand` (PLAN M1-P7 acceptance). Null while the seat is not recovering.
 */
export function recoveryLibrarySize(state: TableState, seat: SeatId): number | null {
  const r = Object.hasOwn(state.seats, seat) ? state.seats[seat]!.recovering : undefined;
  if (!r) return null;
  return Math.max(0, r.deckSize - ownDeckCards(Object.values(state.cards), seat).length);
}

const refKey = (r: Pick<CardRef, 'sid' | 'foil'>): string => `${r.sid}|${r.foil === true ? 'f' : 'n'}`;

/**
 * The owner side of the re-import: the re-imported `deck` minus every public identity of the seat's cards (multiset
 * subtraction by `sid` and foil), then shortened to `recoveryLibrarySize` by dropping cards for the seat's public
 * cards whose identity is unknown (face down); the owner chooses which (here: the last ones of the re-import), and the
 * audit cannot check it. Null when the deck cannot cover the public cards or the seat is not recovering.
 */
export function recoveryRemainder(deck: readonly CardRef[], state: TableState, seat: SeatId): CardRef[] | null {
  const size = recoveryLibrarySize(state, seat);
  if (size === null) return null;
  const left = new Map<string, number>();
  for (const c of ownDeckCards(Object.values(state.cards), seat)) {
    if (!c.identity) continue;
    const k = refKey(c.identity);
    left.set(k, (left.get(k) ?? 0) + 1);
  }
  const rest: CardRef[] = [];
  for (const ref of deck) {
    const k = refKey(ref);
    const n = left.get(k) ?? 0;
    if (n > 0) left.set(k, n - 1);
    else rest.push(ref.foil === true ? { sid: ref.sid, foil: true } : { sid: ref.sid });
  }
  // A public card the re-imported deck does not hold: the deck is not the one that was played.
  for (const n of left.values()) if (n > 0) return null;
  if (rest.length < size) return null;
  return rest.slice(0, size);
}
