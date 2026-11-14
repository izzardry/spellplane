/** The shared leak scan finds forbidden strings anywhere in what a peer could have seen (tests/leak/scan.ts; CLAUDE.md). */
import { describe, expect, it } from 'vitest';
import { scan } from '../../leak/scan';
import { PROTOCOL_VERSION } from '../../../src/net/messages';

describe('leak scan', () => {
  it('finds a forbidden id at any depth, in values, keys and substrings', () => {
    const msg = { v: PROTOCOL_VERSION, t: 'reveal', cards: [{ instanceId: 'c1', ref: { sid: 'secret-sid' } }] };
    const state = { cards: { 'secret-sid-key': { n: 1 } }, note: 'look: secret-sid!' };
    expect(scan([msg, state], ['secret-sid'])).toEqual([
      { index: 0, path: '$.cards[0].ref.sid', token: 'secret-sid' },
      { index: 1, path: '$.cards.secret-sid-key#key', token: 'secret-sid' },
      { index: 1, path: '$.note', token: 'secret-sid' },
    ]);
  });

  it('reports nothing for clean values, empty tokens or no tokens', () => {
    expect(scan([{ a: ['public'], b: 3, c: null }], ['hidden'])).toEqual([]);
    expect(scan([{ a: 'x' }], [''])).toEqual([]);
    expect(scan([{ a: 'x' }], [])).toEqual([]);
  });

  it('walks Maps and Sets and survives cycles', () => {
    const cyc: Record<string, unknown> = { s: 'ok' };
    cyc.self = cyc;
    const hits = scan([new Map([['k', new Set(['has hidden'])]]), cyc], ['hidden']);
    expect(hits).toEqual([{ index: 0, path: '$.k{0}', token: 'hidden' }]);
  });
});
