/**
 * The first group of the table's Menu, "This game" (journey.md 4.10; m7-adjustments.md section 2 `menuTop`):
 * `Leave to home`, `Invite…` (a private networked table), `Concede` (a seated player while no result). A simple
 * working version by M8-C; M8-P8 finishes it (`Declare result…` is later).
 */
import type { TableState } from '../../core/types';
import type { MenuGroup } from '../design/menu';
import type { TableKind } from './types';

/** What the menu's entries do. */
export interface MenuTopActions {
  leave(): void;
  concede?: (() => void) | undefined;
  invite?: (() => void) | undefined;
}

/** The "This game" group for a table of `kind` in `state`, seen from `seat`. */
export function menuTop(kind: TableKind, state: TableState, seat: string | null, actions: MenuTopActions): MenuGroup[] {
  const items: MenuGroup['items'] = [{ id: 'leave', label: 'Leave to home', testid: 'menu-leave', run: actions.leave }];
  if (actions.invite && kind === 'room' && !state.settings.matched) items.push({ id: 'invite', label: 'Invite…', testid: 'menu-invite', run: actions.invite });
  if (actions.concede && seat && state.stage === 'match' && !state.result && !state.seats[seat]?.conceded) items.push({ id: 'concede', label: 'Concede', danger: true, testid: 'menu-concede', run: actions.concede });
  return [{ id: 'this-game', title: 'This game', label: 'This game', items }];
}
