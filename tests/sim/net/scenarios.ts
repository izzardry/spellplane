/**
 * The M1-P1 acceptance scenarios (PLAN M1-P1), parameterised by seed so the acceptance test runs them with fixed
 * seeds and the sweep test (tests/sim/net/sweep.test.ts) runs them with many. Each asserts the design's behaviour:
 * DESIGN "Multiplayer architecture" (Shared state: a sequenced action log) and "Specification: network protocol and
 * secrecy" (Sequencing, Liveness, Sync). Call inside Vitest fake timers.
 */
import { expect, vi } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { checkInvariants } from '../../../src/core/invariants';
import type { TableState } from '../../../src/core/types';
import { AWAY_AFTER_MS } from '../../../src/net/types';
import { mulberry32 } from '../../../src/util/prng';
import { randomAction } from './random-actions';
import { agreed, baseTable, expectConverged, hashOf, makeSim, until, type Sim, type SimPeer } from './sim';

/** The acceptance faults: random delay up to 400 ms (hence reordering) and 5% drop, on every channel. */
export const FAULTS = { delay: { min: 0, max: 400 }, drop: 0.05 };

/**
 * Handover bounds. A sequencer whose peers see it leave is replaced within the away timeout (DESIGN: a peer silent
 * for 6 s is away); one that just falls silent is first detected by that timeout, then replaced within a few round
 * trips of claim, claimAck and catch-up, each resent after a lost message (decision M1-P1: 5 s).
 */
export const HANDOVER_BOUND_MS = { leave: AWAY_AFTER_MS, silent: AWAY_AFTER_MS + 5000 };

/** Dispatch `count` locally accepted random actions from random live engines, at most `gapMs` apart. */
export async function stream(
  sim: Sim,
  count: number,
  rand: () => number,
  opts: { gapMs?: number; from?: () => SimPeer[]; onEach?: (n: number) => void } = {},
): Promise<number> {
  let accepted = 0;
  let tries = 0;
  while (accepted < count) {
    const live = (opts.from ?? (() => sim.live()))();
    const p = live[Math.floor(rand() * live.length)]!;
    const a = randomAction(p.engine.state(), p.seat, rand, `${p.peerId}-${p.proposed.length}-${tries++}`);
    if (a && p.engine.propose(a)) {
      p.proposed.push(a.cid);
      accepted++;
      opts.onEach?.(accepted);
    }
    await vi.advanceTimersByTimeAsync(Math.floor(rand() * (opts.gapMs ?? 40)));
  }
  return accepted;
}

/** The (seq -> cid) log an engine applied in order, required gap-free over [from, to]. */
export function fullLog(p: SimPeer, from: number, to: number): string[] {
  const out: string[] = [];
  for (let s = from; s <= to; s++) {
    const a = p.log.get(s);
    if (!a) throw new Error(`${p.peerId} has no seq ${s} in its applied log`);
    out.push(a.cid);
  }
  return out;
}

/** Acceptance 1: `n` engines, 2,000 random actions under faults, one state hash. */
export async function convergence(n: number, seed: number): Promise<void> {
  const start = baseTable(4);
  const sim = makeSim({ engines: n, start, seed, ...FAULTS });
  await until(() => agreed(sim.peers), 20_000, 'connection');
  const rand = mulberry32(seed * 7 + 1);
  await stream(sim, 2000, rand);
  const h = await expectConverged(sim.peers, 120_000);

  const final = sim.peers[0]!.engine.confirmedState();
  expect(checkInvariants(final)).toEqual([]);
  const sequenced = final.seq - start.seq;
  // The stream really went through the sequencer: most actions were sequenced, colliding ones refused.
  expect(sequenced).toBeGreaterThan(1600);
  const rolledBack = sim.peers.reduce((k, p) => k + p.rolledBack.size, 0);
  for (const p of sim.peers) {
    const cids = fullLog(p, start.seq + 1, final.seq);
    expect(new Set(cids).size, `${p.peerId}: every action sequenced once`).toBe(cids.length);
  }
  // Every locally accepted action was either sequenced exactly once or rolled back after a nack.
  const log = new Set(fullLog(sim.peers[0]!, start.seq + 1, final.seq));
  for (const p of sim.peers) for (const cid of p.proposed) expect(log.has(cid) !== p.rolledBack.has(cid), `${cid} sequenced xor rolled back`).toBe(true);
  expect(sequenced).toBe(2000 - rolledBack);
  expect(hashOf(final)).toBe(h);
}

/**
 * Acceptance 2: kill the sequencer (seat 0) half way through a 600-action stream from all four engines. `silent`
 * makes it fall silent without the transport reporting a leave (a crash or dead link), so only the away timeout
 * detects it.
 */
export async function handover(seed: number, silent: boolean): Promise<void> {
  const start = baseTable(4);
  const sim = makeSim({ engines: 4, start, seed, ...FAULTS });
  await until(() => agreed(sim.peers), 20_000, 'connection');
  const old = sim.peers.find((p) => p.engine.isSequencing())!;
  expect(old.peerId).toBe('peer0'); // the lowest seat sequences
  const rand = mulberry32(seed * 11 + 3);
  const survivors = (): SimPeer[] => sim.peers.filter((p) => p !== old);
  let killedAt = -1;
  const before = new Map<number, string>();
  await stream(sim, 600, rand, {
    from: () => (killedAt < 0 ? sim.peers : survivors()),
    onEach: (k) => {
      if (k !== 300) return;
      // What a survivor has applied was acknowledged by the table; it must keep its place after the handover.
      for (const p of survivors()) for (const [s, a] of p.log) before.set(s, a.cid);
      killedAt = Date.now();
      if (silent) old.transport.silent = true;
      else sim.net.kill(old.transport.selfId);
    },
  });
  const tookMs = (await until(() => agreed(survivors()), 30_000, 'handover', 50).then(() => Date.now())) - killedAt;
  const h = await expectConverged(survivors(), 120_000);
  const next = survivors().find((p) => p.engine.isSequencing())!;
  expect(next.peerId).toBe('peer1'); // the connected seat with the lowest index
  // The stream kept going after the kill, so "agreed" may come late; the handover itself is bounded by when the
  // first action proposed after the kill got sequenced.
  expect(tookMs).toBeGreaterThanOrEqual(0);

  const final = survivors()[0]!.engine.confirmedState();
  const log = new Map<number, string>();
  for (const p of survivors()) {
    for (const [s, a] of p.log) {
      const other = log.get(s);
      if (other !== undefined) expect(a.cid, `seq ${s} agrees across survivors`).toBe(other);
      log.set(s, a.cid);
    }
  }
  for (const [s, cid] of before) expect(log.get(s), `acknowledged seq ${s} kept its place`).toBe(cid);
  const cids = [...log.values()];
  expect(new Set(cids).size, 'no action sequenced twice').toBe(cids.length);
  const inLog = new Set(cids);
  for (const p of survivors()) {
    for (const cid of p.acked) expect(inLog.has(cid), `acknowledged ${cid} is in the log`).toBe(true);
    for (const cid of p.proposed) expect(inLog.has(cid) !== p.rolledBack.has(cid), `${cid} sequenced xor rolled back`).toBe(true);
  }
  expect(final.seq).toBe(Math.max(...log.keys()));
  expect(hashOf(final)).toBe(h);
  expect(survivors().some((p) => p.system.some((t) => /now sequences/.test(t)))).toBe(true);
}

/**
 * Acceptance 2, timing: after the kill, a survivor's action is sequenced within the handover bound. Nothing else is
 * proposed meanwhile, so the measured time is the detection plus the claim.
 */
export async function handoverTime(seed: number, silent: boolean): Promise<number> {
  const start = baseTable(4);
  const sim = makeSim({ engines: 4, start, seed, ...FAULTS });
  await until(() => agreed(sim.peers), 20_000, 'connection');
  const old = sim.peers[0]!;
  expect(old.engine.isSequencing()).toBe(true);
  await stream(sim, 100, mulberry32(seed));
  await expectConverged(sim.peers, 60_000);
  const survivor = sim.peers[2]!;
  const t0 = Date.now();
  if (silent) old.transport.silent = true;
  else sim.net.kill(old.transport.selfId);
  const action: Action = { type: 'life', by: survivor.seat, cid: `after-kill-${seed}`, seat: survivor.seat, delta: -3 };
  expect(survivor.engine.propose(action)).toBe(true);
  await until(() => survivor.acked.has(action.cid), 30_000, 'the first action after the kill to be sequenced', 50);
  const took = Date.now() - t0;
  expect(took).toBeLessThanOrEqual(silent ? HANDOVER_BOUND_MS.silent : HANDOVER_BOUND_MS.leave);
  await expectConverged(sim.peers.slice(1), 60_000);
  return took;
}

/** Acceptance 3: a fourth engine joins after 400 or 800 actions from a fresh seq-0 table or an older save. */
export async function lateJoiner(seed: number, mode: 'fresh' | 'tail' | 'far'): Promise<void> {
  const start = baseTable(4);
  const sim = makeSim({ engines: 3, start, seed, ...FAULTS });
  await until(() => agreed(sim.peers), 20_000, 'connection');
  const rand = mulberry32(seed * 13 + 5);
  let save: { seq: number; state: TableState } = start;
  await stream(sim, mode === 'tail' ? 400 : 800, rand, {
    onEach: (k) => {
      if (mode === 'tail' && k === 100) save = { seq: sim.peers[1]!.engine.seq(), state: sim.peers[1]!.engine.confirmedState() };
    },
  });
  await expectConverged(sim.peers, 60_000);
  // A browser with nothing saved starts from its own seq-0 table, which need not match the room's (two seats here).
  const from = mode === 'fresh' ? { seq: 0, state: { ...baseTable(2).state, seq: 0 } } : save;
  const behind = sim.peers[0]!.engine.seq() - from.seq;
  if (mode === 'far') expect(behind).toBeGreaterThan(500);
  if (mode === 'tail') expect(behind).toBeLessThanOrEqual(500);
  const joiner = sim.add(3, from);
  await until(() => agreed(sim.peers), 30_000, 'the joiner connected');
  await expectConverged(sim.peers, 60_000);
  // The joiner then plays along with everyone else.
  await stream(sim, 200, rand);
  const h = await expectConverged(sim.peers, 60_000);
  expect(hashOf(joiner.engine.confirmedState())).toBe(h);
  expect(joiner.proposed.length).toBeGreaterThan(0);
  expect(joiner.acked.size).toBeGreaterThan(0);
}

/** Acceptance 4: two players drop the same card within 0–150 ms of each other, 40 times. */
export async function concurrentDrags(seed: number): Promise<void> {
  const start = baseTable(4);
  const sim = makeSim({ engines: 3, start, seed, ...FAULTS });
  await until(() => agreed(sim.peers), 20_000, 'connection');
  const rand = mulberry32(seed * 17 + 7);
  const cardIds = Object.values(start.state.cards)
    .filter((c) => c.zone.startsWith('battlefield:'))
    .map((c) => c.id)
    .sort();
  for (let trial = 0; trial < 40; trial++) {
    const card = cardIds[trial % cardIds.length]!;
    // Two different players, the sequencer among them in some trials.
    const i = trial % 3;
    const j = (i + 1 + (trial % 2)) % 3;
    const a = sim.peers[i]!;
    const b = sim.peers[j]!;
    const mk = (p: SimPeer, x: number): Action & { type: 'move' } => ({ type: 'move', by: p.seat, cid: `drag-${trial}-${p.peerId}`, card, to: `battlefield:${p.seat}`, pose: { x, y: trial, rot: 0 } });
    const moveA = mk(a, 100 + trial);
    const moveB = mk(b, -100 - trial);
    const [first, second] = rand() < 0.5 ? [a, b] : [b, a];
    expect(first.engine.propose(first === a ? moveA : moveB)).toBe(true);
    await vi.advanceTimersByTimeAsync(Math.floor(rand() * 150));
    expect(second.engine.propose(second === a ? moveA : moveB)).toBe(true);
    await expectConverged(sim.peers, 60_000);
    const seqOf = (cid: string): number => [...sim.peers[0]!.log.values()].find((x) => x.cid === cid)?.seq ?? -1;
    const [sa, sb] = [seqOf(moveA.cid), seqOf(moveB.cid)];
    expect(sa, 'both moves are sequenced').toBeGreaterThan(0);
    expect(sb, 'both moves are sequenced').toBeGreaterThan(0);
    const last = sa > sb ? moveA : moveB;
    for (const p of sim.peers) {
      const c = p.engine.state().cards[card]!;
      expect(c.zone).toBe(last.to);
      expect(c.pose).toEqual(last.pose);
    }
  }
}

/**
 * The sequencer comes back (DESIGN "Multiplayer architecture": the sequencer page closed and reopened; M1 gate):
 * seat 0 is killed (or falls silent) mid-stream, the others play on under the next sequencer, then seat 0 returns
 * with its stale replica. By rule 1 it sequences again, but only after taking over from the history everyone
 * acknowledged: nothing the others sequenced meanwhile is lost, nothing is sequenced twice.
 */
export async function sequencerReturns(seed: number, silent: boolean): Promise<void> {
  const start = baseTable(4);
  const sim = makeSim({ engines: 4, start, seed, ...FAULTS });
  await until(() => agreed(sim.peers), 20_000, 'connection');
  const old = sim.peers[0]!;
  const rand = mulberry32(seed * 19 + 11);
  const others = (): SimPeer[] => sim.peers.filter((p) => p !== old);
  await stream(sim, 300, rand);
  if (silent) old.transport.silent = true;
  else sim.net.kill(old.transport.selfId);
  await stream(sim, 200, rand, { from: others });
  await until(() => agreed(others()), 30_000, 'handover');
  const acknowledged = new Map<number, string>();
  for (const p of others()) for (const [s, a] of p.log) acknowledged.set(s, a.cid);
  if (silent) old.transport.silent = false;
  else sim.net.revive(old.transport.selfId);
  await until(() => agreed(sim.peers), 30_000, 'the old sequencer back');
  expect(old.engine.isSequencing()).toBe(true);
  await stream(sim, 150, rand);
  await expectConverged(sim.peers, 120_000);
  const log = new Map<number, string>();
  for (const p of others()) for (const [s, a] of p.log) log.set(s, a.cid);
  for (const [s, cid] of acknowledged) expect(log.get(s), `seq ${s} acknowledged before the return`).toBe(cid);
  const cids = [...log.values()];
  expect(new Set(cids).size, 'no action sequenced twice').toBe(cids.length);
  const inLog = new Set(cids);
  for (const p of others()) {
    for (const cid of p.acked) expect(inLog.has(cid), `acknowledged ${cid}`).toBe(true);
    for (const cid of p.proposed) expect(inLog.has(cid) !== p.rolledBack.has(cid), `${cid} sequenced xor rolled back`).toBe(true);
  }
  for (const cid of old.proposed) expect(inLog.has(cid) !== old.rolledBack.has(cid), `${cid} sequenced xor rolled back`).toBe(true);
}
