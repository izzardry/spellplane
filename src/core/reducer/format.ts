/**
 * `formatSet`: the host changes the table format in the lobby (DESIGN "Pre-game: draft, sealed and deck building",
 * Lobby settings: "Format (1v1, free-for-all, Two-Headed Giant)"; "Players, seats and formats": seats per format,
 * Two-Headed Giant teams with one shared life total and turn marker). Contracts: M3-C (stub); implementer: M3-P1
 * (seats, zones and life per format), using core/teams.ts TABLE_FORMAT_SEATS / TABLE_FORMAT_TEAMS / teamIdOf for the teams.
 *
 * Expected rules (DECISIONS [M3-C]): host only (core/stage.ts hostSeat), lobby stage only, no seat Ready; the table
 * gets exactly TABLE_FORMAT_SEATS[format] seats 's0'.. with every seat zone kind the table already has, the teams of
 * TABLE_FORMAT_TEAMS[format] (none otherwise), every seat's and team's life set to `life`, `turn.active` set to seat 0 or
 * its team; occupied chairs keep their occupant, and a format with fewer seats than occupied chairs is refused.
 */
import type { ActionOf } from '../actions';
import type { Draft } from './draft';
import { reject } from './util';

/** `formatSet {format, life}` (core/actions.ts FormatSetAction). Implementer: M3-P1. */
export function formatSet(_d: Draft, _a: ActionOf<'formatSet'>): void {
  reject('formatSet is not implemented: M3-P1');
}
