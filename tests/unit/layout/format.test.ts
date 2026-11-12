/**
 * M3-P1: the host picks the table format in the lobby (`formatSet`; DESIGN "Pre-game: draft, sealed and deck building",
 * Lobby settings: Format; "Players, seats and formats": seats per format, Two-Headed Giant teams with one shared life
 * total and turn marker; DECISIONS [M3-C], [M3-P1]).
 */
import { describe, expect, it } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { stateHash } from '../../../src/core/hash';
import { checkInvariants } from '../../../src/core/invariants';
import { createTable, explain, reduce } from '../../../src/core/reducer';
import { activeSeats, TABLE_FORMAT_SEATS } from '../../../src/core/teams';
import type { Format, TableState } from '../../../src/core/types';
import { mtg } from '../../../src/games/mtg/index';
import { act, no, ok, TEST_GAME } from '../core/helpers';

const FORMATS: Format[] = ['1v1', 'ffa3', 'ffa4', '2hg'];

/** A lobby table of `format` with every chair free (as a fresh room starts). */
function room(format: Format = '1v1'): TableState {
  return createTable({ game: TEST_GAME, format, seats: Array.from({ length: TABLE_FORMAT_SEATS[format] }, (_, i) => ({ name: '', colour: i as 0 })) });
}

/** Take chair `seat` as `name` (the lobby's seatTake). */
function sit(s: TableState, seat: string, name: string, colour: number): TableState {
  return ok(s, act('seatTake', { seat, name, colour: colour as 0, peer: `peer-${name}` }, seat));
}

const formatSet = (format: Format, life = mtg.startingLife(format), by = 's0') => act('formatSet', { format, life }, by);

describe('formatSet rebuilds the chairs, teams and life totals for the format', () => {
  it.each(FORMATS.flatMap((from) => FORMATS.map((to) => ({ from, to }))))('$from to $to: the table has the format\'s chairs and stays consistent', ({ from, to }) => {
    let s = sit(room(from), 's0', 'Anna', 3);
    s = ok(s, formatSet(to));
    expect(s.format).toBe(to);
    expect(Object.keys(s.seats).sort()).toEqual(Array.from({ length: TABLE_FORMAT_SEATS[to] }, (_, i) => `s${i}`));
    expect(Object.values(s.seats).map((x) => x.index).sort()).toEqual(Array.from({ length: TABLE_FORMAT_SEATS[to] }, (_, i) => i));
    // Every seat zone kind of the table, for every chair, and nothing for chairs that went.
    for (const seat of Object.keys(s.seats)) for (const z of TEST_GAME.zones.filter((z) => z.scope === 'seat')) expect(s.zones[`${z.id}:${seat}`], `${z.id}:${seat}`).toBeDefined();
    expect(Object.values(s.zones).every((z) => z.owner === null || Object.hasOwn(s.seats, z.owner))).toBe(true);
    expect(checkInvariants(s)).toEqual([]);
    // The host keeps the chair, name and colour.
    expect(s.seats.s0).toMatchObject({ name: 'Anna', colour: 3, peer: 'peer-Anna' });
  });

  it('Two-Headed Giant: teams t0 (seats 0 and 1) and t1 (seats 2 and 3), 30 life each team, the turn marker on t0', () => {
    let s = sit(room('1v1'), 's0', 'Anna', 0);
    s = ok(s, formatSet('2hg', 30));
    expect(s.teams).toEqual({ t0: { id: 't0', seats: ['s0', 's1'], life: 30, counters: {} }, t1: { id: 't1', seats: ['s2', 's3'], life: 30, counters: {} } });
    expect(['s0', 's1', 's2', 's3'].map((id) => s.seats[id]!.team)).toEqual(['t0', 't0', 't1', 't1']);
    expect(s.turn.active).toBe('t0');
    expect(activeSeats(s)).toEqual(['s0', 's1']);
    for (const seat of Object.values(s.seats)) expect(seat.life).toBe(30);
  });

  it('leaving Two-Headed Giant drops the teams and gives every player their own life and turn', () => {
    let s = sit(room('2hg'), 's0', 'Anna', 0);
    s = ok(s, formatSet('2hg', 30));
    s = ok(s, formatSet('ffa4', 20));
    expect(s.teams).toEqual({});
    expect(Object.values(s.seats).every((x) => x.team === undefined && x.life === 20)).toBe(true);
    expect(s.turn.active).toBe('s0');
    expect(checkInvariants(s)).toEqual([]);
  });

  it('occupied chairs keep their occupant; new chairs are free', () => {
    let s = sit(room('1v1'), 's0', 'Anna', 2);
    s = sit(s, 's1', 'Ben', 0);
    s = ok(s, formatSet('ffa4'));
    expect(s.seats.s0).toMatchObject({ name: 'Anna', colour: 2, peer: 'peer-Anna' });
    expect(s.seats.s1).toMatchObject({ name: 'Ben', colour: 0, peer: 'peer-Ben' });
    for (const id of ['s2', 's3']) {
      expect(s.seats[id]!.name).toBe('');
      expect(s.seats[id]!.peer).toBeUndefined();
    }
    // Free chairs take the lowest colours nobody uses.
    expect([s.seats.s2!.colour, s.seats.s3!.colour]).toEqual([1, 3]);
  });

  it('a smaller format drops free chairs above it, with their zones', () => {
    let s = sit(room('ffa4'), 's0', 'Anna', 0);
    s = sit(s, 's1', 'Ben', 1);
    s = ok(s, formatSet('1v1'));
    expect(Object.keys(s.seats).sort()).toEqual(['s0', 's1']);
    expect(Object.keys(s.zones).some((z) => z.endsWith(':s2') || z.endsWith(':s3'))).toBe(false);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('lines to a chair that goes are removed with it', () => {
    let s = sit(room('ffa3'), 's0', 'Anna', 0);
    s = ok(s, act('lineAdd', { line: 'ln1', kind: 'mark', from: { kind: 'seat', id: 's0' }, to: { kind: 'seat', id: 's2' } }));
    s = ok(s, act('lineAdd', { line: 'ln2', kind: 'mark', from: { kind: 'seat', id: 's0' }, to: { kind: 'seat', id: 's1' } }));
    s = ok(s, formatSet('1v1'));
    expect(Object.keys(s.lines)).toEqual(['ln2']);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('a format change and its replay give the same state hash (deterministic)', async () => {
    const base = sit(room('1v1'), 's0', 'Anna', 0);
    const a = formatSet('2hg', 30);
    expect(await stateHash(reduce(base, a))).toBe(await stateHash(reduce(structuredClone(base), structuredClone(a))));
    // Going there and back keeps the chairs as they were.
    const back = reduce(reduce(base, formatSet('ffa4')), formatSet('1v1'));
    expect(back.seats).toEqual(base.seats);
    expect(back.zones).toEqual(base.zones);
  });

  it('every layout of the game has a chair for every seat the reducer creates', () => {
    for (const f of FORMATS) {
      const s = ok(sit(room('1v1'), 's0', 'Anna', 0), formatSet(f));
      const l = mtg.layout(f);
      for (const seat of Object.values(s.seats)) expect(l.seats[seat.index], `${f} seat ${seat.index}`).toBeDefined();
    }
  });
});

describe('who may change the format, and when', () => {
  it('only the host (the seated player in the lowest chair)', () => {
    let s = sit(room('1v1'), 's1', 'Ben', 1);
    no(s, formatSet('ffa3', 20, 's0'), /host/);
    s = sit(s, 's0', 'Anna', 0);
    no(s, formatSet('ffa3', 20, 's1'), /host/);
    ok(s, formatSet('ffa3', 20, 's0'));
  });

  it('nobody, on an empty table', () => {
    no(room('1v1'), formatSet('ffa3'), /host/);
  });

  it('only in the lobby', () => {
    let s = sit(room('1v1'), 's0', 'Anna', 0);
    s = ok(s, act('stageSet', { stage: 'match' }));
    no(s, formatSet('ffa3'), /lobby/);
  });

  it('not once a player is Ready (a committed deck belongs to its chair)', () => {
    let s = sit(room('1v1'), 's0', 'Anna', 0);
    s = ok(s, act('ready', { commits: ['c1'], instanceIds: ['a1'], zone: 'library:s0' }));
    no(s, formatSet('ffa3'), /Ready/);
  });

  it('not when a player sits in a chair the format does not have; they move to a lower chair first', () => {
    let s = sit(room('ffa4'), 's0', 'Anna', 0);
    s = sit(s, 's3', 'Dan', 3);
    no(s, formatSet('ffa3'), /chair/);
    no(s, formatSet('1v1'), /chair/);
    ok(s, formatSet('2hg'));
  });

  it('not when more players are seated than the format has chairs', () => {
    let s = sit(room('ffa4'), 's0', 'Anna', 0);
    s = sit(s, 's1', 'Ben', 1);
    s = sit(s, 's2', 'Cleo', 2);
    no(s, formatSet('1v1'), /3 players are seated/);
  });

  it('refuses malformed input without throwing (the reducer is total)', () => {
    const s = sit(room('1v1'), 's0', 'Anna', 0);
    const bad: unknown[] = [
      { format: 'ffa5', life: 20 },
      { format: '__proto__', life: 20 },
      { format: 'ffa3', life: 0 },
      { format: 'ffa3', life: -5 },
      { format: 'ffa3', life: 20.5 },
      { format: 'ffa3', life: '20' },
      { format: 'ffa3', life: 1e9 },
      { format: 'ffa3' },
      {},
    ];
    for (const fields of bad) {
      const a = { type: 'formatSet', by: 's0', cid: 'x', ...(fields as object) } as unknown as Action;
      expect(reduce(s, a)).toBe(s);
      expect(explain(s, a)).not.toMatch(/internal error/);
    }
  });
});
