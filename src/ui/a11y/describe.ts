/**
 * Spoken names of the keyboard focus (DESIGN "Input and interaction design", Accessibility: "every card action is
 * reachable from the keyboard by cycling focus through cards in a zone"; PLAN M5-P4: spoken names via an accessible
 * mirror). Pure text. Card names come from the HUD's `nameOf`, which names only what this browser may know (a hidden card
 * reads "Hidden card"); nothing here leaves the browser.
 */
import { parseZoneId } from '../../core/ids';
import type { CardInstance, InstanceId, SeatId, TableState, ZoneId } from '../../core/types';
import type { GameDefinition } from '../../games/types';
import { focusCards, type FocusOptions } from './focus';
import type { CardFocus } from './index';

/** A zone's name as `viewer` hears it: "Your graveyard", "Ben's battlefield", "Stack". */
export function zoneLabel(state: TableState, game: GameDefinition, viewer: SeatId | null, zone: ZoneId): string {
  const { kind, seat } = parseZoneId(zone);
  const label = game.zones.find((z) => z.id === kind)?.label ?? kind;
  if (seat === null) return label;
  const lower = label.charAt(0).toLowerCase() + label.slice(1);
  if (seat === viewer) return `Your ${lower}`;
  const name = state.seats[seat]?.name || seat;
  return `${name}'s ${lower}`;
}

/** The counters on a card as words: "2 +1/+1 counters", "1 loyalty counter". */
function countersText(c: CardInstance): string[] {
  return Object.keys(c.counters)
    .sort()
    .filter((k) => (c.counters[k] ?? 0) !== 0)
    .map((k) => {
      const n = c.counters[k]!;
      return `${n} ${k} counter${Math.abs(n) === 1 ? '' : 's'}`;
    });
}

/**
 * One card as a screen reader says it: its name as this browser may know it, then its state (face down, tapped,
 * attacking or blocking, counters, attached, note). `nameOf` is the HUD's (hidden identities stay "Hidden card").
 */
export function describeCard(state: TableState, id: InstanceId, nameOf: (id: InstanceId) => string): string {
  const c = state.cards[id];
  if (!c) return 'Card gone';
  const parts = [nameOf(id)];
  if (c.face === 'down' && parseZoneId(c.zone).kind !== 'hand' && parseZoneId(c.zone).kind !== 'library') parts.push('face down');
  if (c.tapped) parts.push('tapped');
  if (c.combat === 'attack') parts.push('attacking');
  if (c.combat === 'block') parts.push('blocking');
  parts.push(...countersText(c));
  if (c.attachedTo && state.cards[c.attachedTo]) parts.push(`attached to ${nameOf(c.attachedTo)}`);
  if (c.note) parts.push(`note: ${c.note}`);
  return parts.join(', ');
}

/**
 * The focus as one announcement: the card, then where it is ("Llanowar Elves, tapped. Your battlefield, 2 of 5"); an
 * empty zone or a hidden pile names the zone and its count ("Your library, 53 cards, face down").
 */
export function describeFocus(state: TableState, game: GameDefinition, viewer: SeatId | null, focus: CardFocus, nameOf: (id: InstanceId) => string, opts: FocusOptions = {}): string {
  const where = zoneLabel(state, game, viewer, focus.zone);
  const zone = state.zones[focus.zone];
  const count = zone?.ids.length ?? 0;
  if (focus.card === null) {
    if (count === 0) return `${where}, empty`;
    return `${where}, ${count} card${count === 1 ? '' : 's'}, face down`;
  }
  const cards = focusCards(state, game, viewer, focus.zone, opts);
  const i = cards.indexOf(focus.card);
  return `${describeCard(state, focus.card, nameOf)}. ${where}, ${i < 0 ? '?' : i + 1} of ${cards.length}`;
}
