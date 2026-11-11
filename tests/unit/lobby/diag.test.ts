/**
 * The `#/diag` connection check (PLAN M1 Connectivity check: joins a room through the configured transport and reports
 * time to connect, the peers and a ping round trip; DESIGN "Multiplayer architecture": failures are said plainly).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoopbackNetwork } from '../../../src/net/loopback';
import type { Transport } from '../../../src/net/transport';
import { DIAG_TIMEOUT_MS, NO_PEER, RELAYS_FAILED, newDiagRoom, runDiag, type DiagRun } from '../../../src/ui/diag/diag';
import { SilentTransport, UnreachableTransport } from '../../../src/ui/lobby/local-session';
import { ROOM_KEY_RE } from '../../../src/ui/lobby/room';

const runs: DiagRun[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const r of runs.splice(0)) r.stop();
  vi.useRealTimers();
});

function start(createTransport: () => Transport, room: { roomId: string; roomKey: string } | null = null): DiagRun {
  const r = runDiag({ createTransport, room, now: () => Date.now() });
  runs.push(r);
  return r;
}

describe('runDiag', () => {
  it('a fresh check opens its own diagnostics room, apart from table rooms', () => {
    const r = start(() => new SilentTransport('x'));
    expect(r.roomId).toMatch(/^diag-[a-z]+-[a-z]+-[a-z]+-\d\d$/);
    expect(r.roomKey).toMatch(ROOM_KEY_RE);
    expect(newDiagRoom().roomId).not.toBe(newDiagRoom().roomId);
  });

  it('two browsers in one room: time to join, time to connect and a ping round trip on both sides', async () => {
    const net = new LoopbackNetwork({ delay: { min: 40, max: 40 } });
    const a = start(() => net.create('ta'));
    await vi.advanceTimersByTimeAsync(5);
    expect(a.report().joinedAfterMs).not.toBeNull();
    expect(a.report().peers).toEqual([]);

    await vi.advanceTimersByTimeAsync(1000);
    const b = start(() => net.create('tb'), { roomId: a.roomId, roomKey: a.roomKey });
    expect(b.roomId).toBe(a.roomId);
    await vi.advanceTimersByTimeAsync(200);

    const ra = a.report();
    const rb = b.report();
    expect(ra.peers).toHaveLength(1);
    expect(ra.peers[0]).toMatchObject({ peer: 'tb' });
    expect(ra.peers[0]!.connectedAfterMs).toBeGreaterThanOrEqual(1000);
    expect(rb.peers[0]).toMatchObject({ peer: 'ta' });
    // 40 ms each way.
    expect(ra.peers[0]!.rttMs).toBe(80);
    expect(rb.peers[0]!.rttMs).toBe(80);
    expect(ra.error).toBeNull();
    expect(rb.error).toBeNull();
  });

  it('keeps measuring: a later ping reports the current round trip', async () => {
    const net = new LoopbackNetwork({ delay: { min: 10, max: 10 } });
    const a = start(() => net.create('ta'));
    start(() => net.create('tb'), { roomId: a.roomId, roomKey: a.roomKey });
    await vi.advanceTimersByTimeAsync(100);
    expect(a.report().peers[0]!.rttMs).toBe(20);
    net.options = { delay: { min: 100, max: 100 } };
    await vi.advanceTimersByTimeAsync(2500);
    expect(a.report().peers[0]!.rttMs).toBe(200);
  });

  it('relays out of reach: a plain message after the timeout', async () => {
    const r = start(() => new UnreachableTransport('x'));
    const seen: (string | null)[] = [];
    r.subscribe((x) => seen.push(x.error));
    await vi.advanceTimersByTimeAsync(DIAG_TIMEOUT_MS - 1);
    expect(r.report()).toMatchObject({ joinedAfterMs: null, error: null });
    await vi.advanceTimersByTimeAsync(1);
    expect(r.report().error).toBe(RELAYS_FAILED);
    expect(RELAYS_FAILED).toMatch(/another network, a phone hotspot or a VPN/);
    expect(seen.at(-1)).toBe(RELAYS_FAILED);
  });

  it('joined but nobody ever connects: a plain message naming the remedies', async () => {
    const r = start(() => new SilentTransport('x'));
    await vi.advanceTimersByTimeAsync(DIAG_TIMEOUT_MS + 10);
    expect(r.report().joinedAfterMs).toBe(0);
    expect(r.report().error).toBe(NO_PEER);
    expect(NO_PEER).toMatch(/do not allow a direct connection/);
  });

  it('the no-peer message clears when a peer turns up late', async () => {
    const net = new LoopbackNetwork();
    const a = start(() => net.create('ta'));
    await vi.advanceTimersByTimeAsync(DIAG_TIMEOUT_MS + 10);
    expect(a.report().error).toBe(NO_PEER);
    start(() => net.create('tb'), { roomId: a.roomId, roomKey: a.roomKey });
    await vi.advanceTimersByTimeAsync(10);
    expect(a.report().error).toBeNull();
    expect(a.report().peers).toHaveLength(1);
  });

  it('a transport that cannot be created is reported, not thrown', () => {
    const r = start(() => {
      throw new Error('no transport here');
    });
    expect(r.report().error).toMatch(/no transport here/);
  });

  it('a join that fails is reported with the remedies', async () => {
    const t = new SilentTransport('x');
    t.join = () => Promise.reject(new Error('relay refused'));
    const r = start(() => t);
    await vi.advanceTimersByTimeAsync(1);
    expect(r.report().error).toMatch(/relay refused/);
  });

  it('stop leaves the room and stops reporting', async () => {
    const net = new LoopbackNetwork();
    const a = start(() => net.create('ta'));
    const b = start(() => net.create('tb'), { roomId: a.roomId, roomKey: a.roomKey });
    await vi.advanceTimersByTimeAsync(10);
    b.stop();
    await vi.advanceTimersByTimeAsync(10);
    expect(net.livePeers()).toEqual(['ta']);
  });

  it('ignores a pong it never asked for and a malformed ping', async () => {
    const net = new LoopbackNetwork();
    const a = start(() => net.create('ta'));
    const rogue = net.create('tr');
    await rogue.join('r', 'k');
    await vi.advanceTimersByTimeAsync(5);
    rogue.send('ctl', { v: 1, t: 'diagPong', id: 999, at: 0 }, 'ta');
    rogue.send('ctl', { v: 1, t: 'diagPing', id: 'x', at: 'y' }, 'ta');
    await vi.advanceTimersByTimeAsync(5);
    expect(a.report().peers[0]).toMatchObject({ peer: 'tr', rttMs: null });
  });
});
