/**
 * The `draftCards` pair message through real NetEngines (net/engine.ts routes it to the pair-channel listeners like
 * `pack`; net/draftcards.ts on top). Without that routing every Winston pile look would be dropped by the engine.
 * DESIGN "Specification: network protocol and secrecy", prv: one pair only; "Pre-game", Hidden information: Winston
 * "pile contents visible to whoever looks".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RevealedCard } from '../../../../src/core/commit';
import type { SeatId } from '../../../../src/core/types';
import { draftCardsOver } from '../../../../src/net/draftcards';
import { scan } from '../../../leak/scan';
import { agreed, makeSim, until, type SimPeer } from '../../net/sim';

vi.mock('../../../../src/net/identity', async () => (await import('../../net/fake-identity')).fakeIdentityModule);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('draftCards through the engine', () => {
  it('reaches the addressed seat with the sender’s seat, and no other peer', async () => {
    const sim = makeSim({ engines: 3, seed: 31, delay: { min: 5, max: 40 } });
    await until(() => agreed(sim.peers), 20_000, 'connection');
    const [a, b, c] = sim.peers as [SimPeer, SimPeer, SimPeer];
    const got: { about: string; cards: RevealedCard[]; from: SeatId }[] = [];
    draftCardsOver(b.engine).on((about, cards, from) => got.push({ about, cards, from }));
    let cGot = 0;
    draftCardsOver(c.engine).on(() => cGot++);
    const card: RevealedCard = { instanceId: 'cwinston01', ref: { sid: 'secret-pile-sid' }, salt: 'secret-pile-salt' };
    expect(draftCardsOver(a.engine).send('s1', 'cid-look', [card])).toBe(true);
    expect(draftCardsOver(a.engine).send('s3', 'cid-look', [card])).toBe(false); // nobody holds s3
    await vi.advanceTimersByTimeAsync(500);
    expect(got).toEqual([{ about: 'cid-look', cards: [card], from: 's0' }]);
    expect(cGot).toBe(0);
    const toC = sim.net.delivered.filter((d) => d.to === c.transport.selfId);
    expect(scan([toC, c.engine.messages(), c.engine.state()], ['secret-pile-sid', 'secret-pile-salt'])).toEqual([]);
  });
});
