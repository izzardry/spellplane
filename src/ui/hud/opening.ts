/**
 * The KEEP / MULLIGAN chips over the opening hand (docs/design/m8/m7-adjustments.md, M7-P2 "Above the hand": "The chips
 * show from the first hand until KEEP is pressed or the player moves a card out of the hand"; journey 4.10). Pure.
 */
import type { SeatId, TableState } from '../../core/types';

/** The game number the chips are kept for (TableState.games, 0 for the first game). */
export function gameNumber(st: TableState): number {
  return st.games ?? 0;
}

/**
 * Whether the chips show: during a match's first turn, the seat holds cards in hand, nothing of theirs has left the
 * hand for the table, a graveyard, exile or the stack, and KEEP was not pressed for this game.
 */
export function openingHandShown(st: TableState, me: SeatId, handSize: number, keptGame: number | null): boolean {
  if (st.stage !== 'match' || handSize === 0) return false;
  if (st.turn.number > 1) return false;
  if (keptGame === gameNumber(st)) return false;
  for (const card of Object.values(st.cards)) {
    if (card.owner !== me) continue;
    const kind = card.zone.split(':')[0];
    if (kind === 'battlefield' || kind === 'graveyard' || kind === 'exile' || kind === 'stack') return false;
  }
  return true;
}
