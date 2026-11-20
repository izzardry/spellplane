/** M8-P6: attack and block choices (computer.md 5.5) and the bookkeeping model (5.6) on hand-made boards. */
import { describe, expect, it } from 'vitest';
import { chooseAttackers, chooseBlocks, combatResult } from '../../../src/bot/combat';
import { BOT_PROFILES } from '../../../src/bot/types';
import { creature } from './fixtures';

const { gentle, steady, keen } = BOT_PROFILES;
const none = new Set<string>();
const blocks = (pairs: Record<string, ReturnType<typeof creature>[]>) => new Map(Object.entries(pairs));

describe('attacks', () => {
  it('a 2/2 into an untapped 3/3: no attack at any level; a 3/3 into a 2/2 attacks at every level', () => {
    for (const p of [gentle, steady, keen]) {
      expect(chooseAttackers([creature('a', 2, 2, 2)], [creature('b', 3, 3, 3)], none, p)).toEqual([]);
      expect(chooseAttackers([creature('a', 3, 3, 3)], [creature('b', 2, 2, 2)], none, p).map((c) => c.id)).toEqual(['a']);
    }
  });
  it('an even trade attacks at Steady and Keen only', () => {
    expect(chooseAttackers([creature('a', 2, 2, 2)], [creature('b', 2, 2, 2)], none, gentle)).toEqual([]);
    expect(chooseAttackers([creature('a', 2, 2, 2)], [creature('b', 2, 2, 2)], none, steady).map((c) => c.id)).toEqual(['a']);
  });
  it('respects flying, reach, defender, summoning sickness, haste and tapped blockers', () => {
    expect(chooseAttackers([creature('a', 2, 2, 2, ['flying'])], [creature('b', 5, 5, 5)], none, steady).map((c) => c.id)).toEqual(['a']);
    expect(chooseAttackers([creature('a', 2, 2, 2, ['flying'])], [creature('b', 5, 5, 5, ['reach'])], none, steady)).toEqual([]);
    expect(chooseAttackers([creature('a', 2, 2, 2, ['defender'])], [], none, steady)).toEqual([]);
    expect(chooseAttackers([creature('a', 2, 2, 2)], [], new Set(['a']), steady)).toEqual([]);
    expect(chooseAttackers([creature('a', 2, 2, 2, ['haste'])], [], new Set(['a']), steady).map((c) => c.id)).toEqual(['a']);
    expect(chooseAttackers([creature('a', 2, 2, 2)], [creature('b', 5, 5, 5, [], { tapped: true })], none, steady).map((c) => c.id)).toEqual(['a']);
    expect(chooseAttackers([creature('a', 2, 2, 2, ['menace'])], [creature('b', 5, 5, 5)], none, steady).map((c) => c.id)).toEqual(['a']);
  });
});

describe('blocks', () => {
  it('blocks when the blocker kills and survives; trades only at Steady; never against menace or a flyer without reach', () => {
    expect(chooseBlocks([creature('x', 2, 2, 2)], [creature('m', 3, 3, 3)], 20, gentle)).toEqual([{ blocker: 'm', attacker: 'x' }]);
    expect(chooseBlocks([creature('x', 2, 2, 2)], [creature('m', 2, 2, 2)], 20, gentle)).toEqual([]);
    expect(chooseBlocks([creature('x', 2, 2, 2)], [creature('m', 2, 2, 2)], 20, steady)).toEqual([{ blocker: 'm', attacker: 'x' }]);
    expect(chooseBlocks([creature('x', 2, 2, 1)], [creature('m', 2, 2, 3)], 20, steady)).toEqual([]);
    expect(chooseBlocks([creature('x', 2, 2, 2, ['menace'])], [creature('m', 5, 5, 3)], 20, steady)).toEqual([]);
    expect(chooseBlocks([creature('x', 2, 2, 2, ['flying'])], [creature('m', 5, 5, 3)], 20, steady)).toEqual([]);
    expect(chooseBlocks([creature('x', 2, 2, 2, ['flying'])], [creature('m', 5, 5, 3, ['reach'])], 20, steady)).toEqual([{ blocker: 'm', attacker: 'x' }]);
  });
  it('chump blocks only against lethal damage', () => {
    expect(chooseBlocks([creature('x', 5, 5, 5)], [creature('m', 1, 1, 1)], 20, steady)).toEqual([]);
    expect(chooseBlocks([creature('x', 5, 5, 5)], [creature('m', 1, 1, 1)], 5, steady)).toEqual([{ blocker: 'm', attacker: 'x' }]);
  });
});

describe('combatResult', () => {
  it('unblocked damage goes to the player', () => {
    expect(combatResult([creature('a', 3, 3, 3)], new Map())).toEqual({ toDefender: 3, lifelink: { attacker: 0, defender: 0 }, dead: [] });
  });
  it('first strike kills before damage back', () => {
    const r = combatResult([creature('a', 2, 2, 2, ['first strike'])], blocks({ a: [creature('b', 2, 2, 2)] }));
    expect(r.dead).toEqual(['b']);
  });
  it('deathtouch kills with any damage', () => {
    const r = combatResult([creature('a', 1, 1, 1, ['deathtouch'])], blocks({ a: [creature('b', 5, 5, 5)] }));
    expect(r.dead).toEqual(['a', 'b']);
  });
  it('trample over two blockers assigns lethal in order and the rest to the player', () => {
    const r = combatResult([creature('a', 7, 7, 6, ['trample'])], blocks({ a: [creature('b', 2, 2, 2), creature('c', 1, 3, 3)] }));
    expect(r.toDefender).toBe(2);
    expect(r.dead).toEqual(['b', 'c']);
  });
  it('lifelink gains for its side; indestructible survives', () => {
    const r = combatResult([creature('a', 3, 3, 3, ['lifelink'])], blocks({ a: [creature('b', 4, 4, 4, ['lifelink', 'indestructible'])] }));
    expect(r.lifelink).toEqual({ attacker: 3, defender: 4 });
    expect(r.dead).toEqual(['a']);
  });
  it('double strike deals damage in both steps', () => {
    expect(combatResult([creature('a', 2, 2, 2, ['double strike'])], new Map()).toDefender).toBe(4);
  });
});
