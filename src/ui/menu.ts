/**
 * Context-menu entries (DESIGN "Input and interaction design": every action has a context-menu route, and menus show
 * the key beside each action).
 */
import type { CardInstance } from '../core/types';
import type { ActionId, Keymap } from '../games/types';
import { COUNTER_KINDS, type Commands } from './commands';
import { keyLabel } from './keymap';
import type { IconName } from './design/icons';
import type { HudMenuGroup } from './hud/menu-model';

/** One menu entry. */
export interface MenuEntry {
  id: string;
  label: string;
  /** Key text shown beside the action, e.g. 'Shift+L'; null for actions without a key. */
  key: string | null;
  run: () => void;
}

/**
 * The card element a keyboard-opened menu stands beside (gate M8 finding N2): the card, the kind of element found for it
 * (its focus ring, its hand card, its pile card, …) and that element's box in window CSS px. The menu reports it on its
 * element, and the debug hook's `hud.menu()` reads it back.
 */
export interface MenuAnchor {
  card: string;
  source: string;
  rect: { left: number; top: number; right: number; bottom: number };
}

/** Where a menu of width `w` starts: right of the anchor point `x`, or, when it does not fit there, ending at the anchor card's left edge (`flipX`) if it fits that side. */
export function menuLeft(x: number, w: number, vw: number, flipX: number | null, insetLeft = 0, insetRight = 0, margin = 4): number {
  if (flipX === null || x + w <= vw - Math.max(0, insetRight) - margin) return x;
  return flipX - w >= Math.max(0, insetLeft) + margin ? flipX - w : x;
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
  // M6-P1: attach / detach and clip / remove clip, labelled by state (Commands.menuLabel).
  'attach',
  'clip',
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
  const entries: MenuEntry[] = CARD_MENU.filter((a) => commands.applies(a, card)).map((a) => ({ id: a, label: commands.menuLabel(a, card) ?? labelOf(keymap, a), key: keyLabel(keymap, a), run: () => runOn(a) }));
  if (commands.applies('ability', card)) entries.splice(entries.findIndex((e) => e.id === 'ability') + 1, 0, { id: 'trigger', label: 'Add trigger', key: null, run: () => commands.trigger(card.id) });
  if (commands.applies('counterAdd', card)) {
    for (const kind of COUNTER_KINDS.slice(1)) entries.push({ id: `counter:${kind}`, label: `Add ${kind} counter`, key: null, run: () => commands.counter(card.id, kind, 1) });
  }
  return entries;
}

/** Entries for the empty table; `library` (keyless library actions such as mill and reveal top) follow shuffle. */
export function tableMenu(keymap: Keymap, run: (action: ActionId) => void, library: readonly MenuEntry[] = []): MenuEntry[] {
  const entries: MenuEntry[] = TABLE_MENU.map((a) => ({ id: a, label: labelOf(keymap, a), key: keyLabel(keymap, a), run: () => run(a) }));
  entries.splice(entries.findIndex((e) => e.id === 'shuffle') + 1, 0, ...library);
  return entries;
}

// --- The HUD's Menu (PLAN M7-P2; docs/design/m7-hud-proposal.md, In the menu: "Grouped, with icons, keys shown on the
// right in muted type"). Everything done a few times an evening or less lives here, one step away from the table.

/** An entry of the HUD's Menu. `action` names the keymap action whose key the menu shows. */
export interface HudMenuSpec {
  id: HudMenuId;
  label: string;
  icon: IconName;
  action?: ActionId;
  /** Kept from the toolbar the item replaces, so the route stays addressable. */
  testid: string;
}

export type HudMenuId =
  | 'drawN'
  | 'mulligan'
  | 'shuffle'
  | 'untapAll'
  | 'token'
  | 'clip'
  | 'rollDie'
  | 'flipCoin'
  | 'tidy'
  | 'ask'
  | 'nextGame'
  | 'newDraft'
  | 'fitTable'
  | 'perspective'
  | 'look'
  | 'voice'
  | 'dictation'
  | 'mute'
  | 'keys'
  | 'settings';

export type HudMenuGroupId = 'game' | 'tools' | 'table' | 'view' | 'voice' | 'help';

/** The Menu's groups in order (docs/design/m7-hud-proposal.md: Game, Deck, Table, View, Voice, Help; Tokens and dice split from Game). */
export const HUD_MENU: readonly { id: HudMenuGroupId; label: string; items: readonly HudMenuSpec[] }[] = [
  {
    id: 'game',
    label: 'Game',
    items: [
      { id: 'drawN', label: 'Draw several…', icon: 'draw', action: 'drawN', testid: 'menu-draw-n' },
      { id: 'mulligan', label: 'Mulligan', icon: 'shuffle', action: 'mulligan', testid: 'menu-mulligan' },
      { id: 'shuffle', label: 'Shuffle library', icon: 'shuffle', action: 'shuffle', testid: 'menu-shuffle' },
      { id: 'untapAll', label: 'Untap all', icon: 'untap', action: 'untapAll', testid: 'menu-untap-all' },
      { id: 'tidy', label: 'Tidy my side', icon: 'tidy', action: 'tidy', testid: 'menu-tidy' },
    ],
  },
  // Gate M8 finding N10 (visual.md O-7: at most seven rows a group): the table's extras leave Game for their own group.
  {
    id: 'tools',
    label: 'Tokens and dice',
    items: [
      { id: 'token', label: 'Create token…', icon: 'token', action: 'token', testid: 'open-token' },
      { id: 'clip', label: 'Paperclip (drag onto cards)', icon: 'clip', testid: 'clip-tray' },
      { id: 'rollDie', label: 'Roll a die', icon: 'die', action: 'rollDie', testid: 'menu-roll-die' },
      { id: 'flipCoin', label: 'Flip a coin', icon: 'coin', action: 'flipCoin', testid: 'menu-flip-coin' },
      { id: 'ask', label: 'Ask the table…', icon: 'ask', action: 'ask', testid: 'menu-ask' },
    ],
  },
  {
    id: 'table',
    label: 'Table',
    items: [
      { id: 'nextGame', label: 'Next game…', icon: 'next', testid: 'propose-nextGame' },
      { id: 'newDraft', label: 'New draft…', icon: 'flag', testid: 'propose-newDraft' },
    ],
  },
  {
    id: 'view',
    label: 'View',
    items: [
      { id: 'fitTable', label: 'Fit table', icon: 'fit', action: 'fitTable', testid: 'menu-fit-table' },
      { id: 'perspective', label: 'Switch perspective', icon: 'view', action: 'perspective', testid: 'perspective' },
      { id: 'look', label: 'Look…', icon: 'palette', testid: 'open-theme-settings' },
    ],
  },
  {
    id: 'voice',
    label: 'Voice',
    items: [
      { id: 'voice', label: 'Voice and microphone…', icon: 'voice', testid: 'open-voice-panel' },
      { id: 'mute', label: 'Mute microphone', icon: 'micOff', action: 'mute', testid: 'menu-mute' },
      { id: 'dictation', label: 'Captions (dictation)…', icon: 'captions', testid: 'open-speech-settings' },
    ],
  },
  {
    id: 'help',
    label: 'Help',
    items: [
      { id: 'keys', label: 'Keyboard shortcuts', icon: 'keys', action: 'help', testid: 'open-cheat-sheet' },
      { id: 'settings', label: 'Settings…', icon: 'settings', testid: 'open-settings' },
    ],
  },
];

/** What the table offers now: items that do not apply are left out of the Menu. */
export interface HudMenuContext {
  spectator: boolean;
  /** Live voice at this table (networked). */
  voice: boolean;
  /** Dictated captions are available. */
  captions: boolean;
  /** The evening proposals open now (ui/flow/model.ts proposals). */
  proposals: readonly ('nextGame' | 'newDraft')[];
  /** Muted now (the Mute item reads "Unmute"). */
  muted?: boolean;
}

/** Whether a Menu item is offered in this context. */
export function hudMenuOffers(id: HudMenuId, ctx: HudMenuContext): boolean {
  switch (id) {
    case 'nextGame':
    case 'newDraft':
      return ctx.proposals.includes(id);
    case 'voice':
      return ctx.voice;
    case 'mute':
      return ctx.voice;
    case 'dictation':
      return ctx.captions && !ctx.spectator;
    case 'fitTable':
    case 'perspective':
    case 'look':
    case 'keys':
    case 'settings':
      return true;
    default:
      return !ctx.spectator;
  }
}

/**
 * The Menu as popover groups: the offered items, each with the key of its action (muted on the right) and `run` from
 * the HUD. `pointerdown` handles items that start a drag (the paperclip).
 */
export function hudMenu(ctx: HudMenuContext, keyOf: (a: ActionId) => string | null, run: (id: HudMenuId) => void, pointerdown: Partial<Record<HudMenuId, (e: PointerEvent) => void>> = {}): HudMenuGroup[] {
  return HUD_MENU.map((g) => ({
    id: g.id,
    label: g.label,
    items: g.items
      .filter((i) => hudMenuOffers(i.id, ctx))
      .map((i) => {
        const down = pointerdown[i.id];
        return {
          id: i.id,
          label: i.id === 'mute' && ctx.muted ? 'Unmute microphone' : i.label,
          icon: i.icon,
          key: i.action ? keyOf(i.action) : null,
          testid: i.testid,
          danger: i.id === 'newDraft',
          ...(down ? { onpointerdown: down, title: 'Drag a paperclip onto overlapping cards' } : { run: () => run(i.id) }),
        };
      }),
  }));
}
