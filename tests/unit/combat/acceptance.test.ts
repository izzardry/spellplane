/**
 * PLAN M1-P4 acceptance, engine and HUD side (DESIGN "Combat and annotation"; "Specification: geometry, layout and
 * motion": attack displacement 110 toward the table centre along the seat's forward axis, a card of a seat at θ is
 * tapped at θ + 90):
 *
 * - Attack moves 110 mm forward and taps (A on a hovered creature; Shift+A without tapping).
 * - Settle returns every displaced card to its home pose and removes attack and block lines but not persistent marks.
 * - Lines follow moved endpoints: here on the pure line model (scene/lines.ts drawnLines); the browser test
 *   tests/e2e/combat/combat.spec.ts asserts it on the debug hook's line endpoints.
 *
 * Key presses run through the HUD's real Commands and their drafts through the real reducer.
 */
import { describe, expect, it } from 'vitest';
import { inverse } from '../../../src/core/undo';
import { reduce } from '../../../src/core/reducer';
import type { Anchor, Pose, TableState } from '../../../src/core/types';
import { blockPlan } from '../../../src/scene/combat';
import { drawnLines, type AnchorResolver } from '../../../src/scene/lines';
import { P, act, applyDrafts, board, card, ctxFor, line, ok, press, withoutSeq } from './helpers';

const posesOf = (s: TableState) => Object.fromEntries(Object.values(s.cards).map((c) => [c.id, c.pose]));

describe('attack moves 110 mm forward and taps', () => {
  it('A on a hovered creature of seat 0 moves it 110 mm toward the centre (+y) and taps it', () => {
    const s0 = board();
    const before = card(s0, 'a01').pose;
    const s = applyDrafts(s0, press(s0, 'attack', { hovered: 'a01' }));
    const c = card(s, 'a01');
    expect(c.pose).toEqual({ x: before.x, y: before.y + 110, rot: before.rot });
    expect(c.tapped).toBe(true);
    expect(c.home).toEqual(before);
    expect(c.combat).toBe('attack');
    // Nothing else moved.
    for (const id of ['a00', 'a02', 'b00', 'b01', 'b02']) expect(card(s, id).pose).toEqual(card(s0, id).pose);
  });

  it("forward is the seat's own forward axis: seat 1 (180°) attacks toward -y", () => {
    const s0 = board();
    const s = applyDrafts(s0, press(s0, 'attack', { hovered: 'b02' }, 's1'), 's1');
    expect(card(s, 'b02')).toMatchObject({ pose: P(150, 90, 180), home: P(150, 200, 180), tapped: true, combat: 'attack' });
  });

  it('the forward axis belongs to the controller, not the owner (a stolen creature attacks the other way)', () => {
    let s0 = board();
    s0 = ok(s0, act('move', { card: 'b00', to: 'battlefield:s0', pose: P(-300, -200, 0), controller: 's0' }));
    const s = applyDrafts(s0, press(s0, 'attack', { hovered: 'b00' }));
    expect(card(s, 'b00').pose).toEqual(P(-300, -90, 0));
  });

  it('Shift+A attacks without tapping (vigilance)', () => {
    const s0 = board();
    const s = applyDrafts(s0, press(s0, 'attackNoTap', { hovered: 'a00' }));
    expect(card(s, 'a00')).toMatchObject({ pose: P(-150, -90), tapped: false, combat: 'attack', home: P(-150, -200) });
  });

  it('an already tapped creature still moves forward and stays tapped; its stored rotation stays the seat angle', () => {
    let s0 = board();
    s0 = ok(s0, act('tap', { card: 'a02', tapped: true }));
    const s = applyDrafts(s0, press(s0, 'attack', { hovered: 'a02' }));
    expect(card(s, 'a02')).toMatchObject({ pose: P(150, -90, 0), tapped: true });
  });

  it('a selection attacks together as one undo step, each 110 mm forward of its own slot', () => {
    const s0 = board();
    const drafts = press(s0, 'attack', { hovered: 'a00', selection: ['a00', 'a02'] });
    expect(drafts).toHaveLength(2);
    expect(new Set(drafts.map((d) => d.group)).size).toBe(1);
    expect(drafts[0]!.group).toBeDefined();
    const s = applyDrafts(s0, drafts);
    expect(card(s, 'a00').pose).toEqual(P(-150, -90));
    expect(card(s, 'a02').pose).toEqual(P(150, -90));
  });

  it('pressing A on an attacker again does not move it further', () => {
    const s0 = board();
    const s1 = applyDrafts(s0, press(s0, 'attack', { hovered: 'a01' }));
    expect(press(s1, 'attack', { hovered: 'a01' })).toEqual([]);
  });

  it('a creature displaced by hand (Alt-drag) attacks from its home slot, not from where it was dragged', () => {
    let s0 = board();
    s0 = ok(s0, act('moveTemp', { card: 'a01', pose: P(40, -150) }));
    const s = applyDrafts(s0, press(s0, 'attack', { hovered: 'a01' }));
    expect(card(s, 'a01')).toMatchObject({ pose: P(0, -90), home: P(0, -200) });
  });

  it('cards that are not on a battlefield do not attack', () => {
    const s0 = board();
    expect(press(s0, 'attack', { hovered: 'a03' })).toEqual([]);
  });
});

/** A board in combat: two attackers (one with an Aura), blocks, lines of every kind. */
function combat(): { s: TableState; homes: Record<string, Pose> } {
  let s = board();
  // An Aura on a00, tucked under it.
  s = ok(s, act('reveal', { instanceId: 'a03', ref: { sid: 'sid-aura' }, salt: 'salt-a03' }));
  s = ok(s, act('move', { card: 'a03', to: 'battlefield:s0', pose: P(300, -200) }));
  s = ok(s, act('attach', { card: 'a03', to: 'a00' }));
  const homes = posesOf(s);
  s = applyDrafts(s, press(s, 'attack', { hovered: 'a00', selection: ['a00', 'a01'] }));
  // Two blockers on a00 (a fan), one on a01, declared by seat 1 dropping its creatures.
  const ctx = ctxFor(s);
  s = applyDrafts(s, blockPlan(s, ['b00'], 'a00', P(-150, 0), ctx)!.actions, 's1');
  s = applyDrafts(s, blockPlan(s, ['b02'], 'a00', P(-100, 0), ctx)!.actions, 's1');
  s = applyDrafts(s, blockPlan(s, ['b01'], 'a01', P(0, 0), ctx)!.actions, 's1');
  // Lines: an attack target, a target line, a persistent mark.
  s = line(s, 'atk', 'attack', { kind: 'card', id: 'a01' }, { kind: 'seat', id: 's1' });
  s = line(s, 'tgt', 'target', { kind: 'card', id: 'a02' }, { kind: 'card', id: 'b00' });
  s = line(s, 'mrk', 'mark', { kind: 'card', id: 'a02' }, { kind: 'card', id: 'b01' });
  return { s, homes };
}

describe('settle returns every displaced card home and removes attack and block lines but not persistent marks', () => {
  it('B after a combat with blocks: everything home, attack and block lines gone, the mark and the target line stay', () => {
    const { s: before, homes } = combat();
    const displaced = Object.values(before.cards).filter((c) => c.home).map((c) => c.id).sort();
    expect(displaced).toEqual(['a00', 'a01', 'b00', 'b01', 'b02']);
    expect(Object.values(before.lines).map((l) => l.kind).sort()).toEqual(['attack', 'block', 'block', 'block', 'mark', 'target']);

    const drafts = press(before, 'settle');
    expect(drafts).toEqual([{ type: 'settle' }]);
    const s = applyDrafts(before, drafts);
    for (const id of Object.keys(homes)) expect(card(s, id).pose, id).toEqual(homes[id]);
    for (const c of Object.values(s.cards)) {
      expect(c.home, c.id).toBeUndefined();
      expect(c.combat, c.id).toBeUndefined();
    }
    expect(Object.keys(s.lines).sort()).toEqual(['mrk', 'tgt']);
    // Attackers stay tapped (DESIGN "Combat and annotation", Settle).
    expect(card(s, 'a00').tapped).toBe(true);
    expect(card(s, 'a01').tapped).toBe(true);
  });

  it('the Aura that followed its attacking host comes home with it, tucked as before', () => {
    const { s: before, homes } = combat();
    expect(card(before, 'a03').pose).toEqual({ ...homes.a03!, y: homes.a03!.y + 110 });
    const s = applyDrafts(before, press(before, 'settle'));
    expect(card(s, 'a03').pose).toEqual(homes.a03);
    expect(card(s, 'a03').attachedTo).toBe('a00');
  });

  it('a displaced attachment of a displaced host ends at its own home slot, whatever the id order', () => {
    // Host z99-like ordering: the Aura's id sorts before its host's, so a naive id-ordered settle would move it off home.
    let s = board();
    s = ok(s, act('reveal', { instanceId: 'a03', ref: { sid: 'sid-aura' }, salt: 'salt-a03' }));
    s = ok(s, act('move', { card: 'a03', to: 'battlefield:s0', pose: P(300, -200) }));
    s = ok(s, act('attach', { card: 'a00', to: 'a03' }));
    const homes = posesOf(s);
    s = ok(s, act('moveTemp', { card: 'a00', pose: P(-20, -60) }));
    s = ok(s, act('moveTemp', { card: 'a03', pose: P(300, -90), combat: 'attack', tap: true }));
    s = ok(s, act('settle', {}));
    expect(card(s, 'a03').pose).toEqual(homes.a03);
    expect(card(s, 'a00').pose).toEqual(homes.a00);
  });

  it('settle on a selection returns only those cards and only their attack and block lines', () => {
    const { s: before, homes } = combat();
    const drafts = press(before, 'settle', { selection: ['b01'] });
    expect(drafts).toEqual([{ type: 'settle', cards: ['b01'] }]);
    const s = applyDrafts(before, drafts);
    expect(card(s, 'b01').pose).toEqual(homes.b01);
    expect(card(s, 'b01').home).toBeUndefined();
    expect(card(s, 'a01').home).toBeDefined();
    expect(card(s, 'b00').home).toBeDefined();
    const blocks = Object.values(s.lines).filter((l) => l.kind === 'block').map((l) => l.from.id).sort();
    expect(blocks).toEqual(['b00', 'b02']);
    expect(Object.values(s.lines).some((l) => l.kind === 'attack')).toBe(true);
  });

  it('a blocker that died (moved to the graveyard) stays there; settle still removes its block line', () => {
    const { s: before } = combat();
    let s = ok(before, act('move', { card: 'b01', to: 'graveyard:s1' }, 's1'));
    s = applyDrafts(s, press(s, 'settle'));
    expect(card(s, 'b01').zone).toBe('graveyard:s1');
    expect(Object.values(s.lines).filter((l) => l.kind === 'block')).toEqual([]);
  });

  it('settle is undone as one step back to the combat (personal undo restores the previous hash)', () => {
    const { s: before } = combat();
    const action = { type: 'settle', by: 's0', cid: 'u1' } as const;
    const after = reduce(before, action);
    const inv = inverse(before, action);
    expect(inv).not.toBeNull();
    const undone = reduce(after, { type: 'undo', by: 's0', cid: 'u2', of: 'u1', inverse: inv! });
    expect(undone).not.toBe(after);
    expect(withoutSeq(undone)).toEqual(withoutSeq(before));
  });

  it('settle with nothing displaced and no combat lines changes nothing but marks stay', () => {
    let s = board();
    s = line(s, 'mrk', 'mark', { kind: 'card', id: 'a00' }, { kind: 'card', id: 'b00' });
    const after = applyDrafts(s, press(s, 'settle'));
    expect(withoutSeq(after)).toEqual(withoutSeq(s));
  });
});

describe('lines follow moved endpoints (line model)', () => {
  it('a line drawn between two cards ends at their current centres, wherever they are', () => {
    let s = board();
    s = line(s, 'tgt', 'target', { kind: 'card', id: 'a00' }, { kind: 'card', id: 'b01' });
    s = line(s, 'pl', 'attack', { kind: 'card', id: 'a01' }, { kind: 'seat', id: 's1' });
    const avatar = { x: 0, y: 600 };
    const resolverFor = (st: TableState): AnchorResolver => ({
      point: (a: Anchor) => (a.kind === 'card' ? { x: st.cards[a.id]!.pose.x, y: st.cards[a.id]!.pose.y } : a.kind === 'seat' ? avatar : null),
      shape: () => ({ kind: 'point' }),
    });
    const draw = (st: TableState) => drawnLines(st, resolverFor(st), (id) => st.cards[id]?.pose ?? null, () => 1, () => ({ x: 0, y: 1 }));
    expect(draw(s).find((l) => l.id === 'tgt')).toMatchObject({ from: { x: -150, y: -200 }, to: { x: 0, y: 200 } });
    s = applyDrafts(s, press(s, 'attack', { hovered: 'a00' }));
    s = ok(s, act('move', { card: 'b01', to: 'battlefield:s1', pose: P(77, 250, 180) }, 's1'));
    s = applyDrafts(s, press(s, 'attack', { hovered: 'a01' }));
    const lines = draw(s);
    expect(lines.find((l) => l.id === 'tgt')).toMatchObject({ from: { x: -150, y: -90 }, to: { x: 77, y: 250 } });
    expect(lines.find((l) => l.id === 'pl')).toMatchObject({ from: { x: 0, y: -90 }, to: avatar });
  });
});
