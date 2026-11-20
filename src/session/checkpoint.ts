/**
 * Timed checkpoints of a running game into its History summary (persistence.md section 2, D2; contracts.md Part E).
 * M8-P2.
 *
 * - every 20 s while something changed since the last write (an applied action or a new head heard of);
 * - at once after a turn pass, a stage change and a result; on the tab going hidden and on page hide;
 * - on `now('leave')`, before the room is left.
 *
 * The save state is `saved` after a successful write and `notSaving` when a write and its one retry failed. The
 * interval is counted as a long-lived timer (`track('timers', …)`); `stop()` releases the interval and every listener.
 */
import { stateHash } from '../core/hash';
import type { TableState } from '../core/types';
import { blankSummary } from '../store/games';
import type { GameStore, GameSummary } from '../store/types';
import { track, untrack } from '../util/lifecycle';
import { ownActions, summarise } from './summary';
import type { KnownHead, SaveState, TableSession } from './types';

/** Why a checkpoint is taken (persistence.md section 2). */
export type CheckpointReason = 'timer' | 'turn' | 'hide' | 'leave' | 'result' | 'stage' | 'rejoin';

/** Sequenced actions after which the game is saved at once (persistence.md section 2). */
const SAVE_AT_ONCE: ReadonlySet<string> = new Set(['seatClaim', 'recoverCommit', 'playOn']);

/** Whether the log holds one of SAVE_AT_ONCE sequenced after `seq` (the log's tail only). */
function savesAtOnce(session: TableSession, seq: number): boolean {
  let log: ReturnType<TableSession['log']>;
  try {
    log = session.log();
  } catch {
    return false;
  }
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i]!;
    if (e.kind !== 'action') continue;
    if (e.seq <= seq) break;
    if (SAVE_AT_ONCE.has(e.action.type)) return true;
  }
  return false;
}

/** The checkpoint period while something changed (persistence.md D2). */
export const CHECKPOINT_MS = 20_000;

/** A running checkpointer (contracts.md Part E). */
export interface Checkpointer {
  stop(): void;
  now(reason: CheckpointReason): Promise<void>;
}

/** Members beyond the contract (M8-P2): the save state and its changes. */
export interface CheckpointerExtras {
  saveState(): SaveState;
  subscribe(listener: (s: SaveState) => void): () => void;
  /** Writes made so far (tests and the debug hook). */
  writes(): number;
}

/** What the checkpointer may be given instead of the page's globals (tests). */
export interface CheckpointOptions {
  now?: () => number;
  /** Where `visibilitychange` is heard and `hidden` read (default: `document`). */
  doc?: { readonly visibilityState?: string; addEventListener(type: string, fn: () => void): void; removeEventListener(type: string, fn: () => void): void } | null;
  /** Where `pagehide` is heard (default: `window`). */
  win?: { addEventListener(type: string, fn: () => void): void; removeEventListener(type: string, fn: () => void): void } | null;
  /** The newest head heard of, if the session knows one (M8-P5). */
  knownHead?: () => KnownHead | null;
  /** The state hash (default core/hash stateHash; tests pass a synchronous one under fake timers). */
  hash?: (state: TableState) => Promise<string>;
  /** Meta for a game that has no summary yet (default: from the session; see `metaFor`). */
  meta?: Partial<GameSummary> & Pick<GameSummary, 'kind'>;
  /** The room key of a networked table that has no summary yet (default: read from the page's `#/t/<room>/<key>`). */
  key?: string;
}

/** The sandbox table (`#/solo`, store/tables.ts SOLO_ROOM_ID) is never listed in History. */
const SANDBOX_ROOM = 'solo';

/** The room key in the page's address when it shows `#/t/<room>/…` (a networked game joined by link has no summary yet). */
function keyFromAddress(roomId: string): string {
  const hash = typeof location !== 'undefined' ? location.hash : '';
  const m = /^#\/t\/([^/]+)\/([^/]+)/.exec(hash);
  return m && decodeURIComponent(m[1]!) === roomId ? decodeURIComponent(m[2]!) : '';
}

/** What a first summary of `session` says when no launcher created one (a table joined by link, a resumed practice). */
function metaFor(session: TableSession, st: TableState, opts: CheckpointOptions): Parameters<GameStore['create']>[0] {
  let solo: boolean;
  try {
    solo = session.netStatus().mode === 'solo';
  } catch {
    solo = /^[pc]-/.test(session.roomId);
  }
  const kind: GameSummary['kind'] = opts.meta?.kind ?? (solo ? 'solo' : st.settings.matched ? 'matched' : 'private');
  const decks: GameSummary['decks'] = st.lobby?.draft ? 'draftLive' : 'constructed';
  return { code: session.roomId, key: solo ? '' : (opts.key ?? keyFromAddress(session.roomId)), format: st.format, decks, ...opts.meta, kind };
}

/** A checkpointer that writes nothing: no store, or the sandbox. */
function idle(state: SaveState): Checkpointer & CheckpointerExtras {
  return { now: () => Promise.resolve(), stop: () => undefined, saveState: () => state, subscribe: () => () => undefined, writes: () => 0 };
}

/** Start checkpointing `session` into `games` (contracts.md Part E). With no store nothing is written and the state is `notSaving`. */
export function createCheckpointer(session: TableSession, games: GameStore | null, opts: CheckpointOptions = {}): Checkpointer & CheckpointerExtras {
  if (!games) return idle('notSaving');
  if (session.roomId === SANDBOX_ROOM) return idle('saved');
  const store: GameStore = games;
  const clock = opts.now ?? (() => Date.now());
  const doc = opts.doc !== undefined ? opts.doc : typeof document !== 'undefined' ? document : null;
  const win = opts.win !== undefined ? opts.win : typeof window !== 'undefined' ? window : null;
  let state: SaveState = 'saved';
  const listeners = new Set<(s: SaveState) => void>();
  let dirty = false;
  let played = false;
  let stopped = false;
  let writes = 0;
  let lastHeadKey = '';
  let last: TableState = session.getState();
  let chain: Promise<void> = Promise.resolve();

  const setState = (s: SaveState): void => {
    if (s === state) return;
    state = s;
    for (const l of listeners) l(s);
  };

  async function write(reason: CheckpointReason): Promise<void> {
    const st = session.getState();
    let log: ReturnType<TableSession['log']> = [];
    try {
      log = session.log();
    } catch {
      log = [];
    }
    const at = clock();
    const hash = await (opts.hash ?? stateHash)(st);
    const attempt = async (): Promise<void> => {
      const prior =
        (await store.get(session.roomId)) ??
        blankSummary(metaFor(session, st, opts), at);
      const next = summarise(st, safeSecrets(session), prior, opts.knownHead?.() ?? null, { hash, actions: ownActions(log, session.seat), now: at, played });
      if (reason === 'leave') next.leftAt = at;
      await store.put(next);
    };
    try {
      await attempt();
    } catch {
      try {
        await attempt();
      } catch {
        setState('notSaving');
        return;
      }
    }
    writes++;
    dirty = false;
    played = false;
    setState('saved');
  }

  function now(reason: CheckpointReason): Promise<void> {
    const run = (): Promise<void> => write(reason);
    chain = chain.then(run, run);
    return chain;
  }

  const off = session.subscribe((next) => {
    if (stopped) return;
    const prev = last;
    last = next;
    if (next.seq !== prev.seq) {
      dirty = true;
      played = true;
    }
    if (next.stage !== prev.stage) void now('stage');
    else if (next.result && !prev.result) void now('result');
    else if (next.turn.number !== prev.turn.number || next.turn.active !== prev.turn.active) void now('turn');
    else if (next.seq > prev.seq && savesAtOnce(session, prev.seq)) void now('rejoin');
  });

  const tick = (): void => {
    if (stopped) return;
    const head = opts.knownHead?.();
    const key = head ? `${head.play}:${head.seq}:${head.peer}` : '';
    if (key !== lastHeadKey) {
      lastHeadKey = key;
      dirty = true;
    }
    if (dirty) void now('timer');
  };
  const interval = setInterval(tick, CHECKPOINT_MS);
  const handle = { interval };
  track('timers', handle);

  const onVisibility = (): void => {
    if (doc?.visibilityState === 'hidden') void now('hide');
  };
  const onPageHide = (): void => void now('hide');
  doc?.addEventListener('visibilitychange', onVisibility);
  win?.addEventListener('pagehide', onPageHide);

  return {
    now,
    stop() {
      if (stopped) return;
      stopped = true;
      off();
      clearInterval(interval);
      untrack('timers', handle);
      doc?.removeEventListener('visibilitychange', onVisibility);
      win?.removeEventListener('pagehide', onPageHide);
      listeners.clear();
    },
    saveState: () => state,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    writes: () => writes,
  };
}

function safeSecrets(session: TableSession): ReturnType<TableSession['secrets']> | null {
  try {
    return session.secrets();
  } catch {
    return null;
  }
}
