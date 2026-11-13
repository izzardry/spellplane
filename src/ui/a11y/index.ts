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
 */
export function moveFocus(_state: TableState, _game: GameDefinition, _viewer: SeatId | null, _from: CardFocus | null, _move: FocusMove): CardFocus | null {
  throw new Error('not implemented: M5-P4');
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
