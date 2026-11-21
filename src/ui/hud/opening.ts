/**
 * The KEEP / MULLIGAN chips over the opening hand (docs/design/m8/m7-adjustments.md, M7-P2 "Above the hand": "The chips
 * show from the first hand until KEEP is pressed or the player moves a card out of the hand"; journey 4.10), and until the
 * seat's own first turn ends. Pure.
 */
import type { SeatId, TableState } from '../../core/types';

/** The game number the chips are kept for (TableState.games, 0 for the first game). */
export function gameNumber(st: TableState): number {
  return st.games ?? 0;
}

/**
 * How many seats (or Two-Headed Giant teams) take turns: by the turn after that many, every one of them has finished a
 * turn in the usual order, its own first turn included.
 */
export function turnTakers(st: TableState): number {
  return new Set(Object.values(st.seats).map((s) => s.team ?? s.id)).size || 1;
}

/**
 * Whether the chips show: in a match, the seat holds cards in hand, nothing of theirs has left the hand for the table, a
 * graveyard, exile or the stack, and the chips were not closed for this game (`closedGame`: KEEP was pressed, or the
 * HUD saw the seat's own first turn end). They stay through the other seats' turns before the seat's own first one (a
 * player on the draw keeps them while the opponent plays turn 1); once the turn number has passed one turn per seat or
 * team, every seat has finished a turn, so a page that opens then (and never saw the seat's turn end) leaves them off.
 */
export function openingHandShown(st: TableState, me: SeatId, handSize: number, closedGame: number | null): boolean {
  if (st.stage !== 'match' || handSize === 0) return false;
  if (st.turn.number > turnTakers(st)) return false;
  if (closedGame === gameNumber(st)) return false;
  for (const card of Object.values(st.cards)) {
    if (card.owner !== me) continue;
    const kind = card.zone.split(':')[0];
    if (kind === 'battlefield' || kind === 'graveyard' || kind === 'exile' || kind === 'stack') return false;
  }
  return true;
}

/** Whether the turn moving from `before` to `after` ended a turn of the seat's own (`before` was its turn). */
export function ownTurnEnded(before: { number: number; mine: boolean }, after: { number: number }): boolean {
  return before.mine && after.number > before.number;
}
