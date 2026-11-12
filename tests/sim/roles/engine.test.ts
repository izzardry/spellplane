/**
 * PLAN M3-P5 at the engine level on the simulated network (CLAUDE.md: every protocol feature gets a simulated-network
 * test with delay, drop, reordering and peer loss): the spectator branch of `sendPrivate` and of the sequencer's check
 * (DESIGN "Players, seats and formats", Spectators; "Specification: network protocol and secrecy", Sequencing 1 and 3,
 * the channel table: `prv` is one pair only). The base table seats peer0..peer3; a spectator page may run under the key
 * pair of a seated peer, which must not make it that seat.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { spectatorIdOf } from '../../../src/core/teams';
import type { PrivateMessage } from '../../../src/net/messages';
import { spectatorsOf } from '../../../src/net/roles';
import { scan } from '../../leak/scan';
import { agreed, expectConverged, libraryIds, makeSim, until, type SimPeer } from '../net/sim';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

const FAULTS = { delay: { min: 5, max: 300 }, drop: 0.05, faultyChannels: ['act', 'ctl', 'pres'] as ('act' | 'ctl' | 'pres')[] };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const tid = (p: SimPeer): string => p.transport.selfId;
const secret = { instanceId: libraryIds(1)[5]!, ref: { sid: 'secret-sid-777' }, salt: 'secret-salt-777' };
const reveal = (about: string): PrivateMessage => ({ v: 1, t: 'reveal', ...secret, purpose: 'revealTo', about });

/** Players peer1 and peer2 (seats s1, s2); spectator pages under peer4 (no chair) and peer0 (s0's key pair); s3's peer is absent. */
async function room(seed: number) {
  const sim = makeSim({ engines: 0, seed, ...FAULTS });
  const b = sim.add(1);
  const c = sim.add(2);
  const watcher = sim.add(4, undefined, 'spectator');
  const holder = sim.add(0, undefined, 'spectator');
  await until(() => agreed(sim.peers) && b.engine.peers().filter((p) => p.status === 'connected').length === 3, 30_000, 'connection');
  return { sim, b, c, watcher, holder };
}

describe('spectators on the engine', () => {
  it('a spectator page holds no chair and is never the sequencer, even under a seated key pair', async () => {
    const { b, c, watcher, holder } = await room(51);
    for (const v of [watcher, holder]) {
      expect(v.engine.seat()).toBeNull();
      expect(v.engine.isSequencer()).toBe(false);
    }
    expect(b.engine.sequencerId()).toBe('peer1');
    for (const p of [b, c]) {
      const specs = p.engine.peers().filter((x) => x.role === 'spectator');
      expect(specs.map((x) => [x.peerId, x.seat]).sort()).toEqual([
        ['peer0', null],
        ['peer4', null],
      ]);
      expect(spectatorsOf(p.engine.peers()).map((s) => s.id)).toEqual([spectatorIdOf('peer0'), spectatorIdOf('peer4')]);
    }
    // A chair whose key pair only watches is away for the table: nobody plays it.
    await until(() => b.engine.confirmedState().seats.s0?.away === true, 30_000, 'the watched chair to be away');
  });

  it('a targeted reveal reaches exactly the named spectator; a seat’s messages never reach a spectator page', async () => {
    const { sim, b, c, watcher, holder } = await room(52);
    const got = new Map<string, { t: string; seat: string | null }[]>();
    for (const p of [c, watcher, holder]) p.engine.onPrivate((m, from) => got.set(p.peerId, [...(got.get(p.peerId) ?? []), { t: m.t, seat: from.seat }]));

    expect(b.engine.sendPrivate(spectatorIdOf('peer4'), reveal('r1'))).toBe(true);
    // Not to an unknown spectator, not as anything but a targeted reveal, and a chair whose key pair only watches has no page.
    expect(b.engine.sendPrivate(spectatorIdOf('peer9'), reveal('r2'))).toBe(false);
    expect(b.engine.sendPrivate(spectatorIdOf('peer4'), { ...reveal('r3'), purpose: 'look' } as PrivateMessage)).toBe(false);
    expect(b.engine.sendPrivate(spectatorIdOf('peer4'), { v: 1, t: 'pack', packId: 'p', cards: [secret] })).toBe(false);
    // A spectator whose key pair holds a chair is not a target either: the chair's identities belong to its player page.
    expect(b.engine.sendPrivate(spectatorIdOf('peer0'), reveal('r7'))).toBe(false);
    expect(b.engine.sendPrivate('s3', reveal('r4'))).toBe(false);
    expect(b.engine.sendPrivate('s0', reveal('r5'))).toBe(false);
    // A spectator id of a seated player is not that player's page.
    expect(b.engine.sendPrivate(spectatorIdOf('peer2'), reveal('r6'))).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(got.get('peer4')).toEqual([{ t: 'reveal', seat: 's1' }]);
    expect(got.get('peer0')).toBeUndefined();
    expect(got.get('peer2')).toBeUndefined();
    for (const p of [c, holder]) {
      const toP = sim.net.delivered.filter((d) => d.to === tid(p));
      expect(scan([toP, p.engine.messages(), p.engine.state()], ['secret-sid-777', 'secret-salt-777'])).toEqual([]);
    }
  });

  it('the pair channel of a spectator speaks for no seat, so players drop what it sends there', async () => {
    const { b, holder } = await room(53);
    const seen: (string | null)[] = [];
    b.engine.onPrivate((_m, from) => seen.push(from.seat));
    // holder's key pair is s0's: anything it sends on prv arrives without a seat.
    holder.transport.send('prv', { v: 1, t: 'lookReq', lookId: 'l1', zone: 'library:s1', count: 2 } as never, tid(b));
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual([null]);
  });

  it('under loss and reordering a spectator’s card actions are nacked and its chat and ping are sequenced', async () => {
    const { b, c, watcher, holder } = await room(54);
    const me = spectatorIdOf('peer4');
    const pub = libraryIds(1)[0]!;
    const tries: Action[] = [
      { type: 'tap', by: me, cid: 'w-tap', card: pub, tapped: true },
      { type: 'move', by: me, cid: 'w-move', card: pub, to: 'battlefield:s1', pose: { x: 1, y: 2, rot: 0 } },
      { type: 'life', by: me, cid: 'w-life', seat: 's1', delta: -1 },
      // In a seat's name.
      { type: 'life', by: 's3', cid: 'w-as-s3', seat: 's3', delta: -1 },
      // As another spectator, or under another name than its handshake nickname (P4): the engine checks the identity
      // before the sequencer (net/engine.ts senderPeerCheck), so neither reaches the log.
      { type: 'chat', by: spectatorIdOf('peer9'), cid: 'w-as-other', text: 'hi', channel: 'spectator', name: 'P4' },
      { type: 'chat', by: me, cid: 'w-as-anna', text: 'hi', channel: 'table', name: 'Anna' },
    ];
    for (const a of tries) watcher.engine.propose(a);
    holder.engine.propose({ type: 'tap', by: 's0', cid: 'h-tap', card: libraryIds(0)[0]!, tapped: true });
    watcher.engine.propose({ type: 'chat', by: me, cid: 'w-chat', text: 'hi', channel: 'spectator', name: 'P4' });
    watcher.engine.propose({ type: 'ping', by: me, cid: 'w-ping', target: { kind: 'card', id: pub } });
    await expectConverged([b, c, watcher, holder]);
    for (const a of tries) expect(watcher.rolledBack.get(a.cid), a.cid).toMatch(/spectator/);
    expect(watcher.rolledBack.get('w-as-other')).toMatch(/acts as v:peer4 only/);
    expect(watcher.rolledBack.get('w-as-anna')).toMatch(/nickname it joined with/);
    // A spectator page under s0's key pair still cannot act for s0.
    expect(holder.rolledBack.get('h-tap')).toMatch(/spectator may chat and ping only/);
    const cids = [...b.log.values()].map((a) => a.cid);
    expect(cids).toContain('w-chat');
    expect(cids).toContain('w-ping');
    for (const a of [...tries.map((t) => t.cid), 'h-tap']) expect(cids).not.toContain(a);
  });
});
