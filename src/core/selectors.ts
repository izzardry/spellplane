/**
 * Read-only queries over TableState shared by scene, HUD and session (DESIGN "Data model and protocol";
 * "Engineering rules": the scene and HUD are pure views of state). Implementer: M0-P1. All stubs throw until then.
 */
import type { CardInstance, ConfirmRound, InstanceId, Line, PileId, SeatId, StackItem, TableState, Zone, ZoneId } from './types';

const todo = (): never => {
  throw new Error('not implemented: M0-P1');
};

/** The zone with this id, or null (DESIGN "Table model"). */
export function zoneById(_state: TableState, _zone: ZoneId): Zone | null {
  return todo();
}

/** Zone `kind` of `seat` (or the table zone when seat is null), or null (DESIGN "Table model"). */
export function seatZone(_state: TableState, _kind: string, _seat: SeatId | null): Zone | null {
  return todo();
}

/** Cards of a zone in zone order (sorted ids for hidden zones) (DESIGN "Table model"). */
export function cardsInZone(_state: TableState, _zone: ZoneId): CardInstance[] {
  return todo();
}

/** Members of a pile ordered by pile index, bottom first (DESIGN "Card manipulation"). */
export function pileMembers(_state: TableState, _pile: PileId): CardInstance[] {
  return todo();
}

/** Cards attached to `host` (DESIGN "Combat and annotation", Attachment). */
export function attachmentsOf(_state: TableState, _host: InstanceId): CardInstance[] {
  return todo();
}

/** Cards with a home slot, i.e. temporarily displaced (DESIGN "Combat and annotation"). */
export function displacedCards(_state: TableState): CardInstance[] {
  return todo();
}

/** The top stack item, or null (DESIGN "The effect stack"). */
export function topOfStack(_state: TableState): StackItem | null {
  return todo();
}

/** Lines touching a card, stack item or seat (DESIGN "Combat and annotation"). */
export function linesOf(_state: TableState, _id: string): Line[] {
  return todo();
}

/** Seats in index order (DESIGN "Players, seats and formats"). */
export function seatsInOrder(_state: TableState): SeatId[] {
  return todo();
}

/** Whether every seat other than the asker has answered ok or timeout (DESIGN "Turn flow and confirmation", All passed). */
export function allPassed(_round: ConfirmRound, _seats: SeatId[]): boolean {
  return todo();
}

/** Life shown for a seat: its team's in Two-Headed Giant, else its own (DESIGN "Players, seats and formats"). */
export function lifeOf(_state: TableState, _seat: SeatId): number {
  return todo();
}
