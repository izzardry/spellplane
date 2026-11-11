/**
 * Joining and leaving race-free (net/engine.ts Engine.join/leave, net/trystero.ts TrysteroTransport): a leave that
 * runs while the transport is still joining must not leave a room open behind it.
 */
import { describe, expect, it, vi } from 'vitest';
import { createNetEngine } from '../../../src/net/engine';
import type { Channel, Message, MessageHandler, PeerHandler, PeerId, Transport } from '../../../src/net/transport';
import { TrysteroTransport } from '../../../src/net/trystero';
import { fakeNetIdentity } from '../../sim/net/fake-identity';
import { baseTable } from '../../sim/net/sim';
import { TEST_GAME } from '../core/helpers';

const joinRoom = vi.fn();
vi.mock('trystero/nostr', () => ({ selfId: 'self-x', joinRoom: (...args: unknown[]) => joinRoom(...args) }));

/** A transport whose join completes only when the test says so; it counts open rooms. */
class SlowTransport implements Transport {
  readonly selfId: PeerId = 't-slow';
  open = false;
  private release: (() => void) | null = null;
  join(): Promise<void> {
    return new Promise((resolve) => {
      this.release = () => {
        this.open = true;
        resolve();
      };
    });
  }
  finishJoin(): void {
    this.release?.();
  }
  leave(): void {
    this.open = false;
  }
  peers(): PeerId[] {
    return [];
  }
  send(_c: Channel, _m: Message, _to?: PeerId): void {}
  on(_c: Channel, _h: MessageHandler): void {}
  onPeer(_h: PeerHandler): void {}
}

describe('join and leave', () => {
  it('an engine left while its transport was joining leaves the transport once the join completes', async () => {
    const transport = new SlowTransport();
    const engine = createNetEngine({
      transport,
      roomId: 'amber-fox-93',
      roomKey: 'k',
      identity: fakeNetIdentity('peer0'),
      game: TEST_GAME,
      start: { snapshot: baseTable(2), tail: [] },
    });
    const joined = engine.join();
    engine.leave();
    transport.finishJoin();
    await joined;
    expect(transport.open).toBe(false);
    expect(engine.status()).toBe('closed');
  });

  it('a Trystero transport left while Trystero was loading opens no room', async () => {
    joinRoom.mockReset();
    const t = new TrysteroTransport();
    const joining = t.join('amber-fox-93', 'k');
    t.leave();
    await joining;
    expect(joinRoom).not.toHaveBeenCalled();
    expect(t.peers()).toEqual([]);
  });

  it('a Trystero transport joins one room even when join is called twice', async () => {
    joinRoom.mockReset();
    const room = { makeAction: () => ({ send: () => Promise.resolve(), onMessage: null }), leave: vi.fn(() => Promise.resolve()), addStream: vi.fn() };
    joinRoom.mockReturnValue(room);
    const t = new TrysteroTransport();
    await Promise.all([t.join('amber-fox-93', 'k'), t.join('amber-fox-93', 'k')]);
    expect(joinRoom).toHaveBeenCalledTimes(1);
    expect(t.selfId).toBe('self-x');
    t.leave();
    expect(room.leave).toHaveBeenCalledTimes(1);
  });
});
