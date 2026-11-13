/**
 * PLAN M5-P6 protocol version check on a simulated network (PLAN "Standing rules for tests": every protocol feature gets
 * a simulated-network test with delay, drop, reordering and peer loss before its browser test). A page of another
 * protocol version is modelled as a raw transport that behaves like an M0-M4 engine (net/hello.ts of version 1): it
 * says `hello` with its own `v`, and answers a hello of another version with `bye {reason: 'version', version}`.
 *
 * Owner decision (PLAN Milestone 5, Version mismatch): "A peer on a different protocol version gets a clear message
 * naming both versions and what to do (reload after the game, or wait for the table to update), never a silent failure."
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { PROTOCOL_VERSION } from '../../../src/net/messages';
import type { LoopbackNetwork, LoopbackOptions } from '../../../src/net/loopback';
import type { Message } from '../../../src/net/transport';
import { agreed, expectConverged, makeSim, until, type SimPeer } from './sim';
import { browser, FAKE_TIMERS, KEY, net as sessionNet, open, ROOM, settle } from '../session/harness';
import { openNetSession } from '../../../src/session/net';
import { mtg } from '../../../src/games/index';
import { cards } from '../session/harness';

vi.mock('../../../src/net/identity', async () => (await import('./fake-identity')).fakeIdentityModule);

afterEach(() => {
  vi.useRealTimers();
});

/** A page of protocol `v` (another version) on the network: hellos with its own `v`, and version byes to any other hello. */
function oldPage(net: LoopbackNetwork, tid: string, v: number, nickname = 'Old Ben'): { leave(): void; byes: number } {
  const t = net.create(tid);
  const out = { byes: 0, leave: () => t.leave() };
  const hello = (to: string): void => t.send('ctl', { v, t: 'hello', peerId: `old-${tid}`, pubKey: 'pk-old', nickname, seat: null, role: 'player', lastSeq: 0, nonce: 'n' } as unknown as Message, to);
  t.onPeer((ev, peer) => {
    if (ev === 'join') hello(peer);
  });
  t.on('ctl', (raw, from) => {
    const m = raw as unknown as { v: number; t: string };
    if (m.t === 'hello' && m.v !== v) {
      out.byes++;
      t.send('ctl', { v, t: 'bye', reason: 'version', version: v } as unknown as Message, from);
      // Engines of every version say hello again when they hear nothing back; so does this one.
      hello(from);
    }
  });
  void t.join(ROOM_SIM, 'room-key');
  return out;
}
const ROOM_SIM = 'amber-fox-93';

const FAULTS: (LoopbackOptions & { what: string })[] = [
  { what: 'no faults', seed: 1 },
  { what: 'delay and reordering', seed: 2, delay: { min: 5, max: 120 } },
  { what: 'delay and 20% drop', seed: 3, delay: { min: 5, max: 80 }, drop: 0.2 },
];

describe('engines and a page of another protocol version', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it.each(FAULTS)('a lone page sees the mismatch with both versions and says it once in the log ($what)', async (faults) => {
    const sim = makeSim({ engines: 1, seats: 2, ...faults });
    const [a] = sim.peers as [SimPeer];
    const old = oldPage(sim.net, 'tv', PROTOCOL_VERSION - 1);
    await until(() => a.engine.versionMismatch?.() != null && a.engine.versionMismatch!()!.nickname !== '', 20_000, 'the mismatch');
    expect(a.engine.versionMismatch?.()).toEqual({ mine: PROTOCOL_VERSION, theirs: PROTOCOL_VERSION - 1, peerId: 'old-tv', nickname: 'Old Ben' });
    expect(a.engine.status()).toBe('versionMismatch');
    // Retried hellos and byes keep the state; the log says it once per connection.
    await vi.advanceTimersByTimeAsync(10_000);
    const lines = a.system.filter((t) => t.startsWith('Version mismatch'));
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain(`version ${PROTOCOL_VERSION - 1}`);
    expect(lines[0]).toContain(`version ${PROTOCOL_VERSION}`);
    expect(lines[0]).toMatch(/wait for the table to update/);
    // Never part of the table: no seat, no peer entry, nothing sequenced from it.
    expect(a.engine.peers().some((p) => p.peerId === 'old-tv')).toBe(false);
    old.leave();
  });

  it('a newer page is told to reload after the game; it learns the version from the older page’s bye alone', async () => {
    const sim = makeSim({ engines: 1, seats: 2, seed: 4, delay: { min: 5, max: 40 } });
    const [a] = sim.peers as [SimPeer];
    // A page that never says hello itself and only refuses ours (a version-1 page's engine answers every foreign hello).
    const t = sim.net.create('tnew');
    t.on('ctl', (raw, from) => {
      const m = raw as unknown as { v: number; t: string };
      if (m.t === 'hello') t.send('ctl', { v: PROTOCOL_VERSION + 1, t: 'bye', reason: 'version', version: PROTOCOL_VERSION + 1 } as unknown as Message, from);
    });
    void t.join(ROOM_SIM, 'room-key');
    await until(() => a.engine.versionMismatch?.() != null, 20_000, 'the mismatch');
    expect(a.engine.versionMismatch?.()).toMatchObject({ mine: PROTOCOL_VERSION, theirs: PROTOCOL_VERSION + 1 });
    expect(a.system.find((l) => l.startsWith('Version mismatch'))).toMatch(/reload it after the game/);
  });

  it('the table of the same version plays on beside the mismatched page, and the notice goes when that page leaves', async () => {
    const sim = makeSim({ engines: 2, seats: 2, seed: 5, delay: { min: 5, max: 60 }, drop: 0.05 });
    const [a, b] = sim.peers as [SimPeer, SimPeer];
    await until(() => agreed([a, b]), 20_000, 'connection');
    const old = oldPage(sim.net, 'tv', PROTOCOL_VERSION - 1);
    await until(() => a.engine.versionMismatch?.() != null && b.engine.versionMismatch?.() != null, 20_000, 'both see the mismatch');
    // The others still play: their status stays connected, actions are sequenced and converge.
    for (let i = 0; i < 6; i++) {
      a.engine.propose({ type: 'life', by: 's0', cid: `a${i}`, seat: 's0', delta: -1 } as Action);
      b.engine.propose({ type: 'life', by: 's1', cid: `b${i}`, seat: 's1', delta: -1 } as Action);
      await vi.advanceTimersByTimeAsync(50);
    }
    await expectConverged([a, b]);
    expect(a.engine.status()).toBe('connected');
    expect(a.engine.confirmedState().seats.s0!.life).toBe(14);
    old.leave();
    await until(() => a.engine.versionMismatch?.() == null && b.engine.versionMismatch?.() == null, 10_000, 'the notice to go');
  });

  it('peer loss: the mismatched page is killed and comes back; the notice follows its connection', async () => {
    const sim = makeSim({ engines: 1, seats: 2, seed: 6, delay: { min: 5, max: 60 } });
    const [a] = sim.peers as [SimPeer];
    oldPage(sim.net, 'tv', PROTOCOL_VERSION - 1);
    await until(() => a.engine.versionMismatch?.() != null, 20_000, 'the mismatch');
    sim.net.kill('tv');
    await until(() => a.engine.versionMismatch?.() == null, 10_000, 'the notice to go with the connection');
    expect(a.engine.status()).toBe('alone');
    sim.net.revive('tv');
    await until(() => a.engine.versionMismatch?.() != null, 20_000, 'the mismatch again');
    expect(a.engine.status()).toBe('versionMismatch');
  });
});

describe('sessions and a page of another protocol version', () => {
  beforeEach(() => {
    vi.useFakeTimers(FAKE_TIMERS);
  });

  it('a browser that opens the link while only a page of another version is in the room is told why, never seated alone in silence', async () => {
    const network = sessionNet();
    oldPage(network, 'told', PROTOCOL_VERSION - 1, 'Anna');
    const ben = await browser('ben', 'p-ben');
    const p = openNetSession(
      { game: mtg, cardData: cards(), roomId: ROOM, roomKey: KEY, transport: () => network.create(ben.peerId), identity: ben.identity, store: ben.stores.tables },
      { nonces: ben.nonces, loneWaitMs: 3000 },
    );
    const err = await settle(p.then(() => null, (e: unknown) => e as Error), 60_000, 'the join to end');
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain(`version ${PROTOCOL_VERSION - 1}`);
    expect(err!.message).toContain(`version ${PROTOCOL_VERSION}`);
    expect(err!.message).toContain('Anna');
    expect(err!.message).toMatch(/wait for the table to update/);
  });

  it('the creator of a room sits down and shows the notice in its log; its save records the protocol version', async () => {
    const network = sessionNet();
    const anna = await browser('anna', 'p-anna');
    const s = await open(network, anna, { createdHere: true });
    oldPage(network, 'tben', PROTOCOL_VERSION + 1, 'Ben');
    await settle(
      new Promise<void>((resolve) => {
        const check = (): void => (s.engine.versionMismatch?.() ? resolve() : void setTimeout(check, 20));
        check();
      }),
      20_000,
      'the mismatch',
    );
    const line = s.log().find((e) => e.kind === 'system' && e.text.startsWith('Version mismatch'));
    expect(line && line.kind === 'system' ? line.text : '').toMatch(/This page is older: reload it after the game/);
    s.dispatch({ type: 'chat', text: 'hello', channel: 'table' });
    await settle(s.whenSaved(), 10_000, 'the save');
    const saved = await anna.stores.tables.loadTable(ROOM);
    expect(saved?.table.protocol).toBe(PROTOCOL_VERSION);
    s.leave();
  });

  it('reopening a room a newer Spellplane saved says so in the log, naming both versions', async () => {
    const network = sessionNet();
    const anna = await browser('anna', 'p-anna');
    const s = await open(network, anna, { createdHere: true });
    s.dispatch({ type: 'chat', text: 'hello', channel: 'table' });
    await settle(s.whenSaved(), 10_000, 'the save');
    s.leave();
    const rec = (await anna.stores.tables.loadTable(ROOM))!.table;
    await anna.stores.tables.saveSnapshot({ ...rec, protocol: PROTOCOL_VERSION + 1 }, null);
    const again = await open(network, anna, { createdHere: true });
    const line = again.log().find((e) => e.kind === 'system' && e.text.includes(`version ${PROTOCOL_VERSION + 1}`));
    expect(line && line.kind === 'system' ? line.text : '').toContain(`version ${PROTOCOL_VERSION}`);
    again.leave();
  });
});
