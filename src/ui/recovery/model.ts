/**
 * What the recovery panel says (DESIGN "Multiplayer architecture", Resume and failure handling: the lost-save recovery
 * is public and logged; "Turn flow and confirmation": the table agrees in a confirmation round, silence passes, a hold
 * objects). Pure; the panel (RecoveryPanel.svelte) renders it. Implementer: M1-P7.
 */
import type { Seat, SeatId } from '../../core/types';
import type { RecoveryStatus } from '../../session/resume';

/** One seat's answer to the recovery round, as the panel lists it. */
export interface SeatAnswer {
  seat: SeatId;
  name: string;
  state: 'ok' | 'holding' | 'waiting';
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The answers of the other seats to the recovery round, in seat order (empty while it is not the current round). */
export function seatAnswers(status: RecoveryStatus, seats: Readonly<Record<SeatId, Seat>>): SeatAnswer[] {
  const r = status.round;
  if (!r || !r.current) return [];
  return r.seats.map((seat) => ({
    seat,
    name: (Object.hasOwn(seats, seat) ? seats[seat]!.name : '') || seat,
    state: r.holder === seat ? 'holding' : r.passed.includes(seat) ? 'ok' : 'waiting',
  }));
}

/** The panel's headline for a status, or null when there is nothing to show. */
export function headline(status: RecoveryStatus, running: boolean): string | null {
  switch (status.phase) {
    case 'lost':
      return 'This browser lost your hidden cards at this table';
    case 'proposed':
      if (status.round && !status.round.current) return 'Your recovery was interrupted by another confirmation round';
      return status.round?.holder ? 'The table holds your recovery' : `Recovery: waiting for the table to agree to a new hand of ${status.hand}`;
    case 'agreed':
      return running ? 'The table agreed: committing your new library' : `The table agreed to a new hand of ${status.hand}: re-import your deck to finish`;
    case 'committed':
      return running ? 'Shuffling your new library and drawing your hand' : 'Your recovery is not finished';
    default:
      return running ? 'Shuffling your new library and drawing your hand' : null;
  }
}

/** The explanation under the headline while nothing is proposed yet. */
export function lostText(status: RecoveryStatus): string {
  return (
    `This browser has no save of your hand (${plural(status.lost.hand, 'card')}) and library (${plural(status.lost.library, 'card')}). ` +
    `Re-import the deck you played: the table keeps your ${plural(status.publicCards, 'card')} in play, the rest of the deck becomes a new shuffled library, ` +
    'and you draw a fresh hand once the table agrees. Everyone sees this in the log.'
  );
}

/** The explanation while the recovery's shuffle or draws are owed (the page reloaded after the commit). */
export function committedText(status: RecoveryStatus): string {
  return `Your new library is committed, but it is not shuffled yet or your hand of ${plural(status.hand, 'card')} is not drawn. Finish: the table shuffles it and you draw the rest of the hand.`;
}

/** The library size the recovery leaves after the draws (deck size − public cards − hand). */
export function libraryAfter(status: RecoveryStatus, hand: number): number {
  return Math.max(0, status.deckSize - status.publicCards - hand);
}
