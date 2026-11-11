/**
 * Read-only queries over TableState shared by scene, HUD and session (DESIGN "Data model and protocol";
 * "Engineering rules": the scene and HUD are pure views of state). Implementer: M0-P1.
 */
import type { CardInstance, ConfirmRound, InstanceId, Line, PileId, SecretStore, SeatId, StackItem, TableState, Zone, ZoneId } from './types';
import { zoneId } from './ids';

const own = <T>(rec: Readonly<Record<string, T>>, key: string): T | undefined => (Object.hasOwn(rec, key) ? rec[key] : undefined);
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The zone with this id, or null (DESIGN "Table model"). */
export function zoneById(state: TableState, zone: ZoneId): Zone | null {
  return own(state.zones, zone) ?? null;
}

/** Zone `kind` of `seat` (or the table zone when seat is null), or null (DESIGN "Table model"). */
export function seatZone(state: TableState, kind: string, seat: SeatId | null): Zone | null {
  return zoneById(state, zoneId(kind, seat));
}

/** Cards of a zone in zone order (sorted ids for hidden zones) (DESIGN "Table model"). */
export function cardsInZone(state: TableState, zone: ZoneId): CardInstance[] {
  const z = zoneById(state, zone);
  if (!z) return [];
  return z.ids.flatMap((id) => {
    const c = own(state.cards, id);
    return c ? [c] : [];
  });
}

/** Members of a pile ordered by pile index, bottom first (DESIGN "Card manipulation"). */
export function pileMembers(state: TableState, pile: PileId): CardInstance[] {
  return Object.values(state.cards)
    .filter((c) => c.pile?.id === pile)
    .sort((a, b) => a.pile!.index - b.pile!.index);
}

/** Cards attached to `host`, in id order (DESIGN "Combat and annotation", Attachment). */
export function attachmentsOf(state: TableState, host: InstanceId): CardInstance[] {
  return Object.values(state.cards)
    .filter((c) => c.attachedTo === host)
    .sort((a, b) => byId(a.id, b.id));
}

/** Cards with a home slot, i.e. temporarily displaced (DESIGN "Combat and annotation"). */
export function displacedCards(state: TableState): CardInstance[] {
  return Object.values(state.cards)
    .filter((c) => c.home !== undefined)
    .sort((a, b) => byId(a.id, b.id));
}

/** The top stack item, or null (DESIGN "The effect stack"). */
export function topOfStack(state: TableState): StackItem | null {
  return state.stack[state.stack.length - 1] ?? null;
}

/** Lines touching a card, stack item or seat, in id order (DESIGN "Combat and annotation"). */
export function linesOf(state: TableState, id: string): Line[] {
  return Object.values(state.lines)
    .filter((l) => l.from.id === id || l.to.id === id)
    .sort((a, b) => byId(a.id, b.id));
}

/** Seats in index order (DESIGN "Players, seats and formats"). */
export function seatsInOrder(state: TableState): SeatId[] {
  return Object.values(state.seats)
    .sort((a, b) => a.index - b.index)
    .map((s) => s.id);
}

/** Whether every seat other than the asker has answered ok or timeout (DESIGN "Turn flow and confirmation", All passed). */
export function allPassed(round: ConfirmRound, seats: SeatId[]): boolean {
  return seats.every((s) => {
    if (s === round.askedBy) return true;
    const r = own(round.responses, s);
    return r === 'ok' || r === 'timeout';
  });
}

/** Life shown for a seat: its team's in Two-Headed Giant, else its own (DESIGN "Players, seats and formats"). */
export function lifeOf(state: TableState, seat: SeatId): number {
  const s = own(state.seats, seat);
  if (!s) return 0;
  const team = s.team !== undefined ? own(state.teams, s.team) : undefined;
  return team ? team.life : s.life;
}

/**
 * The top of the local player's library: the first id of the secret library order that is still in the shared
 * library zone (DESIGN "Specification: network protocol and secrecy": a draw names the opaque id on top). Only the
 * owner's browser can answer; shared state keeps the library sorted.
 */
export function topOfLibrary(state: TableState, secrets: SecretStore): InstanceId | null {
  const lib = seatZone(state, 'library', secrets.seat);
  if (!lib) return null;
  const present = new Set(lib.ids);
  return secrets.libraryOrder.find((id) => present.has(id)) ?? null;
}

/** Number of cards in a seat's library, as everyone sees it (DESIGN "Table model": others get a count). */
export function libraryCount(state: TableState, seat: SeatId): number {
  return seatZone(state, 'library', seat)?.ids.length ?? 0;
}

/** Cards a seat controls on the battlefields, in id order (DESIGN "Card manipulation": Ctrl+U untaps everything you control). */
export function controlledCards(state: TableState, seat: SeatId): CardInstance[] {
  return Object.values(state.cards)
    .filter((c) => c.controller === seat && own(state.zones, c.zone)?.kind === 'battlefield')
    .sort((a, b) => byId(a.id, b.id));
}

/** Printed power and toughness as Scryfall writes them ('2', '*', '1+*'), or null when the card has none. */
export type PowerToughnessLookup = (card: CardInstance) => { power: string; toughness: string } | null;

/** Card count and summed power/toughness of a selection (DESIGN "Card manipulation", Multi-select). */
export interface SelectionSummary {
  /** Cards of the selection that exist. */
  count: number;
  /** Cards with a power and toughness. */
  creatures: number;
  power: number;
  toughness: number;
}

/**
 * Summed power/toughness of a selection, with +1/+1 and −1/−1 counters applied. Non-numeric printed values
 * ('*', 'X') count as 0. Card data comes from the caller, since core holds none.
 */
export function selectionSummary(state: TableState, ids: readonly InstanceId[], lookup: PowerToughnessLookup): SelectionSummary {
  const out: SelectionSummary = { count: 0, creatures: 0, power: 0, toughness: 0 };
  const num = (v: string): number => (/^-?\d+$/.test(v.trim()) ? Number(v) : 0);
  for (const id of new Set(ids)) {
    const c = own(state.cards, id);
    if (!c) continue;
    out.count++;
    const pt = lookup(c);
    if (!pt) continue;
    const mod = (own(c.counters, '+1/+1') ?? 0) - (own(c.counters, '-1/-1') ?? 0);
    out.creatures++;
    out.power += num(pt.power) + mod;
    out.toughness += num(pt.toughness) + mod;
  }
  return out;
}
