/** Selectors and invariants (DESIGN "Table model", "Card manipulation", "Turn flow and confirmation"; PLAN M0-P1). */
import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../../../src/core/invariants';
import {
  allPassed,
  attachmentsOf,
  cardsInZone,
  controlledCards,
  displacedCards,
  libraryCount,
  lifeOf,
  linesOf,
  pileMembers,
  seatZone,
  seatsInOrder,
  selectionSummary,
  topOfLibrary,
  topOfStack,
  zoneById,
} from '../../../src/core/selectors';
import type { ConfirmRound, SecretStore, TableState } from '../../../src/core/types';
import { P, act, fresh, ok, play, readyTable } from './helpers';

function board(): TableState {
  let s = play(play(play(readyTable(6), 'a00', P(0, -200)), 'a01', P(100, -200)), 'a02', P(200, -200));
  s = play(s, 'b00', P(0, 200, 180), 's1');
  s = ok(s, act('pile', { card: 'a02', pile: { id: 'L', index: 0, kind: 'cascade' } }));
  s = ok(s, act('pile', { card: 'a00', pile: { id: 'L', index: 1, kind: 'cascade' } }));
  s = ok(s, act('move', { card: 'a01', to: 'battlefield:s1', pose: P(100, 200, 180) }));
  s = ok(s, act('attach', { card: 'a01', to: 'b00' }));
  return s;
}

describe('selectors', () => {
  it('zones and cards in zone order', () => {
    const s = board();
    expect(zoneById(s, 'battlefield:s0')?.ids).toEqual(['a00', 'a02']);
    expect(zoneById(s, 'nope')).toBeNull();
    expect(zoneById(s, 'constructor')).toBeNull();
    expect(seatZone(s, 'library', 's0')?.id).toBe('library:s0');
    expect(seatZone(s, 'stack', null)?.id).toBe('stack');
    expect(cardsInZone(s, 'battlefield:s0').map((c) => c.id)).toEqual(['a00', 'a02']);
    expect(cardsInZone(s, 'library:s0').map((c) => c.id)).toEqual(['a03', 'a04', 'a05']);
    expect(cardsInZone(s, 'nope')).toEqual([]);
  });

  it('pile members in order, attachments, controlled cards', () => {
    const s = board();
    expect(pileMembers(s, 'L').map((c) => c.id)).toEqual(['a02', 'a00']);
    expect(pileMembers(s, 'none')).toEqual([]);
    expect(attachmentsOf(s, 'b00').map((c) => c.id)).toEqual(['a01']);
    expect(controlledCards(s, 's0').map((c) => c.id)).toEqual(['a00', 'a02']);
    expect(controlledCards(s, 's1').map((c) => c.id).sort()).toEqual(['a01', 'b00']);
    expect(displacedCards(s)).toEqual([]);
  });

  it('top of library comes from the owner secret store, never from shared state', () => {
    const s = readyTable(4);
    const secrets: SecretStore = { seat: 's0', identities: {}, libraryOrder: ['a02', 'a00', 'a03', 'a01'], hand: [], audit: [], received: {} };
    expect(topOfLibrary(s, secrets)).toBe('a02');
    const s2 = ok(s, act('draw', { instanceId: 'a02' }));
    // A stale order entry (already drawn) is skipped.
    expect(topOfLibrary(s2, secrets)).toBe('a00');
    expect(topOfLibrary(s2, { ...secrets, libraryOrder: [] })).toBeNull();
    expect(libraryCount(s2, 's0')).toBe(3);
    expect(libraryCount(s2, 's1')).toBe(4);
  });

  it('summed power and toughness of a selection, with +1/+1 and -1/-1 counters', () => {
    let s = board();
    s = ok(s, act('counter', { card: 'a00', kind: '+1/+1', delta: 2 }));
    s = ok(s, act('counter', { card: 'a02', kind: '-1/-1', delta: 1 }));
    const pt: Record<string, { power: string; toughness: string }> = {
      'sid-a00': { power: '2', toughness: '2' },
      'sid-a02': { power: '3', toughness: '*' },
    };
    const sum = selectionSummary(s, ['a00', 'a02', 'a01', 'ghost'], (c) => (c.identity ? (pt[c.identity.sid] ?? null) : null));
    expect(sum).toEqual({ count: 3, creatures: 2, power: 4 + 2, toughness: 4 - 1 });
  });

  it('stack top, lines, seats, life, confirmation', () => {
    let s = board();
    s = ok(s, act('stackPush', { item: 'i1', kind: 'trigger', source: 'a00' }));
    s = ok(s, act('stackPush', { item: 'i2', kind: 'ability', source: 'a02' }));
    s = ok(s, act('lineAdd', { line: 'l', kind: 'target', from: { kind: 'stackItem', id: 'i2' }, to: { kind: 'card', id: 'b00' } }));
    expect(topOfStack(s)?.id).toBe('i2');
    expect(topOfStack(fresh())).toBeNull();
    expect(linesOf(s, 'b00').map((l) => l.id)).toEqual(['l']);
    expect(linesOf(s, 'i2').map((l) => l.id)).toEqual(['l']);
    expect(seatsInOrder(fresh('ffa4', 4))).toEqual(['s0', 's1', 's2', 's3']);
    const t = ok(fresh('2hg', 4), act('life', { seat: 's2', delta: -5 }));
    expect(lifeOf(t, 's3')).toBe(25);
    expect(lifeOf(s, 's0')).toBe(20);
    const round: ConfirmRound = { id: 'r', askedBy: 's0', durationMs: 5000, startSeq: 1, responses: { s1: 'ok', s2: 'timeout' } };
    expect(allPassed(round, ['s0', 's1', 's2'])).toBe(true);
    expect(allPassed(round, ['s0', 's1', 's2', 's3'])).toBe(false);
    expect(allPassed({ ...round, responses: { s1: 'hold', s2: 'ok' } }, ['s0', 's1', 's2'])).toBe(false);
  });
});

describe('checkInvariants', () => {
  it('is empty for reachable states and names each broken rule', () => {
    const s = board();
    expect(checkInvariants(s)).toEqual([]);
    const broken = structuredClone(s);
    broken.zones['graveyard:s0']!.ids.push('a00'); // a card in two zones
    broken.cards.a02!.pile!.index = 3; // gap in the pile
    broken.zones['library:s0']!.ids.reverse(); // hidden order leaked
    broken.cards.a01!.attachedTo = 'a01';
    broken.stack.push({ id: 'x', kind: 'spell', controller: 's0', card: 'a05' });
    broken.lines.q = { id: 'q', kind: 'mark', from: { kind: 'card', id: 'zz' }, to: { kind: 'seat', id: 's0' }, by: 's0' };
    const v = checkInvariants(broken).join('\n');
    expect(v).toMatch(/a00.*graveyard:s0/);
    expect(v).toMatch(/pile L/);
    expect(v).toMatch(/library:s0.*sorted/);
    expect(v).toMatch(/a01.*itself/);
    expect(v).toMatch(/stack/);
    expect(v).toMatch(/line q/);
  });
});
