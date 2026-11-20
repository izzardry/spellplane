/** M8-P6: `decide` (computer.md 5.2, 5.3, C2, C3) on hand-made views: pure and seeded, the rows of Sparring's turn. */
import { describe, expect, it } from 'vitest';
import { decide, keyed } from '../../../src/bot/plan';
import { inside } from '../../../src/bot/place';
import { BOT_PROFILES } from '../../../src/bot/types';
import { creature, handCard, permanentOf, view } from './fixtures';

const steady = BOT_PROFILES.steady;

describe('decide', () => {
  it('is pure and seeded: the same view and seed give the same step 1000 times', () => {
    const v = view({ hand: [handCard('h1', 'Forest'), handCard('h2', 'Highland Game'), handCard('h3', 'Llanowar Elves')], mine: [permanentOf('l1', 'Forest'), permanentOf('l2', 'Forest')] });
    const first = JSON.stringify(decide(v, steady, 'seed'));
    const copy = JSON.stringify(v);
    for (let i = 0; i < 1000; i++) expect(JSON.stringify(decide(v, steady, 'seed'))).toBe(first);
    expect(JSON.stringify(v)).toBe(copy);
    expect(keyed('a', 1, 2, 'x')).toBe(keyed('a', 1, 2, 'x'));
    expect(keyed('a', 1, 2, 'x')).not.toBe(keyed('b', 1, 2, 'x'));
  });

  it('turn 1 on the play does not draw; later turns draw once', () => {
    expect(decide(view({ turn: { number: 1, active: 's1', phase: 'draw', mine: true }, thisTurn: { ...view().thisTurn, drew: false } }), steady, 's')).toEqual({ kind: 'phase', phase: 'main1' });
    expect(decide(view({ turn: { number: 4, active: 's1', phase: 'draw', mine: true }, thisTurn: { ...view().thisTurn, drew: false } }), steady, 's')).toEqual({ kind: 'draw' });
  });

  it('starts its turn: untap phase first, then its own tapped cards', () => {
    expect(decide(view({ turn: { number: 4, active: 's1', phase: 'end', mine: true }, thisTurn: { ...view().thisTurn, fresh: true, steps: 0 } }), steady, 's')).toEqual({ kind: 'phase', phase: 'untap' });
    const tapped = permanentOf('l1', 'Forest', { tapped: true });
    const theirsTapped = permanentOf('x1', 'Forest', { tapped: true, owned: false });
    expect(decide(view({ turn: { number: 4, active: 's1', phase: 'untap', mine: true }, mine: [tapped, theirsTapped] }), steady, 's')).toEqual({ kind: 'untap', cards: ['l1'] });
  });

  it('plays one land a turn', () => {
    const v = view({ hand: [handCard('h1', 'Forest')] });
    expect(decide(v, steady, 's')?.kind).toBe('playLand');
    expect(decide({ ...v, thisTurn: { ...v.thisTurn, landPlayed: true } }, steady, 's')).toEqual({ kind: 'phase', phase: 'combat' });
  });

  it('casts the most expensive creature it can pay for (Steady), the cheapest (Gentle)', () => {
    const lands = [permanentOf('l1', 'Mountain'), permanentOf('l2', 'Mountain'), permanentOf('l3', 'Forest')];
    const hand = [handCard('a', 'Highland Game'), handCard('b', 'Llanowar Elves'), handCard('c', 'Shivan Dragon')];
    const v = view({ hand, mine: lands, thisTurn: { ...view().thisTurn, landPlayed: true } });
    const s = decide(v, steady, 's');
    expect(s).toMatchObject({ kind: 'cast', card: 'a' });
    expect(decide(v, BOT_PROFILES.gentle, 's')).toMatchObject({ kind: 'cast', card: 'b' });
  });

  it('waits while its own spell has an open round, and resolves it once the round passed', () => {
    const round = { id: 'r1', askedBy: 's1', label: '', cue: null, about: 'si1', answered: true, passed: false };
    const v = view({ stack: [{ id: 'si1', controller: 's1', mine: true, card: 'c1' }], round });
    expect(decide(v, steady, 's')).toBeNull();
    const done = decide({ ...v, round: { ...round, passed: true } }, steady, 's');
    expect(done?.kind).toBe('resolve');
    if (done?.kind === 'resolve') expect(inside('1v1', 1, done.pose)).toBe(true);
  });

  it('discards an unplayable card first at the end with eight cards', () => {
    const hand = ['Forest', 'Forest', 'Highland Game', 'Llanowar Elves', 'Shivan Dragon', 'Cleansing Nova', 'Forest', 'Highland Game'].map((n, i) => handCard(`h${i}`, n));
    expect(decide(view({ turn: { number: 4, active: 's1', phase: 'end', mine: true }, hand }), steady, 's')).toEqual({ kind: 'discard', cards: ['h5'] });
    expect(decide(view({ turn: { number: 4, active: 's1', phase: 'end', mine: true }, hand: hand.slice(0, 7) }), steady, 's')).toEqual({ kind: 'passTurn' });
  });

  it('places 30 permanents inside its own territory', () => {
    const mine = [];
    for (let i = 0; i < 30; i++) {
      const s = decide(view({ hand: [handCard(`h${i}`, 'Forest')], mine }), steady, 's');
      expect(s?.kind).toBe('playLand');
      if (s?.kind !== 'playLand') return;
      expect(inside('1v1', 1, s.pose)).toBe(true);
      mine.push(permanentOf(`l${i}`, 'Forest', { pose: s.pose }));
    }
  });

  it('concedes at 0 life or less; answers the human first', () => {
    expect(decide(view({ life: { me: 0, opp: 20 } }), steady, 's')).toEqual({ kind: 'concede' });
    expect(decide(view({ life: { me: -3, opp: 20 }, turn: { number: 5, active: 's0', phase: 'main1', mine: false } }), steady, 's')).toEqual({ kind: 'concede' });
    expect(decide(view({ over: true, life: { me: -3, opp: 20 } }), steady, 's')).toBeNull();
  });

  it('answers a human round with OK and does nothing else on the human turn', () => {
    const turn = { number: 5, active: 's0', phase: 'main1', mine: false };
    expect(decide(view({ turn }), steady, 's')).toBeNull();
    expect(decide(view({ turn, round: { id: 'r', askedBy: 's0', label: '', cue: null, answered: false, passed: false } }), steady, 's')).toEqual({ kind: 'answer', round: 'r' });
  });

  it('mulligans a seven-card hand with 0, 1, 6 or 7 lands once, then puts one card on the bottom', () => {
    const lands = (n: number) => Array.from({ length: 7 }, (_, i) => handCard(`h${i}`, i < n ? 'Forest' : 'Highland Game'));
    const turn = { number: 1, active: 's0', phase: 'main1', mine: false };
    for (const n of [0, 1, 6, 7]) expect(decide(view({ turn, hand: lands(n), opening: { pending: true, mulligans: 0, bottomed: 0 } }), steady, 's'), `${n}`).toEqual({ kind: 'mulligan' });
    for (const n of [2, 3, 4, 5]) expect(decide(view({ turn, hand: lands(n), opening: { pending: true, mulligans: 0, bottomed: 0 } }), steady, 's'), `${n}`).toBeNull();
    expect(decide(view({ turn, hand: lands(6), opening: { pending: true, mulligans: 1, bottomed: 0 } }), steady, 's')).toEqual({ kind: 'bottom', cards: ['h0'] });
    expect(decide(view({ turn, hand: lands(1), opening: { pending: true, mulligans: 1, bottomed: 0 } }), steady, 's')).toEqual({ kind: 'bottom', cards: ['h1'] });
    expect(decide(view({ turn, hand: lands(6).slice(1), opening: { pending: true, mulligans: 1, bottomed: 1 } }), steady, 's')).toBeNull();
  });

  it('a skipped step kind moves the turn on', () => {
    const v = view({ hand: [handCard('h1', 'Forest')] });
    expect(decide(v, steady, 's', { skip: new Set(['playLand']) })).toEqual({ kind: 'phase', phase: 'combat' });
  });

  it('attacks with what survives and books the combat after "Blocks done"', () => {
    const a = creature('a', 3, 3, 3);
    const v = view({ turn: { number: 5, active: 's1', phase: 'combat', mine: true }, mine: [a], theirs: [creature('b', 2, 2, 2, [], { owned: false })] });
    const s = decide(v, steady, 's');
    expect(s).toMatchObject({ kind: 'attack', attackers: [{ card: 'a', tap: true }] });
    const out = { ...a, combat: 'attack' as const, displaced: true };
    const waiting = view({ ...v, mine: [out], thisTurn: { ...v.thisTurn, attacked: true } });
    expect(decide(waiting, steady, 's')).toBeNull();
    const cue = decide({ ...waiting, round: { id: 'r', askedBy: 's0', label: 'Blocks done', cue: 'blocksDone', answered: false, passed: false } }, steady, 's');
    expect(cue).toEqual({ kind: 'book', round: 'r', life: [{ seat: 's0', delta: -3 }], bury: [], pings: [], settle: ['a'], line: '3 to you.' });
  });

  it('on the Attack cue blocks well and answers; on Damage books its own life and its dead, pings the human dead', () => {
    const turn = { number: 6, active: 's0', phase: 'combat', mine: false };
    const attacker = creature('x', 2, 2, 2, [], { owned: false, combat: 'attack' });
    const mine = [creature('m', 3, 3, 3)];
    const blocks = decide(view({ turn, theirs: [attacker], mine, round: { id: 'r', askedBy: 's0', label: 'attack ', cue: 'attack', answered: false, passed: false } }), steady, 's');
    expect(blocks).toMatchObject({ kind: 'block', round: 'r', pairs: [{ blocker: 'm', attacker: 'x' }] });
    const blocked = { ...mine[0]!, combat: 'block' as const, displaced: true };
    const dmg = decide(view({ turn, theirs: [attacker], mine: [blocked], blocks: [{ blocker: 'm', attacker: 'x' }], round: { id: 'r2', askedBy: 's0', label: 'Damage', cue: 'damage', answered: false, passed: false } }), steady, 's');
    expect(dmg).toMatchObject({ kind: 'book', life: [], bury: [], pings: ['x'], settle: ['m'] });
    const unblocked = decide(view({ turn, theirs: [attacker], mine: [], round: { id: 'r2', askedBy: 's0', label: 'Damage', cue: 'damage', answered: false, passed: false } }), steady, 's');
    expect(unblocked).toMatchObject({ kind: 'book', life: [{ seat: 's1', delta: -2 }], line: 'I take 2.' });
  });
});
