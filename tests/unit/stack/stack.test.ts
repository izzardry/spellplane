/**
 * The stack actions (PLAN M1-P3; DESIGN "The effect stack", Putting things on the stack, Resolving 1-4): resolve with
 * the game's default destinations, counter, reorder, drag out; only the top item resolves.
 */
import { describe, expect, it } from 'vitest';
import type { Action } from '../../../src/core/actions';
import type { TableState } from '../../../src/core/types';
import { mtgDefaultDestination } from '../../../src/games/mtg/destination';
import { P, act, no, ok, play, readyTable } from '../core/helpers';

const seqd = (s: TableState, a: Action): TableState => ok(s, { ...a, seq: s.seq + 1 } as Action);

function table(): TableState {
  let s = readyTable(4);
  s = play(s, 'a00', P(-100, -300));
  for (const id of ['a01', 'a02']) s = ok(s, act('reveal', { instanceId: id, ref: { sid: `sid-${id}` }, salt: 'x' }));
  s = ok(s, act('reveal', { instanceId: 'b01', ref: { sid: 'sid-b01' }, salt: 'x' }, 's1'));
  return s;
}

describe('putting things on the stack', () => {
  it('a spell leaves its zone, becomes public and lands on top; an ability marker leaves its source where it is', () => {
    let s = table();
    s = seqd(s, act('stackPush', { item: 'i1', kind: 'spell', card: 'a01', round: 'r1' }));
    s = seqd(s, act('stackPush', { item: 'i2', kind: 'ability', source: 'a00', round: 'r2' }, 's1'));
    expect(s.stack.map((i) => [i.id, i.kind, i.controller])).toEqual([
      ['i1', 'spell', 's0'],
      ['i2', 'ability', 's1'],
    ]);
    expect(s.cards.a01).toMatchObject({ zone: 'stack', identity: { sid: 'sid-a01' }, face: 'up' });
    expect(s.cards.a00!.zone).toBe('battlefield:s0');
    expect(s.zones.stack!.ids).toEqual(['a01']);
  });

  it('any player can add a trigger for any card; a copy marker sits above what it copies', () => {
    let s = table();
    s = seqd(s, act('stackPush', { item: 'i1', kind: 'spell', card: 'a01', round: 'r1' }));
    s = seqd(s, act('stackPush', { item: 'i2', kind: 'trigger', source: 'a00', round: 'r2' }, 's1'));
    s = seqd(s, act('stackPush', { item: 'i3', kind: 'copy', copyOf: 'i1', round: 'r3' }, 's1'));
    expect(s.stack.map((i) => i.id)).toEqual(['i1', 'i2', 'i3']);
    expect(s.stack[2]).toMatchObject({ kind: 'copy', copyOf: 'i1', controller: 's1' });
  });

  it('each item takes a one-line note', () => {
    let s = ok(table(), act('stackPush', { item: 'i1', kind: 'spell', card: 'a01' }));
    s = ok(s, act('stackNote', { item: 'i1', note: 'kicked' }));
    expect(s.stack[0]!.note).toBe('kicked');
    s = ok(s, act('stackNote', { item: 'i1', note: '' }));
    expect(s.stack[0]).not.toHaveProperty('note');
  });
});

describe('resolving (DESIGN "The effect stack", Resolving 1-2)', () => {
  it('only the top item resolves', () => {
    let s = ok(table(), act('stackPush', { item: 'i1', kind: 'spell', card: 'a01' }));
    s = ok(s, act('stackPush', { item: 'i2', kind: 'ability', source: 'a00' }));
    no(s, act('stackResolve', { item: 'i1' }), /only the top item/);
  });

  it('defaults from the card type: permanents to the controller\'s battlefield, instants and sorceries to the owner\'s graveyard, markers vanish', () => {
    let s = table();
    // Ben casts Anna's card (stolen, flashback, ...): controller s1, owner s0.
    s = ok(s, act('stackPush', { item: 'i1', kind: 'spell', card: 'a01', controller: 's1' }, 's1'));
    s = ok(s, act('stackPush', { item: 'i2', kind: 'ability', source: 'a00' }));
    const top = s.stack[1]!;
    expect(mtgDefaultDestination(top)).toBeNull();
    s = ok(s, act('stackResolve', { item: 'i2' }));
    expect(s.stack.map((i) => i.id)).toEqual(['i1']);
    const spell = s.stack[0]!;
    const creature = { type_line: 'Creature — Bear' };
    const instant = { type_line: 'Instant' };
    expect(mtgDefaultDestination(spell, creature as never, s.cards.a01)).toBe('battlefield:s1');
    expect(mtgDefaultDestination(spell, instant as never, s.cards.a01)).toBe('graveyard:s0');
    const onField = ok(s, act('stackResolve', { item: 'i1', to: 'battlefield:s1', pose: P(50, 200, 180) }, 's1'));
    expect(onField.cards.a01).toMatchObject({ zone: 'battlefield:s1', controller: 's1', pose: { x: 50, y: 200, rot: 180 } });
    const toYard = ok(s, act('stackResolve', { item: 'i1', to: 'graveyard:s0' }, 's1'));
    expect(toYard.cards.a01).toMatchObject({ zone: 'graveyard:s0', controller: 's0' });
    // Without a destination the reducer falls back to the controller's battlefield.
    expect(ok(s, act('stackResolve', { item: 'i1' }, 's1')).cards.a01!.zone).toBe('battlefield:s1');
    no(s, act('stackResolve', { item: 'i1', to: 'stack' }), /cannot be the stack/);
  });
});

describe('counter, reorder, drag out (DESIGN "The effect stack", Resolving 3-4)', () => {
  it('counter sends the top spell to its owner\'s graveyard and removes a marker', () => {
    let s = ok(table(), act('stackPush', { item: 'i1', kind: 'spell', card: 'a01', controller: 's1' }, 's1'));
    s = ok(s, act('stackPush', { item: 'i2', kind: 'trigger', source: 'a00' }));
    s = ok(s, act('stackCounter', { item: 'i2' }, 's1'));
    expect(s.stack.map((i) => i.id)).toEqual(['i1']);
    s = ok(s, act('stackCounter', { item: 'i1' }));
    expect(s.cards.a01!.zone).toBe('graveyard:s0');
    expect(s.stack).toEqual([]);
  });

  it('counter is never held back by a waiting round', () => {
    let s = seqd(table(), act('stackPush', { item: 'i1', kind: 'spell', card: 'a01', round: 'r1' }));
    s = ok(s, act('stackCounter', { item: 'i1' }, 's1'));
    expect(s.stack).toEqual([]);
  });

  it('any item can be reordered by hand; indices clamp to the stack', () => {
    let s = ok(table(), act('stackPush', { item: 'i1', kind: 'spell', card: 'a01' }));
    s = ok(s, act('stackPush', { item: 'i2', kind: 'spell', card: 'a02' }));
    s = ok(s, act('stackPush', { item: 'i3', kind: 'ability', source: 'a00' }));
    s = ok(s, act('stackReorder', { item: 'i3', index: 0 }));
    expect(s.stack.map((i) => i.id)).toEqual(['i3', 'i1', 'i2']);
    expect(s.zones.stack!.ids).toEqual(['a01', 'a02']);
    s = ok(s, act('stackReorder', { item: 'i1', index: 99 }));
    expect(s.stack.map((i) => i.id)).toEqual(['i3', 'i2', 'i1']);
    expect(s.zones.stack!.ids).toEqual(['a02', 'a01']);
  });

  it('a spell can be dragged out of the stack; its item goes with it', () => {
    let s = ok(table(), act('stackPush', { item: 'i1', kind: 'spell', card: 'a01' }));
    s = ok(s, act('stackPush', { item: 'i2', kind: 'spell', card: 'a02' }));
    s = ok(s, act('move', { card: 'a01', to: 'battlefield:s0', pose: P(0, -200) }));
    expect(s.stack.map((i) => i.id)).toEqual(['i2']);
    expect(s.zones.stack!.ids).toEqual(['a02']);
  });
});
