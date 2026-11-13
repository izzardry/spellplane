/**
 * Follow options (DESIGN "Camera and navigation", Follow options): follow the stack (the camera eases to include a new
 * stack item if it is off screen) and follow the active player (ease to their territory on turn change). Both are off
 * by default; nothing ever moves the camera while the player is dragging. M4-P1. Pure: which change asks for a move.
 */
import type { SeatId, StackItemId, TableState, TeamId } from '../../core/types';
import type { FollowOptions } from '../types';

/** What the camera should ease to. */
export type FollowRequest = { kind: 'stackItem'; item: StackItemId } | { kind: 'active'; who: SeatId | TeamId };

/**
 * The moves a state change asks for under the toggles: the newest stack item that was not on the stack before (the
 * caller checks whether it is off screen), and the active player when the turn passed to someone else. The first
 * state a scene sees asks for nothing.
 */
export function followRequests(prev: TableState | null, next: TableState, follow: FollowOptions): FollowRequest[] {
  if (!prev) return [];
  const out: FollowRequest[] = [];
  if (follow.activePlayer && (prev.turn.active !== next.turn.active || prev.turn.number !== next.turn.number)) {
    out.push({ kind: 'active', who: next.turn.active });
  }
  if (follow.stack && next.stack !== prev.stack) {
    const before = new Set(prev.stack.map((i) => i.id));
    for (let i = next.stack.length - 1; i >= 0; i--) {
      const item = next.stack[i]!;
      if (!before.has(item.id)) {
        out.push({ kind: 'stackItem', item: item.id });
        break;
      }
    }
  }
  return out;
}
