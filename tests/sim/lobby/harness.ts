/**
 * Lobby simulations (M8-P7): N LobbyRooms on a LoopbackNetwork under Vitest fake timers, with the fake identity of
 * tests/sim/net/fake-identity.ts (test files `vi.mock('../../../src/net/identity', …)` themselves). Each seeker ticks
 * every 250 ms and may answer the ready check by itself.
 */
import { vi } from 'vitest';
import type { Band, QueueId } from '../../../src/core/types';
import type { BrokerEffect, FormedMatch } from '../../../src/net/lobby/broker';
import { LobbyRoom, type TicketDraft } from '../../../src/net/lobby/room';
import { LoopbackNetwork, type LoopbackOptions, type LoopbackTransport } from '../../../src/net/loopback';
import type { Transport } from '../../../src/net/transport';
import { mulberry32 } from '../../../src/util/prng';
import { fakeNetIdentity } from '../net/fake-identity';

export const FAKE_TIMERS = { toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] as ('setTimeout' | 'clearTimeout' | 'setInterval' | 'clearInterval' | 'Date')[] };

export interface Seeker {
  name: string;
  room: LobbyRoom;
  effects: BrokerEffect[];
  formed: FormedMatch[];
  /** Answer the ready check: true accept, false decline, null never. */
  answer: boolean | null;
  timer: ReturnType<typeof setInterval>;
  checks: string[];
}

export function lobbyNet(options: LoopbackOptions = {}): LoopbackNetwork {
  return new LoopbackNetwork({ seed: 11, delay: { min: 5, max: 60 }, ...options });
}

let counter = 0;
/**
 * A transport shaped like Trystero's: its `selfId` is '' until `join` resolved (TrysteroTransport learns it only when
 * the library has loaded on join).
 */
export function lateIdTransport(t: LoopbackTransport): Transport {
  let joined = false;
  return {
    get selfId(): string {
      return joined ? t.selfId : '';
    },
    async join(roomId: string, roomKey: string): Promise<void> {
      await Promise.resolve();
      await t.join(roomId, roomKey);
      joined = true;
    },
    leave: () => t.leave(),
    peers: () => t.peers(),
    send: (channel, msg, to) => t.send(channel, msg, to),
    on: (channel, handler) => t.on(channel, handler),
    onPeer: (handler) => t.onPeer(handler),
  };
}

export function makeSeeker(net: LoopbackNetwork, name: string, opts: { answer?: boolean | null; tid?: string; seed?: number; lateId?: boolean } = {}): Seeker {
  const tid = opts.tid ?? `${name}-${++counter}`;
  const rand = mulberry32(opts.seed ?? counter * 7919);
  const s: Seeker = {
    name,
    effects: [],
    formed: [],
    answer: opts.answer === undefined ? true : opts.answer,
    checks: [],
    timer: setInterval(() => s.room.tick(), 250),
    room: undefined as unknown as LobbyRoom,
  };
  s.room = new LobbyRoom({
    transport: opts.lateId ? lateIdTransport(net.create(tid)) : net.create(tid),
    identity: fakeNetIdentity(`p-${tid}`, name),
    now: () => Date.now(),
    random: (n) => Uint8Array.from({ length: n }, () => Math.floor(rand() * 256)),
    onEffect: (e) => {
      s.effects.push(e);
      if (e.kind === 'formed') s.formed.push(e.match);
      if (e.kind === 'check') {
        s.checks.push(e.mid);
        if (s.answer !== null) {
          const a = s.answer;
          setTimeout(() => s.room.answer(a), 50);
        }
      }
    },
  });
  return s;
}

export function draft(queues: QueueId[], o: { band?: Band; r?: number; open?: boolean; rev?: number; proto?: number } = {}): TicketDraft {
  return {
    name: 'Player',
    proto: o.proto ?? 4,
    queues,
    ratings: { '1v1.constructed': { r: o.r ?? 1500, g: 12 }, '1v1.limited': { r: o.r ?? 1500, g: 12 } },
    band: o.band ?? 3,
    score: 50,
    open: o.open ?? false,
    nat: 'unknown',
    rev: o.rev ?? 1,
  };
}

export async function joinAndSeek(s: Seeker, d: TicketDraft, waitedMs = 0): Promise<void> {
  await s.room.join();
  await s.room.seek(d, waitedMs);
}

export async function advance(ms: number, step = 10): Promise<void> {
  for (let t = 0; t < ms; t += step) await vi.advanceTimersByTimeAsync(step);
}

export async function until(done: () => boolean, maxMs: number, what: string): Promise<number> {
  const start = Date.now();
  for (let t = 0; t <= maxMs; t += 10) {
    if (done()) return Date.now() - start;
    await vi.advanceTimersByTimeAsync(10);
  }
  throw new Error(`timed out waiting for ${what}`);
}

export function stop(seekers: Seeker[]): void {
  for (const s of seekers) {
    clearInterval(s.timer);
    s.room.leave();
  }
}
