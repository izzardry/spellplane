/**
 * The connection check behind `#/diag` (PLAN M1 Connectivity check: a page that joins a room through the configured
 * transport and reports time to connect, the peers and a ping round trip; DESIGN "Multiplayer architecture", Rooms and
 * connection: no relay fallback, failures are said plainly). Diagnostics rooms carry only the two messages below on
 * `ctl`; they never meet a table's engine because their ids start with `diag-` (M1-P5 decision). Implementer: M1-P5.
 */
import type { Message, PeerId, Transport } from '../../net/transport';
import { REMEDIES } from '../lobby/connectivity';
import { cryptoBytes, randomRoomId, randomRoomKey } from '../lobby/room';
import type { DiagProps, DiagReport } from '../types';

/** Give up on the relays, or on seeing any peer, after this long (M1-P5 decision). */
export const DIAG_TIMEOUT_MS = 20_000;
/** A ping goes to every peer this often; the report shows the latest round trip. */
export const DIAG_PING_MS = 2_000;

/** Ping on `ctl` in a diagnostics room: `at` is the sender's clock, echoed back in the pong. */
export interface DiagPing extends Message {
  t: 'diagPing';
  id: number;
  at: number;
}
/** Answer to a ping, echoing its id and clock. */
export interface DiagPong extends Message {
  t: 'diagPong';
  id: number;
  at: number;
}

/** A fresh diagnostics room: `diag-` plus a table-style room id, and a fresh key. */
export function newDiagRoom(random: (n: number) => Uint8Array = cryptoBytes): { roomId: string; roomKey: string } {
  return { roomId: `diag-${randomRoomId(random)}`, roomKey: randomRoomKey(random) };
}

export const RELAYS_FAILED = `Could not reach the signalling relays within ${DIAG_TIMEOUT_MS / 1000} s. Check the internet connection. ${REMEDIES}`;
export const NO_PEER = `No other browser connected within ${DIAG_TIMEOUT_MS / 1000} s. Open this check's link on the other machine; if it is open and nothing appears here, the two networks do not allow a direct connection. ${REMEDIES}`;

/** A running check. */
export interface DiagRun {
  readonly roomId: string;
  readonly roomKey: string;
  report(): DiagReport;
  subscribe(listener: (report: DiagReport) => void): () => void;
  stop(): void;
}

/** Start the check: join `props.room` (or a fresh diagnostics room), ping every peer, report as things change. */
export function runDiag(props: DiagProps, opts: { timeoutMs?: number; pingMs?: number } = {}): DiagRun {
  const timeoutMs = opts.timeoutMs ?? DIAG_TIMEOUT_MS;
  const pingMs = opts.pingMs ?? DIAG_PING_MS;
  const room = props.room ?? newDiagRoom();
  const start = props.now();
  const listeners = new Set<(r: DiagReport) => void>();
  const peers = new Map<PeerId, { peer: string; connectedAfterMs: number; rttMs: number | null }>();
  const sent = new Map<number, PeerId>();
  let joinedAfterMs: number | null = null;
  let error: string | null = null;
  let stopped = false;
  let nextId = 1;
  let transport: Transport | null = null;

  const report = (): DiagReport => ({ roomId: room.roomId, joinedAfterMs, peers: [...peers.values()].map((p) => ({ ...p })), error });
  const emit = (): void => {
    if (stopped) return;
    const r = report();
    for (const l of listeners) l(r);
  };

  const ping = (to: PeerId): void => {
    if (!transport || stopped) return;
    const id = nextId++;
    sent.set(id, to);
    const msg: DiagPing = { v: 1, t: 'diagPing', id, at: props.now() };
    transport.send('ctl', msg, to);
  };

  const timers: ReturnType<typeof setTimeout>[] = [];
  // The relays get `timeoutMs` to let us in; after joining, other browsers get `timeoutMs` to appear.
  timers.push(
    setTimeout(() => {
      if (stopped || joinedAfterMs !== null || error) return;
      error = RELAYS_FAILED;
      emit();
    }, timeoutMs),
  );
  const pinger = setInterval(() => {
    for (const p of peers.keys()) if (transport?.peers().includes(p)) ping(p);
  }, pingMs);

  try {
    transport = props.createTransport();
  } catch (e) {
    error = `This build cannot open a network connection: ${e instanceof Error ? e.message : String(e)}`;
  }

  if (transport) {
    const t = transport;
    t.onPeer((event, peer) => {
      if (stopped) return;
      if (event === 'join' && !peers.has(peer)) {
        peers.set(peer, { peer, connectedAfterMs: Math.max(0, props.now() - start), rttMs: null });
        if (error === NO_PEER) error = null;
        emit();
        ping(peer);
      }
    });
    t.on('ctl', (msg, from) => {
      if (stopped) return;
      if (msg.t === 'diagPing' && typeof msg.id === 'number' && typeof msg.at === 'number') {
        const pong: DiagPong = { v: 1, t: 'diagPong', id: msg.id, at: msg.at };
        t.send('ctl', pong, from);
      } else if (msg.t === 'diagPong' && typeof msg.id === 'number' && typeof msg.at === 'number') {
        const to = sent.get(msg.id);
        const p = peers.get(from);
        if (to !== from || !p) return;
        sent.delete(msg.id);
        p.rttMs = Math.max(0, props.now() - msg.at);
        emit();
      }
    });
    t.join(room.roomId, room.roomKey).then(
      () => {
        if (stopped) return;
        joinedAfterMs = Math.max(0, props.now() - start);
        if (error === RELAYS_FAILED) error = null;
        emit();
        timers.push(
          setTimeout(() => {
            if (stopped || peers.size > 0 || error) return;
            error = NO_PEER;
            emit();
          }, timeoutMs),
        );
      },
      (e: unknown) => {
        if (stopped) return;
        error = `Could not join the room: ${e instanceof Error ? e.message : String(e)}. ${REMEDIES}`;
        emit();
      },
    );
  }

  return {
    roomId: room.roomId,
    roomKey: room.roomKey,
    report,
    subscribe(listener) {
      listeners.add(listener);
      listener(report());
      return () => listeners.delete(listener);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const t of timers) clearTimeout(t);
      clearInterval(pinger);
      listeners.clear();
      try {
        transport?.leave();
      } catch {
        /* already gone */
      }
    },
  };
}
