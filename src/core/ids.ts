import type { SeatId, ZoneId } from './types';

/**
 * Zone id convention (DESIGN "Table model": zones per player or per table).
 * Seat zones are `<kind>:<seatId>` (e.g. 'library:s0'), table zones are `<kind>` (e.g. 'stack').
 */

/** The id of zone `kind` of `seat`, or of the table zone `kind` when `seat` is null (DESIGN "Table model"). */
export function zoneId(kind: string, seat: SeatId | null = null): ZoneId {
  return seat === null ? kind : `${kind}:${seat}`;
}

/** Split a zone id into its kind and seat (DESIGN "Table model"). */
export function parseZoneId(id: ZoneId): { kind: string; seat: SeatId | null } {
  const i = id.indexOf(':');
  return i < 0 ? { kind: id, seat: null } : { kind: id.slice(0, i), seat: id.slice(i + 1) };
}

/** Seat id for a seat index, as `createTable` assigns them (DESIGN "Data model and protocol"). */
export function seatIdOf(index: number): SeatId {
  return `s${index}`;
}
