/**
 * Simulated-network harness for the M1-P1 acceptance tests (PLAN M1-P1; CLAUDE.md: LoopbackNetwork with seeded delay,
 * drop, reordering and kill/revive, driven by Vitest fake timers). Every engine starts from the same table: four
 * seats held by peer ids peer0..peer3, each seat ready with a hidden library and a few public cards on its
 * battlefield, so random actions have public and hidden cards of every seat to work on.
 */
import { expect, vi } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { canonicalJson } from '../../../src/core/hash';
import { createTable, explain, reduce } from '../../../src/core/reducer';
import { sha256Sync } from '../../../src/core/sha256';
import type { Deadline, SeatId, TableState } from '../../../src/core/types';
import { createNetEngine, type NetEngineImpl } from '../../../src/net/engine';
import { LoopbackNetwork, type LoopbackOptions, type LoopbackTransport } from '../../../src/net/loopback';
import type { SequencedAction } from '../../../src/net/messages';
import type { Channel, Message, MessageHandler, PeerHandler, PeerId, Transport } from '../../../src/net/transport';
import type { PeerRole } from '../../../src/net/messages';
import { TEST_GAME } from '../../unit/core/helpers';
import { fakeNetIdentity } from './fake-identity';

export const ROOM = 'amber-fox-93';
export const KEY = 'room-key';

export const peerIdOf = (i: number): string => `peer${i}`;
export const seatOf = (i: number): SeatId => `s${i}`;

const PREFIX = ['a', 'b', 'c', 'd'];

/** Library ids of seat i. */
export function libraryIds(i: number, n = 12): string[] {
  return Array.from({ length: n }, (_, k) => `${PREFIX[i]}${String(k).padStart(2, '0')}`);
}

function must(state: TableState, a: Action): TableState {
  const why = explain(state, a);
  if (why !== null) throw new Error(`setup action ${a.type} refused: ${why}`);
  return reduce(state, a);
}

/**
 * The common starting table (a snapshot at its last seq): `seats` seats with peers, each ready with 12 hidden
 * library cards, three of them revealed onto its battlefield.
 */
export function baseTable(seats = 4, opts: { format?: '1v1' | 'ffa4' } = {}): { seq: number; state: TableState } {
  let s = createTable({
    game: TEST_GAME,
    format: opts.format ?? (seats === 2 ? '1v1' : 'ffa4'),
    seats: Array.from({ length: seats }, (_, i) => ({ name: `P${i}`, colour: i, peer: peerIdOf(i) })),
  });
  let seq = 0;
  const step = (a: Omit<Action, 'seq'>): void => {
    seq++;
    s = must(s, { ...a, seq } as Action);
  };
  for (let i = 0; i < seats; i++) {
    const ids = libraryIds(i);
    step({ type: 'ready', by: seatOf(i), cid: `setup-ready-${i}`, commits: ids.map((id) => `commit-${id}`), instanceIds: ids, zone: `library:${seatOf(i)}` } as Action);
  }
  for (let i = 0; i < seats; i++) {
    for (let k = 0; k < 3; k++) {
      const id = libraryIds(i)[k]!;
      step({ type: 'reveal', by: seatOf(i), cid: `setup-rev-${id}`, instanceId: id, ref: { sid: `sid-${id}` }, salt: `salt-${id}` } as Action);
      step({ type: 'move', by: seatOf(i), cid: `setup-mv-${id}`, card: id, to: `battlefield:${seatOf(i)}`, pose: { x: -100 + 70 * k, y: 150 * (i % 2 ? -1 : 1), rot: 0 } } as Action);
    }
  }
  return { seq, state: s };
}

/** SHA-256 of the canonical JSON, as the engines exchange it (DESIGN "Specification: network protocol and secrecy", Sync). */
export const hashOf = (s: TableState): string => sha256Sync(canonicalJson(s));

/** A transport wrapper that can fall silent without the network noticing (no leave event): a crash or a dead link. */
export class SilentableTransport implements Transport {
  silent = false;
  /** Drop outgoing messages for which this returns true (targeted loss in protocol tests). */
  dropOut: ((channel: Channel, msg: Message, to: PeerId | undefined) => boolean) | null = null;
  /** Drop incoming messages for which this returns true. */
  dropIn: ((channel: Channel, msg: Message, from: PeerId) => boolean) | null = null;
  constructor(readonly inner: LoopbackTransport) {}
  get selfId(): PeerId {
    return this.inner.selfId;
  }
  join(roomId: string, roomKey: string): Promise<void> {
    return this.inner.join(roomId, roomKey);
  }
  leave(): void {
    this.inner.leave();
  }
  peers(): PeerId[] {
    return this.inner.peers();
  }
  send(channel: Channel, msg: Message, to?: PeerId): void {
    if (this.silent || this.dropOut?.(channel, msg, to)) return;
    this.inner.send(channel, msg, to);
  }
  on(channel: Channel, handler: MessageHandler): void {
    this.inner.on(channel, (m, from) => {
      if (!this.silent && !this.dropIn?.(channel, m, from)) handler(m, from);
    });
  }
  onPeer(handler: PeerHandler): void {
    this.inner.onPeer((ev, p) => {
      if (!this.silent) handler(ev, p);
    });
  }
}

export interface SimPeer {
  index: number;
  peerId: string;
  seat: SeatId;
  transport: SilentableTransport;
  engine: NetEngineImpl;
  /** Every action this engine applied in order, by seq (from onSequenced). */
  log: Map<number, SequencedAction>;
  /** Cids of own actions that came back sequenced (acknowledged). */
  acked: Set<string>;
  /** Own actions rolled back after a nack, with the reason. */
  rolledBack: Map<string, string>;
  /** Cids this engine proposed and had accepted locally. */
  proposed: string[];
  system: string[];
}

export interface Sim {
  net: LoopbackNetwork;
  peers: SimPeer[];
  add(index: number, start?: { seq: number; state: TableState }, role?: PeerRole): SimPeer;
  live(): SimPeer[];
}

export interface SimOptions extends LoopbackOptions {
  /** Engines to create now (indices 0..n-1). */
  engines: number;
  /** Seats at the table (default 4). */
  seats?: number;
  start?: { seq: number; state: TableState };
  deadlines?: (s: TableState) => Deadline[];
}

/** Create the network and the first engines (not joined yet). Call inside fake timers. */
export function makeSim(opts: SimOptions): Sim {
  const net = new LoopbackNetwork(opts);
  const start = opts.start ?? baseTable(opts.seats ?? 4);
  const peers: SimPeer[] = [];
  const sim: Sim = {
    net,
    peers,
    add(index, from = start, role = 'player') {
      const transport = new SilentableTransport(net.create(`t${index}-${peers.length}`));
      const engine = createNetEngine({
        transport,
        roomId: ROOM,
        roomKey: KEY,
        identity: fakeNetIdentity(peerIdOf(index), `P${index}`),
        game: TEST_GAME,
        start: { snapshot: from, tail: [] },
        role,
        now: () => Date.now(),
        ...(opts.deadlines ? { deadlines: opts.deadlines } : {}),
      }) as NetEngineImpl;
      const p: SimPeer = { index, peerId: peerIdOf(index), seat: seatOf(index), transport, engine, log: new Map(), acked: new Set(), rolledBack: new Map(), proposed: [], system: [] };
      engine.onSequenced((a, own) => {
        p.log.set(a.seq, a);
        if (own) p.acked.add(a.cid);
      });
      engine.onRollback((a, reason) => p.rolledBack.set(a.cid, reason));
      engine.onSystem((_l, text) => p.system.push(text));
      peers.push(p);
      void engine.join();
      return p;
    },
    live() {
      return peers.filter((p) => !p.transport.silent && net.isAlive(p.transport.selfId) && p.engine.status() !== 'closed');
    },
  };
  for (let i = 0; i < opts.engines; i++) sim.add(i);
  return sim;
}

/** Advance the fake clock in steps until `cond` holds; returns the elapsed ms, or fails after `maxMs`. */
export async function until(cond: () => boolean, maxMs: number, what: string, stepMs = 50): Promise<number> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > maxMs) throw new Error(`timed out after ${maxMs} ms waiting for ${what}`);
    await vi.advanceTimersByTimeAsync(stepMs);
  }
  return Date.now() - t0;
}

/** Every live engine is connected and they agree on one sequencer that has finished taking over. */
export function agreed(peers: SimPeer[]): boolean {
  if (peers.length === 0) return false;
  const s = peers[0]!.engine.sequencerId();
  if (s === null) return false;
  const holder = peers.find((p) => p.peerId === s);
  return !!holder && holder.engine.isSequencing() && peers.every((p) => p.engine.sequencerId() === s && p.engine.status() === 'connected');
}

/** All live engines hold the same confirmed state, nothing pending, view equal to confirmed. */
export function converged(peers: SimPeer[]): boolean {
  if (peers.some((p) => p.engine.pendingActions().length > 0 || p.engine.state() !== p.engine.confirmedState())) return false;
  const seq = peers[0]!.engine.seq();
  if (peers.some((p) => p.engine.seq() !== seq)) return false;
  const h = hashOf(peers[0]!.engine.confirmedState());
  return peers.every((p) => hashOf(p.engine.confirmedState()) === h);
}

/** Wait until the live engines agree and are converged, then assert one state hash. */
export async function expectConverged(peers: SimPeer[], maxMs = 60_000): Promise<string> {
  await until(() => converged(peers), maxMs, 'convergence', 250);
  const hashes = peers.map((p) => hashOf(p.engine.confirmedState()));
  expect(new Set(hashes).size).toBe(1);
  return hashes[0]!;
}
