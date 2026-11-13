/**
 * TrysteroTransport's peer events around a page unload (net/trystero.ts), on a stand-in for Trystero's room (tests
 * never use the network). Trystero leaves its rooms on `beforeunload` and closes the peer connections ~100 ms later,
 * reporting each as a peer that left; the page's own engine must not hear those (M4 gate finding, see
 * tests/sim/net/reload.test.ts), while a peer that leaves at any other time is reported as before.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

interface FakeRoom {
  onPeerJoin: ((peer: string) => void) | null;
  onPeerLeave: ((peer: string) => void) | null;
  onPeerStream: unknown;
  makeAction: () => { send: () => Promise<void>; onMessage: unknown };
  leave: () => Promise<void>;
}
const rooms: FakeRoom[] = [];

vi.mock('trystero/nostr', () => ({
  selfId: 'self',
  joinRoom: (): FakeRoom => {
    const room: FakeRoom = {
      onPeerJoin: null,
      onPeerLeave: null,
      onPeerStream: null,
      makeAction: () => ({ send: () => Promise.resolve(), onMessage: null }),
      leave: () => Promise.resolve(),
    };
    rooms.push(room);
    return room;
  },
}));

const { TrysteroTransport } = await import('../../../src/net/trystero');

afterEach(() => {
  vi.unstubAllGlobals();
  rooms.length = 0;
});

async function joined(): Promise<{ t: InstanceType<typeof TrysteroTransport>; room: FakeRoom; window: EventTarget; events: string[] }> {
  const window = new EventTarget();
  vi.stubGlobal('addEventListener', window.addEventListener.bind(window));
  vi.stubGlobal('removeEventListener', window.removeEventListener.bind(window));
  const t = new TrysteroTransport();
  const events: string[] = [];
  t.onPeer((ev, p) => events.push(`${ev}:${p}`));
  await t.join('room', 'key');
  const room = rooms.at(-1)!;
  room.onPeerJoin!('a');
  room.onPeerJoin!('b');
  return { t, room, window, events };
}

describe('TrysteroTransport around a page unload', () => {
  it('a peer that leaves is reported', async () => {
    const { t, room, events } = await joined();
    room.onPeerLeave!('a');
    expect(events).toEqual(['join:a', 'join:b', 'leave:a']);
    expect(t.peers()).toEqual(['b']);
  });

  it('once the page unloads, the connections Trystero closes are not reported as peers leaving', async () => {
    const { t, room, window, events } = await joined();
    window.dispatchEvent(new Event('beforeunload'));
    room.onPeerLeave!('a');
    room.onPeerLeave!('b');
    expect(events).toEqual(['join:a', 'join:b']);
    expect(t.peers()).toEqual([]);
  });

  it('an explicit leave still reports every peer gone', async () => {
    const { t, window, events } = await joined();
    t.leave();
    expect(events).toEqual(['join:a', 'join:b', 'leave:a', 'leave:b']);
    // Its unload listener went with it.
    window.dispatchEvent(new Event('beforeunload'));
    expect(events).toHaveLength(4);
  });
});
