/**
 * `formatSet`: the host changes the table format in the lobby (DESIGN "Pre-game: draft, sealed and deck building",
 * Lobby settings: "Format (1v1, free-for-all, Two-Headed Giant)"; "Players, seats and formats": seats per format,
 * Two-Headed Giant teams with one shared life total and turn marker). Contracts: M3-C; implementer: M3-P1.
 *
 * Rules (DECISIONS [M3-C], [M3-P1]):
 * - host only (core/stage.ts hostSeat, as `lobbySet`), lobby stage only, and nobody Ready (no seat `ready`, no deck
 *   commitment): a committed deck belongs to the chair it was committed at;
 * - `life` is a whole number from 1 to 999 (the client takes it from `GameDefinition.startingLife(format)`);
 * - the table gets exactly TABLE_FORMAT_SEATS[format] seats 's0'.. : chairs that stay keep their occupant, name, colour
 *   and counters; new chairs are free, with the lowest seat colour no other chair uses, and every seat zone kind the
 *   table already has (same visibility); a chair that goes must be free and own no card, else the format is refused
 *   (occupied chairs are never moved, so a peer's seat id never changes under it);
 * - the teams of TABLE_FORMAT_TEAMS[format] with ids `teamIdOf(i)` replace any teams (none outside Two-Headed Giant);
 * - every seat's and team's life is `life`; `turn.active` is seat 0, or its team; lines that name a removed seat go.
 * Pure and total: every input is checked.
 */
import type { ActionOf } from '../actions';
import { hostSeat } from '../stage';
import { TABLE_FORMAT_SEATS, TABLE_FORMAT_TEAMS, teamIdOf } from '../teams';
import type { Format, SeatColourIndex, SeatId, Zone } from '../types';
import { seatIdOf, zoneId } from '../ids';
import type { Draft } from './draft';
import { checkInt, reject } from './util';

/** Largest starting life a format accepts (the design's are 20 and 30). */
export const MAX_FORMAT_LIFE = 999;

/** Seat colours a table offers (DESIGN "Themes and rendering": eight seat colours). */
const SEAT_COLOURS = 8;

const FORMATS: readonly Format[] = ['1v1', 'ffa3', 'ffa4', '2hg'];

function checkFormat(v: unknown): Format {
  if (typeof v !== 'string' || !FORMATS.includes(v as Format)) reject('unknown table format');
  return v as Format;
}

/** `formatSet {format, life}` (core/actions.ts FormatSetAction). */
export function formatSet(d: Draft, a: ActionOf<'formatSet'>): void {
  const format = checkFormat(a.format);
  const life = checkInt(a.life, 'starting life', 1, MAX_FORMAT_LIFE);
  if (d.base.stage !== 'lobby') reject('the format changes only in the lobby');
  const host = hostSeat(d.base);
  if (host === null || a.by !== host) reject('only the host changes the format');
  if (d.seats.values().some((s) => s.ready) || d.commitments.keys().length > 0) reject('the format cannot change once a player is Ready');

  const n = TABLE_FORMAT_SEATS[format];
  const seats = d.seats.values().sort((x, y) => x.index - y.index);
  const occupied = (s: (typeof seats)[number]) => s.peer !== undefined || s.name.trim() !== '';

  // Chairs that go: free, and nothing of theirs is on the table.
  const gone = seats.filter((s) => s.index >= n);
  const goneIds = new Set<SeatId>(gone.map((s) => s.id));
  if (gone.some(occupied)) {
    const taken = gone.filter(occupied).length;
    const count = seats.filter(occupied).length;
    reject(count > n ? `${count} players are seated and this format has ${n} chairs` : `${taken === 1 ? 'a player sits' : 'players sit'} in a chair this format does not have; move to a lower chair first`);
  }
  if (d.cards.values().some((c) => goneIds.has(c.owner) || goneIds.has(c.controller))) reject('a chair this format does not have still has cards');
  if (d.stack.some((i) => goneIds.has(i.controller))) reject('a chair this format does not have still has an item on the stack');

  // The seat zone kinds this table has, with their visibility (from any existing seat; seat 0 always exists).
  const kinds = new Map<string, Zone['visibility']>();
  for (const z of d.zones.values()) if (z.owner !== null && !kinds.has(z.kind)) kinds.set(z.kind, z.visibility);

  for (const s of gone) {
    for (const id of d.zones.keys()) if (d.zones.get(id)!.owner === s.id) d.zones.delete(id);
    d.seats.delete(s.id);
  }
  for (const l of d.lines.values()) {
    const named = [l.from, l.to].some((e) => e.kind === 'seat' && goneIds.has(e.id));
    if (named || goneIds.has(l.by)) d.lines.delete(l.id);
  }

  // New chairs: free, the lowest colour no other chair uses, every seat zone kind.
  for (let index = 0; index < n; index++) {
    const id = seatIdOf(index);
    if (d.seats.has(id)) continue;
    const used = new Set(d.seats.values().map((s) => s.colour));
    let colour = 0;
    while (used.has(colour as SeatColourIndex) && colour < SEAT_COLOURS - 1) colour++;
    d.seats.set(id, { id, index, name: '', colour: colour as SeatColourIndex, life, counters: {}, ready: false, autoPass: false });
    for (const [kind, visibility] of kinds) {
      const zid = zoneId(kind, id);
      d.zones.set(zid, visibility === 'public' ? { id: zid, kind, owner: id, visibility, ids: [] } : { id: zid, kind, owner: id, visibility, count: 0, ids: [] });
    }
  }

  // Teams of the format replace any teams; every seat's and team's life is `life`.
  for (const t of d.teams.keys()) d.teams.delete(t);
  for (const id of d.seats.keys()) {
    const w = d.seats.w(id);
    delete w.team;
    w.life = life;
  }
  (TABLE_FORMAT_TEAMS[format] ?? []).forEach((members, i) => {
    const team = teamIdOf(i);
    const ids = members.map(seatIdOf);
    d.teams.set(team, { id: team, seats: ids, life, counters: {} });
    for (const s of ids) d.seats.w(s).team = team;
  });

  const first = d.seats.need(seatIdOf(0));
  const turn = d.turnW();
  turn.active = first.team ?? first.id;
  d.setFormat(format);
}
