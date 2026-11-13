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
import { GEOMETRY } from '../../core/geometry';
import { parseZoneId } from '../../core/ids';
import type { CardInstance, InstanceId, SeatId, TableState, ZoneId } from '../../core/types';
import type { GameDefinition } from '../../games/types';
import { layoutOf, rotateCw, seatAngle } from '../geometry';

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
 * What the focus order may know beyond shared state (M5-P4): the viewer's own hand in the order the hand fan shows it
 * (SecretStore.hand; shared state keeps hidden zones sorted). Absent means the zone's own order.
 */
export interface FocusOptions {
  handOrder?: readonly InstanceId[];
}

/** The seat zone kinds that take focus, in order (M5-C: hand, battlefield, library, graveyard, exile, command). */
export const FOCUS_SEAT_KINDS = ['hand', 'battlefield', 'library', 'graveyard', 'exile', 'command'] as const;
/** The table zone that takes focus between the own zones and the other seats' (M5-C). */
export const FOCUS_TABLE_KINDS = ['stack'] as const;

/** Cards whose centres lie within this of a row's first card (mm, viewer's frame) read as one row: half a card's height. */
const ROW_TOLERANCE_MM = GEOMETRY.card.h / 2;

/** Seats in clockwise (turn) order starting after `viewer`, or from the first seat for a spectator (DESIGN "Players, seats and formats"). */
function seatsClockwise(state: TableState, game: GameDefinition, viewer: SeatId | null): SeatId[] {
  const bySeatIndex = new Map(Object.values(state.seats).map((s) => [s.index, s.id]));
  const order = layoutOf(game, state)?.turnOrder ?? [...bySeatIndex.keys()].sort((a, b) => a - b);
  const ids = order.map((i) => bySeatIndex.get(i)).filter((id): id is SeatId => id !== undefined);
  // Seats the layout does not list (never expected) follow in index order, so every seat is reachable.
  for (const s of Object.values(state.seats).sort((a, b) => a.index - b.index)) if (!ids.includes(s.id)) ids.push(s.id);
  const at = viewer === null ? -1 : ids.indexOf(viewer);
  return at < 0 ? ids : [...ids.slice(at + 1), ...ids.slice(0, at)];
}

/**
 * The zones keyboard focus visits, in order (pure): the viewer's own hand, battlefield, library, graveyard, exile and
 * command zone, then the stack, then every other seat clockwise with the same kinds but no hand (another player's hand
 * is hidden). Only kinds the game declares and zones the table has; a spectator starts at the stack. Added by M5-P4.
 */
export function focusZones(state: TableState, game: GameDefinition, viewer: SeatId | null): ZoneId[] {
  const kinds = new Set(game.zones.map((z) => z.id));
  const out: ZoneId[] = [];
  const seatZones = (seat: SeatId, own: boolean) => {
    for (const kind of FOCUS_SEAT_KINDS) {
      if (!kinds.has(kind) || (kind === 'hand' && !own)) continue;
      const id = `${kind}:${seat}`;
      if (state.zones[id]) out.push(id);
    }
  };
  if (viewer !== null && state.seats[viewer]) seatZones(viewer, true);
  for (const kind of FOCUS_TABLE_KINDS) if (kinds.has(kind) && state.zones[kind]) out.push(kind);
  for (const seat of seatsClockwise(state, game, viewer)) if (seat !== viewer) seatZones(seat, false);
  return out;
}

/** Battlefield cards in reading order as `viewer` sees the table (own seat at the bottom): rows far to near, each left to right. */
function readingOrder(state: TableState, game: GameDefinition, viewer: SeatId | null, ids: readonly InstanceId[]): InstanceId[] {
  const layout = layoutOf(game, state);
  const angle = viewer !== null && state.seats[viewer] ? seatAngle(layout, state, viewer) : 0;
  const placed = ids
    .map((id) => state.cards[id])
    .filter((c): c is CardInstance => !!c)
    .map((c) => {
      // Canonical frame to the viewer's: undo the viewer seat's clockwise rotation.
      const p = rotateCw(c.pose.x, c.pose.y, -angle);
      return { id: c.id, x: p.x, y: p.y };
    })
    .sort((a, b) => b.y - a.y || a.x - b.x || (a.id < b.id ? -1 : 1));
  const rows: (typeof placed)[] = [];
  for (const c of placed) {
    const row = rows[rows.length - 1];
    if (row && row[0]!.y - c.y <= ROW_TOLERANCE_MM) row.push(c);
    else rows.push([c]);
  }
  return rows.flatMap((r) => r.sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : 1)).map((c) => c.id));
}

/**
 * The cards of `zone` that take focus, in their visible order (pure; M5-C "only zones and cards this viewer may see are
 * focusable"): a public zone's cards, the viewer's own hand in its fan order, nothing of a hidden zone (a library shows
 * only its back). Battlefields read as the viewer sees them, rows far to near and left to right; piles and the stack
 * start with the top card. Added by M5-P4.
 */
export function focusCards(state: TableState, game: GameDefinition, viewer: SeatId | null, zone: ZoneId, opts: FocusOptions = {}): InstanceId[] {
  const z = state.zones[zone];
  if (!z) return [];
  const { kind } = parseZoneId(zone);
  if (z.visibility !== 'public') {
    if (kind !== 'hand' || viewer === null || z.owner !== viewer) return [];
    const members = new Set(z.ids);
    const ordered = (opts.handOrder ?? []).filter((id) => members.has(id));
    const seen = new Set(ordered);
    return [...ordered, ...z.ids.filter((id) => !seen.has(id))];
  }
  if (kind === 'battlefield') return readingOrder(state, game, viewer, z.ids);
  const spec = game.zones.find((s) => s.id === kind);
  if (spec && (spec.presentation === 'squared' || spec.presentation === 'cascade-lane')) return [...z.ids].reverse();
  return [...z.ids];
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

export { describeCard, describeFocus, zoneLabel } from './describe';
export { AnnounceQueue, ANNOUNCE, type AnnounceSink, type AnnounceTimers } from './announcer';
export { LogAnnouncements, lineText } from './log';
export { SEAT_GLYPHS, SEAT_PATTERNS, seatGlyph } from './seats';
