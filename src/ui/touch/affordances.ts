/**
 * What the on-card and on-pile controls offer and where they stand (PLAN Milestone 7, Owner decisions after the first
 * design round, Play without memorising keys; PLAN M7-P5: "a selected card shows a compact action strip next to it
 * (Tap, Flip, Counter +/−, To graveyard, More…) that is also the iPad thumb bar; counters as chips on the card you click
 * +/−"; "hovering or pressing a pile shows its few actions on the pile (Draw, Shuffle, Search, Reveal top) as small
 * buttons"; docs/design/m7-hud-proposal.md, Card action strip and Pile actions). Added by M7-P5.
 *
 * Every control runs an action the keys already run (ui/commands.ts), so the reducer and hidden information are
 * unchanged. No label names a key: keys stay optional accelerators and leave the primary UI.
 */
import type { CardInstance, SeatId, TableState } from '../../core/types';
import type { ActionId } from '../../games/types';
import { PILE_ACTIONS, type PileActionId, type PileHover, type ScreenRect, type SelectionAnchor } from '../../scene/types';
import { DEFAULT_COUNTER } from '../commands';
import { TOUCH_TARGET_PX } from './actions';

/** One control of the selection strip. `counters` is the counter group (chips with − and +), `more` the full menu. */
export interface StripItem {
  id: 'attack' | 'tap' | 'flip' | 'counters' | 'cast' | 'toHand' | 'toGraveyard' | 'more';
  label: string;
  /** The keymap action it runs on the selection (ui/commands.ts Commands.runFor), or null (counters, more). */
  action: ActionId | null;
}

/** What the strip knows about the moment. */
export interface StripContext {
  cards: readonly CardInstance[];
  me: SeatId | null;
  /** The turn's phase id (games/mtg/zones.ts MTG_PHASES) and whether it is the viewer's (or the team's) turn. */
  phase: string;
  myTurn: boolean;
  /** Commands.applies: whether an action does something for a card. */
  applies(action: ActionId, card: CardInstance): boolean;
  /** Whether a card lies on a battlefield. */
  battlefield(card: CardInstance): boolean;
}

/**
 * The strip's controls for a selection, most likely first (docs/design/m7-hud-proposal.md: "battlefield in Main shows
 * Tap · To graveyard · ⋯; in Combat, Attack · Tap · ⋯"): Attack in the own combat step for own untapped creatures,
 * Tap or Untap, Flip, the counters, Cast for a card off the battlefield (command, graveyard), To hand for one off the
 * battlefield, To graveyard, More… An action shows when it applies to every selected card.
 */
export function stripItems(ctx: StripContext): StripItem[] {
  const cards = ctx.cards;
  if (cards.length === 0 || ctx.me === null) return [];
  const all = (a: ActionId) => cards.every((c) => ctx.applies(a, c));
  const onField = cards.every((c) => ctx.battlefield(c));
  const out: StripItem[] = [];
  const canAttack = ctx.myTurn && ctx.phase === 'combat' && onField && cards.every((c) => c.controller === ctx.me && !c.tapped && c.combat !== 'attack') && all('attack');
  if (canAttack) out.push({ id: 'attack', label: 'Attack', action: 'attack' });
  if (all('tap')) out.push({ id: 'tap', label: cards.every((c) => c.tapped) ? 'Untap' : 'Tap', action: 'tap' });
  if (all('flip')) out.push({ id: 'flip', label: 'Flip', action: 'flip' });
  if (all('counterAdd')) out.push({ id: 'counters', label: 'Counters', action: null });
  if (!onField && all('cast')) out.push({ id: 'cast', label: 'Cast', action: 'cast' });
  if (!onField && all('toHand')) out.push({ id: 'toHand', label: 'To hand', action: 'toHand' });
  if (all('toGraveyard')) out.push({ id: 'toGraveyard', label: 'To graveyard', action: 'toGraveyard' });
  out.push({ id: 'more', label: 'More…', action: null });
  return out;
}

/** A counter chip: a kind on the card and how many (DESIGN "Card manipulation": generic +1/+1 by default, named kinds). */
export interface CounterChip {
  kind: string;
  count: number;
}

/**
 * The chips the strip shows for the selection's counters: every kind on the first selected card that is not zero, in
 * name order, with the default +1/+1 first; none when it has none (the strip's + adds the default kind).
 */
export function counterChips(cards: readonly CardInstance[]): CounterChip[] {
  const c = cards[0];
  if (!c) return [];
  return Object.entries(c.counters)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([kind, n]) => ({ kind, count: n ?? 0 }))
    .sort((a, b) => Number(b.kind === DEFAULT_COUNTER) - Number(a.kind === DEFAULT_COUNTER) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
}

/** One pile action button. */
export interface PileButton {
  id: PileActionId;
  label: string;
}

const PILE_LABELS: Record<PileActionId, string> = {
  draw: 'Draw',
  drawN: 'Draw several…',
  shuffle: 'Shuffle',
  search: 'Search',
  open: 'Open',
  mill: 'Mill…',
  revealTop: 'Reveal top',
};

/**
 * The buttons a pile offers (scene/types.ts PILE_ACTIONS): the own library draws, shuffles, searches and reveals its
 * top card (to the other players: only when someone else sits at the table); another player's library offers nothing
 * (its cards are its owner's to handle); a graveyard or exile opens.
 */
export function pileButtons(hover: PileHover, state: TableState, me: SeatId | null): PileButton[] {
  if (!hover.zone) return PILE_ACTIONS.pile.map((id) => ({ id, label: PILE_LABELS[id] }));
  const kind = hover.zone.split(':')[0] ?? '';
  if (kind === 'library') {
    if (me === null || hover.owner !== me) return [];
    const others = Object.values(state.seats).some((s) => s.id !== me && (s.name !== '' || s.peer !== undefined));
    return PILE_ACTIONS.library.filter((id) => id !== 'revealTop' || others).map((id) => ({ id, label: PILE_LABELS[id] }));
  }
  if (kind === 'graveyard' || kind === 'exile' || kind === 'command') return PILE_ACTIONS[kind].map((id) => ({ id, label: PILE_LABELS[id] }));
  return [];
}

/** Gap between a card or pile and its controls, CSS px. */
export const AFFORDANCE_GAP_PX = 8;

/** A control row's height: compact for a mouse, a thumb-sized target on a touch screen (DESIGN "sized for thumbs"). */
/** The kit's `sm` control height (strip and pile actions under a mouse), px. */
export const STRIP_ACTION_PX = 36;

export function controlHeight(touch: boolean): number {
  return touch ? TOUCH_TARGET_PX : STRIP_ACTION_PX;
}

/**
 * Where the strip of `size` stands for an anchor: centred over the selection, above it (or below when `above` is
 * false), kept inside the viewport `view` with a margin.
 */
export function stripPlace(anchor: SelectionAnchor, size: { width: number; height: number }, view: { width: number; height: number }, margin = 8): { x: number; y: number } {
  const r = anchor.rect;
  const cx = r.x + r.width / 2;
  const x = clamp(cx - size.width / 2, margin, view.width - size.width - margin);
  const y = anchor.above ? r.y - AFFORDANCE_GAP_PX - size.height : r.y + r.height + AFFORDANCE_GAP_PX;
  return { x: Math.round(x), y: Math.round(clamp(y, margin, view.height - size.height - margin)) };
}

/**
 * Where a pile's buttons of `size` stand: beside the pile on the side with room (the left first: the own piles sit at
 * the right edge of the own territory), vertically centred on it, inside the viewport.
 */
export function pilePlace(rect: ScreenRect, size: { width: number; height: number }, view: { width: number; height: number }, margin = 8): { x: number; y: number; side: 'left' | 'right' } {
  const left = rect.x - AFFORDANCE_GAP_PX - size.width;
  const right = rect.x + rect.width + AFFORDANCE_GAP_PX;
  const side = left >= margin || right + size.width > view.width - margin ? 'left' : 'right';
  const x = clamp(side === 'left' ? left : right, margin, view.width - size.width - margin);
  const y = clamp(rect.y + rect.height / 2 - size.height / 2, margin, view.height - size.height - margin);
  return { x: Math.round(x), y: Math.round(y), side };
}

function clamp(v: number, lo: number, hi: number): number {
  return hi < lo ? lo : Math.min(Math.max(v, lo), hi);
}

/** Display name of a counter kind on a chip. */
export function counterLabel(kind: string): string {
  return kind;
}
