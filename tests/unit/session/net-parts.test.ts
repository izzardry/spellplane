/**
 * The networked session's smaller parts (PLAN M1-P8): the shared table save (session/persist.ts: one transaction per
 * action, a snapshot every 200 actions and whenever the stored log could have a hole), the open-round nonce store
 * (session/nonces.ts), the live identity the lobby renames (session/live-identity.ts), the killable transport behind
 * the debug hook (session/transports.ts) and the disclosed set rebuilt from a stored log (session/net.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { createTable, reduce } from '../../../src/core/reducer';
import type { SecretStore, TableState } from '../../../src/core/types';
import { mtg } from '../../../src/games/index';
import { LoopbackNetwork } from '../../../src/net/loopback';
import { liveIdentity } from '../../../src/session/live-identity';
import { exposedFromLog, freshNetTable } from '../../../src/session/net';
import { localNonces, memoryNonces } from '../../../src/session/nonces';
import { SNAPSHOT_EVERY, TablePersistence } from '../../../src/session/persist';
import { KillableTransport, SilentTransport, UnreachableTransport } from '../../../src/session/transports';
import type { IdentityRecord, IdentityStore } from '../../../src/store/types';
import { closeStores, stores } from './helpers';

afterEach(() => {
  closeStores();
  vi.useRealTimers();
});

function table(): TableState {
  return createTable({ game: mtg, format: '1v1', seats: [{ name: 'Ann', colour: 0, peer: 'pa' }, { name: 'Ben', colour: 1, peer: 'pb' }] });
}

/** `n` life actions after `state`, each with its state after it. */
function steps(state: TableState, n: number): { action: Action; after: TableState }[] {
  const out: { action: Action; after: TableState }[] = [];
  let s = state;
  for (let i = 0; i < n; i++) {
    const action = { type: 'life', by: 's0', cid: `c${s.seq + 1}`, seat: 's0', delta: -1, seq: s.seq + 1 } as Action;
    s = reduce(s, action);
    out.push({ action, after: s });
  }
  return out;
}

const SECRETS: SecretStore = { seat: 's0', identities: {}, libraryOrder: [], hand: [], audit: [], received: {} };

describe('session/persist.ts TablePersistence', () => {
  async function saver(start: TableState) {
    const s = await stores();
    const errors: string[] = [];
    const p = new TablePersistence({ store: s.tables, roomId: 'room-1', roomKey: 'key', seat: () => 's0', onError: (t) => errors.push(t), now: () => 1, snapshot: start, snapshotSeq: start.seq, lastSeq: start.seq });
    return { s, p, errors };
  }

  it('writes each following action with the record unchanged, and rebases every SNAPSHOT_EVERY actions', async () => {
    const start = table();
    const { s, p } = await saver(start);
    p.saveBase(start, SECRETS);
    for (const { action, after } of steps(start, SNAPSHOT_EVERY + 3)) p.saveAction(action, after, SECRETS);
    await p.whenSaved();
    const loaded = (await s.tables.loadTable('room-1'))!;
    expect(loaded.table).toMatchObject({ roomKey: 'key', seat: 's0', lastSeq: SNAPSHOT_EVERY + 3, snapshotSeq: SNAPSHOT_EVERY });
    expect(loaded.table.snapshot!.seq).toBe(SNAPSHOT_EVERY);
    expect(loaded.log.map((r) => r.seq)).toEqual([SNAPSHOT_EVERY + 1, SNAPSHOT_EVERY + 2, SNAPSHOT_EVERY + 3]);
  });

  it('an action that does not follow the stored log (a catch-up from a snapshot, a rewind) moves the snapshot to the state handed in', async () => {
    const start = table();
    const { s, p } = await saver(start);
    p.saveBase(start, SECRETS);
    const run = steps(start, 10);
    for (const { action, after } of run.slice(0, 3)) p.saveAction(action, after, SECRETS);
    // A snapshot load: seqs 4..9 never reported; seq 10 arrives with the replica already at seq 10.
    p.saveAction(run[9]!.action, run[9]!.after, SECRETS);
    await p.whenSaved();
    let loaded = (await s.tables.loadTable('room-1'))!;
    expect(loaded.table).toMatchObject({ lastSeq: 10, snapshotSeq: 10 });
    // A rewind: seq 9 of another history, reported with the replica's head at seq 10 again: still a valid record.
    const other = { ...run[8]!.action, cid: 'other-9' } as Action;
    p.saveAction(other, run[9]!.after, SECRETS);
    // A later action of the same step, covered by that snapshot, only adds its log line.
    p.saveAction(run[9]!.action, run[9]!.after, SECRETS);
    await p.whenSaved();
    loaded = (await s.tables.loadTable('room-1'))!;
    expect(loaded.table).toMatchObject({ lastSeq: 10, snapshotSeq: 10 });
    expect((await s.tables.loadLog('room-1')).find((r) => r.seq === 9)!.action.cid).toBe('other-9');
  });

  it('a failed write is reported once and the next write stores a fresh snapshot, so the hole never matters', async () => {
    const start = table();
    const { s, p, errors } = await saver(start);
    p.saveBase(start, SECRETS);
    const run = steps(start, 3);
    const real = s.tables.saveAction.bind(s.tables);
    let fail = true;
    s.tables.saveAction = (...args) => (fail ? ((fail = false), Promise.reject(new Error('disk full'))) : real(...args));
    for (const { action, after } of run) p.saveAction(action, after, SECRETS);
    await p.whenSaved();
    expect(errors).toEqual(['Could not save the table: disk full']);
    const loaded = (await s.tables.loadTable('room-1'))!;
    expect(loaded.table).toMatchObject({ lastSeq: 3, snapshotSeq: 2 });
  });

  it('coalesces secret-store-only writes and keeps the latest', async () => {
    const start = table();
    const { s, p } = await saver(start);
    p.saveBase(start, SECRETS);
    p.saveSecrets({ ...SECRETS, hand: ['a'] });
    p.saveSecrets({ ...SECRETS, hand: ['a', 'b'] });
    await p.whenSaved();
    expect((await s.tables.loadTable('room-1'))!.secrets!.hand).toEqual(['a', 'b']);
  });

  it('a save that replaces another (a rejoin) writes only after the old queue, so a late old write never lands over its record', async () => {
    const start = table();
    const { s, p: old } = await saver(start);
    old.saveBase(start, SECRETS);
    // The old table's last write is slow.
    const real = s.tables.saveAction.bind(s.tables);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    s.tables.saveAction = async (...args) => {
      await gate;
      return real(...args);
    };
    const run = steps(start, 5);
    old.saveAction(run[4]!.action, run[4]!.after, SECRETS);
    const fresh = new TablePersistence({ store: s.tables, roomId: 'room-1', roomKey: 'key', seat: () => 's1', onError: () => {}, now: () => 2, snapshot: start, snapshotSeq: 0, lastSeq: 0, after: old.whenSaved() });
    fresh.saveBase(start, { ...SECRETS, seat: 's1' });
    release();
    await fresh.whenSaved();
    const loaded = (await s.tables.loadTable('room-1'))!;
    expect(loaded.table).toMatchObject({ seat: 's1', lastSeq: 0, snapshotSeq: 0 });
  });
});

describe('session/nonces.ts', () => {
  it('memory nonces keep one nonce per round kind and id', () => {
    const n = memoryNonces();
    n.set('rng', 'r1', 'x');
    n.set('shuffle', 'r1', 'y');
    expect(n.get('rng', 'r1')).toBe('x');
    expect(n.get('shuffle', 'r1')).toBe('y');
    expect(n.ids('rng')).toEqual(['r1']);
    n.delete('rng', 'r1');
    expect(n.get('rng', 'r1')).toBeNull();
  });

  it('local nonces survive a new store over the same local storage, per room and identity', () => {
    const data = new Map<string, string>();
    const ls = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
      key: (i: number) => [...data.keys()][i] ?? null,
      get length() {
        return data.size;
      },
    };
    vi.stubGlobal('localStorage', ls);
    try {
      localNonces('room', 'peer-a').set('rng', 'r9', 'nonce-a');
      expect(localNonces('room', 'peer-a').get('rng', 'r9')).toBe('nonce-a');
      expect(localNonces('room', 'peer-b').get('rng', 'r9')).toBeNull();
      expect(localNonces('other', 'peer-a').get('rng', 'r9')).toBeNull();
      expect(localNonces('room', 'peer-a').ids('rng')).toEqual(['r9']);
      localNonces('room', 'peer-a').delete('rng', 'r9');
      expect(data.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('without local storage the nonces live in memory', () => {
    vi.stubGlobal('localStorage', undefined);
    try {
      const n = localNonces('room', 'peer-a');
      n.set('rng', 'r1', 'x');
      expect(n.get('rng', 'r1')).toBe('x');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('session/live-identity.ts', () => {
  it('a rename through the wrapped store reaches the session identity at once', async () => {
    let record: IdentityRecord = { id: 'me', keyPair: {} as CryptoKeyPair, peerId: 'abc', nickname: '', seatColour: 2 };
    const store: IdentityStore = {
      get: () => Promise.resolve(record),
      setNickname: (n) => Promise.resolve(void (record = { ...record, nickname: n })),
      setSeatColour: (c) => Promise.resolve(void (record = { ...record, seatColour: c })),
    };
    const live = liveIdentity(store);
    const id = await live.identity();
    expect(id).toMatchObject({ peerId: 'abc', nickname: '', seatColour: 2 });
    const renamed = live.store.setNickname('Ann');
    // The session's takeSeat runs right after the lobby's rename, before the store write settled.
    expect(id.nickname).toBe('Ann');
    await renamed;
    expect((await live.store.get()).nickname).toBe('Ann');
    await live.store.setSeatColour(6);
    expect(id.seatColour).toBe(6);
  });
});

describe('session/transports.ts', () => {
  it('a killed transport neither sends nor hears; revived, it does both again', async () => {
    vi.useFakeTimers();
    const network = new LoopbackNetwork();
    const a = new KillableTransport(network.create('a'));
    const b = network.create('b');
    const heardByB: string[] = [];
    const heardByA: string[] = [];
    b.on('ctl', (m) => heardByB.push(m.t));
    a.on('ctl', (m) => heardByA.push(m.t));
    await a.join('r', 'k');
    await b.join('r', 'k');
    await vi.advanceTimersByTimeAsync(5);
    a.kill();
    a.send('ctl', { v: 1, t: 'one' });
    b.send('ctl', { v: 1, t: 'two' });
    await vi.advanceTimersByTimeAsync(5);
    expect([heardByA, heardByB]).toEqual([[], []]);
    a.revive();
    a.send('ctl', { v: 1, t: 'three' });
    b.send('ctl', { v: 1, t: 'four' });
    await vi.advanceTimersByTimeAsync(5);
    expect([heardByA, heardByB]).toEqual([['four'], ['three']]);
  });

  it('the failure stand-ins: a silent network joins and never sees anyone; unreachable relays never let it join', async () => {
    const silent = new SilentTransport('s');
    await silent.join();
    expect(silent.peers()).toEqual([]);
    let joined = false;
    void new UnreachableTransport('u').join().then(() => (joined = true));
    await Promise.resolve();
    expect(joined).toBe(false);
  });
});

describe('session/net.ts', () => {
  it('a fresh networked table has one free chair per seat of the format', () => {
    expect(Object.values(freshNetTable(mtg).seats).map((s) => [s.id, s.name, s.peer])).toEqual([
      ['s0', '', undefined],
      ['s1', '', undefined],
    ]);
    expect(Object.keys(freshNetTable(mtg, 'ffa4').seats)).toEqual(['s0', 's1', 's2', 's3']);
    // Deterministic: a creator's and a joiner's seq-0 tables are the same table.
    expect(freshNetTable(mtg)).toEqual(freshNetTable(mtg));
  });

  it('exposedFromLog: own reveals, flips with an identity, targeted reveals and other seats’ looks; nothing else', () => {
    const st = createTable({ game: mtg, format: '1v1', seats: [{ name: 'A', colour: 0 }, { name: 'B', colour: 1 }] });
    const ids = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
    const state: TableState = reduce(st, { type: 'ready', by: 's0', cid: 'r', seq: 1, commits: ids.map((i) => `h-${i}`), instanceIds: ids, zone: 'library:s0' } as Action);
    const log = [
      { type: 'reveal', by: 's0', instanceId: 'c1', ref: { sid: 'x' }, salt: 's' },
      { type: 'flip', by: 's0', card: 'c2', face: 'up', ref: { sid: 'y' }, salt: 's' },
      { type: 'flip', by: 's0', card: 'c3', face: 'up' },
      { type: 'revealTo', by: 's0', instanceId: 'c4', seats: ['s1'] },
      { type: 'lookAt', by: 's1', zone: 'battlefield:s0', count: 1, card: 'c5' },
      { type: 'lookAt', by: 's0', zone: 'library:s0', count: 6 },
      { type: 'reveal', by: 's1', instanceId: 'c6', ref: { sid: 'z' }, salt: 's' },
    ] as unknown as Action[];
    expect([...exposedFromLog(log, state, 's0')].sort()).toEqual(['c1', 'c2', 'c4', 'c5']);
    // Another seat's look at a whole own zone counts every card in it.
    const look = [{ type: 'lookAt', by: 's1', zone: 'library:s0', count: 1 }] as unknown as Action[];
    expect([...exposedFromLog(look, state, 's0')].sort()).toEqual(ids);
  });
});
