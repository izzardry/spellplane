/**
 * M8-P2: summaries, checkpoints and leaving (persistence.md sections 2 and 3; contracts.md Part C "Leave", Part E,
 * Part G "History and saving"). Fake timers drive the 20 s checkpoint; fake-indexeddb holds the games store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { canonicalJson } from '../../../src/core/hash';
import type { LogEntry, SecretStore, TableState } from '../../../src/core/types';
import { CHECKPOINT_MS, createCheckpointer } from '../../../src/session/checkpoint';
import { ownActions, summarise, THUMB_MAX } from '../../../src/session/summary';
import type { SessionListener, TableSession } from '../../../src/session/types';
import { blankSummary, createGameStore } from '../../../src/store/games';
import { openStores, type LocalStores } from '../../../src/store/stores';
import type { GameStore, GameSummary } from '../../../src/store/types';
import { LEFT_NETWORKED, LEFT_SOLO, leaveTable } from '../../../src/ui/play/leave';
import { live, resetLifecycleForTests } from '../../../src/util/lifecycle';
import { sampleSecrets, sampleState, uniqueDbName } from '../store/helpers';

const seat = (id: string, index: number, name: string, extra: object = {}) => ({ id, index, name, colour: index, life: 20, counters: {}, ready: true, autoPass: false, ...extra });

function fourPlayers(): TableState {
  const st = sampleState();
  st.format = 'ffa4';
  st.seats = { s0: seat('s0', 0, 'Ada'), s1: seat('s1', 1, 'Ben', { away: true }), s2: seat('s2', 2, 'Cy'), s3: seat('s3', 3, 'Dee', { takeovers: 1 }) } as TableState['seats'];
  st.turn = { number: 3, active: 's1', phase: 'main1' };
  return st;
}

function twoHeaded(): TableState {
  const st = fourPlayers();
  st.format = '2hg';
  for (const [i, s] of Object.values(st.seats).entries()) s.team = i < 2 ? 't0' : 't1';
  st.teams = { t0: { id: 't0', seats: ['s0', 's1'], life: 30, counters: {} }, t1: { id: 't1', seats: ['s2', 's3'], life: 24, counters: {} } };
  st.turn = { number: 5, active: 't1', phase: 'main1' };
  return st;
}

function prior(code = 'room-a-b-10'): GameSummary {
  return blankSummary({ code, key: 'k', kind: 'private', format: '1v1', decks: 'constructed' }, 100);
}

describe('summarise (pure, public state only)', () => {
  it('1v1: players, turn, own seat, result; the thumb holds public battlefield outlines only', () => {
    const st = sampleState();
    st.seats.s1 = seat('s1', 1, 'Ben') as TableState['seats'][string];
    const g = summarise(st, sampleSecrets(), prior(), null, { hash: 'h1', actions: 4, now: 500 });
    expect(g.players.map((p) => [p.name, p.me, p.life])).toEqual([['Ada', true, 17], ['Ben', false, 20]]);
    expect(g).toMatchObject({ seat: 's0', turn: 4, active: 's0', stage: 'match', seq: 3, hash: 'h1', actions: 4, savedAt: 500 });
    expect(g.thumb?.cards).toEqual([[40, 40, 1, 0]]);
    // Nothing hidden: no identity, salt, instance id or hand of the secret store reaches the summary.
    const json = canonicalJson(g);
    for (const secret of ['aaaa', 'bbbb', 'cccc', 'salt-', '0000579f', 'c1', 'c4', 'libraryOrder']) expect(json).not.toContain(secret);
    expect(g.result).toBeUndefined();
    const ended = summarise({ ...st, result: { winners: ['s1'], reason: 'concede', atSeq: 3 } }, null, g, null, { now: 900 });
    expect(ended).toMatchObject({ ended: 'result', endedAt: 900, result: { winners: ['s1'] } });
  });

  it('four players: away, takeovers, whose turn; a head names its seat', () => {
    const g = summarise(fourPlayers(), sampleSecrets(), prior(), { play: 9, seq: 12, peer: 'p', seat: 's2' });
    expect(g.players.map((p) => [p.seat, p.away])).toEqual([['s0', false], ['s1', true], ['s2', false], ['s3', false]]);
    expect(g).toMatchObject({ format: 'ffa4', active: 's1', turn: 3, takeovers: 1, knownHead: { play: 9, seq: 12, name: 'Cy' } });
  });

  it('2HG: team life and the active team', () => {
    const g = summarise(twoHeaded(), sampleSecrets(), prior(), null);
    expect(g.players.map((p) => [p.team, p.life])).toEqual([['t0', 30], ['t0', 30], ['t1', 24], ['t1', 24]]);
    expect(g.active).toBe('t1');
  });

  it('a draft stage has no thumb and keeps the stage', () => {
    const st = sampleState();
    st.stage = 'draft';
    st.zones['battlefield:s0'] = { id: 'battlefield:s0', kind: 'battlefield', owner: 's0', visibility: 'public', ids: [] };
    const g = summarise(st, null, prior(), null);
    expect(g.stage).toBe('draft');
    expect(g.thumb).toBeNull();
  });

  it('caps the thumb at 80 cards and skips hidden zones', () => {
    const st = sampleState();
    const ids: string[] = [];
    for (let i = 0; i < 100; i++) {
      const id = `b${i}`;
      ids.push(id);
      st.cards[id] = { id, owner: 's0', controller: 's0', zone: 'battlefield:s0', face: 'up', faceIndex: 0, tapped: false, pose: { x: i, y: 0, rot: 0 }, counters: {} };
    }
    st.zones['battlefield:s0'] = { id: 'battlefield:s0', kind: 'battlefield', owner: 's0', visibility: 'public', ids };
    expect(summarise(st, null, prior(), null).thumb?.cards.length).toBe(THUMB_MAX);
  });

  it('ownActions counts own play actions, not chat or another seat', () => {
    const a = (type: string, by: string): LogEntry => ({ kind: 'action', seq: 1, at: 0, action: { type, by, cid: 'c', seq: 1 } as unknown as Action });
    expect(ownActions([a('tap', 's0'), a('chat', 's0'), a('tap', 's1'), a('draw', 's0')], 's0')).toBe(2);
  });
});

/** A session double: state, log, subscribe, leave. */
function fakeSession(roomId = 'p-test'): TableSession & { set(st: TableState): void; push(e: LogEntry): void; left: number; disposed: number } {
  let state = sampleState();
  const log: LogEntry[] = [];
  const listeners = new Set<SessionListener>();
  const s = {
    seat: 's0',
    roomId,
    left: 0,
    disposed: 0,
    getState: () => state,
    netStatus: () => ({ mode: 'solo', connection: 'solo', peers: [], sequencer: null, seq: state.seq }),
    secrets: (): SecretStore => sampleSecrets(),
    log: () => log,
    subscribe(l: SessionListener) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    set(st: TableState) {
      state = st;
      for (const l of listeners) l(st);
    },
    push(e: LogEntry) {
      log.push(e);
    },
    leave() {
      s.left++;
      return Promise.resolve();
    },
    dispose() {
      s.disposed++;
    },
  };
  return s as unknown as TableSession & { set(st: TableState): void; push(e: LogEntry): void; left: number; disposed: number };
}

const open: LocalStores[] = [];
async function gameStore(): Promise<GameStore & { purgeRemoved(): Promise<void> }> {
  const s = await openStores(uniqueDbName('saving'));
  open.push(s);
  return createGameStore(s.db);
}

/** A games store in memory that resolves in microtasks (fake timers flush it). */
function memoryGames(): GameStore {
  const rows = new Map<string, GameSummary>();
  return {
    create: (m) => { if (!rows.has(m.code)) rows.set(m.code, blankSummary(m, 0)); return Promise.resolve(); },
    put: (g) => { rows.set(g.code, structuredClone(g)); return Promise.resolve(); },
    get: (c) => Promise.resolve(rows.get(c) ?? null),
    list: () => Promise.resolve([...rows.values()]),
    remove: () => Promise.resolve(),
    restore: () => Promise.resolve(),
    purge: (c) => { rows.delete(c); return Promise.resolve(); },
    endOlderSolo: () => Promise.resolve(),
  };
}

describe('checkpointer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearInterval', 'clearTimeout', 'Date'] });
    resetLifecycleForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    for (const s of open.splice(0)) s.close();
  });

  function counting(store: GameStore): GameStore & { puts: number } {
    const c = { ...store, puts: 0, put: async (g: GameSummary) => { c.puts++; await store.put(g); } };
    return c;
  }

  it('no write while nothing changed; one 20 s after an action; at once on turn pass and on hide', async () => {
    const games = counting(memoryGames());
    const session = fakeSession();
    const doc = new EventTarget() as EventTarget & { visibilityState: string };
    doc.visibilityState = 'visible';
    const cp = createCheckpointer(session, games, { doc, win: null, hash: (st) => Promise.resolve(`h${st.seq}`) });
    expect(live().timers).toBe(1);
    await vi.advanceTimersByTimeAsync(CHECKPOINT_MS * 3);
    expect(games.puts).toBe(0);

    session.set({ ...session.getState(), seq: 4 });
    await vi.advanceTimersByTimeAsync(CHECKPOINT_MS - 1000);
    // The interval runs on its own phase; within one period of the action exactly one write lands.
    await vi.advanceTimersByTimeAsync(1000);
    expect(games.puts).toBe(1);
    await vi.advanceTimersByTimeAsync(CHECKPOINT_MS * 2);
    expect(games.puts).toBe(1);

    session.set({ ...session.getState(), seq: 5, turn: { number: 5, active: 's0', phase: 'untap' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(games.puts).toBe(2);

    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(games.puts).toBe(3);
    const g = await games.get('p-test');
    expect(g).toMatchObject({ seq: 5, turn: 5 });
    expect(g?.hash).not.toBe('');

    cp.stop();
    expect(live().timers).toBe(0);
    session.set({ ...session.getState(), seq: 6, turn: { number: 6, active: 's0', phase: 'untap' } });
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(CHECKPOINT_MS * 2);
    expect(games.puts).toBe(3);
  });

  it('a failed write is retried once, then the state is notSaving; a later success says saved', async () => {
    const real = await gameStore();
    let fail = 2;
    let attempts = 0;
    const games: GameStore = { ...real, put: async (g) => { attempts++; if (fail-- > 0) throw new Error('QuotaExceededError'); await real.put(g); } };
    const cp = createCheckpointer(fakeSession(), games, { doc: null, win: null });
    await cp.now('timer');
    expect(attempts).toBe(2);
    expect(cp.saveState()).toBe('notSaving');
    await cp.now('timer');
    expect(cp.saveState()).toBe('saved');
    cp.stop();
  });

  it('without a store it says notSaving and writes nothing', async () => {
    const cp = createCheckpointer(fakeSession(), null, { doc: null, win: null });
    await cp.now('leave');
    expect(cp.saveState()).toBe('notSaving');
    cp.stop();
  });
});

describe('leaveTable', () => {
  afterEach(() => {
    for (const s of open.splice(0)) s.close();
  });

  const tap = (i: number): LogEntry => ({ kind: 'action', seq: i, at: 0, action: { type: 'tap', by: 's0', cid: `c${i}`, seq: i, card: 'c3', tapped: true } as Action });

  it('purges a solo game with fewer than 10 own actions and shows no toast', async () => {
    const games = await gameStore();
    await games.create({ code: 'p-short', key: '', kind: 'solo', format: '1v1', decks: 'constructed' });
    const session = fakeSession('p-short');
    for (let i = 1; i <= 9; i++) session.push(tap(i));
    const go = vi.fn();
    const toast = vi.fn();
    expect(await leaveTable({ session, kind: 'practice', code: 'p-short', games, go, toast })).toBe('purged');
    expect(await games.get('p-short')).toBeNull();
    expect(toast).not.toHaveBeenCalled();
    expect(go).toHaveBeenCalledWith('#/');
    expect(session.left).toBe(1);
    expect(session.disposed).toBe(1);
  });

  it('keeps a solo game with 10 own actions: checkpoint, Home, "Game saved" with CONTINUE', async () => {
    const games = await gameStore();
    await games.create({ code: 'p-long', key: '', kind: 'solo', format: '1v1', decks: 'constructed' });
    const session = fakeSession('p-long');
    for (let i = 1; i <= 10; i++) session.push(tap(i));
    const go = vi.fn();
    const toast = vi.fn();
    const cp = createCheckpointer(session, games, { doc: null, win: null });
    expect(await leaveTable({ session, kind: 'practice', code: 'p-long', games, go, toast, checkpointer: cp })).toBe('left');
    const g = await games.get('p-long');
    expect(g).toMatchObject({ actions: 10 });
    expect(g?.leftAt).toBeTypeOf('number');
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0]![0]).toBe(LEFT_SOLO);
    toast.mock.calls[0]![1].run();
    expect(go).toHaveBeenLastCalledWith('#/p/p-long');
  });

  it('a networked table: the game goes on, REJOIN opens the room again', async () => {
    const games = await gameStore();
    await games.create({ code: 'amber-fox-93', key: 'KEY', kind: 'private', format: '1v1', decks: 'constructed' });
    const session = fakeSession('amber-fox-93');
    const go = vi.fn();
    const toast = vi.fn();
    expect(await leaveTable({ session, kind: 'room', code: 'amber-fox-93', games, go, toast })).toBe('left');
    expect(toast.mock.calls[0]![0]).toBe(LEFT_NETWORKED);
    expect(toast.mock.calls[0]![1].label).toBe('Rejoin');
    toast.mock.calls[0]![1].run();
    expect(go).toHaveBeenLastCalledWith('#/t/amber-fox-93/KEY');
    expect(await games.get('amber-fox-93')).not.toBeNull();
  });
});
