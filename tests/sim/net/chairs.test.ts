/**
 * Moving chairs through the sequencer (DESIGN "Players, seats and formats": chair selection in the lobby;
 * "Specification: network protocol and secrecy", Sequencing 3 and Handshake: the sequencer rejects any propose whose
 * `by` is not the sender's seat). A player who moves holds two chairs for a moment: it takes the new chair, then
 * leaves the old one. Review round 3 found two ways this broke; both probes are kept here as regression tests, and a
 * third test drives the move through M1-P5's real stamping (src/ui/lobby/local-session.ts `takeSeat`), so the lobby
 * and the sequencer cannot drift apart again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { reduce } from '../../../src/core/reducer';
import type { SeatId, TableState } from '../../../src/core/types';
import { mtg } from '../../../src/games/index';
import type { Channel, Message, MessageHandler, PeerHandler, PeerId, Transport } from '../../../src/net/transport';
import { FakeCardData } from '../../../src/ui/fakes';
import { createLocalSession, type LocalSession } from '../../../src/ui/lobby/local-session';
import { agreed, baseTable, expectConverged, makeSim, until, type Sim, type SimPeer } from './sim';

vi.mock('../../../src/net/identity', async () => (await import('./fake-identity')).fakeIdentityModule);

const DELAY = { delay: { min: 5, max: 40 } };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** The reviewer's table: baseTable(4) with s1 freed; peer0 at s0 (the sequencer), peer2 at s2, peer3 at s3. */
async function freedS1(seed: number): Promise<{ sim: Sim; a: SimPeer; c: SimPeer; d: SimPeer; free: { seq: number; state: TableState } }> {
  const base = baseTable(4);
  const free = { seq: base.seq + 1, state: reduce(base.state, { type: 'seatLeave', by: 's1', cid: 'free-s1', seat: 's1', seq: base.seq + 1 }) };
  const sim = makeSim({ engines: 0, seed, start: free, ...DELAY });
  const [a, c, d] = [sim.add(0, free), sim.add(2, free), sim.add(3, free)];
  await until(() => agreed(sim.peers), 20_000, 'connection');
  return { sim, a, c, d, free };
}

const holders = (s: TableState): (string | undefined)[] => ['s0', 's1', 's2', 's3'].map((id) => s.seats[id]!.peer);

function noRollbacks(sim: Sim): void {
  for (const p of sim.peers) expect(p.rolledBack, p.peerId).toEqual(new Map());
}

describe('review round 3 probe: moving chairs', () => {
  it('M1-P5 stamping (take as the new chair, then leave the old one): down, then up, and the old chair is free for others', async () => {
    const { sim, a, c, d } = await freedS1(31);
    // Down: peer3 moves s3 -> s1.
    expect(d.engine.propose({ type: 'seatTake', by: 's1', cid: 'down-take', seat: 's1', name: 'P3', colour: 3, peer: 'peer3', group: 'down' })).toBe(true);
    expect(d.engine.propose({ type: 'seatLeave', by: 's3', cid: 'down-leave', seat: 's3', group: 'down' })).toBe(true);
    await expectConverged(sim.peers);
    noRollbacks(sim);
    for (const p of sim.peers) expect(holders(p.engine.confirmedState()), p.peerId).toEqual(['peer0', 'peer3', 'peer2', undefined]);
    expect(d.engine.seat()).toBe('s1');
    // The chair it left is really free: another player moves into it.
    expect(c.engine.propose({ type: 'seatTake', by: 's3', cid: 'c-take', seat: 's3', name: 'P2', colour: 2, peer: 'peer2', group: 'c' })).toBe(true);
    expect(c.engine.propose({ type: 'seatLeave', by: 's2', cid: 'c-leave', seat: 's2', group: 'c' })).toBe(true);
    await expectConverged(sim.peers);
    noRollbacks(sim);
    // Up: peer3 moves s1 -> s2 (the chair peer2 just left).
    expect(d.engine.propose({ type: 'seatTake', by: 's2', cid: 'up-take', seat: 's2', name: 'P3', colour: 3, peer: 'peer3', group: 'up' })).toBe(true);
    expect(d.engine.propose({ type: 'seatLeave', by: 's1', cid: 'up-leave', seat: 's1', group: 'up' })).toBe(true);
    await expectConverged(sim.peers);
    noRollbacks(sim);
    for (const p of sim.peers) expect(holders(p.engine.confirmedState()), p.peerId).toEqual(['peer0', undefined, 'peer3', 'peer2']);
    // Each plays from its new chair.
    d.engine.propose({ type: 'life', by: 's2', cid: 'd-life', seat: 's2', delta: -2 });
    c.engine.propose({ type: 'life', by: 's3', cid: 'c-life', seat: 's3', delta: -3 });
    await expectConverged(sim.peers);
    noRollbacks(sim);
    expect(a.engine.state().seats.s2!.life).toBe(18);
    expect(a.engine.state().seats.s3!.life).toBe(17);
  });

  it('the other stamping (take as the current chair, then leave it) moving down leaves the player one chair, not two', async () => {
    const { sim, c, d } = await freedS1(32);
    expect(d.engine.propose({ type: 'seatTake', by: 's3', cid: 'take', seat: 's1', name: 'P3', colour: 3, peer: 'peer3' })).toBe(true);
    await expectConverged(sim.peers);
    // peer3 now holds s1 and s3; the first chair in seat order is s1, yet it may still leave s3 as s3.
    expect(d.engine.propose({ type: 'seatLeave', by: 's3', cid: 'leave', seat: 's3' })).toBe(true);
    await expectConverged(sim.peers);
    noRollbacks(sim);
    for (const p of sim.peers) expect(holders(p.engine.confirmedState()), p.peerId).toEqual(['peer0', 'peer3', 'peer2', undefined]);
    // And nobody else can act as, or leave, a chair the sender does not hold.
    expect(c.engine.propose({ type: 'seatLeave', by: 's1', cid: 'c-leaves-s1', seat: 's1' })).toBe(true);
    await expectConverged(sim.peers);
    expect(c.rolledBack.get('c-leaves-s1')).toMatch(/not the sender's seat/);
    expect(holders(c.engine.confirmedState())).toEqual(['peer0', 'peer3', 'peer2', undefined]);
  });
});

/**
 * A transport that only listens to what M1-P5's stand-in session sends: the session sees one other page ('room')
 * that ranks first (a lower peer id at the same seq), so it proposes to it instead of applying anything itself.
 */
class Tap implements Transport {
  readonly selfId: PeerId = 'tap';
  readonly sent: { channel: Channel; msg: Message }[] = [];
  private readonly handlers = new Map<Channel, MessageHandler[]>();
  join(): Promise<void> {
    return Promise.resolve();
  }
  leave(): void {}
  peers(): PeerId[] {
    return ['room'];
  }
  send(channel: Channel, msg: Message): void {
    this.sent.push({ channel, msg });
  }
  on(channel: Channel, handler: MessageHandler): void {
    this.handlers.set(channel, [...(this.handlers.get(channel) ?? []), handler]);
  }
  onPeer(_handler: PeerHandler): void {}
  deliver(channel: Channel, msg: Message): void {
    for (const h of this.handlers.get(channel) ?? []) h(msg, 'room');
  }
}

/** M1-P5's stand-in session for `p`, kept in step with `p`'s confirmed table, and the actions its takeSeat stamps. */
async function lobbyOf(p: SimPeer): Promise<{ session: LocalSession; takeSeat(seat: SeatId): Action[] }> {
  const tap = new Tap();
  const show = (): void => {
    const state = p.engine.confirmedState();
    tap.deliver('ctl', { v: 1, t: 'lxHello', peerId: '0room', nickname: '', seq: state.seq });
    tap.deliver('act', { v: 1, t: 'lxState', peerId: '0room', state, action: null });
  };
  const pending = createLocalSession({
    game: mtg,
    cardData: new FakeCardData(),
    roomId: 'amber-fox-93',
    roomKey: 'k',
    transport: tap,
    identity: { peerId: p.peerId, nickname: `P${p.index}`, seatColour: p.index },
    settleMs: 10,
  });
  show();
  await vi.advanceTimersByTimeAsync(20);
  const session = await pending;
  return {
    session,
    takeSeat(seat) {
      show();
      expect(session.seat, 'the stand-in sees the chair this peer holds').toBe(p.engine.seat());
      const from = tap.sent.length;
      session.takeSeat(seat, p.index);
      return tap.sent
        .slice(from)
        .filter((m) => m.msg.t === 'lxPropose')
        .map((m) => (m.msg as unknown as { action: Action }).action);
    },
  };
}

describe('chair moves with M1-P5’s real stamping (local-session.ts takeSeat)', () => {
  it('a follower moves down and up and the sequencer moves up; every stamped action is sequenced, none refused', async () => {
    const { sim, a, d } = await freedS1(33);
    const lobbyD = await lobbyOf(d);
    const lobbyA = await lobbyOf(a);
    const move = async (p: SimPeer, lobby: Awaited<ReturnType<typeof lobbyOf>>, to: SeatId): Promise<Action[]> => {
      const actions = lobby.takeSeat(to);
      expect(actions.map((x) => x.type)).toEqual(['seatTake', 'seatLeave']);
      for (const x of actions) expect(p.engine.propose(x), `${x.type} ${x.by}`).toBe(true);
      await expectConverged(sim.peers);
      return actions;
    };

    const down = await move(d, lobbyD, 's1');
    // M1-P5 stamps the take as the chair taken (by = new seat) and the leave as the chair left.
    expect(down[0]).toMatchObject({ type: 'seatTake', seat: 's1', by: 's1', peer: 'peer3' });
    expect(down[1]).toMatchObject({ type: 'seatLeave', seat: 's3', by: 's3' });
    expect(holders(d.engine.confirmedState())).toEqual(['peer0', 'peer3', 'peer2', undefined]);

    await move(d, lobbyD, 's3');
    expect(holders(d.engine.confirmedState())).toEqual(['peer0', undefined, 'peer2', 'peer3']);

    await move(a, lobbyA, 's1'); // the sequencer itself moves up: it keeps the lowest chair index, so it still sequences
    expect(holders(d.engine.confirmedState())).toEqual([undefined, 'peer0', 'peer2', 'peer3']);
    await until(() => agreed(sim.peers) && a.engine.isSequencing(), 20_000, 'the sequencer at s1');

    await move(d, lobbyD, 's0'); // a follower takes the lowest chair: it becomes the sequencer
    expect(holders(d.engine.confirmedState())).toEqual(['peer3', 'peer0', 'peer2', undefined]);
    await until(() => agreed(sim.peers) && d.engine.isSequencing(), 20_000, 'handover to the lowest chair');

    noRollbacks(sim);
    for (const p of sim.peers) expect(p.engine.seat(), p.peerId).toBe(['s1', 's2', 's0'][sim.peers.indexOf(p)]);
    lobbyA.session.leave();
    lobbyD.session.leave();
  });
});
