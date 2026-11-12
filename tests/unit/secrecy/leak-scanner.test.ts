/** The pair scan of the shared leak scanner (tests/leak/leak.ts): ids next to identities, old ids next to new ones. */
import { describe, expect, it } from 'vitest';
import { scanPairs } from '../../leak/leak';

const PAIRS = [{ pair: ['c1', 'bolt'] as [string, string], why: 'mapping' as const }];

describe('leak pair scan', () => {
  it('finds an id next to its Scryfall id in a message, a card record or a keyed record', () => {
    const reveal = { v: 1, t: 'seq', action: { type: 'reveal', instanceId: 'c1', ref: { sid: 'bolt' }, salt: 's' } };
    const card = { cards: { c1: { id: 'c1', identity: { sid: 'bolt' } } } };
    const received = { received: { c1: { card: { sid: 'bolt' }, salt: 's', from: 's0' } } };
    const tuple = { leak: [['c1', 'bolt']] };
    const hits = scanPairs([reveal, card, received, tuple], PAIRS);
    expect(hits.map((h) => [h.index, h.path])).toEqual([
      [0, '$.action'],
      [1, '$.cards.c1'],
      [2, '$.received.c1'],
      [3, '$.leak[0]'],
    ]);
  });

  it('does not pair strings that merely share a long id list or sit far apart', () => {
    const state = {
      zones: { lib: { ids: ['a0', 'a1', 'a2', 'c1', 'a4'] } },
      commitments: { s0: { instanceIds: ['c1', 'c2', 'c3', 'c4', 'c5'], commits: ['x', 'y', 'z', 'w', 'v'] } },
      cards: { c1: { id: 'c1' }, c9: { id: 'c9', identity: { sid: 'bolt' } } },
      list: ['bolt', 'c1', 'x', 'y', 'z'],
    };
    expect(scanPairs([state], PAIRS)).toEqual([]);
  });
});
