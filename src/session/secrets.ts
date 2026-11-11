/**
 * Keeping the owner's private lists in step with shared state (DESIGN "Data model and protocol", SecretStore; "Table
 * model", Hidden cards). Shared state holds a hidden zone only as a sorted set of opaque ids; the real library order
 * and hand order live in the SecretStore. After every applied action the lists are reconciled with the zones: cards
 * that left drop out, cards that arrived are placed by the action's position (library top by default).
 */
import { zoneId } from '../core/ids';
import type { CardRef, InstanceId, SecretStore, SeatId, TableState } from '../core/types';

/** An empty secret store for `seat`. */
export function emptySecrets(seat: SeatId): SecretStore {
  return { seat, identities: {}, libraryOrder: [], hand: [], audit: [], received: {} };
}

/** Where cards entering the library go: on top (draw undone, "put on top") or at the bottom. */
export type LibraryPlacement = 'top' | 'bottom';

function idsOf(state: TableState, zone: string): readonly InstanceId[] {
  return Object.hasOwn(state.zones, zone) ? state.zones[zone]!.ids : [];
}

/**
 * The secret store reconciled with the zones of `after`: the library order and hand keep their relative order, cards that
 * left drop out, cards that entered the library go on top (in the order they were in the hand, so a mulligan keeps
 * the hand's order) or at the bottom, and cards that entered the hand are appended. Returns `secrets` itself when
 * nothing changed.
 */
export function reconcileSecrets(secrets: SecretStore, after: TableState, placement: LibraryPlacement = 'top'): SecretStore {
  const lib = zoneId('library', secrets.seat);
  const hand = zoneId('hand', secrets.seat);
  const libNow = new Set(idsOf(after, lib));
  const handNow = new Set(idsOf(after, hand));

  const keptLib = secrets.libraryOrder.filter((id) => libNow.has(id));
  const keptHand = secrets.hand.filter((id) => handNow.has(id));
  const knownLib = new Set(keptLib);
  const knownHand = new Set(keptHand);

  // Arrivals in a stable order: the previous hand order first (mulligan), then the rest by id.
  const prevHand = secrets.hand;
  const rank = (id: InstanceId): number => {
    const i = prevHand.indexOf(id);
    return i < 0 ? prevHand.length : i;
  };
  const byArrival = (a: InstanceId, b: InstanceId): number => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
  const newLib = [...libNow].filter((id) => !knownLib.has(id)).sort(byArrival);
  const newHand = [...handNow].filter((id) => !knownHand.has(id)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const libraryOrder = placement === 'bottom' ? [...keptLib, ...newLib] : [...newLib, ...keptLib];
  const handOrder = [...keptHand, ...newHand];

  const same = (x: readonly string[], y: readonly string[]): boolean => x.length === y.length && x.every((v, i) => v === y[i]);
  if (same(libraryOrder, secrets.libraryOrder) && same(handOrder, secrets.hand)) return secrets;
  return { ...secrets, libraryOrder, hand: handOrder };
}

/**
 * Identities this viewer may see but shared state lacks (scene/types.ts ViewState.privateFaces): own cards in the
 * hand and own public face-down cards (drawn dimmed), plus identities others revealed to this browser only. Never
 * library cards: nobody sees library faces (DESIGN "Table model").
 */
export function privateFaces(state: TableState, secrets: SecretStore): Record<InstanceId, CardRef> {
  const out: Record<InstanceId, CardRef> = {};
  for (const [id, c] of Object.entries(state.cards)) {
    if (c.identity !== undefined) continue;
    const zone = state.zones[c.zone];
    if (!zone) continue;
    const own = c.owner === secrets.seat ? secrets.identities[id] : undefined;
    if (own && (zone.visibility === 'public' || (zone.visibility === 'owner' && zone.owner === secrets.seat))) {
      out[id] = own.card;
      continue;
    }
    const got = Object.hasOwn(secrets.received, id) ? secrets.received[id] : undefined;
    if (got && zone.visibility !== 'nobody') out[id] = got.card;
  }
  return out;
}
