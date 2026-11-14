/**
 * The local save of one table, shared by the solo and the networked session (DESIGN "Specification: network protocol
 * and secrecy", Local persistence: the log entry, the table record and the secret store of one action are written in
 * one transaction; Sync: a snapshot every 200 actions; "Multiplayer architecture", Resume).
 *
 * Writes run strictly in order on one promise chain. The table record always names a snapshot and the seq it was
 * taken at, and `lastSeq`; a restore replays the stored log between them, so the stored log between `snapshotSeq` and
 * `lastSeq` must be the current timeline. Whenever that could be in doubt, the record moves its snapshot (a rebase):
 * every SNAPSHOT_EVERY actions, after a failed write (the stored log has a hole), when an action does not follow the
 * last stored one (a networked replica that caught up from a snapshot, or rewound to another history), and when the
 * state handed in is already past the action (several actions applied in one step).
 */
import type { Action } from '../core/actions';
import type { SecretStore, SeatId, TableState } from '../core/types';
import { PROTOCOL_VERSION } from '../net/messages';
import type { LogRecord, TableRecord, TableStore } from '../store/types';

/** A snapshot of the table goes into the table record every this many actions (DESIGN "Specification: network protocol and secrecy", Sync). */
export const SNAPSHOT_EVERY = 200;

export interface TablePersistenceOptions {
  store: TableStore | undefined;
  roomId: string;
  /** '' for the solo table. */
  roomKey: string;
  /** The seat the record names (the chair this browser holds, or its last one). */
  seat: () => SeatId | null;
  /** Called with a plain message when a write fails (the caller logs it). */
  onError: (text: string) => void;
  /** Local wall clock (display only). */
  now: () => number;
  /** The stored snapshot the stored log continues from, and the last stored seq. */
  snapshot: TableState;
  snapshotSeq: number;
  lastSeq: number;
  /** Writes start after this settles (the queue of a save this one replaces); it never rejects. */
  after?: Promise<void>;
  /**
   * The protocol version of the stored record this save continues (`TableRecord.protocol`), if any. A higher one than
   * this page's is kept, so a room a newer Spellplane played keeps saying so after an older page saved it.
   */
  protocol?: number | undefined;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The ordered write queue of one table's local save. */
export class TablePersistence {
  private writes: Promise<void>;
  /** The base of the stored table record (updated as writes succeed). */
  private snapshot: TableState;
  private snapshotSeq: number;
  /** Last seq the queued writes cover (queued, not necessarily written yet). */
  private lastSeq: number;
  /** A write failed, so the stored log has a hole: the next write stores a fresh snapshot. */
  private broken = false;
  /** The state the last forced snapshot was taken from (see `saveAction`). */
  private lastState: TableState | null = null;
  private secretsQueued: SecretStore | null = null;

  constructor(private readonly o: TablePersistenceOptions) {
    this.writes = o.after ?? Promise.resolve();
    this.snapshot = o.snapshot;
    this.snapshotSeq = o.snapshotSeq;
    this.lastSeq = o.lastSeq;
  }

  /** Resolves once every write queued so far has finished (immediately without a store). */
  whenSaved(): Promise<void> {
    return this.writes;
  }

  /**
   * Queue the write of sequenced action `action` (its `seq` set) with the table record and the secret store, in one
   * transaction. `state` is the state after the action, or a later one (then the record moves its snapshot to it).
   * State and secrets are never mutated in place, so the references stay valid until the write runs.
   */
  saveAction(action: Action, state: TableState, secrets: SecretStore | null): void {
    const store = this.o.store;
    const seq = action.seq;
    if (!store || seq === undefined) return;
    const at = this.o.now();
    const entry: LogRecord = { roomId: this.o.roomId, seq, action, at };
    // The state the last rebase stored, handed in again for an earlier action of the same step: that action is
    // inside the snapshot already, so only its log line is written and the record stays where it is.
    const covered = state === this.lastState && seq <= state.seq;
    const forced = !covered && (seq !== this.lastSeq + 1 || state.seq !== seq || seq % SNAPSHOT_EVERY === 0);
    if (!covered) this.lastSeq = state.seq;
    if (forced) this.lastState = state;
    const lastSeq = this.lastSeq;
    this.writes = this.writes
      .then(async () => {
        const rebase = forced || (!covered && this.broken);
        const snapshot = rebase ? state : this.snapshot;
        const snapshotSeq = rebase ? state.seq : this.snapshotSeq;
        await store.saveAction(this.o.roomId, entry, this.record(state, snapshot, snapshotSeq, lastSeq, at), secrets);
        this.snapshot = snapshot;
        this.snapshotSeq = snapshotSeq;
        this.broken = false;
      })
      .catch((e: unknown) => this.failed(e));
  }

  /**
   * Store `state` as the record's snapshot without a log entry: a fresh table, or a table restored only up to a gap,
   * whose stored log past the restored seq belongs to an abandoned timeline.
   */
  saveBase(state: TableState, secrets: SecretStore | null): void {
    const store = this.o.store;
    if (!store) return;
    this.lastSeq = state.seq;
    this.lastState = null;
    this.writes = this.writes
      .then(async () => {
        await store.saveSnapshot(this.record(state, state, state.seq, state.seq, this.o.now()), secrets);
        this.snapshot = state;
        this.snapshotSeq = state.seq;
        this.broken = false;
      })
      .catch((e: unknown) => this.failed(e));
  }

  /**
   * Queue a write of the secret store alone (DESIGN "Local persistence": `secrets` keyed by roomId), for changes
   * without a sequenced action of their own: a deck committed before its `ready` is sequenced, a shuffle nonce, an
   * identity received on the pair channel. Coalesced: one write carries the latest store.
   */
  saveSecrets(secrets: SecretStore): void {
    const store = this.o.store;
    if (!store) return;
    const first = this.secretsQueued === null;
    this.secretsQueued = secrets;
    if (!first) return;
    this.writes = this.writes
      .then(async () => {
        const s = this.secretsQueued;
        this.secretsQueued = null;
        if (s) await store.saveSecrets(this.o.roomId, s);
      })
      .catch((e: unknown) => this.failed(e));
  }

  private failed(e: unknown): void {
    this.broken = true;
    this.o.onError(`Could not save the table: ${errorText(e)}`);
  }

  private record(state: TableState, snapshot: TableState, snapshotSeq: number, lastSeq: number, at: number): TableRecord {
    return {
      roomId: this.o.roomId,
      roomKey: this.o.roomKey,
      lastSeq,
      snapshot,
      snapshotSeq,
      seat: this.o.seat(),
      stage: state.stage,
      updatedAt: at,
      // The room records the highest protocol version it was played with (PLAN Milestone 5, owner decisions, Version
      // mismatch; net/version.ts roomProtocol, roomVersionNotice): an older page saving a room a newer one wrote never
      // lowers it, so the notice comes again at every reload instead of once.
      protocol: Math.max(this.o.protocol ?? PROTOCOL_VERSION, PROTOCOL_VERSION),
    };
  }
}
