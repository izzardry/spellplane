/**
 * Shared fixtures for the core engine tests (PLAN M0-P1). States are built only through actions, so every
 * fixture is a state the reducer itself can reach.
 */
import { expect } from 'vitest';
import type { Action, ActionOf, ActionType } from '../../../src/core/actions';
import { canonicalJson } from '../../../src/core/hash';
import { createTable, explain, reduce } from '../../../src/core/reducer';
import type { CardInstance, CoreGameSpec, Format, Pose, TableState } from '../../../src/core/types';

/** A game definition shaped like Magic's (DESIGN "Table model"), independent of games/mtg (M0-P6). */
export const TEST_GAME: CoreGameSpec = {
  id: 'test',
  zones: [
    { id: 'library', scope: 'seat', visibility: 'nobody', ordered: true, presentation: 'squared', label: 'Library' },
    { id: 'hand', scope: 'seat', visibility: 'owner', ordered: false, presentation: 'fan', label: 'Hand' },
    { id: 'battlefield', scope: 'seat', visibility: 'public', ordered: false, presentation: 'free', label: 'Battlefield' },
    { id: 'graveyard', scope: 'seat', visibility: 'public', ordered: true, presentation: 'squared', label: 'Graveyard' },
    { id: 'exile', scope: 'seat', visibility: 'public', ordered: true, presentation: 'squared', label: 'Exile' },
    { id: 'command', scope: 'seat', visibility: 'public', ordered: false, presentation: 'area', label: 'Command' },
    { id: 'sideboard', scope: 'seat', visibility: 'owner', ordered: false, presentation: 'hidden', label: 'Sideboard' },
    { id: 'stack', scope: 'table', visibility: 'public', ordered: true, presentation: 'cascade-lane', label: 'Stack' },
  ],
  phases: [
    { id: 'untap', label: 'Untap' },
    { id: 'upkeep', label: 'Upkeep' },
    { id: 'draw', label: 'Draw' },
    { id: 'main1', label: 'Main 1' },
    { id: 'combat', label: 'Combat' },
    { id: 'main2', label: 'Main 2' },
    { id: 'end', label: 'End' },
  ],
  startingLife: (f: Format) => (f === '2hg' ? 30 : 20),
};

let cidCounter = 0;

/** Build an action with `by` (default s0) and a fresh cid. */
export function act<T extends ActionType>(type: T, fields: Omit<ActionOf<T>, 'type' | 'by' | 'cid'>, by = 's0'): ActionOf<T> {
  return { type, by, cid: `t${++cidCounter}`, ...fields } as unknown as ActionOf<T>;
}

/** Apply an action that must apply; fails the test with the reducer's reason otherwise. */
export function ok(state: TableState, action: Action): TableState {
  const why = explain(state, action);
  expect(why, `${action.type} should apply`).toBeNull();
  return reduce(state, action);
}

/** Apply an action that must NOT apply: same object back and a reason. Returns the reason. */
export function no(state: TableState, action: Action, reason?: RegExp): string {
  const next = reduce(state, action);
  expect(next, `${action.type} should not apply`).toBe(state);
  const why = explain(state, action);
  expect(why).not.toBeNull();
  if (reason) expect(why).toMatch(reason);
  return why ?? '';
}

/** A fresh two-seat table. */
export function fresh(format: Format = '1v1', seats = 2): TableState {
  const names = ['Anna', 'Ben', 'Cleo', 'Dan'];
  const teams = format === '2hg' ? ['t0', 't0', 't1', 't1'] : [];
  return createTable({
    game: TEST_GAME,
    format,
    seats: names.slice(0, seats).map((name, i) => ({ name, colour: i, ...(teams[i] ? { team: teams[i] } : {}) })),
  });
}

/** Ids of seat `s`'s library cards: s0 gets a00..a(n-1), s1 gets b00.. */
export function libIds(seat: string, n: number): string[] {
  const p = seat === 's0' ? 'a' : seat === 's1' ? 'b' : seat === 's2' ? 'c' : 'd';
  return Array.from({ length: n }, (_, i) => `${p}${String(i).padStart(2, '0')}`);
}

/** Both seats ready with `n` hidden library cards each. */
export function readyTable(n = 10, format: Format = '1v1', seats = 2): TableState {
  let s = fresh(format, seats);
  for (let i = 0; i < seats; i++) {
    const seat = `s${i}`;
    const ids = libIds(seat, n);
    s = ok(s, act('ready', { commits: ids.map((id) => `commit-${id}`), instanceIds: ids, zone: `library:${seat}` }, seat));
  }
  return s;
}

export const P = (x: number, y: number, rot = 0): Pose => ({ x, y, rot });

/** Reveal a library card and put it onto its owner's battlefield at `pose` (DESIGN "Table model": hidden to public needs a reveal). */
export function play(state: TableState, id: string, pose: Pose, by = 's0', sid = `sid-${id}`): TableState {
  let s = ok(state, act('reveal', { instanceId: id, ref: { sid }, salt: `salt-${id}` }, by));
  s = ok(s, act('move', { card: id, to: `battlefield:${by}`, pose }, by));
  return s;
}

/** The card, asserting it exists. */
export function card(state: TableState, id: string): CardInstance {
  const c = state.cards[id];
  expect(c, `card ${id}`).toBeDefined();
  return c!;
}

/** Recursively freeze a value (deep-freeze), so any write to the reducer's input throws in strict mode. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

/** Hash-equivalent comparison key of a state with `seq` set aside (core/undo.ts contract: "seq aside"). */
export function withoutSeq(state: TableState): string {
  return canonicalJson({ ...state, seq: 0 });
}

// ---------------------------------------------------------------------------------------------------------------
// Independent checks of the design's structural rules (not using core/invariants.ts, which is itself under test).
// ---------------------------------------------------------------------------------------------------------------

/** DESIGN "Table model": every card is in exactly one zone. Returns violations. */
export function cardsInExactlyOneZone(state: TableState): string[] {
  const out: string[] = [];
  const seen = new Map<string, number>();
  for (const zone of Object.values(state.zones)) {
    for (const id of zone.ids) {
      seen.set(id, (seen.get(id) ?? 0) + 1);
      if (state.cards[id]?.zone !== zone.id) out.push(`${id} listed in ${zone.id} but says ${state.cards[id]?.zone}`);
    }
  }
  for (const id of Object.keys(state.cards)) {
    if (seen.get(id) !== 1) out.push(`${id} is in ${seen.get(id) ?? 0} zones`);
  }
  for (const id of seen.keys()) if (!state.cards[id]) out.push(`${id} listed but no card`);
  return out;
}

/** PLAN M0-P1: pile indices are contiguous from 0 within each pile. Returns violations. */
export function pileIndicesContiguous(state: TableState): string[] {
  const piles = new Map<string, number[]>();
  for (const c of Object.values(state.cards)) {
    if (c.pile) piles.set(c.pile.id, [...(piles.get(c.pile.id) ?? []), c.pile.index]);
  }
  const out: string[] = [];
  for (const [id, idx] of piles) {
    const sorted = [...idx].sort((a, b) => a - b);
    if (sorted.some((v, i) => v !== i)) out.push(`pile ${id} has indices ${sorted.join(',')}`);
  }
  return out;
}

/** DESIGN "Table model": hidden zones hold only sorted opaque ids and a count; their cards carry no public state. */
export function hiddenZonesOpaque(state: TableState): string[] {
  const out: string[] = [];
  for (const z of Object.values(state.zones)) {
    if (z.visibility === 'public') continue;
    if (z.count !== z.ids.length) out.push(`${z.id} count ${z.count} != ${z.ids.length}`);
    const sorted = [...z.ids].sort();
    if (sorted.join() !== z.ids.join()) out.push(`${z.id} ids not sorted`);
    for (const id of z.ids) {
      const c = state.cards[id];
      if (c && (c.tapped || c.pile || c.attachedTo || c.note !== undefined || Object.keys(c.counters).length)) out.push(`${id} in ${z.id} carries public state`);
    }
  }
  return out;
}
