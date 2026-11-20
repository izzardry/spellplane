/**
 * Words of the Gathering card and the claim page (journey.md 4.11, 4.12; contracts.md Part G "Rejoin"). Pure.
 * Implementer: M8-P5.
 */
import type { TableState } from '../../core/types';
import { claimScreen } from '../../session/invite';
import type { MusterSeat, MusterStatus } from '../../session/types';

/** Under `PLAY ON WITHOUT …` and `PLAY ON WITH THIS TABLE` (contracts.md Part G item 2). */
export const PLAY_ON_LINE = "The table with more moves is kept; the other side's moves are played again on top where they still fit.";

/** Above the claim page's buttons (contracts.md Part G item 6). */
export const CLAIM_WARNING = 'If another browser of yours still has this game, open the link there. Sitting down here discards that hand.';

/** `Ben`, `Ben and Cy`, `Ben, Cy and Dana`. */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
}

/** `Waiting for Ben` with two players; `Getting everyone back` with more. */
export function titleOf(status: MusterStatus, state: TableState): string {
  const others = status.seats.filter((s) => !s.me);
  if (others.length === 1) return `Waiting for ${others[0]!.name || state.seats[others[0]!.seat]?.name || others[0]!.seat}`;
  return 'Getting everyone back';
}

/** The word at the right of a row. */
export function rowWord(state: MusterSeat['state']): string {
  switch (state) {
    case 'here':
      return 'Here';
    case 'connecting':
      return 'Connecting…';
    case 'away':
      return 'Not here';
    case 'leftBefore':
      return 'Left before you';
  }
}

/** A refusal screen of the claim page (journey.md 4.11). */
export interface ClaimRefusalScreen {
  kind: string;
  title: string;
  text: string;
  /** `OPEN MY SEAT` instead of `WATCH` (the link is for another seat of this browser). */
  openMine?: boolean;
}

/** Every refusal screen the claim path can show (persistence.md section 7; journey.md 4.11; contracts.md Part G item 6). */
export function refusalScreens(seatName: string, mySeatName: string): ClaimRefusalScreen[] {
  return [
    { kind: 'used', title: 'Link already used', text: 'This link was already used. Ask for a new one.' },
    { kind: 'expired', title: 'Link expired', text: 'This link has expired. Ask for a new one.' },
    { kind: 'otherDevice', title: `${seatName} is still here`, text: `${seatName} is still connected from his other browser.` },
    { kind: 'otherSeat', title: 'Another seat', text: `This link is for ${seatName}'s seat. You are ${mySeatName} at this table.`, openMine: true },
    { kind: 'moved', title: 'Seat moved', text: 'Your seat was taken over from another browser. Your saved hand for this game can no longer be used.' },
    {
      kind: 'locked',
      title: 'Every seat is taken',
      text: "This game has started and every seat is taken. If one of them is yours, ask a player at the table to bring you back from your name's menu.",
    },
  ];
}

/** The refusal screen for a reason of the reducer, the sequencer or the claim view (`[claim:…]` codes). */
export function claimScreenOf(reason: string, seatName: string): ClaimRefusalScreen {
  const c = claimScreen(reason, seatName);
  return { kind: c.kind, title: c.title, text: c.text, ...(c.openMine ? { openMine: true } : {}) };
}
