/**
 * The keyboard focus order (DESIGN "Input and interaction design", Accessibility: "every card action is reachable from
 * the keyboard by cycling focus through cards in a zone"; PLAN M5-P4): which zones take focus and which of their cards,
 * in order. Pure, and a leaf of ui/a11y (index.ts and describe.ts import it; it imports neither). Re-exported by
 * ui/a11y/index.ts.
 */
import { GEOMETRY } from '../../core/geometry';
import { parseZoneId } from '../../core/ids';
import type { CardInstance, InstanceId, SeatId, TableState, ZoneId } from '../../core/types';
import type { GameDefinition } from '../../games/types';
import { layoutOf, rotateCw, seatAngle } from '../geometry';

/**
 * What the focus order may know beyond shared state (M5-P4): the viewer's own hand in the order the hand fan shows it
 * (SecretStore.hand; shared state keeps hidden zones sorted; absent means the zone's own order), and the cards of an
 * own hidden zone the viewer is looking at in the pile viewer (Search, Look at top N), in the viewer's order.
 */
export interface FocusOptions {
  handOrder?: readonly InstanceId[];
  /** The open pile viewer's looked-at cards of `zone` (the viewer's own library), in the order the viewer shows them. */
  looked?: { zone: ZoneId; ids: readonly InstanceId[] } | null;
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
 * only its back) except the cards of an own hidden zone the viewer is looking at in the pile viewer (`opts.looked`, in
 * the viewer's order). Battlefields read as the viewer sees them, rows far to near and left to right; piles and the stack
 * start with the top card. Added by M5-P4.
 */
export function focusCards(state: TableState, game: GameDefinition, viewer: SeatId | null, zone: ZoneId, opts: FocusOptions = {}): InstanceId[] {
  const z = state.zones[zone];
  if (!z) return [];
  const { kind } = parseZoneId(zone);
  if (z.visibility !== 'public') {
    const looked = opts.looked;
    if (looked && looked.zone === zone && kind !== 'hand') {
      // Only the viewer's own zone: the looked cards are what this browser was shown (session.lookAt).
      if (viewer === null || z.owner !== viewer) return [];
      const members = new Set(z.ids);
      return [...new Set(looked.ids)].filter((id) => members.has(id));
    }
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
