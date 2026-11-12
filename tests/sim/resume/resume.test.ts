/**
 * PLAN M1-P7 acceptance, simulated network: "Reloading either page mid-game rejoins the same seat with the same hand;
 * closing both pages and reopening either restores the table" (DESIGN "Multiplayer architecture", Resume and failure
 * handling: rejoin by key pair and catch up from any connected peer; if nobody is connected, the first browser back
 * restores from its own save; later arrivals reconcile to the copy with the highest sequence number).
 *
 * Real networked sessions (session/net.ts over the M1-P1 engine) with their own fake IndexedDB, on a LoopbackNetwork
 * with delay and reordering, under fake timers. A reload is a new session on a new transport over the same stores.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chooseResume } from '../../../src/net/sync';
import { closeAll, FAKE_TIMERS, hashOf, net, open, ROOM, settle, until, waitConverged, type Browser } from '../session/harness';
import { playScript } from '../session/script';
import { handHash, libraryHash } from './helpers';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

let browsers: Browser[] = [];
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
});
afterEach(() => {
  closeAll(browsers);
  browsers = [];
  vi.useRealTimers();
});

const chats = (b: Browser): string[] => b.session!.log().flatMap((e) => (e.kind === 'action' && e.action.type === 'chat' ? [e.action.text] : []));

describe('reloading either page mid-game rejoins the same seat with the same hand', () => {
  it.each([
    ['A, the sequencer', 'A'],
    ['B', 'B'],
  ] as const)('%s reloads: same chair, same hand hash, same library order, one state hash', async (_label, who) => {
    const network = net({ seed: who === 'A' ? 71 : 72, delay: { min: 0, max: 120 } });
    const p = await playScript(network, browsers);
    const me = who === 'A' ? p.A : p.B;
    const other = who === 'A' ? p.b : p.a;
    const s = me.session!;
    const before = { seat: s.seat, hand: handHash(s), library: libraryHash(s), handIds: [...s.secrets().hand] };
    expect(before.handIds.length).toBeGreaterThan(0);
    s.leave();
    // The other page carries on while this one reloads.
    other.chat('still here');
    const back = await open(network, me, { settleMs: 200 });
    await waitConverged([back, other]);
    expect(back.seat).toBe(before.seat);
    expect(handHash(back)).toBe(before.hand);
    expect(libraryHash(back)).toBe(before.library);
    expect(back.getState().zones[`hand:${before.seat}`]!.ids).toEqual([...before.handIds].sort());
    expect(hashOf(back.engine.confirmedState())).toBe(hashOf(other.engine.confirmedState()));
    // The line said meanwhile reached the reloaded page through the catch-up.
    expect(chats(me)).toContain('still here');
    // And it plays on: a draw takes the top card it remembered.
    const top = back.secrets().libraryOrder[0]!;
    await settle(back.draw(1));
    await waitConverged([back, other]);
    expect(back.secrets().hand).toContain(top);
  });

  it('both reload one after the other and the game goes on from the same state', async () => {
    const network = net({ seed: 73 });
    const p = await playScript(network, browsers);
    const hands = { a: handHash(p.a), b: handHash(p.b) };
    p.a.leave();
    const a = await open(network, p.A, { settleMs: 200 });
    await waitConverged([a, p.b]);
    p.b.leave();
    const b = await open(network, p.B, { settleMs: 200 });
    const hash = await waitConverged([a, b]);
    expect(hash).toBe(hashOf(b.engine.confirmedState()));
    expect(handHash(a)).toBe(hands.a);
    expect(handHash(b)).toBe(hands.b);
  });
});

describe('closing both pages and reopening either restores the table', () => {
  it.each([
    ['the one with the lower seq', 'low'],
    ['the one with the higher seq', 'high'],
  ] as const)('both crash; %s comes back alone from its own save, then the other: both reconcile to the higher seq', async (_label, first) => {
    const network = net({ seed: first === 'low' ? 81 : 82 });
    const p = await playScript(network, browsers);
    const hands = { a: handHash(p.a), b: handHash(p.b) };
    // B's page dies; A plays on alone for a while, so A's copy is ahead.
    await settle(p.b.whenSaved());
    network.kill(p.B.peerId);
    p.b.leave();
    p.B.session = null;
    p.a.chat('while Ben was gone');
    p.a.dispatch({ type: 'life', seat: 's0', delta: -3 });
    await until(() => p.a.engine.pending().length === 0, 20_000, 'A to play on alone');
    // Then A's page dies too: nobody is at the table.
    await settle(p.a.whenSaved());
    network.kill(p.A.peerId);
    p.a.leave();
    p.A.session = null;
    const savedSeq = async (b: Browser): Promise<number> => (await settle(b.stores.tables.loadTable(ROOM)))!.table.lastSeq;
    const high = { seq: await savedSeq(p.A) };
    const lowSeq = await savedSeq(p.B);
    expect(lowSeq).toBeLessThan(high.seq);

    network.revive(p.A.peerId);
    network.revive(p.B.peerId);
    const [firstB, secondB] = first === 'low' ? [p.B, p.A] : [p.A, p.B];
    // The first browser back restores from its own save, with nobody connected.
    const one = await open(network, firstB, { settleMs: 200 });
    expect(one.engine.seq()).toBe(firstB === p.A ? high.seq : lowSeq);
    expect(one.seat).toBe(firstB === p.A ? 's0' : 's1');
    expect(handHash(one)).toBe(firstB === p.A ? hands.a : hands.b);
    expect(one.engine.peers().filter((x) => x.status === 'connected')).toEqual([]);
    // The later arrival: both reconcile to the copy with the highest seq (net/sync.ts chooseResume).
    const two = await open(network, secondB, { settleMs: 200 });
    await waitConverged([one, two], 'both to reconcile');
    const a = firstB === p.A ? one : two;
    const b = firstB === p.A ? two : one;
    expect(chooseResume(lowSeq, [{ peerId: p.A.peerId, lastSeq: high.seq }])).toEqual({ from: 'peer', peerId: p.A.peerId, haveSeq: lowSeq });
    expect(b.engine.seq()).toBeGreaterThanOrEqual(high.seq);
    // A's actions after B left are in both copies; nothing of A's history was lost to B's shorter copy.
    expect(a.engine.confirmedState().seats.s0!.life).toBe(17);
    expect(b.engine.confirmedState().seats.s0!.life).toBe(17);
    expect(chats(p.B)).toContain('while Ben was gone');
    expect(b.log().filter((e) => e.kind === 'action').map((e) => e.seq).slice(0, high.seq)).toEqual(Array.from({ length: high.seq }, (_, i) => i + 1));
    // Same chairs and hands as before both pages closed.
    expect([a.seat, b.seat]).toEqual(['s0', 's1']);
    expect(handHash(a)).toBe(hands.a);
    expect(handHash(b)).toBe(hands.b);
    // And the table plays on.
    await settle(b.draw(1));
    await waitConverged([a, b]);
  });
});
