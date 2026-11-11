/**
 * A small sequenced table over the loopback transport for the confirmation-round tests (PLAN M1-P3; DESIGN
 * "Specification: network protocol and secrecy", Sequencing and Timers). It is deliberately not M1-P1's NetEngine:
 * peer 0 is the sequencer, every peer proposes on `act`, the sequencer stamps `seq` and broadcasts `seq` messages,
 * and every peer applies them strictly in order (buffering out-of-order arrivals). The sequencer arms the pure
 * deadlines of core/deadlines.ts from its own apply time of `fromSeq`, as the contract describes, and sequences their
 * `emit` drafts as itself when they fire. Vitest fake timers drive both the network delays and the clock.
 */
import { vi } from 'vitest';
import type { Action, ActionDraft } from '../../../src/core/actions';
import { deadlines } from '../../../src/core/deadlines';
import { canonicalJson } from '../../../src/core/hash';
import { createTable, explain, reduce } from '../../../src/core/reducer';
import type { CoreGameSpec, SeatId, TableState } from '../../../src/core/types';
import { LoopbackNetwork, type LoopbackOptions } from '../../../src/net/loopback';
import type { NackMessage, ProposeMessage, SeqMessage, SequencedAction } from '../../../src/net/messages';
import type { Message, Transport } from '../../../src/net/transport';

export const GAME: CoreGameSpec = {
  id: 'test',
  zones: [
    { id: 'library', scope: 'seat', visibility: 'nobody', ordered: true, presentation: 'squared', label: 'Library' },
    { id: 'hand', scope: 'seat', visibility: 'owner', ordered: false, presentation: 'fan', label: 'Hand' },
    { id: 'battlefield', scope: 'seat', visibility: 'public', ordered: false, presentation: 'free', label: 'Battlefield' },
    { id: 'graveyard', scope: 'seat', visibility: 'public', ordered: true, presentation: 'squared', label: 'Graveyard' },
    { id: 'exile', scope: 'seat', visibility: 'public', ordered: true, presentation: 'squared', label: 'Exile' },
    { id: 'stack', scope: 'table', visibility: 'public', ordered: true, presentation: 'cascade-lane', label: 'Stack' },
  ],
  phases: [
    { id: 'main1', label: 'Main 1' },
    { id: 'end', label: 'End' },
  ],
  startingLife: () => 20,
};

/**
 * Stand-in for M1-P7's `away` handler (the reducer refuses `away` until that package lands): the sequencer marks a
 * seat away or back. Applied identically on every peer, so it stays a shared, sequenced fact.
 */
function applyAway(state: TableState, a: Extract<Action, { type: 'away' }>): TableState {
  const seat = state.seats[a.seat];
  if (!seat) return state;
  const next = { ...seat };
  if (a.away) next.away = true;
  else delete next.away;
  return { ...state, seq: a.seq ?? state.seq, seats: { ...state.seats, [a.seat]: next } };
}

export function apply(state: TableState, a: Action): TableState {
  return a.type === 'away' ? applyAway(state, a) : reduce(state, a);
}

function refusal(state: TableState, a: Action): string | null {
  return a.type === 'away' ? null : explain(state, a);
}

export interface Applied {
  seq: number;
  /** Fake clock when this peer applied it. */
  at: number;
  action: SequencedAction;
  /** Canonical JSON of the state after it (equal canonical JSON means equal state hash, core/hash.ts). */
  hash: string;
}

export class Peer {
  state: TableState;
  readonly applied: Applied[] = [];
  readonly nacks: { cid: string; reason: string }[] = [];
  private readonly buffer = new Map<number, SeqMessage>();
  private cid = 0;
  /** Sequencer only. */
  private readonly armed = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly appliedAt = new Map<number, number>();
  /** Sequencer only: when each deadline fired (key -> clock). */
  readonly fired: { key: string; at: number; seq: number }[] = [];

  constructor(
    readonly seat: SeatId,
    readonly transport: Transport,
    readonly table: SimTable,
    start: TableState,
  ) {
    this.state = start;
    transport.on('act', (msg, from) => this.onAct(msg, from));
  }

  get isSequencer(): boolean {
    return this.table.sequencer === this;
  }

  /** Propose an action as this seat (no optimistic apply: the view is the confirmed state). */
  propose(draft: ActionDraft): string {
    const cid = `${this.seat}-${++this.cid}`;
    const action = { ...draft, by: this.seat, cid } as Action;
    if (this.isSequencer) this.sequence(action, this.transport.selfId);
    else this.transport.send('act', { v: 1, t: 'propose', cid, action } satisfies ProposeMessage, this.table.sequencer.transport.selfId);
    return cid;
  }

  private onAct(msg: Message, from: string): void {
    if (msg.t === 'propose' && this.isSequencer) {
      const m = msg as unknown as ProposeMessage;
      this.sequence(m.action, from);
    } else if (msg.t === 'seq') {
      const m = msg as unknown as SeqMessage;
      if (m.seq <= this.state.seq) return;
      this.buffer.set(m.seq, m);
      for (let next = this.buffer.get(this.state.seq + 1); next; next = this.buffer.get(this.state.seq + 1)) {
        this.buffer.delete(next.seq);
        this.applyOne(next.action);
      }
    } else if (msg.t === 'nack') {
      const m = msg as unknown as NackMessage;
      this.nacks.push({ cid: m.cid, reason: m.reason });
    }
  }

  /** Sequencer: check, stamp, apply, broadcast; refuse with a nack. */
  private sequence(action: Action, from: string): void {
    const why = refusal(this.state, action);
    if (why !== null) {
      if (from === this.transport.selfId) this.nacks.push({ cid: action.cid, reason: why });
      else this.transport.send('act', { v: 1, t: 'nack', cid: action.cid, reason: why } satisfies NackMessage, from);
      return;
    }
    const seq = this.state.seq + 1;
    const stamped = { ...action, seq } as SequencedAction;
    this.applyOne(stamped);
    this.transport.send('act', { v: 1, t: 'seq', seq, cid: stamped.cid, action: stamped } satisfies SeqMessage);
  }

  private applyOne(a: SequencedAction): void {
    const before = this.state;
    this.state = apply(before, a);
    if (this.state.seq !== a.seq) throw new Error(`${this.seat}: seq ${a.seq} did not apply: ${refusal(before, a) ?? 'no change'}`);
    const at = Date.now();
    this.appliedAt.set(a.seq, at);
    this.applied.push({ seq: a.seq, at, action: a, hash: canonicalJson(this.state) });
    if (this.isSequencer) this.armDeadlines();
  }

  /** Sequencer clock (DESIGN "Specification: network protocol and secrecy", Timers): arm new keys, drop vanished ones. */
  armDeadlines(): void {
    const live = deadlines(this.state);
    const keys = new Set(live.map((d) => d.key));
    for (const [key, t] of this.armed) {
      if (!keys.has(key)) {
        clearTimeout(t);
        this.armed.delete(key);
      }
    }
    for (const d of live) {
      if (this.armed.has(d.key)) continue;
      const from = this.appliedAt.get(d.fromSeq) ?? Date.now();
      const wait = Math.max(0, from + d.afterMs - Date.now());
      this.armed.set(
        d.key,
        setTimeout(() => {
          this.armed.delete(d.key);
          const still = deadlines(this.state).find((x) => x.key === d.key);
          if (!still) return;
          this.fired.push({ key: d.key, at: Date.now(), seq: this.state.seq });
          for (const draft of still.emit) {
            const action = { ...draft, by: this.seat, cid: `${this.seat}-clock-${++this.cid}` } as Action;
            this.sequence(action, this.transport.selfId);
          }
        }, wait),
      );
    }
  }

  /** Sequencer only: what the M1-P7 liveness rule does when a peer has been silent for 6 s. */
  markAway(seat: SeatId, away: boolean): void {
    this.sequence({ type: 'away', seat, away, by: this.seat, cid: `${this.seat}-away-${++this.cid}` }, this.transport.selfId);
  }

  stop(): void {
    for (const t of this.armed.values()) clearTimeout(t);
    this.armed.clear();
  }
}

export class SimTable {
  readonly net: LoopbackNetwork;
  readonly peers: Peer[] = [];

  constructor(names: string[], opts: LoopbackOptions = {}, passTimerMs: number | null = 5000) {
    this.net = new LoopbackNetwork(opts);
    let start = createTable({ game: GAME, format: names.length > 2 ? 'ffa3' : '1v1', seats: names.map((name, i) => ({ name, colour: i, peer: `peer${i}` })) });
    start = { ...start, stage: 'match', settings: { ...start.settings, passTimerMs } };
    names.forEach((_, i) => {
      const t = this.net.create(`peer${i}`);
      this.peers.push(new Peer(`s${i}`, t, this, structuredClone(start)));
    });
  }

  /** Peer 0 sequences (the lowest seat index, DESIGN Sequencing 1). */
  get sequencer(): Peer {
    return this.peers[0]!;
  }

  async join(): Promise<void> {
    for (const p of this.peers) await p.transport.join('room', 'key');
    await vi.advanceTimersByTimeAsync(1);
  }

  peer(seat: SeatId): Peer {
    const p = this.peers.find((x) => x.seat === seat);
    if (!p) throw new Error(`no peer ${seat}`);
    return p;
  }

  /** Let every in-flight message arrive (longer than any delay) without crossing a confirmation deadline when `ms` is small. */
  async settle(ms = 1000): Promise<void> {
    await vi.advanceTimersByTimeAsync(ms);
  }

  stop(): void {
    for (const p of this.peers) p.stop();
  }
}
