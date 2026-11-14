/**
 * Dropping a carry group (PLAN Milestone 6, owner decisions: "drop a card on another's upper third and it tucks and
 * attaches; dragging the host carries it; dragging it out detaches it. Dragging a middle cascade card carries the cards
 * below it"; "A dragged group is one gesture, undone as one step"). The scene's drafts (scene/carry.ts) are applied
 * with the real reducer and the resulting table is checked, so the test asserts what the player sees happen.
 */
import { describe, expect, it } from 'vitest';
import type { Action, ActionDraft } from '../../../src/core/actions';
import { carryGroup } from '../../../src/core/clips';
import { GEOMETRY } from '../../../src/core/geometry';
import { checkInvariants } from '../../../src/core/invariants';
import { tuckPose } from '../../../src/core/reducer';
import type { InstanceId, Pose, TableState } from '../../../src/core/types';
import { inverse } from '../../../src/core/undo';
import { carryDropActions } from '../../../src/scene/carry';
import { toStoredPoses } from '../../../src/scene/gestures';
import { displayedRot } from '../../../src/scene/layout';
import type { DropResult } from '../../../src/scene/snap';
import { P, act, card, ok, play, readyTable, withoutSeq } from '../core/helpers';

const CASCADE = GEOMETRY.cascadeOffset;
let n = 0;
const opts = { newId: (p: string) => `${p}-${++n}`, presentation: (z: string) => (z.startsWith('battlefield') ? ('free' as const) : z === 'stack' ? ('cascade-lane' as const) : ('squared' as const)) };

/** Drawn start poses of the group, as the scene has them. */
function startOf(s: TableState, ids: readonly InstanceId[]): Map<InstanceId, Pose> {
  return new Map(ids.map((id) => [id, { ...s.cards[id]!.pose, rot: displayedRot(s.cards[id]!) }]));
}

/** Apply drafts as the session would (by s0), every one of them; returns the final state and the actions. */
function apply(s: TableState, drafts: ActionDraft[], by = 's0'): { state: TableState; actions: Action[] } {
  // As the scene does: drafts carry drawn poses, the session gets stored ones.
  const actions = toStoredPoses(s, drafts).map((d) => ({ ...d, by, cid: `d${++n}` }) as Action);
  let st = s;
  for (const a of actions) st = ok(st, a);
  expect(checkInvariants(st)).toEqual([]);
  return { state: st, actions };
}

function dropGroup(s: TableState, anchor: InstanceId, result: DropResult, dest = { zone: 'battlefield:s0', controller: 's0' }, selection: InstanceId[] = []) {
  const g = carryGroup(s, anchor, { selection });
  const drafts = carryDropActions(s, g, startOf(s, g.cards), result, dest, opts);
  return { g, drafts, ...apply(s, drafts) };
}

/** Undo a whole group step (newest first), as the session does for one group. */
function undoAll(before: TableState, actions: Action[]): TableState {
  const states = [before];
  for (const a of actions) states.push(ok(states[states.length - 1]!, a));
  let s = states[states.length - 1]!;
  for (let i = actions.length - 1; i >= 0; i--) {
    const inv = inverse(states[i]!, actions[i]!);
    if (!inv) continue;
    s = ok(s, act('undo', { of: actions[i]!.cid, inverse: JSON.parse(JSON.stringify(inv)) }));
  }
  return s;
}

function base(): TableState {
  let s = readyTable(12);
  s = play(s, 'a00', P(0, -200));
  s = play(s, 'a01', P(200, -200));
  s = play(s, 'a02', P(300, -200));
  return s;
}

describe('tuck by drop', () => {
  it('a card dropped on another\'s upper third tucks behind it and attaches (one action, logged as attach)', () => {
    const s = base();
    const { drafts, state } = dropGroup(s, 'a01', { rule: '3a', kind: 'tuck', host: 'a00', pose: tuckPose(P(0, -200), 1) });
    expect(drafts).toEqual([{ type: 'attach', card: 'a01', to: 'a00' }]);
    expect(card(state, 'a01')).toMatchObject({ attachedTo: 'a00', pose: P(10, -190) });
    const ids = state.zones['battlefield:s0']!.ids;
    expect(ids.indexOf('a01')).toBeLessThan(ids.indexOf('a00'));
  });

  it('a card from the hand tucks onto a creature on the battlefield (a move, then the attach, one group)', () => {
    let s = base();
    s = ok(s, act('draw', { instanceId: 'a05' }));
    s = ok(s, act('reveal', { instanceId: 'a05', ref: { sid: 'aura' }, salt: 'x' }));
    const { drafts, state } = dropGroup(s, 'a05', { rule: '3a', kind: 'tuck', host: 'a00', pose: tuckPose(P(0, -200), 1) });
    expect(drafts.map((d) => d.type)).toEqual(['move', 'attach']);
    expect(new Set(drafts.map((d) => d.group)).size).toBe(1);
    expect(card(state, 'a05')).toMatchObject({ zone: 'battlefield:s0', attachedTo: 'a00', pose: P(10, -190) });
  });

  it('an Aura of mine tucks onto an opponent\'s creature: it joins that battlefield and stays under my control', () => {
    let s = base();
    s = play(s, 'b00', P(0, 200, 180), 's1');
    const { state } = dropGroup(s, 'a01', { rule: '3a', kind: 'tuck', host: 'b00', pose: tuckPose(P(0, 200, 180), 1) }, { zone: 'battlefield:s1', controller: 's1' });
    expect(card(state, 'a01')).toMatchObject({ zone: 'battlefield:s1', attachedTo: 'b00', controller: 's0', pose: P(-10, 190, 180) });
  });
});

describe('carry and detach by drag', () => {
  function withAura(): TableState {
    let s = base();
    s = ok(s, act('attach', { card: 'a01', to: 'a00' }));
    s = ok(s, act('attach', { card: 'a02', to: 'a00' }));
    return s;
  }

  it('dragging the host carries its attachments, tucked as they were; one move', () => {
    const s = withAura();
    const { drafts, state } = dropGroup(s, 'a00', { rule: 5, kind: 'free', pose: P(-300, -100) });
    expect(drafts).toEqual([{ type: 'move', card: 'a00', to: 'battlefield:s0', pose: P(-300, -100), pile: null }]);
    expect(card(state, 'a01')).toMatchObject({ attachedTo: 'a00', pose: P(-290, -90) });
    expect(card(state, 'a02')).toMatchObject({ attachedTo: 'a00', pose: P(-280, -80) });
    expect(state.zones['battlefield:s0']!.ids.slice(-3)).toEqual(['a02', 'a01', 'a00']);
  });

  it('dragging an attachment out alone detaches it (logged as detach), in the same gesture', () => {
    const s = withAura();
    const { drafts, state } = dropGroup(s, 'a01', { rule: 5, kind: 'free', pose: P(300, -300) });
    expect(drafts.map((d) => d.type)).toEqual(['move', 'detach']);
    expect(card(state, 'a01').attachedTo).toBeUndefined();
    expect(card(state, 'a01').pose).toEqual(P(300, -300));
    expect(card(state, 'a02').attachedTo).toBe('a00');
  });

  it('a host with attachments dragged into another territory keeps them attached there', () => {
    let s = withAura();
    s = play(s, 'b00', P(400, 200, 180), 's1');
    const { state } = dropGroup(s, 'a00', { rule: 5, kind: 'free', pose: P(0, 150) }, { zone: 'battlefield:s1', controller: 's1' });
    expect(card(state, 'a00').zone).toBe('battlefield:s1');
    expect(card(state, 'a01')).toMatchObject({ zone: 'battlefield:s1', attachedTo: 'a00', pose: P(10, 160) });
    expect(card(state, 'a02')).toMatchObject({ zone: 'battlefield:s1', attachedTo: 'a00', pose: P(20, 170) });
  });

  it('undoing the group drag restores the table exactly', () => {
    const s = withAura();
    const { actions } = dropGroup(s, 'a01', { rule: 5, kind: 'free', pose: P(300, -300) });
    expect(withoutSeq(undoAll(s, actions))).toBe(withoutSeq(s));
  });
});

describe('solitaire carry of piles', () => {
  function cascade(): TableState {
    let s = readyTable(12);
    for (const [i, id] of ['a00', 'a01', 'a02', 'a03'].entries()) {
      s = play(s, id, P(-200, -150 - i * CASCADE));
      s = ok(s, act('pile', { card: id, pile: { id: 'L', index: i, kind: 'cascade' } }));
    }
    return s;
  }

  it('dragging a middle cascade card carries the cards below it into a new cascade; the rest stays', () => {
    const s = cascade();
    const { g, state, drafts } = dropGroup(s, 'a01', { rule: 5, kind: 'free', pose: P(200, -100) });
    expect(g.cards).toEqual(['a01', 'a02', 'a03']);
    expect(new Set(drafts.map((d) => d.group)).size).toBe(1);
    const L = card(state, 'a00').pile;
    expect(L).toEqual({ id: 'L', index: 0, kind: 'cascade' });
    expect(Object.values(state.cards).filter((c) => c.pile?.id === 'L')).toHaveLength(1);
    const np = card(state, 'a01').pile!;
    expect(np).toMatchObject({ index: 0, kind: 'cascade' });
    expect(card(state, 'a02').pile).toEqual({ ...np, index: 1 });
    expect(card(state, 'a03').pile).toEqual({ ...np, index: 2 });
    expect(card(state, 'a01').pose).toEqual(P(200, -100));
    expect(card(state, 'a03').pose).toEqual(P(200, -100 - 2 * CASCADE));
  });

  it('the bottom card takes the whole pile; the last card comes out alone', () => {
    let { state } = dropGroup(cascade(), 'a00', { rule: 5, kind: 'free', pose: P(100, -100) });
    expect(Object.values(state.cards).filter((c) => c.pile?.id === 'L').map((c) => c.pose)).toEqual([0, 1, 2, 3].map((i) => P(100, -100 - i * CASCADE)));
    ({ state } = dropGroup(cascade(), 'a03', { rule: 5, kind: 'free', pose: P(100, -100) }));
    expect(card(state, 'a03').pile).toBeUndefined();
    expect(Object.values(state.cards).filter((c) => c.pile?.id === 'L')).toHaveLength(3);
  });

  it('a whole pile dragged to another battlefield arrives whole', () => {
    let s = cascade();
    s = play(s, 'b00', P(400, 200, 180), 's1');
    const { state } = dropGroup(s, 'a00', { rule: 5, kind: 'free', pose: P(0, 150) }, { zone: 'battlefield:s1', controller: 's1' });
    const ms = Object.values(state.cards).filter((c) => c.pile?.id === 'L');
    expect(ms.map((c) => c.zone)).toEqual(Array(4).fill('battlefield:s1'));
  });
});

describe('clipped groups', () => {
  it('dragging any clipped card moves the whole group rigidly, as one undo step', () => {
    let s = base();
    s = ok(s, act('clipAdd', { clip: 'k1', cards: ['a00', 'a01'], anchor: { card: 'a00', x: 31, y: 0 } }));
    s = ok(s, act('attach', { card: 'a02', to: 'a01' }));
    const before = s;
    for (const anchor of ['a00', 'a01']) {
      const at = anchor === 'a00' ? P(-100, 0) : P(100, 0);
      const { state, actions } = dropGroup(before, anchor, { rule: 5, kind: 'free', pose: at });
      const dx = card(state, 'a00').pose.x - card(before, 'a00').pose.x;
      const dy = card(state, 'a00').pose.y - card(before, 'a00').pose.y;
      for (const id of ['a01', 'a02']) {
        expect(card(state, id).pose.x - card(before, id).pose.x).toBeCloseTo(dx, 6);
        expect(card(state, id).pose.y - card(before, id).pose.y).toBeCloseTo(dy, 6);
      }
      expect(state.clips?.k1?.cards).toEqual(['a00', 'a01']);
      expect(card(state, 'a02').attachedTo).toBe('a01');
      expect(new Set(actions.map((a) => a.group)).size).toBe(1);
      expect(withoutSeq(undoAll(before, actions))).toBe(withoutSeq(before));
    }
  });

  it('dropping a clipped group on the graveyard takes every card there; the clip goes with them', () => {
    let s = base();
    s = ok(s, act('clipAdd', { clip: 'k1', cards: ['a00', 'a01'], anchor: { card: 'a00', x: 31, y: 0 } }));
    const { state } = dropGroup(s, 'a01', { rule: 1, kind: 'zone', zone: 'graveyard:s0' });
    expect(card(state, 'a00').zone).toBe('graveyard:s0');
    expect(card(state, 'a01').zone).toBe('graveyard:s0');
    expect(state.clips).toBeUndefined();
  });
});
