/** M8-P6: reading cards (computer.md 5.4, C1) over the fixture cards, and paying costs. */
import { describe, expect, it } from 'vitest';
import { adjustedStats, keywordsOf, landColours, parseCost, readCard } from '../../../src/bot/cards';
import { pay } from '../../../src/bot/mana';
import { card, M19 } from './fixtures';

describe('reading a card', () => {
  it('gives every creature and land of the M19 fixture a kind, and every plain cost a parsed cost', () => {
    for (const c of M19) {
      const r = readCard(c.id, c);
      if (/\bCreature\b/.test(c.type_line) && !/\bLand\b/.test(c.type_line)) expect(r.kind, c.name).toBe('creature');
      if (/\bLand\b/.test(c.type_line)) expect(r.kind, c.name).toBe('land');
      if (r.kind === 'creature' && c.mana_cost && /^(\{(\d+|[WUBRGC])\})+$/.test(c.mana_cost)) {
        expect(r.cost, c.name).not.toBeNull();
        expect(r.mv, c.name).toBe(c.cmc);
      }
    }
  });

  it('refuses X and hybrid costs', () => {
    expect(parseCost('{X}{R}')).toBeNull();
    expect(parseCost('{G/W}')).toBeNull();
    expect(parseCost('{2/B}')).toBeNull();
    expect(readCard('a', card('Banefire')).cost).toBeNull();
    expect(parseCost('{4}{R}{R}')).toEqual({ generic: 4, colours: { R: 2 } });
  });

  it('reads land colours of the five basics and of a dual land', () => {
    expect(readCard('a', card('Plains')).produces).toEqual(['W']);
    expect(readCard('a', card('Island')).produces).toEqual(['U']);
    expect(readCard('a', card('Swamp')).produces).toEqual(['B']);
    expect(readCard('a', card('Mountain')).produces).toEqual(['R']);
    expect(readCard('a', card('Forest')).produces).toEqual(['G']);
    expect(readCard('a', card('Cinder Barrens')).produces).toEqual(['B', 'R']);
    expect(landColours('Land', '{T}: Add one mana of any color.')).toEqual(['W', 'U', 'B', 'R', 'G']);
    expect(readCard('a', card('Detection Tower')).produces).toEqual([]);
  });

  it('reads keywords, power and toughness', () => {
    const shivan = readCard('a', card('Shivan Dragon'));
    expect(shivan.keywords).toEqual(['flying']);
    expect([shivan.power, shivan.toughness]).toEqual([5, 5]);
    expect(readCard('a', card('Volcanic Dragon')).keywords).toEqual(['flying', 'haste']);
    expect(readCard('a', card('Sun Sentinel')).keywords).toEqual(['vigilance']);
    expect(readCard('a', card('Child of Night')).keywords).toEqual(['lifelink']);
    expect(keywordsOf('Creatures you control with flying get +1/+1.')).toEqual([]);
  });

  it('applies notes and counters', () => {
    const base = { power: 2, toughness: 2 };
    expect(adjustedStats(base, {}, '5/5')).toEqual({ power: 5, toughness: 5 });
    expect(adjustedStats(base, {}, '+3/+3')).toEqual({ power: 5, toughness: 5 });
    expect(adjustedStats(base, {}, '-1/-1')).toEqual({ power: 1, toughness: 1 });
    expect(adjustedStats(base, { '+1/+1': 2 }, undefined)).toEqual({ power: 4, toughness: 4 });
    expect(adjustedStats(base, { '-1/-1': 1 }, undefined)).toEqual({ power: 1, toughness: 1 });
    expect(adjustedStats(base, { '+1/+1': 2 }, 'a note')).toEqual({ power: 4, toughness: 4 });
  });

  it('reads a token without data as a 1/1', () => {
    const t = readCard('t', null);
    expect([t.power, t.toughness]).toEqual([1, 1]);
  });
});

describe('paying', () => {
  const M = (id: string): { id: string; produces: ('R' | 'G')[] } => ({ id, produces: ['R'] });
  const F = (id: string): { id: string; produces: ('R' | 'G')[] } => ({ id, produces: ['G'] });
  it('pays {1}{R}{R} with Mountain, Mountain, Forest and not with Mountain, Forest, Forest', () => {
    expect(pay({ generic: 1, colours: { R: 2 } }, [M('m1'), M('m2'), F('f1')])?.sort()).toEqual(['f1', 'm1', 'm2']);
    expect(pay({ generic: 1, colours: { R: 2 } }, [M('m1'), F('f1'), F('f2')])).toBeNull();
  });
  it('pays coloured symbols from the land with the fewest colours and keeps what the hand needs', () => {
    const dual = { id: 'd', produces: ['R', 'G'] as ('R' | 'G')[] };
    expect(pay({ generic: 0, colours: { R: 1 } }, [dual, M('m')])).toEqual(['m']);
    expect(pay({ generic: 1, colours: {} }, [F('f'), M('m')], { G: 2 })).toEqual(['m']);
  });
});
