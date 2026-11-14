/**
 * The presence channel (DESIGN "Multiplayer architecture": pointer position, the card being dragged, who is typing or
 * speaking travel on the unreliable channel and are never logged; net/types.ts PRESENCE_INTERVAL_MS throttling and
 * the per-sender counter `n` that drops stale messages).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PresenceMessage } from '../../../src/net/messages';
import { PresenceChannel } from '../../../src/net/presence';
import { PRESENCE_INTERVAL_MS, type PeerPresence } from '../../../src/net/types';
import { PROTOCOL_VERSION } from '../../../src/net/messages';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function channel(): { p: PresenceChannel; sent: PresenceMessage[] } {
  const sent: PresenceMessage[] = [];
  const p = new PresenceChannel({ send: (m) => sent.push(m), now: () => Date.now() });
  return { p, sent };
}

describe('presence: sending', () => {
  it('throttles cursor updates to one per interval and always sends the last value', async () => {
    const { p, sent } = channel();
    p.cursor({ x: 1, y: 1 });
    for (let i = 2; i <= 10; i++) {
      await vi.advanceTimersByTimeAsync(5);
      p.cursor({ x: i, y: i }, 'card-1');
    }
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ t: 'cursor', at: { x: 10, y: 10 }, over: 'card-1' });
    await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS * 4);
    expect(sent).toHaveLength(2);
  });

  it('numbers every message so receivers can drop stale ones', () => {
    const { p, sent } = channel();
    p.speaking(true);
    p.typing('table');
    p.captionInterim('hello', { kind: 'seat', id: 's0' });
    expect(sent.map((m) => m.n)).toEqual([1, 2, 3]);
  });

  it('sends the end of a drag at once, even inside the throttle window', async () => {
    const { p, sent } = channel();
    p.drag([{ id: 'c1', pose: { x: 0, y: 0, rot: 0 } }]);
    await vi.advanceTimersByTimeAsync(10);
    p.drag([{ id: 'c1', pose: { x: 5, y: 0, rot: 0 } }]);
    p.drag([]);
    expect(sent.map((m) => (m.t === 'drag' ? m.cards.length : -1))).toEqual([1, 0]);
    await vi.advanceTimersByTimeAsync(PRESENCE_INTERVAL_MS * 2);
    expect(sent).toHaveLength(2);
  });

  it('copies poses, so later changes by the caller do not leak into a queued message', async () => {
    const { p, sent } = channel();
    const pose = { x: 1, y: 2, rot: 0 };
    p.drag([{ id: 'c1', pose }]);
    pose.x = 99;
    expect(sent[0]).toMatchObject({ cards: [{ id: 'c1', pose: { x: 1, y: 2, rot: 0 } }] });
  });
});

describe('presence: receiving', () => {
  it('keeps each peer’s latest state and drops messages older than the last applied', () => {
    const { p } = channel();
    const seen: PeerPresence[][] = [];
    p.subscribe((peers) => seen.push(peers));
    const who = { peerId: 'peer1', seat: 's1' };
    p.receive('t1', who, { v: PROTOCOL_VERSION, t: 'cursor', n: 2, at: { x: 5, y: 6 }, over: null });
    p.receive('t1', who, { v: PROTOCOL_VERSION, t: 'cursor', n: 1, at: { x: 0, y: 0 }, over: null });
    p.receive('t1', who, { v: PROTOCOL_VERSION, t: 'typing', n: 3, channel: 'table' });
    p.receive('t1', who, { v: PROTOCOL_VERSION, t: 'drag', n: 4, cards: [{ id: 'c9', pose: { x: 1, y: 1, rot: 90 } }] });
    p.receive('t1', who, { v: PROTOCOL_VERSION, t: 'speaking', n: 5, on: true });
    p.receive('t1', who, { v: PROTOCOL_VERSION, t: 'captionInterim', n: 6, text: 'bolt', anchor: null });
    expect(p.peers()).toEqual([
      expect.objectContaining({ peerId: 'peer1', seat: 's1', cursor: { x: 5, y: 6 }, typing: 'table', drag: [{ id: 'c9', pose: { x: 1, y: 1, rot: 90 } }], speaking: true, caption: { text: 'bolt', anchor: null } }),
    ]);
    expect(seen).toHaveLength(5);
    p.receive('t1', who, { v: PROTOCOL_VERSION, t: 'captionInterim', n: 7, text: null, anchor: null });
    expect(p.peers()[0]!.caption).toBeNull();
  });

  it('forgets a peer that left and relabels one that changed seat', () => {
    const { p } = channel();
    p.receive('t1', { peerId: 'peer1', seat: null }, { v: PROTOCOL_VERSION, t: 'cursor', n: 1, at: { x: 1, y: 1 }, over: null });
    p.relabel('t1', 'peer1', 's2');
    expect(p.peers()[0]!.seat).toBe('s2');
    p.forget('t1');
    expect(p.peers()).toEqual([]);
  });

  it('stops notifying after unsubscribe', () => {
    const { p } = channel();
    const calls: number[] = [];
    const off = p.subscribe((peers) => calls.push(peers.length));
    p.receive('t1', { peerId: 'a', seat: null }, { v: PROTOCOL_VERSION, t: 'speaking', n: 1, on: true });
    off();
    p.receive('t1', { peerId: 'a', seat: null }, { v: PROTOCOL_VERSION, t: 'speaking', n: 2, on: false });
    expect(calls).toEqual([1]);
  });
});
