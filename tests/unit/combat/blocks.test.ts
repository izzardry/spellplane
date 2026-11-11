/**
 * Blocks and the blocker fan (DESIGN "Combat and annotation", Combat shortcuts 3: a defender drags a creature onto an
 * attacker; the blocker moves temporarily to sit in front of it and a block line joins the pair; several blockers fan
 * out, their left-to-right order is the damage order and can be rearranged by dragging. "Specification: geometry,
 * layout and motion": blocker 96 in front of the attacker on the defender's side, further blockers offset 69
 * sideways). Plans from scene/combat.ts applied with the real reducer.
 */
import { describe, expect, it } from 'vitest';
import type { TableState } from '../../../src/core/types';
import { blockPlan, blockersOf, canBlock, fanAttacker, fanAxes, fanPositions, fanUnder, settleSlots, unblockDrafts, withUnblock } from '../../../src/scene/combat';
import { P, act, applyDrafts, board, card, ctxFor, ok, play, press, readyTable } from './helpers';

/** Board with a00 (seat 0) and b02 (seat 1) attacking. a00 ends at (-150, -90); b02 at (150, 90). */
function attacking(): TableState {
  let s = board();
  s = applyDrafts(s, press(s, 'attack', { hovered: 'a00' }));
  s = applyDrafts(s, press(s, 'attack', { hovered: 'b02' }, 's1'), 's1');
  return s;
}

const block = (s: TableState, moved: string[], attacker: string, at = card(s, attacker).pose, by = card(s, moved[0]!).controller) => {
  const plan = blockPlan(s, moved, attacker, at, ctxFor(s));
  expect(plan, 'a block').not.toBeNull();
  return applyDrafts(s, plan!.actions, by);
};

const blockLines = (s: TableState) =>
  Object.values(s.lines)
    .filter((l) => l.kind === 'block')
    .map((l) => `${l.from.id}>${l.to.id}`)
    .sort();

describe('a blocker sits 96 mm in front of the attacker on the defender side', () => {
  it("seat 1 blocks seat 0's attacker: the blocker moves to 96 mm toward seat 1, temporarily, with a block line", () => {
    const s0 = attacking();
    const s = block(s0, ['b00'], 'a00');
    expect(card(s, 'b00')).toMatchObject({ pose: P(-150, 6, 180), home: P(-150, 200, 180), combat: 'block', tapped: false });
    expect(blockLines(s)).toEqual(['b00>a00']);
    const l = Object.values(s.lines).find((x) => x.kind === 'block')!;
    expect(l).toMatchObject({ from: { kind: 'card', id: 'b00' }, to: { kind: 'card', id: 'a00' }, by: 's1' });
  });

  it("seat 0 blocks seat 1's attacker: 96 mm toward seat 0 (-y), keeping its own rotation", () => {
    const s = block(attacking(), ['a01'], 'b02');
    expect(card(s, 'a01')).toMatchObject({ pose: P(150, -6, 0), home: P(0, -200, 0), combat: 'block' });
  });

  it('a tapped creature can be put in front of an attacker; it stays tapped and keeps its stored rotation', () => {
    let s = attacking();
    s = ok(s, act('tap', { card: 'b01', tapped: true }, 's1'));
    s = block(s, ['b01'], 'a00');
    expect(card(s, 'b01')).toMatchObject({ pose: P(-150, 6, 180), tapped: true });
  });

  it('the fan frame follows the seats: a defender at 90° blocks from the attacker toward its own side', () => {
    const { out, side } = fanAxes(90);
    // Seat at 90° sits at the left edge (its forward axis is +x): the blocker goes toward -x of the attacker.
    expect(out.x).toBeCloseTo(-1);
    expect(out.y).toBeCloseTo(0);
    expect(Math.abs(side.x)).toBeCloseTo(0);
    expect(Math.abs(side.y)).toBeCloseTo(1);
    const [p] = fanPositions({ x: 0, y: 0 }, 90, 1);
    expect(p).toEqual({ x: -96, y: 0 });
  });
});

describe('several blockers fan out; left to right is the damage order', () => {
  it('two blockers sit 69 mm apart, centred in front of the attacker', () => {
    let s = attacking();
    s = block(s, ['b00'], 'a00');
    s = block(s, ['b01'], 'a00', P(-100, 6));
    expect(card(s, 'b00').pose).toEqual(P(-184.5, 6, 180));
    expect(card(s, 'b01').pose).toEqual(P(-115.5, 6, 180));
    expect(blockLines(s)).toEqual(['b00>a00', 'b01>a00']);
    expect(blockersOf(s, 'a00', ctxFor(s))).toEqual(['b00', 'b01']);
  });

  it('three blockers: 69 mm steps, the middle one straight in front', () => {
    let s = attacking();
    s = block(s, ['b00'], 'a00');
    s = block(s, ['b01'], 'a00', P(0, 6));
    s = ok(s, act('reveal', { instanceId: 'b03', ref: { sid: 'sid-b03' }, salt: 'salt-b03' }, 's1'));
    s = ok(s, act('move', { card: 'b03', to: 'battlefield:s1', pose: P(300, 200, 180) }, 's1'));
    s = block(s, ['b03'], 'a00', P(100, 6));
    expect(blockersOf(s, 'a00', ctxFor(s))).toEqual(['b00', 'b01', 'b03']);
    expect([card(s, 'b00').pose.x, card(s, 'b01').pose.x, card(s, 'b03').pose.x]).toEqual([-219, -150, -81]);
  });

  it('a new blocker enters the order where it is dropped (left of the existing one)', () => {
    let s = attacking();
    s = block(s, ['b00'], 'a00');
    s = block(s, ['b01'], 'a00', P(-200, 6));
    expect(blockersOf(s, 'a00', ctxFor(s))).toEqual(['b01', 'b00']);
    expect(card(s, 'b01').pose.x).toBe(-184.5);
  });

  it("left to right is the attacking player's: for seat 1's attacker the order runs toward -x", () => {
    let s = attacking();
    s = block(s, ['a01'], 'b02');
    s = block(s, ['a02'], 'b02', P(100, -6));
    // Seat 1 faces -y; its left-to-right is -x: a02 dropped at smaller x comes second.
    expect(blockersOf(s, 'b02', ctxFor(s))).toEqual(['a01', 'a02']);
    expect(card(s, 'a01').pose.x).toBe(184.5);
    expect(card(s, 'a02').pose.x).toBe(115.5);
  });

  it('dragging a blocker across its neighbour reorders the fan (no new line, the same two blockers)', () => {
    let s = attacking();
    s = block(s, ['b00'], 'a00');
    s = block(s, ['b01'], 'a00', P(-100, 6));
    const lines = Object.keys(s.lines).sort();
    // b00 (left) dropped to the right of b01: it goes second.
    s = block(s, ['b00'], 'a00', P(-90, 6));
    expect(blockersOf(s, 'a00', ctxFor(s))).toEqual(['b01', 'b00']);
    expect(card(s, 'b01').pose).toEqual(P(-184.5, 6, 180));
    expect(card(s, 'b00').pose).toEqual(P(-115.5, 6, 180));
    expect(Object.keys(s.lines).sort()).toEqual(lines);
    // Home slots stay the original ones.
    expect(card(s, 'b00').home).toEqual(P(-150, 200, 180));
  });

  it('a drop that leaves the order as it was changes nothing', () => {
    let s = attacking();
    s = block(s, ['b00'], 'a00');
    s = block(s, ['b01'], 'a00', P(-100, 6));
    const plan = blockPlan(s, ['b00'], 'a00', P(-300, 6), ctxFor(s))!;
    expect(plan.actions).toEqual([]);
  });

  it('dropping two selected creatures blocks with both, as one undo group', () => {
    const s0 = attacking();
    const plan = blockPlan(s0, ['b00', 'b01'], 'a00', P(-150, 6), ctxFor(s0))!;
    const groups = new Set(plan.actions.map((a) => a.group));
    expect(groups.size).toBe(1);
    expect([...groups][0]).toBeDefined();
    const s = applyDrafts(s0, plan.actions, 's1');
    expect(blockersOf(s, 'a00', ctxFor(s))).toEqual(['b00', 'b01']);
    expect(blockLines(s)).toEqual(['b00>a00', 'b01>a00']);
  });

  it('moving a blocker to another attacker takes its line along and closes up the fan it left', () => {
    let s = attacking();
    s = applyDrafts(s, press(s, 'attack', { hovered: 'a01' }));
    s = block(s, ['b00'], 'a00');
    s = block(s, ['b01'], 'a00', P(-100, 6));
    s = block(s, ['b01'], 'a01');
    expect(blockLines(s)).toEqual(['b00>a00', 'b01>a01']);
    expect(card(s, 'b00').pose).toEqual(P(-150, 6, 180));
    expect(card(s, 'b01').pose).toEqual(P(0, 6, 180));
  });

  it('dragging a blocker away from its fan unblocks it: its line goes and the fan closes up', () => {
    let s = attacking();
    s = block(s, ['b00'], 'a00');
    s = block(s, ['b01'], 'a00', P(-100, 6));
    const drafts = unblockDrafts(s, ['b01'], ctxFor(s));
    s = applyDrafts(s, [...drafts, { type: 'move', card: 'b01', to: 'battlefield:s1', pose: P(0, 250, 180) }], 's1');
    expect(blockLines(s)).toEqual(['b00>a00']);
    expect(card(s, 'b00').pose).toEqual(P(-150, 6, 180));
    expect(unblockDrafts(s, ['b02'], ctxFor(s))).toEqual([]);
  });

  it('a lone blocker lifted and put back near its spot stays blocking (the drop is in its own fan)', () => {
    let s = attacking();
    s = block(s, ['b00'], 'a00');
    const ctx = ctxFor(s);
    // Its spot is (-150, 6); a drop 20 mm off it, with nothing under the pointer, is inside the fan.
    expect(fanUnder(s, ['b00'], P(-130, 20), ctx)).toBe('a00');
    const plan = blockPlan(s, ['b00'], 'a00', P(-130, 20), ctx)!;
    expect(plan.actions).toEqual([]);
    // Far from the fan, or for a card that blocks nothing, it is an ordinary drop (which unblocks).
    expect(fanUnder(s, ['b00'], P(-150, 200), ctx)).toBeNull();
    expect(fanUnder(s, ['b00'], P(0, 6), ctx)).toBeNull();
    expect(fanUnder(s, ['b01'], P(-150, 6), ctx)).toBeNull();
  });

  it("a drop inside a two-blocker fan's extent reorders it", () => {
    let s = attacking();
    s = block(s, ['b00'], 'a00');
    s = block(s, ['b01'], 'a00', P(-100, 6));
    // b00 sits left (-184.5); dropped right of b01 (-115.5) within the fan: the order swaps.
    const ctx = ctxFor(s);
    expect(fanUnder(s, ['b00'], P(-90, 10), ctx)).toBe('a00');
    s = applyDrafts(s, blockPlan(s, ['b00'], 'a00', P(-90, 10), ctx)!.actions, 's1');
    expect(blockersOf(s, 'a00', ctx)).toEqual(['b01', 'b00']);
    expect(blockLines(s)).toEqual(['b00>a00', 'b01>a00']);
  });

  it('at a seat angle off the right angles, re-planning an unchanged fan dispatches nothing (poses quantised as stored)', () => {
    let s = attacking();
    let n = 0;
    const ctx = { angleOf: (seat: string) => (seat === 's1' ? 150 : 0), newId: (p: string) => `${p}-q${++n}` };
    s = applyDrafts(s, blockPlan(s, ['b00'], 'a00', card(s, 'a00').pose, ctx)!.actions, 's1');
    s = applyDrafts(s, blockPlan(s, ['b01'], 'a00', card(s, 'a00').pose, ctx)!.actions, 's1');
    const [first] = blockersOf(s, 'a00', ctx);
    const plan = blockPlan(s, [first!], 'a00', card(s, first!).pose, ctx)!;
    expect(plan.actions).toEqual([]);
    for (const [id, pose] of plan.poses) expect(card(s, id).pose, id).toEqual(pose);
  });

  it('settle after blocks: blockers go home, block lines go', () => {
    let s = attacking();
    s = block(s, ['b00'], 'a00');
    s = block(s, ['b01'], 'a00', P(-100, 6));
    s = applyDrafts(s, press(s, 'settle'));
    expect(card(s, 'b00').pose).toEqual(P(-150, 200, 180));
    expect(card(s, 'b01').pose).toEqual(P(0, 200, 180));
    expect(blockLines(s)).toEqual([]);
  });
});

describe('what counts as a block drop', () => {
  it('only onto an attacker, and only with another seat’s cards on a battlefield', () => {
    const s = attacking();
    expect(canBlock(s, ['b00'], 'a00')).toBe(true);
    // Own controller's card onto the own attacker: an ordinary drop (a pile).
    expect(canBlock(s, ['a01'], 'a00')).toBe(false);
    // Onto a creature that is not attacking.
    expect(canBlock(s, ['b00'], 'a01')).toBe(false);
    // A hidden card (in a library) cannot block.
    expect(canBlock(s, ['b03'], 'a00')).toBe(false);
    expect(canBlock(s, [], 'a00')).toBe(false);
    expect(canBlock(s, ['a00'], 'a00')).toBe(false);
    expect(blockPlan(s, ['a01'], 'a00', P(0, 0), ctxFor(s))).toBeNull();
  });

  it('an attached card (an Aura) does not block', () => {
    let s = attacking();
    s = ok(s, act('reveal', { instanceId: 'b03', ref: { sid: 'sid-b03' }, salt: 'salt-b03' }, 's1'));
    s = ok(s, act('move', { card: 'b03', to: 'battlefield:s1', pose: P(300, 200, 180) }, 's1'));
    s = ok(s, act('attach', { card: 'b03', to: 'b00' }, 's1'));
    expect(canBlock(s, ['b03'], 'a00')).toBe(false);
  });

  it('a drop onto a blocker joins the fan of the attacker it blocks', () => {
    let s = attacking();
    s = block(s, ['b00'], 'a00');
    expect(fanAttacker(s, 'b00')).toBe('a00');
    expect(fanAttacker(s, 'a00')).toBe('a00');
    expect(fanAttacker(s, 'a01')).toBeNull();
    s = block(s, ['b01'], fanAttacker(s, 'b00')!, card(s, 'b00').pose);
    expect(blockersOf(s, 'a00', ctxFor(s)).sort()).toEqual(['b00', 'b01']);
  });

  it('after settle the former attacker is no fan target any more', () => {
    let s = attacking();
    s = block(s, ['b00'], 'a00');
    s = applyDrafts(s, press(s, 'settle'));
    expect(fanAttacker(s, 'a00')).toBeNull();
    expect(fanAttacker(s, 'b00')).toBeNull();
  });
});

describe('a blocker that died leaves the fan (it is moved to the graveyard by hand)', () => {
  /** a00 attacks; b00 and b01 block it; b00 dies (moved to its graveyard by hand, keeping its block line). */
  function oneDied(): TableState {
    let s = attacking();
    s = block(s, ['b00'], 'a00');
    s = block(s, ['b01'], 'a00', P(-100, 6));
    s = ok(s, act('move', { card: 'b00', to: 'graveyard:s1' }, 's1'));
    // Lines drop only on entering a hidden zone: the dead blocker's line is still there.
    expect(blockLines(s)).toEqual(['b00>a00', 'b01>a00']);
    return s;
  }

  it('the fan is only the blockers still on a battlefield', () => {
    const s = oneDied();
    expect(blockersOf(s, 'a00', ctxFor(s))).toEqual(['b01']);
  });

  it('another blocker joins: every draft applies and the two live blockers sit 69 apart, centred on the attacker', () => {
    let s = oneDied();
    const plan = blockPlan(s, ['b02'], 'a00', P(-80, 6), ctxFor(s))!;
    expect(plan.actions.filter((a) => a.type === 'moveTemp' && a.card === 'b00')).toEqual([]);
    s = applyDrafts(s, plan.actions, 's1');
    expect(blockersOf(s, 'a00', ctxFor(s))).toEqual(['b01', 'b02']);
    expect(card(s, 'b01').pose).toEqual(P(-184.5, 6, 180));
    expect(card(s, 'b02').pose).toEqual(P(-115.5, 6, 180));
    // Re-ordering the survivors (first-strike damage dealt, damage order changed) applies too.
    s = block(s, ['b01'], 'a00', P(-90, 6));
    expect(blockersOf(s, 'a00', ctxFor(s))).toEqual(['b02', 'b01']);
    expect(card(s, 'b02').pose).toEqual(P(-184.5, 6, 180));
    expect(card(s, 'b01').pose).toEqual(P(-115.5, 6, 180));
  });

  it('dragging the survivor away applies cleanly and leaves no fan', () => {
    let s = oneDied();
    s = applyDrafts(s, withUnblock(s, [{ type: 'move', card: 'b01', to: 'battlefield:s1', pose: P(0, 250, 180) }], ['b01'], ctxFor(s)), 's1');
    expect(blockersOf(s, 'a00', ctxFor(s))).toEqual([]);
  });
});

describe('a blocker dropped into a hidden zone (a bounce to hand)', () => {
  it('unblocks before the move: every draft of the group applies, the rest of the fan closes up', () => {
    let s = attacking();
    s = block(s, ['b00'], 'a00');
    s = block(s, ['b01'], 'a00', P(-100, 6));
    const drafts = withUnblock(s, [{ type: 'toZone', card: 'b01', to: 'hand:s1', position: 'any' }], ['b01'], ctxFor(s));
    expect(drafts[0]).toMatchObject({ type: 'lineRemove' });
    expect(new Set(drafts.map((d) => d.group)).size).toBe(1);
    s = applyDrafts(s, drafts, 's1');
    expect(card(s, 'b01').zone).toBe('hand:s1');
    expect(blockLines(s)).toEqual(['b00>a00']);
    expect(card(s, 'b00').pose).toEqual(P(-150, 6, 180));
  });

  it('a drop of a card that blocks nothing is left as it is', () => {
    const s = attacking();
    const drop = [{ type: 'toZone' as const, card: 'b01', to: 'hand:s1', position: 'any' as const }];
    expect(withUnblock(s, drop, ['b01'], ctxFor(s))).toBe(drop);
  });
});

describe('Two-Headed Giant: a teammate is no blocker', () => {
  it("dropping a teammate's creature onto your own attacker is an ordinary drop; an opponent's blocks", () => {
    let s = readyTable(4, '2hg', 4);
    s = play(s, 'a00', P(-150, -200));
    s = play(s, 'b00', P(150, -200), 's1');
    s = play(s, 'c00', P(-150, 200, 180), 's2');
    s = ok(s, act('moveTemp', { card: 'a00', pose: P(-150, -90), combat: 'attack', tap: true }));
    expect(canBlock(s, ['b00'], 'a00')).toBe(false);
    expect(canBlock(s, ['c00'], 'a00')).toBe(true);
    expect(canBlock(s, ['b00', 'c00'], 'a00')).toBe(false);
  });
});

describe('settle: who goes home with which stagger slot', () => {
  it('displaced cards get slots in drawing order; an attachment rides along in its host’s slot', () => {
    let s = attacking();
    s = block(s, ['b00'], 'a00');
    s = ok(s, act('reveal', { instanceId: 'a03', ref: { sid: 'sid-a03' }, salt: 'salt-a03' }));
    s = ok(s, act('move', { card: 'a03', to: 'battlefield:s0', pose: P(300, -200) }));
    s = ok(s, act('attach', { card: 'a03', to: 'a00' }));
    const before = s;
    const after = applyDrafts(s, press(s, 'settle'));
    const slots = settleSlots(after, ['a03', 'b00', 'a00', 'b02', 'a01'], (id) => before.cards[id]);
    expect([...slots]).toEqual([
      ['b00', 0],
      ['a00', 1],
      ['b02', 2],
      ['a03', 1],
    ]);
    // Nothing settled: no slots.
    expect(settleSlots(before, Object.keys(before.cards), (id) => before.cards[id]).size).toBe(0);
  });
});
