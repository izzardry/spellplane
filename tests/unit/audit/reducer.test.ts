/**
 * `auditPublish` in the reducer (PLAN M5-P2; DESIGN "Multiplayer architecture", Hidden information 6: published at game
 * end; CLAUDE.md: hidden information leaves its owner's browser only through the design's reveal paths). A bundle is
 * sequenced only after the game it covers ended, only by its own seat, only in the published shape.
 */
import { describe, expect, it } from 'vitest';
import type { AuditBundle } from '../../../src/core/audit';
import { AuditTable } from './helpers';

function played(): AuditTable {
  const g = new AuditTable();
  g.startMatch();
  g.shuffle('s0', 'sh-a1');
  g.shuffle('s1', 'sh-b1');
  g.draw('s0', 3);
  return g;
}

describe('the auditPublish reducer', () => {
  it('refuses a bundle while its game is still being played, and accepts it once the game ended, changing nothing but seq', () => {
    const g = played();
    const open = { game: 1, fromSeq: 3, toSeq: g.state.seq };
    const bundle: AuditBundle = { seat: 's0', game: open, records: [] };
    g.t.refuse('s0', { type: 'auditPublish', bundle }, /still being played/);
    g.endMatch();
    const ended = g.bundle('s0');
    const before = g.state;
    const after = g.t.apply('s0', { type: 'auditPublish', bundle: ended });
    expect({ ...after, seq: before.seq }).toEqual(before);
    // An earlier game may be published while a later one is played: its records say nothing about the later game.
    g.t.ready('s0');
    g.t.ready('s1');
    g.t.apply('s0', { type: 'stageSet', stage: 'match' });
    g.t.apply('s1', { type: 'auditPublish', bundle: g.bundle('s1') });
    g.t.refuse('s1', { type: 'auditPublish', bundle: { seat: 's1', game: { game: 2, fromSeq: 20, toSeq: 21 }, records: [] } }, /still being played/);
    g.t.refuse('s1', { type: 'auditPublish', bundle: { seat: 's1', game: { game: 3, fromSeq: 20, toSeq: 21 }, records: [] } }, /has not been played/);
  });

  it('refuses a bundle for another seat, from an empty chair, or naming a span that has not ended', () => {
    const g = played();
    g.endMatch();
    const b = g.bundle('s1');
    g.t.refuse('s0', { type: 'auditPublish', bundle: b }, /own audit records only/);
    g.t.refuse('s1', { type: 'auditPublish', bundle: { ...b, game: { ...b.game, toSeq: g.state.seq + 1 } } }, /only after it ended/);
    g.t.apply('s1', { type: 'seatLeave', seat: 's1' });
    g.t.refuse('s1', { type: 'auditPublish', bundle: b }, /holds no player/);
  });

  it('refuses anything beyond nonces and orders: identities, salts, retired identities, other seats’ zones', () => {
    const g = played();
    g.endMatch();
    const b = g.bundle('s0');
    const shuffle = b.records[0]!;
    const cases: unknown[] = [
      { ...b, identities: { x: { sid: 'abc' } } },
      { ...b, records: [{ ...shuffle, ref: { sid: 'abc' } }] },
      { ...b, records: [{ ...shuffle, salt: 'abc' }] },
      { ...b, records: [{ ...shuffle, reissue: { before: [], retired: { a: { card: { sid: 'abc' }, salt: 's' } } } }] },
      { ...b, records: [{ ...shuffle, zone: 'library:s1' }] },
      { ...b, records: [{ ...shuffle, order: [...shuffle.order, shuffle.order[0]] }] },
      { ...b, records: [{ kind: 'peek', zone: 'library:s0' }] },
      { ...b, incomplete: false },
      { ...b, game: { ...b.game, game: 0 } },
      { ...b, game: { ...b.game, toSeq: b.game.fromSeq - 1 } },
      null,
      'bundle',
    ];
    for (const bundle of cases) g.t.refuse('s0', { type: 'auditPublish', bundle: bundle as AuditBundle });
    g.t.apply('s0', { type: 'auditPublish', bundle: b });
  });
});
