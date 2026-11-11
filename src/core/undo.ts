/**
 * Personal undo as inverse actions (DESIGN "Turn flow and confirmation", Undo). Implementer: M0-P1.
 * `inverse(before, action)` returns an action that, applied to `reduce(before, action)`, restores a state whose hash
 * equals `stateHash(before)` (seq aside), or null when the action is not undoable (core/actions.ts isUndoable).
 * The session dispatches it wrapped in `{type: 'undo', of: action.cid, inverse}`.
 */
import type { Action, UndoableAction } from './actions';
import type { TableState } from './types';

/** The inverse of `action` given the state before it, or null (DESIGN "Turn flow and confirmation", Undo). Stub (M0-P1). */
export function inverse(_before: TableState, _action: Action): UndoableAction | null {
  throw new Error('not implemented: M0-P1');
}
