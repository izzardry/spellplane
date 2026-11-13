/**
 * Accessibility helpers (DESIGN "Input and interaction design", Accessibility: "Seat colours are paired with a shape or
 * pattern … Paper meets WCAG AA contrast throughout. Reduced-motion is honoured. The log is a live region, so screen
 * readers announce actions, and every card action is reachable from the keyboard by cycling focus through cards in a
 * zone"; PLAN M5-P4). Contracts: M5-C. Implementer: M5-P4 (ui/a11y/*, the focus ring through ViewState.focused, the
 * log's live region, seat patterns beside colours in the HUD, the reduced-motion audit, axe checks).
 *
 * Focus keys (DECISIONS [M5-C]): arrow keys move card focus, following the WAI-ARIA composite-widget convention. They
 * are not keymap actions: every keymap key acts on a card, while these move between cards, and Tab already means "next
 * phase". The focused card counts as hovered for the keymap, so every card action is reachable from the keyboard.
 */
import type { InstanceId, SeatId, TableState, ZoneId } from '../../core/types';
import type { GameDefinition } from '../../games/types';
import { focusCards, focusZones, type FocusOptions } from './focus';

/** WCAG 2.2 AA contrast minimums (1.4.3 text, large text; 1.4.11 non-text) (DESIGN "Paper meets WCAG AA contrast throughout"). Added by M5-C. */
export const WCAG_AA = { text: 4.5, largeText: 3, nonText: 3 } as const;

/** A focus movement (DESIGN "Input and interaction design", Accessibility: cycling focus through cards in a zone). Added by M5-C. */
export type FocusMove = 'nextCard' | 'prevCard' | 'nextZone' | 'prevZone' | 'first' | 'last';

/** The keys of each focus movement (KeyboardEvent.key; DECISIONS [M5-C]: not remappable keymap actions). Added by M5-C. */
export const FOCUS_KEYS: Readonly<Record<FocusMove, string>> = {
  nextCard: 'ArrowRight',
  prevCard: 'ArrowLeft',
  nextZone: 'ArrowDown',
  prevZone: 'ArrowUp',
  first: 'PageUp',
  last: 'PageDown',
};

/** Where keyboard focus is on the table: a zone, and the card in it (null for an empty zone) (DESIGN "Input and interaction design", Accessibility). Added by M5-C. */
export interface CardFocus {
  zone: ZoneId;
  card: InstanceId | null;
}

/**
 * The next focus for a movement (pure): cards of a zone in their visible order, wrapping; zones in a fixed order
 * starting with the viewer's own (hand, battlefield, library, graveyard, exile, command), then the stack, then the
 * other seats clockwise. Only zones and cards this viewer may see are focusable. `from` null starts at the viewer's
 * hand. Implementer: M5-P4. Added by M5-C.
 *
 * M5-P4: `from` null (or a zone that no longer takes focus) lands on the first focusable zone (the own hand, or the
 * stack for a spectator) at its first card, or its last for 'prevCard' and 'last'. Moving to another zone lands on its
 * first card. A card that left its zone counts as just before the zone's first card. Null only when no zone takes
 * focus. `opts` (added by M5-P4) gives the own hand's fan order.
 */
export function moveFocus(state: TableState, game: GameDefinition, viewer: SeatId | null, from: CardFocus | null, move: FocusMove, opts: FocusOptions = {}): CardFocus | null {
  const zones = focusZones(state, game, viewer);
  if (zones.length === 0) return null;
  const at = (zone: ZoneId, pick: 'first' | 'last'): CardFocus => {
    const cards = focusCards(state, game, viewer, zone, opts);
    return { zone, card: (pick === 'first' ? cards[0] : cards[cards.length - 1]) ?? null };
  };
  const zi = from ? zones.indexOf(from.zone) : -1;
  if (!from || zi < 0) return at(zones[0]!, move === 'last' || move === 'prevCard' ? 'last' : 'first');
  const n = zones.length;
  switch (move) {
    case 'nextZone':
      return at(zones[(zi + 1) % n]!, 'first');
    case 'prevZone':
      return at(zones[(zi - 1 + n) % n]!, 'first');
    case 'first':
      return at(from.zone, 'first');
    case 'last':
      return at(from.zone, 'last');
    case 'nextCard':
    case 'prevCard': {
      const cards = focusCards(state, game, viewer, from.zone, opts);
      if (cards.length === 0) return { zone: from.zone, card: null };
      const i = from.card === null ? -1 : cards.indexOf(from.card);
      if (i < 0) return { zone: from.zone, card: (move === 'nextCard' ? cards[0] : cards[cards.length - 1])! };
      const k = cards.length;
      return { zone: from.zone, card: cards[(i + (move === 'nextCard' ? 1 : -1) + k) % k]! };
    }
  }
}

/** The focus movement of a key press, or null (FOCUS_KEYS; only without Ctrl, Alt, Meta or Shift). Added by M5-P4. */
export function focusMoveOf(e: { key: string; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean; shiftKey?: boolean }): FocusMove | null {
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return null;
  for (const [move, key] of Object.entries(FOCUS_KEYS) as [FocusMove, string][]) if (key === e.key) return move;
  return null;
}

/**
 * Keep focus where it was after the table changed (pure; M5-P4): on its card while that card is still in the zone and
 * focusable; else on the card that took its place in the zone's order (`before` is the zone's focus order before the
 * change), the last one when it was the last, or null for a zone now empty. Focus on a zone that no longer takes focus
 * is dropped (null).
 */
export function keepFocus(state: TableState, game: GameDefinition, viewer: SeatId | null, focus: CardFocus | null, before: readonly InstanceId[], opts: FocusOptions = {}): CardFocus | null {
  if (!focus) return null;
  if (!focusZones(state, game, viewer).includes(focus.zone)) return null;
  const cards = focusCards(state, game, viewer, focus.zone, opts);
  if (focus.card !== null && cards.includes(focus.card)) return focus;
  if (cards.length === 0) return { zone: focus.zone, card: null };
  const i = focus.card === null ? 0 : before.indexOf(focus.card);
  // Of the cards that stood after it, the first still there takes its place.
  if (i >= 0) for (const id of before.slice(i + 1)) if (cards.includes(id)) return { zone: focus.zone, card: id };
  return { zone: focus.zone, card: cards[Math.min(Math.max(i, 0), cards.length - 1)]! };
}

/** Politeness of a live-region announcement (WAI-ARIA `aria-live`). Added by M5-C. */
export type Politeness = 'polite' | 'assertive';

/**
 * The live region screen readers read (DESIGN "Input and interaction design", Accessibility: "The log is a live
 * region"). One per page, fed by the log's new lines and by focus changes; 'assertive' only for prompts addressed to
 * this player. Added by M5-C; implementer: M5-P4.
 */
export interface LiveAnnouncer {
  announce(text: string, politeness?: Politeness): void;
  /** The texts announced so far, oldest first (debug hook `a11y.announcements`). */
  history(): string[];
}

/** Announcements kept for the debug hook. Added by M5-C. */
export const ANNOUNCE_HISTORY_MAX = 100;

// The focus order lives in a leaf module (./focus) that describe.ts imports too, so nothing here imports back into
// this file at runtime. The announcer (./announcer) imports this file's constants and is imported from its own path.
export { focusCards, focusZones, FOCUS_SEAT_KINDS, FOCUS_TABLE_KINDS, type FocusOptions } from './focus';
export { describeCard, describeFocus, zoneLabel } from './describe';
export { LogAnnouncements, lineText } from './log';
export { SEAT_GLYPHS, SEAT_PATTERNS, seatGlyph } from './seats';
