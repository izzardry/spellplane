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
import type { SequencedAction } from '../../../src/net/messages';
import { AWAY_AFTER_MS } from '../../../src/net/types';
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
