/**
 * PLAN M1-P3 acceptance, simulated network: confirmation rounds driven by the sequencer's clock (DESIGN "Turn flow and
 * confirmation", Confirmation rounds; "Specification: network protocol and secrecy", Timers: a round stores
 * `durationMs` and its starting seq, every client animates its own countdown, only the sequencer's clock decides and
 * emits `respond {seat, 'timeout'}` for silent seats).
 *
 * - A stack item starts a round.
 * - Silence passes after the configured duration, on all peers at the same sequence number.
 * - Hold stops the timer (and release restarts it).
 * - An away peer times out.
 * - Resolve before all-pass requires the second press (`force`) and is in the log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionDraft } from '../../../src/core/actions';
import { roundPassed, waitingOn } from '../../../src/core/reducer/confirm';
import { SimTable, type Peer } from './table';

const DELAY = { min: 5, max: 400 };

/** Seats s0 Anna (sequencer), s1 Ben, s2 Cleo; Ben's battlefield holds a public token and his library one card. */
async function table(opts: { names?: string[]; passTimerMs?: number | null; seed?: number } = {}): Promise<SimTable> {
  const t = new SimTable(opts.names ?? ['Anna', 'Ben', 'Cleo'], { seed: opts.seed ?? 7, delay: DELAY }, opts.passTimerMs === undefined ? 5000 : opts.passTimerMs);
  await t.join();
  const ben = t.peer('s1');
  ben.propose({ type: 'createToken', card: 'tok', zone: 'battlefield:s1', pose: { x: 0, y: 200, rot: 180 }, label: 'Treasure' });
  ben.propose({ type: 'ready', commits: ['commit-b1'], instanceIds: ['b1'], zone: 'library:s1' });
  ben.propose({ type: 'reveal', instanceId: 'b1', ref: { sid: 'sid-bolt' }, salt: 'salt-b1' });
  await t.settle();
  converged(t);
  return t;
}

/** Every peer applied the same seqs with the same resulting states. */
function converged(t: SimTable): void {
  const ref = t.peers[0]!;
  for (const p of t.peers.slice(1)) {
    expect(p.applied.map((a) => a.seq)).toEqual(ref.applied.map((a) => a.seq));
    expect(p.applied.map((a) => a.hash)).toEqual(ref.applied.map((a) => a.hash));
  }
}

/** The seq at which each peer recorded a timeout for `seat` in round `round`. */
function timeoutSeqs(peers: Peer[], round: string, seat: string): (number | null)[] {
  return peers.map((p) => p.applied.find((a) => a.action.type === 'respond' && a.action.round === round && a.action.seat === seat && a.action.response === 'timeout')?.seq ?? null);
}

function appliedSeqOf(p: Peer, cid: string): Peer['applied'][number] {
  const a = p.applied.find((x) => x.action.cid === cid);
  if (!a) throw new Error(`${p.seat} never applied ${cid}`);
  return a;
}

const cast = (item: string, round: string): ActionDraft => ({ type: 'stackPush', item, kind: 'spell', card: 'b1', round });
const ability = (item: string, round: string): ActionDraft => ({ type: 'stackPush', item, kind: 'ability', source: 'tok', round });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a stack item starts a round (DESIGN "The effect stack", Stack and confirmation)', () => {
  it('opens a round about the pushed item on every peer, at the same seq', async () => {
    const t = await table();
    const cid = t.peer('s1').propose(cast('i1', 'r1'));
    await t.settle(450);
    const seqs = t.peers.map((p) => appliedSeqOf(p, cid).seq);
    expect(new Set(seqs).size).toBe(1);
    for (const p of t.peers) {
      expect(p.state.confirm).toMatchObject({ id: 'r1', askedBy: 's1', about: 'i1', durationMs: 5000, startSeq: seqs[0], responses: {} });
      expect(waitingOn(p.state)).toEqual(['s0', 's2']);
      expect(roundPassed(p.state)).toBe(false);
    }
    t.stop();
  });
});

describe('silence passes after the configured duration on all peers at the same sequence number', () => {
  it.each([
    { name: '5 s default', passTimerMs: 5000, seed: 3 },
    { name: '2 s', passTimerMs: 2000, seed: 11 },
    { name: '30 s', passTimerMs: 30000, seed: 19 },
  ])('$name', async ({ passTimerMs, seed }) => {
    const t = await table({ passTimerMs, seed });
    const cid = t.peer('s1').propose(cast('i1', 'r1'));
    // The sequencer applies the push when the proposal arrives; its clock starts there.
    await vi.advanceTimersByTimeAsync(DELAY.max + 1);
    const pushedAt = appliedSeqOf(t.sequencer, cid).at;

    // Just before the deadline nobody has timed out anywhere.
    await vi.advanceTimersByTimeAsync(pushedAt + passTimerMs - 1 - Date.now());
    for (const p of t.peers) expect(p.state.confirm?.responses).toEqual({});
    expect(t.sequencer.fired).toEqual([]);

    // At the deadline the sequencer emits one timeout per silent seat; every peer applies them at the same seqs.
    await vi.advanceTimersByTimeAsync(1);
    expect(t.sequencer.fired).toHaveLength(1);
    expect(t.sequencer.fired[0]!.at - pushedAt).toBe(passTimerMs);
    await t.settle();
    converged(t);
    const anna = timeoutSeqs(t.peers, 'r1', 's0');
    const cleo = timeoutSeqs(t.peers, 'r1', 's2');
    expect(new Set(anna).size).toBe(1);
    expect(new Set(cleo).size).toBe(1);
    expect(anna[0]).not.toBeNull();
    expect(cleo[0]).not.toBeNull();
    for (const p of t.peers) {
      expect(p.state.confirm?.responses).toEqual({ s0: 'timeout', s2: 'timeout' });
      expect(roundPassed(p.state)).toBe(true);
    }
    // The timeouts are the sequencer's actions, attributed to it, for the silent seats.
    const timeouts = t.sequencer.applied.filter((a) => a.action.type === 'respond');
    expect(timeouts.map((a) => a.action.by)).toEqual(['s0', 's0']);
    t.stop();
  });

  it('peers apply the push at different local times, yet the timeout seq is the same everywhere', async () => {
    const t = await table({ seed: 5 });
    const cid = t.peer('s2').propose(ability('i1', 'r1'));
    await vi.advanceTimersByTimeAsync(10_000);
    converged(t);
    const localStarts = t.peers.map((p) => appliedSeqOf(p, cid).at);
    expect(new Set(localStarts).size).toBeGreaterThan(1);
    const pushSeq = appliedSeqOf(t.sequencer, cid).seq;
    // One timeout per silent seat, in seat order, right after the push.
    expect(timeoutSeqs(t.peers, 'r1', 's0')).toEqual([pushSeq + 1, pushSeq + 1, pushSeq + 1]);
    expect(timeoutSeqs(t.peers, 'r1', 's1')).toEqual([pushSeq + 2, pushSeq + 2, pushSeq + 2]);
    t.stop();
  });

  it('only silent seats time out: an OK before the deadline stays an OK', async () => {
    const t = await table();
    t.peer('s1').propose(cast('i1', 'r1'));
    await vi.advanceTimersByTimeAsync(1000);
    t.peer('s2').propose({ type: 'respond', round: 'r1', seat: 's2', response: 'ok' });
    await vi.advanceTimersByTimeAsync(10_000);
    converged(t);
    for (const p of t.peers) expect(p.state.confirm?.responses).toEqual({ s0: 'timeout', s2: 'ok' });
    expect(timeoutSeqs(t.peers, 'r1', 's2')).toEqual([null, null, null]);
    t.stop();
  });

  it('once everyone answered, no timer runs', async () => {
    const t = await table();
    t.peer('s1').propose(cast('i1', 'r1'));
    await vi.advanceTimersByTimeAsync(500);
    t.peer('s0').propose({ type: 'respond', round: 'r1', seat: 's0', response: 'ok' });
    t.peer('s2').propose({ type: 'respond', round: 'r1', seat: 's2', response: 'ok' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.sequencer.fired).toEqual([]);
    for (const p of t.peers) expect(roundPassed(p.state)).toBe(true);
    t.stop();
  });

  it('with the timer off, silence never passes', async () => {
    const t = await table({ passTimerMs: null });
    t.peer('s1').propose(cast('i1', 'r1'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(t.sequencer.fired).toEqual([]);
    for (const p of t.peers) {
      expect(p.state.confirm).toMatchObject({ id: 'r1', durationMs: 0, responses: {} });
      expect(waitingOn(p.state)).toEqual(['s0', 's2']);
    }
    t.stop();
  });

  it('a newer item restarts the round: the old deadline never fires', async () => {
    const t = await table();
    t.peer('s1').propose(cast('i1', 'r1'));
    await vi.advanceTimersByTimeAsync(3000);
    const cid = t.peer('s2').propose(ability('i2', 'r2'));
    await vi.advanceTimersByTimeAsync(3000);
    // 6 s after the first push, but only ~3 s after the second: no timeout yet.
    expect(t.sequencer.fired).toEqual([]);
    await vi.advanceTimersByTimeAsync(3000);
    converged(t);
    expect(t.sequencer.fired.map((f) => f.key)).toEqual([`confirm:r2:${appliedSeqOf(t.sequencer, cid).seq}:s0,s1`]);
    for (const p of t.peers) expect(p.state.confirm).toMatchObject({ id: 'r2', about: 'i2', askedBy: 's2', responses: { s0: 'timeout', s1: 'timeout' } });
    t.stop();
  });
});

describe('hold stops the timer (DESIGN "Turn flow and confirmation", Hold)', () => {
  it('a hold before the deadline stops every timer; release restarts the countdown from the release', async () => {
    const t = await table({ seed: 23 });
    t.peer('s1').propose(cast('i1', 'r1'));
    await vi.advanceTimersByTimeAsync(2000);
    t.peer('s2').propose({ type: 'respond', round: 'r1', seat: 's2', response: 'hold' });
    await vi.advanceTimersByTimeAsync(120_000);
    converged(t);
    expect(t.sequencer.fired).toEqual([]);
    for (const p of t.peers) expect(p.state.confirm).toMatchObject({ holder: 's2', responses: { s2: 'hold' } });

    const release = t.peer('s2').propose({ type: 'respond', round: 'r1', seat: 's2', response: 'release' });
    // Proposal to the sequencer, then its broadcast: two hops.
    await vi.advanceTimersByTimeAsync(2 * DELAY.max + 1);
    const releasedAt = appliedSeqOf(t.sequencer, release);
    for (const p of t.peers) expect(p.state.confirm).toMatchObject({ timerSeq: releasedAt.seq, responses: { s2: 'ok' } });
    for (const x of t.peers) expect(x.state.confirm?.holder).toBeUndefined();
    await vi.advanceTimersByTimeAsync(releasedAt.at + 5000 - 1 - Date.now());
    expect(t.sequencer.fired).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await t.settle();
    converged(t);
    expect(t.sequencer.fired.map((f) => f.key)).toEqual([`confirm:r1:${releasedAt.seq}:s0`]);
    const seqs = timeoutSeqs(t.peers, 'r1', 's0');
    expect(new Set(seqs).size).toBe(1);
    for (const x of t.peers) expect(x.state.confirm?.responses).toEqual({ s0: 'timeout', s2: 'ok' });
    t.stop();
  });

  it('the holder adds to the stack, which starts a new round on the new top item', async () => {
    const t = await table();
    t.peer('s1').propose(cast('i1', 'r1'));
    await vi.advanceTimersByTimeAsync(1000);
    t.peer('s0').propose({ type: 'respond', round: 'r1', seat: 's0', response: 'hold' });
    await vi.advanceTimersByTimeAsync(10_000);
    t.peer('s0').propose({ type: 'createToken', card: 'tok-a', zone: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 }, label: 'Clue' });
    const cid = t.peer('s0').propose(ability('i2', 'r2'));
    await t.settle();
    for (const p of t.peers) expect(p.state.confirm).toMatchObject({ id: 'r2', askedBy: 's0', about: 'i2', responses: {} });
    expect(t.peers[2]!.state.confirm?.holder).toBeUndefined();
    await vi.advanceTimersByTimeAsync(5000);
    converged(t);
    expect(t.sequencer.fired.map((f) => f.key)).toEqual([`confirm:r2:${appliedSeqOf(t.sequencer, cid).seq}:s1,s2`]);
    t.stop();
  });

  it('two holds race: the first sequenced wins, the second is refused', async () => {
    const t = await table();
    t.peer('s1').propose(cast('i1', 'r1'));
    await vi.advanceTimersByTimeAsync(1000);
    t.peer('s0').propose({ type: 'respond', round: 'r1', seat: 's0', response: 'hold' });
    t.peer('s2').propose({ type: 'respond', round: 'r1', seat: 's2', response: 'hold' });
    await t.settle();
    converged(t);
    expect(t.sequencer.state.confirm?.holder).toBe('s0');
    expect(t.peer('s2').nacks.map((n) => n.reason)).toEqual([expect.stringMatching(/already holds/)]);
    t.stop();
  });
});

describe('an away peer times out (DESIGN "Turn flow and confirmation", Connection loss during a round)', () => {
  it('a peer that dropped is treated as passing after the timer; the others agree on the seq', async () => {
    const t = await table({ seed: 31 });
    t.net.kill('peer2');
    t.peer('s1').propose(cast('i1', 'r1'));
    await vi.advanceTimersByTimeAsync(1000);
    t.peer('s0').propose({ type: 'respond', round: 'r1', seat: 's0', response: 'ok' });
    await vi.advanceTimersByTimeAsync(10_000);
    const live = [t.peer('s0'), t.peer('s1')];
    const seqs = timeoutSeqs(live, 'r1', 's2');
    expect(seqs[0]).not.toBeNull();
    expect(seqs[0]).toBe(seqs[1]);
    expect(live[0]!.applied.map((a) => a.hash)).toEqual(live[1]!.applied.map((a) => a.hash));
    for (const p of live) expect(roundPassed(p.state)).toBe(true);
    t.stop();
  });

  it('a hold by a seat that goes away no longer stops the clock: that seat times out too', async () => {
    const t = await table({ seed: 37 });
    t.peer('s1').propose(cast('i1', 'r1'));
    await vi.advanceTimersByTimeAsync(1000);
    t.peer('s2').propose({ type: 'respond', round: 'r1', seat: 's2', response: 'hold' });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(t.sequencer.fired).toEqual([]);
    t.net.kill('peer2');
    // The engine's liveness rule marks the seat away after 6 s of silence (AWAY_AFTER_MS); it is a sequenced action,
    // applied by the real reducer on every peer.
    await vi.advanceTimersByTimeAsync(6000);
    t.sequencer.markAway('s2', true);
    await vi.advanceTimersByTimeAsync(10_000);
    const live = [t.peer('s0'), t.peer('s1')];
    expect(live[0]!.applied.map((a) => a.hash)).toEqual(live[1]!.applied.map((a) => a.hash));
    for (const p of live) {
      expect(p.state.confirm?.responses).toEqual({ s0: 'timeout', s2: 'timeout' });
      expect(p.state.confirm?.holder).toBeUndefined();
      expect(roundPassed(p.state)).toBe(true);
    }
    t.stop();
  });
  it('away goes through the real reducer: a mark that changes nothing is refused, and a seat back from away answers again', async () => {
    const t = await table({ seed: 41 });
    t.sequencer.markAway('s2', true);
    await vi.advanceTimersByTimeAsync(1000);
    for (const p of t.peers) expect(p.state.seats.s2!.away).toBe(true);
    const seq = t.sequencer.state.seq;
    // Marking an away seat away again is refused by the reducer (no-op), so no peer applies anything.
    t.sequencer.markAway('s2', true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.sequencer.state.seq).toBe(seq);
    expect(t.sequencer.nacks.at(-1)?.reason).toMatch(/already away/);
    // Back: the seat is present again and a round waits for it as for anyone.
    t.sequencer.markAway('s2', false);
    await vi.advanceTimersByTimeAsync(1000);
    t.peer('s1').propose(cast('i1', 'r1'));
    await vi.advanceTimersByTimeAsync(1000);
    for (const p of t.peers) {
      expect(p.state.seats.s2!.away).toBeUndefined();
      expect(waitingOn(p.state)).toContain('s2');
    }
    t.peer('s2').propose({ type: 'respond', round: 'r1', seat: 's2', response: 'ok' });
    await vi.advanceTimersByTimeAsync(1000);
    for (const p of t.peers) expect(p.state.confirm?.responses.s2).toBe('ok');
    converged(t);
    t.stop();
  });
});

describe('resolve before all-pass requires the second press and logs it (DESIGN "Turn flow and confirmation", All passed)', () => {
  it('a plain resolve is refused while the round waits; a forced one is sequenced with force on every peer', async () => {
    const t = await table();
    t.peer('s1').propose(cast('i1', 'r1'));
    await t.settle();
    const plain = t.peer('s1').propose({ type: 'stackResolve', item: 'i1', to: 'graveyard:s1' });
    await t.settle();
    expect(t.peer('s1').nacks).toEqual([{ cid: plain, reason: expect.stringMatching(/not everyone has passed/) }]);
    for (const p of t.peers) expect(p.state.stack.map((i) => i.id)).toEqual(['i1']);

    const forced = t.peer('s1').propose({ type: 'stackResolve', item: 'i1', to: 'graveyard:s1', force: true });
    await t.settle();
    converged(t);
    for (const p of t.peers) {
      const logged = appliedSeqOf(p, forced);
      expect(logged.action).toMatchObject({ type: 'stackResolve', item: 'i1', force: true });
      expect(p.state.stack).toEqual([]);
      expect(p.state.cards.b1?.zone).toBe('graveyard:s1');
      // The round about the item ends with it.
      expect(p.state.confirm).toBeNull();
    }
    t.stop();
  });

  it('after everyone passed (here by the timer) a plain resolve applies', async () => {
    const t = await table();
    t.peer('s1').propose(cast('i1', 'r1'));
    await vi.advanceTimersByTimeAsync(6000);
    const cid = t.peer('s1').propose({ type: 'stackResolve', item: 'i1', to: 'graveyard:s1' });
    await t.settle();
    converged(t);
    expect(t.peer('s1').nacks).toEqual([]);
    expect(appliedSeqOf(t.sequencer, cid).action).not.toHaveProperty('force');
    t.stop();
  });

  it('a hold sequenced before a plain resolve makes the resolve fail for everyone', async () => {
    const t = await table({ seed: 43 });
    t.peer('s1').propose(cast('i1', 'r1'));
    await t.settle();
    t.peer('s0').propose({ type: 'respond', round: 'r1', seat: 's0', response: 'ok' });
    t.peer('s2').propose({ type: 'respond', round: 'r1', seat: 's2', response: 'ok' });
    await t.settle();
    expect(roundPassed(t.peer('s1').state)).toBe(true);
    // Cleo changes her mind and holds just as Ben resolves: the hold is sequenced first (Cleo is not slower than Ben here).
    t.peer('s2').propose({ type: 'respond', round: 'r1', seat: 's2', response: 'hold' });
    await vi.advanceTimersByTimeAsync(DELAY.max + 1);
    const cid = t.peer('s1').propose({ type: 'stackResolve', item: 'i1', to: 'graveyard:s1' });
    await t.settle();
    converged(t);
    expect(t.peer('s1').nacks.map((n) => n.cid)).toEqual([cid]);
    for (const p of t.peers) expect(p.state.stack.map((i) => i.id)).toEqual(['i1']);
    t.stop();
  });
});
