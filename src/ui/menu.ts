/**
 * Context-menu entries (DESIGN "Input and interaction design": every action has a context-menu route, and menus show
 * the key beside each action).
 */
import type { CardInstance } from '../core/types';
import type { ActionId, Keymap } from '../games/types';
import { COUNTER_KINDS, type Commands } from './commands';
import { keyLabel } from './keymap';

/** One menu entry. */
export interface MenuEntry {
  id: string;
  label: string;
  /** Key text shown beside the action, e.g. 'Shift+L'; null for actions without a key. */
  key: string | null;
  run: () => void;
}

/** Card actions in menu order (DESIGN "Card manipulation", "Combat and annotation", "The effect stack"). */
export const CARD_MENU: readonly ActionId[] = [
  'tap',
  'flip',
  'transform',
  'rotate180',
  'counterAdd',
  'counterRemove',
  'note',
  'copy',
  'revealTo',
  'peek',
  'cast',
  'ability',
  'attack',
  'attackNoTap',
  'toGraveyard',
  'toExile',
  'toHand',
  'toLibraryTop',
  'toLibraryBottom',
  'ping',
  'zoomTo',
  'inspect',
];

/** Table actions offered on empty table (no card under the pointer). */
export const TABLE_MENU: readonly ActionId[] = ['draw', 'drawN', 'shuffle', 'mulligan', 'untapAll', 'settle', 'tidy', 'token', 'rollDie', 'flipCoin', 'ask', 'resolve', 'counterTop', 'nextPhase', 'nextTurn', 'undo', 'fitTable', 'help'];

function labelOf(keymap: Keymap, action: ActionId): string {
  return keymap.find((b) => b.action === action)?.label ?? action;
}

/**
 * Entries for a card: every keymap action that applies to it, with its key, then the keyless extras (trigger,
 * named counters). `runOn` runs an action with the card as the hovered card.
 */
export function cardMenu(card: CardInstance, keymap: Keymap, commands: Commands, runOn: (action: ActionId) => void): MenuEntry[] {
  const entries: MenuEntry[] = CARD_MENU.filter((a) => commands.applies(a, card)).map((a) => ({ id: a, label: labelOf(keymap, a), key: keyLabel(keymap, a), run: () => runOn(a) }));
  if (commands.applies('ability', card)) entries.splice(entries.findIndex((e) => e.id === 'ability') + 1, 0, { id: 'trigger', label: 'Add trigger', key: null, run: () => commands.trigger(card.id) });
  if (commands.applies('counterAdd', card)) {
    for (const kind of COUNTER_KINDS.slice(1)) entries.push({ id: `counter:${kind}`, label: `Add ${kind} counter`, key: null, run: () => commands.counter(card.id, kind, 1) });
  }
  return entries;
}

/** Entries for the empty table. */
export function tableMenu(keymap: Keymap, run: (action: ActionId) => void): MenuEntry[] {
  return TABLE_MENU.map((a) => ({ id: a, label: labelOf(keymap, a), key: keyLabel(keymap, a), run: () => run(a) }));
}
