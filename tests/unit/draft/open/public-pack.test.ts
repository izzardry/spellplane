/**
 * The public-pack memory of the Rochester and Grid drivers (draft/open.ts `rememberPublicPack`; DESIGN "Specification:
 * network protocol and secrecy", Commitments: shown cards are verified, suspect otherwise). The sequencer checks
 * structure only, so a `packOpen` the reducer refused is still sequenced and reaches the drivers; it must never stand
 * in for the real pack, or the pool would lose a picked card once it left the table.
 */
import { describe, expect, it } from 'vitest';
import type { Action } from '../../../../src/core/actions';
import type { RevealedCard } from '../../../../src/core/commit';
import { emptySecretStore } from '../../../../src/core/secrets';
import type { SecretStore, SeatId, TableState } from '../../../../src/core/types';
import { createRochesterDriver } from '../../../../src/draft/rochester';
import type { DraftHost } from '../../../../src/draft/types';
import { reduce } from '../../../../src/core/reducer';
import { act, draftOf, draftTable, packCards, packOpenFields, sealPackSeed } from './helpers';

/** A fake host for `seat` that feeds sequenced actions (applied or refused) to the driver. */
function fakeHost(seat: SeatId, start: TableState) {
  const h = { state: start, secrets: emptySecretStore(seat) as SecretStore, seq: [] as ((a: Action, s: TableState) => void)[] };
  const host: DraftHost = {
    seat,
    state: () => h.state,
    secrets: () => h.secrets,
    setSecrets: (next) => {
      h.secrets = next;
    },
    dispatch: (draft) => ({ ...draft, by: seat, cid: 'x' }) as Action,
    packSeed: () => Promise.reject(new Error('no pack seeds here')),
    sendPack: () => undefined,
    onPack: () => () => undefined,
    onSequenced: (l) => {
      h.seq.push(l);
      return () => undefined;
    },
    sets: { listSets: () => Promise.resolve([]), get: () => Promise.resolve(null), peek: () => null },
    generatePack: () => {
      throw new Error('no packs here');
    },
    entropy: { id: () => 'cx', salt: () => 'salt' },
  };
  /** Sequence `action` (the reducer may refuse it: the state then stays) and tell the driver. */
  const sequence = (action: Action): void => {
    const sequenced = { ...action, seq: h.state.seq + 1 } as Action;
    h.state = reduce(h.state, sequenced);
    for (const l of h.seq) l(sequenced, h.state);
  };
  return { h, host, sequence };
}

describe('public packs remembered by the drivers', () => {
  it('a refused packOpen under the next pack id does not take the real pack\'s place; the pick still reaches the pool', () => {
    const s = draftTable(2, { format: 'rochester', packs: 1, burn: 0 });
    const sealed = sealPackSeed(s, 's0');
    const { h, host, sequence } = fakeHost('s0', sealed.state);
    const driver = createRochesterDriver(host);
    const packId = `pack-${sealed.sid}`;
    // s1 squats the pack id s0 is about to use (its round id is public) with cards of its own: refused, yet sequenced.
    const fake = packCards(15);
    sequence(act('packOpen', { ...packOpenFields(packId, fake, sealed.sid, 0, 'M19', 'up') }, 's1'));
    expect(draftOf(h.state).packs[packId]).toBeUndefined();
    expect(h.secrets.draft?.held[packId]).toBeUndefined();
    // The real pack, and a refused copy of it with a forged card afterwards.
    const cards = packCards(15);
    sequence(act('packOpen', packOpenFields(packId, cards, sealed.sid, 0, 'M19', 'up'), 's0'));
    const forged: RevealedCard[] = cards.map((c, i) => (i === 0 ? { ...c, ref: { sid: 'forged' } } : c));
    sequence(act('packOpen', packOpenFields(packId, forged, sealed.sid, 0, 'M19', 'up'), 's0'));
    expect(h.secrets.draft!.held[packId]).toEqual(cards);
    // s0 picks; the card leaves the table and still lands in the pool.
    const pick = cards[4]!;
    sequence(act('pick', { packId, count: 1, cards: [pick.instanceId] }, 's0'));
    expect(draftOf(h.state).packs[packId]!.cards!.some((c) => c.id === pick.instanceId)).toBe(false);
    expect(draftOf(h.state).taken!.s0).toEqual([pick.instanceId]);
    expect(h.secrets.pool).toEqual([pick.ref]);
    driver.dispose();
  });

  it('cards of a malformed refused packOpen are ignored', () => {
    const s = draftTable(2, { format: 'rochester', packs: 1, burn: 0 });
    const sealed = sealPackSeed(s, 's0');
    const { h, host, sequence } = fakeHost('s1', sealed.state);
    const driver = createRochesterDriver(host);
    const packId = `pack-${sealed.sid}`;
    const cards = packCards(15);
    const broken = { ...packOpenFields(packId, cards, sealed.sid, 0, 'M19', 'up'), cards: [null, 3, { instanceId: 'x' }] as unknown as RevealedCard[] };
    expect(() => sequence(act('packOpen', broken, 's0'))).not.toThrow();
    expect(h.secrets.draft?.held[packId]).toBeUndefined();
    sequence(act('packOpen', packOpenFields(packId, cards, sealed.sid, 0, 'M19', 'up'), 's0'));
    expect(h.secrets.draft!.held[packId]).toEqual(cards);
    driver.dispose();
  });
});
