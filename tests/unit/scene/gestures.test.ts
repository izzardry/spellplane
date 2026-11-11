// Gestures to actions, DESIGN "Card manipulation" and CLAUDE.md (one action per card, shared group; scene never mutates).
import { describe, expect, it } from 'vitest';
import type { CardInstance, TableState, ZonePresentation } from '../../../src/core/types';
import { dropActions, tapActions, toStoredPoses, type DropActionOptions } from '../../../src/scene/gestures';
import { buildHarnessState } from '../../../src/scene/harness-fixture';

let n = 0;
const opts = (over: Partial<DropActionOptions> = {}): DropActionOptions => ({
  newId: (p) => `${p}-${++n}`,
  keepPile: false,
  presentation: (z): ZonePresentation | null => (z === 'stack' ? 'cascade-lane' : z.startsWith('battlefield') ? 'free' : z.startsWith('hand') ? 'fan' : 'squared'),
  ...over,
});

function table(): TableState {
  const s = buildHarnessState({ scenario: 'empty' });
  const add = (id: string, x: number, y: number, extra: Partial<CardInstance> = {}) => {
    s.cards[id] = { id, owner: 's0', controller: 's0', zone: 'battlefield:s0', face: 'up', faceIndex: 0, tapped: false, pose: { x, y, rot: 0 }, counters: {}, identity: { sid: `fx-${id}` }, ...extra };
    (s.zones['battlefield:s0']!.ids as string[]).push(id);
  };
  add('a', 0, -300);
  add('b', 200, -300);
  add('c', 300, -300);
  return s;
}

describe('drop actions', () => {
  it('a squared drop on a loose card creates a pile: target index 0, dropped card index 1, one group', () => {
    const s = table();
    const acts = dropActions(s, [s.cards.b!], new Map(), { rule: 2, kind: 'squared', pose: { x: 0, y: -300, rot: 0 }, onto: 'a', pile: null }, { zone: 'battlefield:s0', controller: 's0' }, opts());
    expect(acts).toHaveLength(2);
    const [p, m] = acts as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(p).toMatchObject({ type: 'pile', card: 'a', pile: { index: 0, kind: 'squared' } });
    expect(m).toMatchObject({ type: 'move', card: 'b', to: 'battlefield:s0', pose: { x: 0, y: -300, rot: 0 }, pile: { index: 1, kind: 'squared' } });
    expect((p.pile as { id: string }).id).toBe((m.pile as { id: string }).id);
    expect(p.group).toBeDefined();
    expect(p.group).toBe(m.group);
    expect(m.controller).toBeUndefined();
  });

  it('joining an existing cascade appends at the next index', () => {
    const s = table();
    s.cards.a!.pile = { id: 'c1', index: 0, kind: 'cascade' };
    s.cards.b!.pile = { id: 'c1', index: 1, kind: 'cascade' };
    const acts = dropActions(s, [s.cards.c!], new Map(), { rule: 3, kind: 'cascade', pose: { x: 0, y: -328, rot: 0 }, below: 'b', pile: s.cards.b!.pile }, { zone: 'battlefield:s0', controller: 's0' }, opts());
    expect(acts).toEqual([{ type: 'move', card: 'c', to: 'battlefield:s0', pose: { x: 0, y: -328, rot: 0 }, pile: { id: 'c1', index: 2, kind: 'cascade' } }]);
  });

  it('zone drops: library top, hand, public pile, stack', () => {
    const s = table();
    const zone = (z: string) => dropActions(s, [s.cards.a!], new Map(), { rule: 1, kind: 'zone', zone: z }, { zone: 'battlefield:s0', controller: 's0' }, opts());
    expect(zone('library:s0')).toEqual([{ type: 'toZone', card: 'a', to: 'library:s0', position: 'top' }]);
    expect(zone('hand:s1')).toEqual([{ type: 'toZone', card: 'a', to: 'hand:s1', position: 'any' }]);
    expect(zone('graveyard:s0')).toEqual([{ type: 'move', card: 'a', to: 'graveyard:s0', pile: null }]);
    expect(zone('stack')).toMatchObject([{ type: 'stackPush', kind: 'spell', card: 'a' }]);
  });

  it('a group keeps its arrangement and shares one group id; a drop into another territory changes controller', () => {
    const s = table();
    const start = new Map([
      ['b', { x: 200, y: -300, rot: 0 }],
      ['c', { x: 300, y: -300, rot: 0 }],
    ]);
    const acts = dropActions(s, [s.cards.b!, s.cards.c!], start, { rule: 5, kind: 'free', pose: { x: 50, y: 300, rot: 0 } }, { zone: 'battlefield:s1', controller: 's1' }, opts());
    expect(acts).toMatchObject([
      { type: 'move', card: 'b', to: 'battlefield:s1', pose: { x: 50, y: 300 }, controller: 's1' },
      { type: 'move', card: 'c', to: 'battlefield:s1', pose: { x: 150, y: 300 }, controller: 's1' },
    ]);
    expect((acts[0] as { group?: string }).group).toBe((acts[1] as { group?: string }).group);
  });

  it('pulling a card out of a pile clears its membership; moving a whole pile keeps it', () => {
    const s = table();
    s.cards.a!.pile = { id: 'p', index: 0, kind: 'squared' };
    const out = dropActions(s, [s.cards.a!], new Map(), { rule: 5, kind: 'free', pose: { x: 10, y: -10, rot: 0 } }, { zone: 'battlefield:s0', controller: 's0' }, opts());
    expect(out).toMatchObject([{ type: 'move', pile: null }]);
    const keep = dropActions(s, [s.cards.a!], new Map(), { rule: 5, kind: 'free', pose: { x: 10, y: -10, rot: 0 } }, { zone: 'battlefield:s0', controller: 's0' }, opts({ keepPile: true }));
    expect(keep).toMatchObject([{ type: 'move', pile: { id: 'p', index: 0 } }]);
  });

  it('no actions when nothing changes', () => {
    const s = table();
    expect(dropActions(s, [s.cards.a!], new Map(), { rule: 5, kind: 'free', pose: { x: 0, y: -300, rot: 0 } }, { zone: 'battlefield:s0', controller: 's0' }, opts())).toEqual([]);
    expect(dropActions(s, [s.cards.a!], new Map(), { rule: 1, kind: 'zone', zone: 'battlefield:s0' }, { zone: 'battlefield:s0', controller: 's0' }, opts())).toEqual([]);
  });
});

describe('tap actions', () => {
  it('toggles from the first card and groups a selection', () => {
    const s = table();
    expect(tapActions([s.cards.a!], opts())).toEqual([{ type: 'tap', card: 'a', tapped: true }]);
    s.cards.b!.tapped = true;
    const acts = tapActions([s.cards.a!, s.cards.b!, s.cards.c!], opts());
    expect(acts.map((a) => (a as { card: string }).card)).toEqual(['a', 'c']);
    expect((acts[0] as { group?: string }).group).toBeDefined();
  });
});

describe('stored poses', () => {
  it('moves and temporary moves of a tapped card drop the drawn tap turn; untapped cards are unchanged', () => {
    const s = table();
    s.cards.a!.tapped = true;
    const out = toStoredPoses(s, [
      { type: 'move', card: 'a', to: 'battlefield:s0', pose: { x: 10, y: -300, rot: 90 }, pile: null },
      { type: 'moveTemp', card: 'a', pose: { x: 10, y: -200, rot: 90 } },
      { type: 'move', card: 'b', to: 'battlefield:s0', pose: { x: 50, y: -300, rot: 0 }, pile: null },
      { type: 'tap', card: 'a', tapped: false },
    ]);
    expect(out[0]).toMatchObject({ pose: { x: 10, y: -300, rot: 0 } });
    expect(out[1]).toMatchObject({ pose: { x: 10, y: -200, rot: 0 } });
    expect(out[2]).toMatchObject({ pose: { x: 50, y: -300, rot: 0 } });
    expect(out[3]).toEqual({ type: 'tap', card: 'a', tapped: false });
  });
});
