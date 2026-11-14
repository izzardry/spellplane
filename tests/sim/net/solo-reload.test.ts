/**
 * PLAN M5-P6 (owner decision, folded in from the M4 gate): "solo actions survive a reload after a disconnect". A page
 * that is cut off from the room by a real disconnect plays on alone (its engine sequences its own actions), and is then
 * reloaded instead of reconnected. When it meets the room again, the room's history wins (DESIGN "Multiplayer
 * architecture", Resume: "later arrivals reconcile"), and the actions its player made alone are proposed again to the
 * room's sequencer, as they are when the page reconnects without a reload (decision M1-P1: own actions of an abandoned
 * part are proposed again). Before M5 the reloaded page knew its own actions by cid in memory only and lost them
 * (docs/gates/M4.md, "Solo actions after a reload").
 *
 * A reload is modelled as the browser does it (tests/sim/net/reload.test.ts): the page's transport goes and it comes
 * back as a new engine with the same identity and a new transport id, started from its save — the snapshot it began
 * with plus every action its engine reported sequenced.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../../../src/core/actions';
import type { TableState } from '../../../src/core/types';
import type { SequencedAction } from '../../../src/net/messages';
import { ownOfTail } from '../../../src/net/engine';
import { applySequenced } from '../../../src/net/sequencer';
import { AWAY_AFTER_MS } from '../../../src/net/types';
import { aloneInRoom, SNAPSHOT_EVERY, TablePersistence } from '../../../src/session/persist';
import type { LogRecord, TableRecord, TableStore } from '../../../src/store/types';
import { agreed, baseTable, expectConverged, makeSim, until, type SimPeer } from './sim';

vi.mock('../../../src/net/identity', async () => (await import('./fake-identity')).fakeIdentityModule);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const tid = (p: SimPeer): string => p.transport.selfId;
const life = (p: SimPeer, cid: string, delta = -1): Action => ({ type: 'life', by: p.seat, cid, seat: p.seat, delta });

/** What `p` saved: every action its engine reported sequenced after `startSeq`, up to its head, gap-free. */
function saved(p: SimPeer, startSeq: number): SequencedAction[] {
  const tail: SequencedAction[] = [];
  for (let q = startSeq + 1; q <= p.engine.seq(); q++) {
    const a = p.log.get(q);
    if (!a) break;
    tail.push(a);
  }
  return tail;
}

type Who = 'sequencer' | 'follower';

const FAULTS = [
  { what: 'a quiet network', faults: { delay: { min: 5, max: 40 } } },
  { what: 'delay, reordering and drop', faults: { delay: { min: 0, max: 250 }, drop: 0.05 } },
];

async function scenario(who: Who, seed: number, faults: object, extra: (cut: SimPeer) => Action[] = () => []) {
  const start = baseTable(3);
  const sim = makeSim({ engines: 3, seats: 3, start, seed, ...faults });
  await until(() => agreed(sim.peers), 20_000, 'connection');
  const [a, b, c] = sim.peers as [SimPeer, SimPeer, SimPeer];
  for (let i = 0; i < 3; i++) {
    for (const p of [a, b, c]) p.engine.propose(life(p, `${p.peerId}-before-${i}`));
    await vi.advanceTimersByTimeAsync(60);
  }
  await expectConverged(sim.peers);
  // A real disconnect: the others see the page go, and it sees them go.
  const cut = who === 'sequencer' ? a : b;
  const room = sim.peers.filter((p) => p !== cut);
  sim.net.kill(tid(cut));
  await vi.advanceTimersByTimeAsync(AWAY_AFTER_MS + 2000);
  // The cut-off page plays alone: its engine sequences its player's actions by itself.
  const alone: Action[] = [life(cut, 'alone-1', -2), { type: 'counter', by: cut.seat, cid: 'alone-2', card: cut.index === 0 ? 'a00' : 'b00', kind: '+1/+1', delta: 1 } as Action, life(cut, 'alone-3', -3), ...extra(cut)];
  for (const x of alone) {
    expect(cut.engine.propose(x), `${x.cid} applies on the cut-off page`).toBe(true);
    await vi.advanceTimersByTimeAsync(30);
  }
  await until(() => alone.every((x) => cut.acked.has(x.cid)), 20_000, 'the solo actions to be sequenced alone');
  // The room plays on meanwhile, past the cut-off page's head, so its history is the one that wins.
  for (let i = 0; i < 6; i++) {
    for (const p of room) p.engine.propose(life(p, `${p.peerId}-room-${i}`));
    await vi.advanceTimersByTimeAsync(60);
  }
  await expectConverged(room);
  // The page is reloaded, not reconnected: a new engine (new transport id) from its save.
  const save = saved(cut, start.seq);
  for (const x of alone) expect(save.some((s) => s.cid === x.cid), `${x.cid} is in the save`).toBe(true);
  cut.engine.leave();
  const back = sim.add(cut.index, start, 'player', save);
  const everyone = [...room, back];
  await until(() => agreed(everyone), 30_000, 'back at the table');
  await until(() => alone.every((x) => [...everyone[0]!.log.values()].some((s) => s.cid === x.cid) || back.rolledBack.has(x.cid)), 30_000, 'the solo actions to be answered');
  await expectConverged(everyone);
  return { sim, start, cut, back, room, alone, everyone, save };
}

describe('solo actions survive a reload after a real disconnect (M4 gate follow-up)', () => {
  it.each(FAULTS.flatMap((f) => (['follower', 'sequencer'] as Who[]).map((who) => ({ who, ...f }))))(
    'the $who page, cut off and reloaded, gets the actions it made alone into the room’s history ($what)',
    async ({ who, faults }) => {
      for (const seed of [3, 8]) {
        const { back, alone, everyone } = await scenario(who, seed, faults);
        const history = [...everyone[0]!.log.values()];
        for (const x of alone) {
          expect(history.filter((s) => s.cid === x.cid).length, `seed ${seed}: ${x.cid} sequenced once in the room’s history`).toBe(1);
          expect(back.rolledBack.has(x.cid), `seed ${seed}: ${x.cid} not refused`).toBe(false);
        }
        // Their effect is on the table everyone shares: the life total counts the two solo losses on top of the rest.
        const seat = everyone[0]!.engine.confirmedState().seats[back.seat]!;
        expect(seat.life, `seed ${seed}`).toBe(20 - 3 - 2 - 3);
        // The room's own actions are all kept as well.
        for (const p of everyone.filter((q) => q !== back)) for (let i = 0; i < 6; i++) expect(history.some((s) => s.cid === `${p.peerId}-room-${i}`)).toBe(true);
      }
    },
    120_000,
  );

  it('the sequencer’s own records of the solo stretch (away, sequencerClaim) are not proposed again', async () => {
    const { back, save } = { ...(await scenario('follower', 5, FAULTS[0]!.faults)) };
    // The cut-off page claimed the room for itself and marked the others away while alone: those records are in its
    // save, and none of them goes out again (the room's sequencer derives its own).
    expect(save.some((x) => x.type === 'away' || x.type === 'sequencerClaim')).toBe(true);
    const proposed = back.engine.messages().filter((r) => r.dir === 'out' && r.msg.t === 'propose').map((r) => (r.msg as unknown as { action: Action }).action);
    expect(proposed.some((x) => x.type === 'away' || x.type === 'sequencerClaim')).toBe(false);
  }, 120_000);

  it('only this identity’s own actions are proposed again, never another seat’s from the save', async () => {
    const { back } = await scenario('follower', 4, FAULTS[0]!.faults);
    const proposed = back.engine.messages().filter((r) => r.dir === 'out' && r.msg.t === 'propose').map((r) => (r.msg as unknown as { action: Action }).action);
    expect(proposed.length).toBeGreaterThan(0);
    for (const x of proposed) expect(x.by).toBe(back.seat);
  }, 120_000);
});

/** A table store in memory: the record and the log as session/persist.ts writes them (what a reload reads back). */
function memoryStore(): TableStore & { record: () => TableRecord | null; log: Map<number, LogRecord> } {
  let record: TableRecord | null = null;
  const log = new Map<number, LogRecord>();
  const no = (): never => {
    throw new Error('not used');
  };
  return {
    record: () => record,
    log,
    saveAction(_roomId, entry, table) {
      log.set(entry.seq, entry);
      record = table;
      return Promise.resolve();
    },
    saveSnapshot(table) {
      record = table;
      return Promise.resolve();
    },
    saveSecrets: () => Promise.resolve(),
    loadTable: no,
    loadLog: no,
    listTables: no,
    deleteTable: no,
  };
}

/**
 * The page's real save (session/net.ts): every action its engine reports sequenced goes through a TablePersistence,
 * folded the way the session folds them, with the networked session's snapshot hold (`aloneInRoom`) or none.
 */
function persistFor(p: SimPeer, start: { seq: number; state: TableState }, hold: boolean) {
  const store = memoryStore();
  const saves = new TablePersistence({
    store,
    roomId: 'room',
    roomKey: 'key',
    seat: () => p.seat,
    onError: (text) => {
      throw new Error(text);
    },
    now: () => 0,
    snapshot: start.state,
    snapshotSeq: start.seq,
    lastSeq: start.seq,
    ...(hold ? { holdSnapshot: () => aloneInRoom(p.engine) } : {}),
  });
  let fold = start.state;
  p.engine.onSequenced((a) => {
    fold = a.seq === fold.seq + 1 ? applySequenced(fold, a) : p.engine.confirmedState();
    saves.saveAction(a, fold, null);
  });
  /** What a reload reads: the record's snapshot and the stored log after it up to `lastSeq`. */
  const load = async () => {
    await saves.whenSaved();
    const r = store.record()!;
    const tail: SequencedAction[] = [];
    for (let q = r.snapshotSeq + 1; q <= r.lastSeq; q++) tail.push(store.log.get(q)!.action as SequencedAction);
    return { snapshot: { seq: r.snapshotSeq, state: r.snapshot! }, tail };
  };
  return { load };
}

describe('a solo stretch that crosses a periodic snapshot of the save (review M5-P6 round 3)', () => {
  /**
   * The save moves its snapshot every SNAPSHOT_EVERY actions. A stretch the page plays alone that crosses such a seq
   * would leave its first actions inside the stored snapshot, where the reloaded engine cannot find them to propose
   * again: the room's history would lose them. While no other peer is connected the save keeps its snapshot below the
   * stretch (session/persist.ts `holdSnapshot`).
   */
  async function crossing(who: Who, seed: number, hold: boolean) {
    const start = baseTable(3);
    const sim = makeSim({ engines: 3, seats: 3, start, seed, delay: { min: 5, max: 40 } });
    const cut = who === 'sequencer' ? sim.peers[0]! : sim.peers[1]!;
    const save = persistFor(cut, start, hold);
    await until(() => agreed(sim.peers), 20_000, 'connection');
    const room = sim.peers.filter((p) => p !== cut);
    // Play up to a few seqs below a snapshot seq, so the solo stretch crosses it.
    for (let i = 0; cut.engine.seq() < SNAPSHOT_EVERY - 8; i++) {
      for (const p of sim.peers) p.engine.propose(life(p, `${p.peerId}-before-${i}`, 0));
      await vi.advanceTimersByTimeAsync(60);
    }
    await expectConverged(sim.peers);
    sim.net.kill(tid(cut));
    await vi.advanceTimersByTimeAsync(AWAY_AFTER_MS + 2000);
    const alone: Action[] = Array.from({ length: 12 }, (_, i) => life(cut, `alone-${i + 1}`, -1));
    for (const x of alone) {
      expect(cut.engine.propose(x)).toBe(true);
      await vi.advanceTimersByTimeAsync(30);
    }
    await until(() => alone.every((x) => cut.acked.has(x.cid)), 20_000, 'the solo actions to be sequenced alone');
    const seqs = alone.map((x) => [...cut.log.values()].find((s) => s.cid === x.cid)!.seq);
    // The snapshot seq falls inside the stretch, after its first action.
    expect(seqs[0]! < SNAPSHOT_EVERY && SNAPSHOT_EVERY <= seqs.at(-1)!, `stretch ${seqs[0]}..${seqs.at(-1)}`).toBe(true);
    for (let i = 0; i < 12; i++) {
      for (const p of room) p.engine.propose(life(p, `${p.peerId}-room-${i}`, 0));
      await vi.advanceTimersByTimeAsync(60);
    }
    await expectConverged(room);
    const saved = await save.load();
    cut.engine.leave();
    return { sim, cut, room, alone, seqs, saved };
  }

  it('without the hold the stored snapshot lands inside the stretch (the case this guards)', async () => {
    const { saved, seqs } = await crossing('follower', 3, false);
    expect(saved.snapshot.seq).toBe(SNAPSHOT_EVERY);
    expect(saved.snapshot.seq).toBeGreaterThanOrEqual(seqs[0]!);
  }, 120_000);

  it('a save whose snapshot does cover part of the stretch: the fork is found at the snapshot, not later as a reducer bug', async () => {
    // A save written without the hold (or by a page that noticed the cut-off only after the snapshot): the reloaded
    // engine cannot compare anything below its restored snapshot, so a fork at the first seq after it loads the
    // sequencer's snapshot at once. The solo actions after the stored snapshot still reach the room; those inside it
    // cannot be told apart from the rest of the snapshot (the hold above keeps them out of it).
    for (const seed of [3, 8]) {
      const { sim, cut, room, alone, seqs, saved } = await crossing('follower', seed, false);
      expect(saved.snapshot.seq).toBe(SNAPSHOT_EVERY);
      const back = sim.add(cut.index, saved.snapshot, 'player', saved.tail);
      const everyone = [...room, back];
      await until(() => agreed(everyone), 30_000, 'back at the table');
      const after = alone.filter((_, i) => seqs[i]! > saved.snapshot.seq);
      expect(after.length).toBeGreaterThan(0);
      await until(() => after.every((x) => [...everyone[0]!.log.values()].some((s) => s.cid === x.cid) || back.rolledBack.has(x.cid)), 30_000, 'the solo actions to be answered');
      await expectConverged(everyone);
      const history = [...everyone[0]!.log.values()];
      for (const x of after) expect(history.filter((s) => s.cid === x.cid).length, `seed ${seed}: ${x.cid} sequenced once`).toBe(1);
      expect(back.system.some((t) => /diverged at or before seq/.test(t)), `seed ${seed}: ${back.system.join(' | ')}`).toBe(true);
      expect(back.system.some((t) => /hash mismatch/i.test(t)), `seed ${seed}: ${back.system.join(' | ')}`).toBe(false);
    }
  }, 240_000);

  it.each(['follower', 'sequencer'] as Who[])('the %s page keeps its snapshot below the stretch, and after a reload every solo action reaches the room', async (who) => {
    for (const seed of [3, 8]) {
      const { sim, cut, room, alone, seqs, saved } = await crossing(who, seed, true);
      expect(saved.snapshot.seq, `seed ${seed}`).toBeLessThan(seqs[0]!);
      const back = sim.add(cut.index, saved.snapshot, 'player', saved.tail);
      const everyone = [...room, back];
      await until(() => agreed(everyone), 30_000, 'back at the table');
      await until(() => alone.every((x) => [...everyone[0]!.log.values()].some((s) => s.cid === x.cid) || back.rolledBack.has(x.cid)), 30_000, 'the solo actions to be answered');
      await expectConverged(everyone);
      const history = [...everyone[0]!.log.values()];
      for (const x of alone) expect(history.filter((s) => s.cid === x.cid).length, `seed ${seed}: ${x.cid} sequenced once`).toBe(1);
      expect(everyone[0]!.engine.confirmedState().seats[back.seat]!.life, `seed ${seed}`).toBe(20 - alone.length);
      // Nothing was taken for a reducer bug: the fork was found where it lies.
      expect(back.system.some((t) => /hash mismatch/i.test(t)), `seed ${seed}: ${back.system.join(' | ')}`).toBe(false);
    }
  }, 240_000);
});

describe('which stored actions are this identity’s own after a reload (net/engine.ts ownOfTail)', () => {
  const start = baseTable(3).state;
  const me = start.seats.s1!.peer!;
  const a = (x: object): Action => x as Action;

  it('actions of the seat it holds, never the sequencer’s records of its own view', () => {
    const tail = [
      a({ type: 'life', by: 's1', cid: 'mine', seat: 's1', delta: -1 }),
      a({ type: 'life', by: 's0', cid: 'theirs', seat: 's0', delta: -1 }),
      a({ type: 'away', by: 's1', cid: 'duty', seat: 's0', away: true }),
      a({ type: 'sequencerClaim', by: 's1', cid: 'claim' }),
    ];
    expect(ownOfTail(start, tail, me)).toEqual(['mine']);
  });

  it('a chair taken over from an earlier holder: only what follows its own seatTake is its own', () => {
    // The identity starts without a seat; s2's holder plays, leaves, and this identity takes s2.
    const free = structuredClone(start);
    delete free.seats.s1!.peer;
    const tail = [
      a({ type: 'life', by: 's2', cid: 'before', seat: 's2', delta: -1 }),
      a({ type: 'seatLeave', by: 's2', cid: 'leave', seat: 's2' }),
      a({ type: 'seatTake', by: 's2', cid: 'take', seat: 's2', name: 'Me', colour: 2, peer: me }),
      a({ type: 'life', by: 's2', cid: 'after', seat: 's2', delta: -1 }),
      a({ type: 'seatLeave', by: 's2', cid: 'gone', seat: 's2' }),
      a({ type: 'life', by: 's2', cid: 'later', seat: 's2', delta: -1 }),
    ];
    expect(ownOfTail(free, tail, me)).toEqual(['take', 'after', 'gone']);
  });
});
