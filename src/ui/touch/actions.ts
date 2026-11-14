/**
 * What the touch controls offer (DESIGN "Input and interaction design", Touch: "long-press opens a radial menu with the
 * eight most used actions … A slim action bar above the hand exposes Attack, Settle, Resolve, Ask and the talk button,
 * sized for thumbs"; PLAN Milestone 5, owner decisions: the eight radial slots and the thumb bar). Contracts: M5-C.
 * Implementer: M5-P1 (ui/touch/*: the radial menu, the thumb action bar, the scrolling hand fan).
 *
 * Every entry runs an existing keymap action through ui/commands.ts, so touch, keys and the context menu stay three
 * routes to the same action (DESIGN "Input and interaction design": every action has three routes).
 */
import type { ActionId } from '../../games/types';
import type { InstanceId } from '../../core/types';

/** One slot of the long-press radial menu (DESIGN "Input and interaction design", Touch). */
export interface RadialSlot {
  /** Stable id (test ids `radial-<id>`, debug hook). */
  id: 'tap' | 'flip' | 'inspect' | 'counter' | 'toHand' | 'toGraveyard' | 'toExile' | 'stack';
  /** Keymap actions in order of preference: the first that applies to the card runs (Commands.applies). */
  actions: readonly ActionId[];
  label: string;
  /** Slot direction, degrees clockwise from straight up. */
  angleDeg: number;
}

/**
 * The eight radial slots, clockwise from the top (PLAN Milestone 5, owner decisions: "tap/untap, flip face down/up,
 * inspect, +1/+1 counter, to hand, to graveyard, exile, and put on the stack (cast or ability)"). The stack slot casts a
 * card from hand, graveyard, exile or command, and adds an ability for a card on the battlefield.
 */
export const RADIAL_SLOTS: readonly RadialSlot[] = [
  { id: 'tap', actions: ['tap'], label: 'Tap / untap', angleDeg: 0 },
  { id: 'flip', actions: ['flip'], label: 'Flip', angleDeg: 45 },
  { id: 'inspect', actions: ['inspect'], label: 'Inspect', angleDeg: 90 },
  { id: 'counter', actions: ['counterAdd'], label: '+1/+1', angleDeg: 135 },
  { id: 'toHand', actions: ['toHand'], label: 'To hand', angleDeg: 180 },
  { id: 'toGraveyard', actions: ['toGraveyard'], label: 'To graveyard', angleDeg: 225 },
  { id: 'toExile', actions: ['toExile'], label: 'Exile', angleDeg: 270 },
  { id: 'stack', actions: ['cast', 'ability'], label: 'To stack', angleDeg: 315 },
];

/** One button of the thumb action bar above the hand (DESIGN "Input and interaction design", Touch). `hold` buttons act while pressed (talk). */
export interface ThumbAction {
  action: ActionId;
  label: string;
  hold?: true;
}

/** The thumb action bar (DESIGN "Input and interaction design", Touch; PLAN Milestone 5, owner decisions: Attack, Settle, Resolve, Ask and Talk). */
export const THUMB_BAR: readonly ThumbAction[] = [
  { action: 'attack', label: 'Attack' },
  { action: 'settle', label: 'Settle' },
  { action: 'resolve', label: 'Resolve' },
  { action: 'ask', label: 'Ask' },
  { action: 'talk', label: 'Talk', hold: true },
];

/** Smallest touch target, CSS px (Apple's Human Interface Guidelines: 44 pt; DESIGN "sized for thumbs"). */
export const TOUCH_TARGET_PX = 44;

/** The radial menu as it shows (debug hook `touch.radial()`; DESIGN "Input and interaction design", Touch). */
export interface RadialMenuState {
  card: InstanceId;
  /** Centre of the menu (the long-press point), CSS px. */
  at: { x: number; y: number };
  /** Slots that apply to the card, with their on-screen rectangles. */
  slots: { id: RadialSlot['id']; enabled: boolean; screen: DOMRect }[];
}
