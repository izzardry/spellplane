/**
 * PLAN M3-P3: the session's voice host (session/voice.ts) reads the session's current engine and transport, which the
 * session replaces when it gives up a table it started alone (session/net.ts rejoin): audio goes out on the current
 * transport, a stream from a dropped transport is ignored, and the speaking presence follows the current engine.
 */
import { describe, expect, it } from 'vitest';
import type { PeerId, Transport } from '../../../src/net/transport';
import type { NetEngine, PeerPresence } from '../../../src/net/types';
import { latestTransport, voiceWiring, type VoicePort } from '../../../src/session/voice';
import { FakeMedia, MemorySettingsStore, table } from './fakes';

function transport(id: string) {
  const handlers: ((s: MediaStream, from: PeerId) => void)[] = [];
  const added: [unknown, PeerId | undefined][] = [];
  const t = {
    selfId: id,
    addStream: (s: MediaStream, to?: PeerId) => added.push([s, to]),
    removeStream: () => undefined,
    onStream: (h: (s: MediaStream, from: PeerId) => void) => handlers.push(h),
  } as unknown as Transport;
  return { t, added, emit: (s: unknown, from: PeerId) => handlers.forEach((h) => h(s as MediaStream, from)) };
}

function engine(name: string) {
  const said: boolean[] = [];
  const listeners = new Set<(p: PeerPresence[]) => void>();
  const e = {
    name,
    peers: () => [],
    seat: () => 's0',
    presence: {
      speaking: (on: boolean) => said.push(on),
      peers: () => [],
      subscribe: (l: (p: PeerPresence[]) => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    },
  } as unknown as NetEngine;
  return { e, said, listeners };
}

describe('the session voice host', () => {
  it('follows the current engine and transport across a rejoin', () => {
    const t1 = transport('a');
    const t2 = transport('b');
    let current = t1.t;
    const factory = latestTransport(() => current);
    factory.make();
    const e1 = engine('one');
    const e2 = engine('two');
    let eng = e1.e;
    const net = new Set<() => void>();
    const port: VoicePort = {
      engine: () => eng,
      transport: factory.current,
      state: () => table('1v1'),
      subscribe: () => () => undefined,
      subscribeNet: (l) => {
        net.add(l);
        return () => net.delete(l);
      },
    };
    const { host, presence } = voiceWiring(port, { media: new FakeMedia(), settings: new MemorySettingsStore(), engines: [] });
    const got: [unknown, PeerId][] = [];
    host.transport.onStream!((s, from) => got.push([s, from]));
    host.onPeers(() => undefined);
    const presenceSeen: number[] = [];
    presence.subscribe(() => presenceSeen.push(1));

    host.transport.addStream!({} as MediaStream, 'p1');
    t1.emit('s1', 'p1');
    host.presence.speaking(true);
    expect(t1.added).toHaveLength(1);
    expect(got).toEqual([['s1', 'p1']]);
    expect(e1.said).toEqual([true]);
    expect(host.transport.selfId).toBe('a');

    // The session makes a new engine over a new transport and tells its net listeners.
    current = t2.t;
    factory.make();
    eng = e2.e;
    for (const l of net) l();
    host.transport.addStream!({} as MediaStream, 'p2');
    expect(t2.added).toHaveLength(1);
    expect(t1.added).toHaveLength(1);
    expect(host.transport.selfId).toBe('b');
    t1.emit('late', 'p1');
    t2.emit('s2', 'p2');
    expect(got).toEqual([
      ['s1', 'p1'],
      ['s2', 'p2'],
    ]);
    host.presence.speaking(false);
    expect(e2.said).toEqual([false]);
    // Presence listeners moved to the new engine.
    expect(e1.listeners.size).toBe(0);
    for (const l of e2.listeners) l([]);
    expect(presenceSeen).toEqual([1]);
    expect(host.seat()).toBe('s0');
  });
});
