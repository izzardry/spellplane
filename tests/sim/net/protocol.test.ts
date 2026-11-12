/**
 * Protocol behaviour beyond the four acceptance scenarios, each on the simulated network with targeted loss
 * (DESIGN "Specification: network protocol and secrecy": Sequencing 2-5, Liveness, Sync, Timers, the channel table;
 * "Multiplayer architecture": presence is never logged, hidden information travels on per-pair channels).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { reduce } from '../../../src/core/reducer';
import type { Deadline, TableState } from '../../../src/core/types';
import type { WireMessage } from '../../../src/net/messages';
import { AWAY_AFTER_MS, HASH_EVERY, HEARTBEAT_MS } from '../../../src/net/types';
import { mulberry32 } from '../../../src/util/prng';
import { scan } from '../../leak/scan';
import { stream } from './scenarios';
import { createNetEngine, HOLD_PREV_MS } from '../../../src/net/engine';
import { boundNonce } from '../../../src/net/hello';
import { LoopbackNetwork } from '../../../src/net/loopback';
import { handshakeText, PROTOCOL_VERSION, toMessage, type SequencedAction } from '../../../src/net/messages';
import { applySequenced } from '../../../src/net/sequencer';
import type { Message } from '../../../src/net/transport';
import { TEST_GAME } from '../../unit/core/helpers';
import { fakeNetIdentity } from './fake-identity';
import { agreed, baseTable, converged, expectConverged, hashOf, historyWhenReached, KEY, libraryIds, makeSim, replay, ROOM, until, type Sim, type SimPeer } from './sim';

vi.mock('../../../src/net/identity', async () => (await import('./fake-identity')).fakeIdentityModule);

const DELAY = { delay: { min: 5, max: 40 } };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function connected(opts: Parameters<typeof makeSim>[0]): Promise<Sim> {
  const sim = makeSim(opts);
  await until(() => agreed(sim.peers), 20_000, 'connection');
  return sim;
}

const life = (p: SimPeer, cid: string, delta = -1): Action => ({ type: 'life', by: p.seat, cid, seat: p.seat, delta });
const delivered = (sim: Sim, t: string): { msg: WireMessage; from: string; to: string }[] =>
  sim.net.delivered.filter((d) => d.msg.t === t).map((d) => ({ msg: d.msg as unknown as WireMessage, from: d.from, to: d.to }));
const tid = (p: SimPeer): string => p.transport.selfId;

describe('nack and rollback', () => {
  it('a refused proposal is nacked to its proposer only, which rolls it back; nobody else applies it', async () => {
    const sim = await connected({ engines: 3, seed: 1, ...DELAY });
    const [, b] = sim.peers;
    const state = b!.engine.state();
    const theirLibraryCard = state.zones['library:s0']!.ids[0]!;
    // Only the owner can publish a hidden card's identity; the reducer alone cannot tell.
    const reveal: Action = { type: 'reveal', by: 's1', cid: 'steal', instanceId: theirLibraryCard, ref: { sid: 'guess' }, salt: 'x' };
    expect(b!.engine.propose(reveal)).toBe(true);
    expect(b!.engine.state().cards[theirLibraryCard]!.identity).toEqual({ sid: 'guess' }); // optimistic
    await expectConverged(sim.peers);
    expect(b!.rolledBack.get('steal')).toMatch(/belongs to s0/);
    expect(b!.engine.state().cards[theirLibraryCard]!.identity).toBeUndefined();
    for (const p of sim.peers) expect([...p.log.values()].some((a) => a.cid === 'steal')).toBe(false);
    const nacks = delivered(sim, 'nack');
    expect(nacks).toHaveLength(1);
    expect(nacks[0]!.to).toBe(tid(b!));
  });

  it('an action made invalid by an earlier sequenced one is refused and rolled back', async () => {
    const sim = await connected({ engines: 2, seed: 2, ...DELAY });
    const [a, b] = sim.peers as [SimPeer, SimPeer];
    a.engine.propose({ type: 'createToken', by: 's0', cid: 'mk', card: 'tok-1', zone: 'battlefield:s0', pose: { x: 0, y: 0, rot: 0 }, ref: { sid: 'cat' } });
    await expectConverged(sim.peers);
    // A removes the token while B, not yet aware, taps it.
    a.engine.propose({ type: 'remove', by: 's0', cid: 'rm', card: 'tok-1' });
    b.engine.propose({ type: 'tap', by: 's1', cid: 'tp', card: 'tok-1', tapped: true });
    expect(b.engine.state().cards['tok-1']!.tapped).toBe(true);
    await expectConverged(sim.peers);
    expect(b.rolledBack.get('tp')).toMatch(/tok-1/);
    expect(b.engine.state().cards['tok-1']).toBeUndefined();
  });

  it('one proposer’s actions are sequenced in the order it applied them on the ordered `act` channel', async () => {
    // DESIGN channel table: `act` is reliable and ordered, so proposals reach the sequencer in the order sent.
    const sim = await connected({ engines: 2, seed: 3, ...DELAY, ordered: true });
    const b = sim.peers[1]!;
    b.engine.propose({ type: 'createToken', by: 's1', cid: 'make', card: 'tok-b', zone: 'battlefield:s1', pose: { x: 0, y: 0, rot: 0 }, ref: { sid: 'cat' } });
    b.engine.propose({ type: 'tap', by: 's1', cid: 'tap', card: 'tok-b', tapped: true });
    b.engine.propose({ type: 'counter', by: 's1', cid: 'count', card: 'tok-b', kind: '+1/+1', delta: 1 });
    await expectConverged(sim.peers);
    expect(b.rolledBack.size).toBe(0);
    const order = [...b.log.values()].filter((x) => ['make', 'tap', 'count'].includes(x.cid)).sort((x, y) => x.seq - y.seq).map((x) => x.cid);
    expect(order).toEqual(['make', 'tap', 'count']);
    expect(sim.peers[0]!.engine.state().cards['tok-b']).toMatchObject({ tapped: true, counters: { '+1/+1': 1 } });
  });

  it('a lost proposal is resent; later ones wait for it (`prev`) and are sequenced after it, in the order applied', async () => {
    // ProposeMessage.prev (M1-C amendment): the sequencer holds a proposal until the proposer's previous pending one
    // is sequenced or refused, so one proposer's actions keep their order under loss, too.
    const sim = await connected({ engines: 2, seed: 3, ...DELAY });
    const b = sim.peers[1]!;
    let dropped = 0;
    b.transport.dropOut = (_ch, msg) => msg.t === 'propose' && (msg as unknown as { cid: string }).cid === 'make' && dropped++ === 0;
    b.engine.propose({ type: 'createToken', by: 's1', cid: 'make', card: 'tok-b', zone: 'battlefield:s1', pose: { x: 0, y: 0, rot: 0 }, ref: { sid: 'cat' } });
    b.engine.propose({ type: 'tap', by: 's1', cid: 'tap', card: 'tok-b', tapped: true });
    b.engine.propose({ type: 'counter', by: 's1', cid: 'count', card: 'tok-b', kind: '+1/+1', delta: 1 });
    const sent = b.engine.messages().flatMap((r) => (r.dir === 'out' && r.msg.t === 'propose' ? [r.msg] : []));
    expect(sent.map((m) => [m.cid, m.prev])).toEqual([
      ['make', null],
      ['tap', 'make'],
      ['count', 'tap'],
    ]);
    await expectConverged(sim.peers);
    expect(dropped).toBe(2); // the first copy was lost, the resend went through
    expect(b.rolledBack.size).toBe(0);
    const order = [...b.log.values()].filter((x) => ['make', 'tap', 'count'].includes(x.cid)).sort((x, y) => x.seq - y.seq).map((x) => x.cid);
    expect(order).toEqual(['make', 'tap', 'count']);
    expect(sim.peers[0]!.engine.state().cards['tok-b']).toMatchObject({ tapped: true, counters: { '+1/+1': 1 } });
  });

  it('a proposal whose `prev` does not come within HOLD_PREV_MS is sequenced or refused without it, never lost', async () => {
    const sim = await connected({ engines: 2, seed: 3, ...DELAY });
    const [a, b] = sim.peers as [SimPeer, SimPeer];
    let block = true;
    b.transport.dropOut = (_ch, msg) => block && msg.t === 'propose' && (msg as unknown as { cid: string }).cid === 'first';
    b.engine.propose(life(b, 'first', -1));
    b.engine.propose(life(b, 'second', -2));
    await vi.advanceTimersByTimeAsync(HOLD_PREV_MS - 300);
    expect(a.engine.state().seats.s1!.life, 'held while its prev may still come').toBe(20);
    await vi.advanceTimersByTimeAsync(800);
    expect(a.engine.state().seats.s1!.life, 'sequenced without it after the hold').toBe(18);
    block = false;
    await expectConverged(sim.peers);
    expect(b.rolledBack.size).toBe(0);
    expect(a.engine.state().seats.s1!.life).toBe(17);
  });

  it('a held proposal goes on as soon as its `prev` is refused', async () => {
    const sim = await connected({ engines: 2, seed: 3, ...DELAY });
    const [a, b] = sim.peers as [SimPeer, SimPeer];
    // `bad` reaches the sequencer only after `next` (delayed, not lost); the sequencer refuses it.
    let hold = true;
    const late: (() => void)[] = [];
    b.transport.dropOut = (ch, msg, to) => {
      if (!hold || msg.t !== 'propose' || (msg as unknown as { cid: string }).cid !== 'bad') return false;
      late.push(() => b.transport.inner.send(ch, msg, to));
      return true;
    };
    expect(b.engine.propose({ type: 'life', by: 's0', cid: 'bad', seat: 's0', delta: -5 })).toBe(true); // a forged `by`
    b.engine.propose(life(b, 'next', -1));
    await vi.advanceTimersByTimeAsync(300);
    expect(a.engine.state().seats.s1!.life).toBe(20);
    hold = false;
    b.transport.dropOut = null;
    for (const f of late.splice(0, 1)) f();
    await vi.advanceTimersByTimeAsync(200);
    expect(a.engine.state().seats.s1!.life, 'released by the refusal, well before HOLD_PREV_MS').toBe(19);
    await expectConverged(sim.peers);
    expect(b.rolledBack.get('bad')).toMatch(/sender's seat/);
    expect(a.engine.state().seats.s0!.life).toBe(20);
  });

  it('a resent proposal that was already sequenced is not sequenced twice', async () => {
    const sim = await connected({ engines: 2, seed: 4, ...DELAY });
    const b = sim.peers[1]!;
    // B never hears its own seq back for a while (nor catches up), so it resends the proposal.
    let block = true;
    b.transport.dropIn = (_ch, msg) => block && (msg.t === 'seq' || msg.t === 'syncRes');
    b.engine.propose(life(b, 'once'));
    await vi.advanceTimersByTimeAsync(3500);
    block = false;
    await expectConverged(sim.peers);
    expect(delivered(sim, 'propose').filter((d) => (d.msg as { cid?: string }).cid === 'once').length).toBeGreaterThan(1);
    expect([...sim.peers[0]!.log.values()].filter((x) => x.cid === 'once')).toHaveLength(1);
    expect(b.engine.state().seats.s1!.life).toBe(19);
  });
});

describe('gaps, catch-up and consistency', () => {
  it('a lost seq is detected as a gap and fetched with a tail from the sequencer', async () => {
    const sim = await connected({ engines: 3, seed: 5, ...DELAY });
    const [a, , c] = sim.peers as [SimPeer, SimPeer, SimPeer];
    a.engine.propose(life(a, 'warm-up'));
    await expectConverged(sim.peers);
    const target = a.engine.seq() + 2;
    c.transport.dropIn = (_ch, msg) => msg.t === 'seq' && (msg as unknown as { seq: number }).seq === target;
    for (let i = 0; i < 5; i++) {
      a.engine.propose(life(a, `g${i}`));
      await vi.advanceTimersByTimeAsync(30);
    }
    await expectConverged(sim.peers);
    const reqs = c.engine.messages().filter((r) => r.dir === 'out' && r.msg.t === 'syncReq');
    expect(reqs.map((r) => (r.msg as { haveSeq: number }).haveSeq)).toContain(target - 1);
    const res = c.engine.messages().filter((r) => r.dir === 'in' && r.msg.t === 'syncRes').map((r) => r.msg as Extract<WireMessage, { t: 'syncRes' }>);
    expect(res.some((m) => m.snapshot === null && m.tail.some((x) => x.seq === target))).toBe(true);
  });

  it('a lost last seq is noticed from the sequencer’s heartbeat', async () => {
    const sim = await connected({ engines: 2, seed: 6, ...DELAY });
    const [a, b] = sim.peers as [SimPeer, SimPeer];
    b.transport.dropIn = (_ch, msg) => msg.t === 'seq';
    a.engine.propose(life(a, 'last'));
    await vi.advanceTimersByTimeAsync(100);
    expect(b.engine.seq()).toBe(a.engine.seq() - 1);
    b.transport.dropIn = (_ch, msg) => msg.t === 'seq'; // still no seq messages: only hb + syncRes can heal it
    await until(() => b.engine.seq() === a.engine.seq(), HEARTBEAT_MS + 1500, 'catch-up from the heartbeat');
  });

  it('peers exchange the hash of the canonical state every 50 actions, and the hashes agree', async () => {
    const start = baseTable(4);
    const sim = await connected({ engines: 3, seed: 7, start, ...DELAY });
    const rand = mulberry32(3);
    await stream(sim, 160, rand, { gapMs: 60 });
    await expectConverged(sim.peers);
    const head = sim.peers[0]!.engine.seq();
    const multiples = Array.from({ length: Math.floor(head / HASH_EVERY) }, (_, i) => (i + 1) * HASH_EVERY).filter((s) => s > start.seq);
    expect(multiples.length).toBeGreaterThanOrEqual(3);
    // Replay the log to know the state at each multiple of 50.
    let s: TableState = start.state;
    const expected = new Map<number, string>();
    for (let q = start.seq + 1; q <= head; q++) {
      const a = sim.peers[0]!.log.get(q)!;
      const next = reduce(s, a);
      s = next.seq === q ? next : { ...next, seq: q };
      if (q % HASH_EVERY === 0) expected.set(q, hashOf(s));
    }
    for (const p of sim.peers) {
      const sent = p.engine.messages().filter((r) => r.dir === 'out' && r.msg.t === 'hash').map((r) => r.msg as Extract<WireMessage, { t: 'hash' }>);
      expect(sent.map((m) => m.seq)).toEqual(multiples);
      for (const m of sent) expect(m.h).toBe(expected.get(m.seq));
    }
  });

  it('a state-hash mismatch triggers a resync from the sequencer’s snapshot and is reported', async () => {
    const start = baseTable(4);
    // C's copy differs from everyone else's (as a reducer bug would make it).
    const corrupt = { seq: start.seq, state: { ...start.state, seats: { ...start.state.seats, s2: { ...start.state.seats.s2!, life: 7 } } } };
    const sim = makeSim({ engines: 2, seed: 8, start, ...DELAY });
    const c = sim.add(2, corrupt);
    const emitted = new Map<number, number>();
    c.engine.onSequenced((a) => emitted.set(a.seq, (emitted.get(a.seq) ?? 0) + 1));
    await until(() => agreed(sim.peers), 20_000, 'connection');
    const rand = mulberry32(8);
    await stream(sim, 120, rand, { gapMs: 60 });
    await expectConverged(sim.peers);
    // Found by the periodic hash exchange, or already when C verified its sequencer's history: the sequencer's
    // snapshot at C's head has another state hash (review M1-P1 retry round 1).
    expect(c.system.some((t) => /hash mismatch|state hashes differ/.test(t))).toBe(true);
    // The reload replays the tail after the snapshot; actions already reported are not reported again.
    expect([...emitted].filter(([, n]) => n > 1)).toEqual([]);
    expect(c.engine.state().seats.s2!.life).toBe(sim.peers[0]!.engine.state().seats.s2!.life);
    const log = new Set([...sim.peers[0]!.log.values()].map((a) => a.cid));
    for (const cid of c.proposed) expect(log.has(cid) !== c.rolledBack.has(cid), cid).toBe(true);
  });
});

describe('stale answers, unnoticed forks and held proposals', () => {
  it('a catch-up answer that fits no outstanding request is not applied, not even from the sequencer', async () => {
    // Review M1-P1 retry round 1, finding 2: a late answer (to a request from before a claim, or from a peer this
    // replica no longer asks) may describe a history that has since been replaced.
    const sim = await connected({ engines: 3, seed: 10, ...DELAY });
    const [a, b, c] = sim.peers as [SimPeer, SimPeer, SimPeer];
    await expectConverged(sim.peers);
    const n = c.engine.seq();
    const late = (cid: string): SequencedAction => ({ type: 'life', by: 's1', cid, seat: 's1', delta: -5, seq: n + 1 });
    b.transport.inner.send('ctl', toMessage({ v: PROTOCOL_VERSION, t: 'syncRes', snapshot: null, tail: [late('late-peer')] }), tid(c));
    await vi.advanceTimersByTimeAsync(300);
    expect(c.engine.seq(), 'a peer’s unasked answer').toBe(n);
    a.transport.inner.send('ctl', toMessage({ v: PROTOCOL_VERSION, t: 'syncRes', snapshot: null, tail: [late('late-seqr')] }), tid(c));
    await vi.advanceTimersByTimeAsync(300);
    expect(c.engine.seq(), 'the sequencer’s unasked answer').toBe(n);
    a.engine.propose(life(a, 'after'));
    await expectConverged(sim.peers);
    for (const cid of ['late-peer', 'late-seqr']) expect([...c.log.values()].some((x) => x.cid === cid), cid).toBe(false);
    expect(c.engine.confirmedState().seats.s1!.life).toBe(20);
  });

  it('a hash mismatch from a history that diverged unnoticed proposes the own actions the sequencer lacks again', async () => {
    // Review M1-P1 retry round 1 (hardening): C holds its own `ghost` at the seq where the sequencer has `real`, and
    // never sees `real` there, so no fork check notices. The state hashes disagree at the next multiple of
    // HASH_EVERY; the reload must not silently drop `ghost`, which C saw sequenced.
    const sim = await connected({ engines: 3, seed: 9, ...DELAY });
    const [a, , c] = sim.peers as [SimPeer, SimPeer, SimPeer];
    // A first seq lets C verify its sequencer's history (until then it re-reads rather than applies seqs).
    a.engine.propose(life(a, 'warm-up', 0));
    await expectConverged(sim.peers);
    let first = true;
    c.transport.dropOut = (_ch, msg) => msg.t === 'propose' && (msg as unknown as { cid: string }).cid === 'ghost' && first && !(first = false);
    c.transport.dropIn = (_ch, msg) => msg.t === 'seq' && (msg as unknown as { cid: string }).cid === 'real';
    const n = a.engine.seq() + 1;
    const ghost = life(c, 'ghost', -3);
    c.engine.propose(ghost);
    a.transport.inner.send('act', toMessage({ v: PROTOCOL_VERSION, t: 'seq', seq: n, cid: 'ghost', action: { ...ghost, seq: n } }), tid(c));
    await vi.advanceTimersByTimeAsync(100);
    expect(c.acked.has('ghost')).toBe(true);
    a.engine.propose(life(a, 'real'));
    for (let i = 0; a.engine.seq() < Math.ceil(n / HASH_EVERY) * HASH_EVERY + 2; i++) {
      a.engine.propose(life(a, `more-${i}`, 0));
      await vi.advanceTimersByTimeAsync(20);
    }
    await expectConverged(sim.peers);
    expect(c.system.some((t) => /hash mismatch/.test(t))).toBe(true);
    const log = new Set([...a.log.values()].map((x) => x.cid));
    expect(log.has('ghost'), 'ghost proposed again and sequenced').toBe(true);
    expect(log.has('real')).toBe(true);
    expect(c.rolledBack.size).toBe(0);
    expect(a.engine.confirmedState().seats.s2!.life).toBe(17);
  });

  it('a proposer flooding proposals whose `prev` never comes cannot push another proposer’s held proposal out of order', async () => {
    // Review M1-P1 retry round 1 (minor): the pool of held proposals is bounded; the flooding proposer's own oldest
    // goes on without its prev, not someone else's.
    const sim = await connected({ engines: 3, seed: 3, ...DELAY });
    const [a, b, c] = sim.peers as [SimPeer, SimPeer, SimPeer];
    let block = true;
    c.transport.dropOut = (_ch, msg) => block && msg.t === 'propose' && (msg as unknown as { cid: string }).cid === 'first';
    c.engine.propose(life(c, 'first', -1));
    c.engine.propose(life(c, 'second', -2));
    await vi.advanceTimersByTimeAsync(200);
    for (let i = 0; i < 2_100; i++) {
      const action = life(b, `flood-${i}`, 0);
      b.transport.inner.send('act', toMessage({ v: PROTOCOL_VERSION, t: 'propose', cid: action.cid, action, prev: 'never' }), tid(a));
    }
    await vi.advanceTimersByTimeAsync(300);
    expect(a.engine.state().seats.s2!.life, 'still held for its prev').toBe(20);
    block = false;
    await expectConverged(sim.peers);
    const order = [...a.log.values()].filter((x) => x.cid === 'first' || x.cid === 'second').sort((x, y) => x.seq - y.seq).map((x) => x.cid);
    expect(order).toEqual(['first', 'second']);
    expect(c.rolledBack.size).toBe(0);
  });
});

describe('fork repair and state hashes', () => {
  it('after rewinding to a fork, the sequencer’s hash of a replaced seq is not compared with the abandoned history', async () => {
    // DESIGN "Data model and protocol", Consistency check. A scripted sequencer (peer0, seat s0) and one engine
    // (peer1) whose seq 100 (a multiple of HASH_EVERY) is another history's action. The sequencer's `seq 100` reveals
    // the fork; its `hash 100` (ctl) arrives before the engine re-applied seq 100 from the sequencer's tail.
    const base = baseTable(2);
    const lifeAt = (seq: number, seat: 's0' | 's1', cid: string, delta: number): SequencedAction => ({ type: 'life', by: seat, cid, seat, delta, seq });
    const common: SequencedAction[] = [];
    for (let q = base.seq + 1; q < 2 * HASH_EVERY; q++) common.push(lifeAt(q, q % 2 ? 's0' : 's1', `common-${q}`, q % 3 ? 1 : -1));
    const abandoned = lifeAt(2 * HASH_EVERY, 's1', 'abandoned', -4);
    const theirs = lifeAt(2 * HASH_EVERY, 's0', 'theirs', -5);
    let state = base.state;
    for (const a of common) state = applySequenced(state, a);
    const expected = hashOf(applySequenced(state, theirs));
    const net = new LoopbackNetwork({ seed: 21, delay: { min: 1, max: 2 }, ordered: true });
    const engine = createNetEngine({
      transport: net.create('tc'),
      roomId: ROOM,
      roomKey: KEY,
      identity: fakeNetIdentity('peer1'),
      game: TEST_GAME,
      start: { snapshot: base, tail: [...common, abandoned] },
      now: () => Date.now(),
    });
    const warnings: string[] = [];
    engine.onSystem((_l, t) => warnings.push(t));
    expect(engine.seq()).toBe(2 * HASH_EVERY);
    // The scripted sequencer.
    const r = net.create('tr');
    const got: WireMessage[] = [];
    for (const ch of ['ctl', 'act'] as const) r.on(ch, (m) => got.push(m as unknown as WireMessage));
    await r.join(ROOM, KEY);
    await engine.join();
    await until(() => got.some((m) => m.t === 'hello'), 2000, 'its hello');
    const nonce = (got.find((m) => m.t === 'hello') as Extract<WireMessage, { t: 'hello' }>).nonce;
    const me = fakeNetIdentity('peer0');
    const send = (ch: 'ctl' | 'act', m: object): void => r.send(ch, { v: 1, ...m } as unknown as Message, 'tc');
    send('ctl', { t: 'hello', peerId: 'peer0', pubKey: me.pubKey, nickname: 'S', seat: 's0', role: 'player', lastSeq: 2 * HASH_EVERY - 1, nonce: 'n-r' });
    send('ctl', { t: 'welcome', peerId: 'peer0', sig: await me.sign(handshakeText(ROOM, boundNonce(nonce, 'tr', 'tc'), 'peer0')), sequencer: 'peer0', seq: 2 * HASH_EVERY - 1 });
    await until(() => got.some((m) => m.t === 'syncReq'), 3000, 'the first catch-up request');
    send('ctl', { t: 'syncRes', snapshot: null, tail: [] });
    await until(() => engine.status() === 'connected' && engine.sequencerId() === 'peer0', 3000, 'connected to the scripted sequencer');
    const syncReqs = (): Extract<WireMessage, { t: 'syncReq' }>[] => got.filter((m): m is Extract<WireMessage, { t: 'syncReq' }> => m.t === 'syncReq');
    let requests = syncReqs().length;
    send('act', { t: 'seq', seq: theirs.seq, cid: theirs.cid, action: theirs });
    send('ctl', { t: 'hash', seq: theirs.seq, h: expected });
    // Its first seq from a new sequencer: the engine does not adopt from the single differing seq (the fork may lie
    // further down) but re-reads the overlap; the sequencer's hash meanwhile is kept, not compared with the abandoned
    // seq 100 (review M1-P1 retry round 2).
    await until(() => syncReqs().length > requests, 3000, 'the overlap read');
    const overlap = syncReqs().at(-1)!.haveSeq;
    expect(overlap).toBeGreaterThan(0);
    expect(overlap).toBeLessThan(2 * HASH_EVERY - 1);
    await vi.advanceTimersByTimeAsync(20);
    expect(warnings.filter((w) => /hash mismatch/.test(w))).toEqual([]);
    requests = syncReqs().length;
    send('ctl', { t: 'syncRes', snapshot: null, tail: [...common.filter((x) => x.seq > overlap), theirs] });
    // The overlap answer shows the fork at seq 100: rewind to 99 and fetch the sequencer's tail from there.
    await until(() => syncReqs().length > requests, 3000, 'the request for the adopted tail');
    expect(syncReqs().at(-1)).toMatchObject({ haveSeq: 2 * HASH_EVERY - 1 });
    send('ctl', { t: 'hash', seq: theirs.seq, h: expected });
    await vi.advanceTimersByTimeAsync(20);
    expect(warnings.filter((w) => /hash mismatch/.test(w))).toEqual([]);
    send('ctl', { t: 'syncRes', snapshot: null, tail: [theirs] });
    await until(() => engine.seq() === theirs.seq && engine.confirmedState().seats.s0!.life === state.seats.s0!.life - 5, 3000, 'the adopted history');
    expect(hashOf(engine.confirmedState())).toBe(expected);
    await vi.advanceTimersByTimeAsync(500);
    expect(warnings.filter((w) => /hash mismatch/.test(w))).toEqual([]);
    expect(got.some((m) => m.t === 'syncReq' && m.haveSeq === 0)).toBe(false); // no forced snapshot resync
    engine.leave();
  });
});

describe('authority', () => {
  it('refuses a forged `by` and actions only the sequencer may send', async () => {
    const sim = await connected({ engines: 2, seed: 9, ...DELAY });
    const b = sim.peers[1]!;
    b.engine.propose({ type: 'life', by: 's0', cid: 'forged', seat: 's0', delta: -5 });
    b.engine.propose({ type: 'sequencerClaim', by: 's1', cid: 'usurp', fromSeq: 1, peer: 'peer1' });
    await expectConverged(sim.peers);
    expect(b.rolledBack.get('forged')).toMatch(/sender's seat/);
    expect(b.rolledBack.get('usurp')).toMatch(/only the sequencer/);
    expect(sim.peers[0]!.engine.state().seats.s0!.life).toBe(20);
  });

  it('leak scenario: a non-owner cannot pull a hidden card public or onto the stack; nothing of it leaves its owner', async () => {
    // CLAUDE.md shared leak test; DESIGN Sequencing 3: hidden-zone actions come from the zone's owner.
    const sim = await connected({ engines: 3, seed: 14, ...DELAY });
    const [a, b, c] = sim.peers as [SimPeer, SimPeer, SimPeer];
    const hidden = a.engine.state().zones['library:s0']!.ids.slice(0, 3) as [string, string, string];
    // What only A's browser knows about those cards (its secret store in a real session).
    const secrets = hidden.flatMap((id) => [`secret-sid-${id}`, `secret-salt-${id}`]);
    const before = hashOf(a.engine.confirmedState());
    b.engine.propose({ type: 'move', by: 's1', cid: 'grab', card: hidden[0], to: 'battlefield:s1', pose: { x: 0, y: 0, rot: 0 } });
    b.engine.propose({ type: 'stackPush', by: 's1', cid: 'cast', item: 'stolen', kind: 'spell', card: hidden[1] });
    c.engine.propose({ type: 'toZone', by: 's2', cid: 'shuffle-in', card: hidden[2], to: 'hand:s0', position: 'top' });
    await expectConverged(sim.peers);
    expect(b.rolledBack.get('grab')).toMatch(/zone's owner/);
    expect(b.rolledBack.get('cast')).toMatch(/zone's owner/);
    expect(c.rolledBack.get('shuffle-in')).toMatch(/zone's owner/);
    expect(hashOf(a.engine.confirmedState())).toBe(before);
    for (const p of sim.peers) {
      for (const id of hidden) expect(p.engine.state().cards[id]).toMatchObject({ zone: 'library:s0' });
      for (const id of hidden) expect(p.engine.state().cards[id]!.identity).toBeUndefined();
    }
    // A was never asked to publish anything: nothing reached B or C that names these cards' identities.
    expect(sim.net.delivered.filter((d) => d.from === tid(a) && ['seq', 'reveal'].includes(d.msg.t))).toEqual([]);
    for (const p of [b, c]) {
      const seen = [sim.net.delivered.filter((d) => d.to === tid(p)), p.engine.messages(), p.engine.state()];
      expect(scan(seen, secrets)).toEqual([]);
    }
  });

  it('an unseated player can take a free chair with its own peer id only, then play', async () => {
    const base = baseTable(4);
    const free = { seq: base.seq + 1, state: reduce(base.state, { type: 'seatLeave', by: 's3', cid: 'free', seat: 's3', seq: base.seq + 1 }) };
    const sim = makeSim({ engines: 3, seed: 10, start: free, ...DELAY });
    const newcomer = sim.add(9, free); // peer9 holds no seat
    await until(() => agreed(sim.peers), 20_000, 'connection');
    expect(newcomer.engine.seat()).toBeNull();
    newcomer.engine.propose({ type: 'seatTake', by: 's3', cid: 'take-other', seat: 's3', name: 'Eve', colour: 4, peer: 'peer1' });
    await expectConverged(sim.peers);
    expect(newcomer.rolledBack.get('take-other')).toMatch(/own peer id/);
    newcomer.engine.propose({ type: 'seatTake', by: 's3', cid: 'take', seat: 's3', name: 'Eve', colour: 4, peer: 'peer9' });
    await expectConverged(sim.peers);
    expect(newcomer.engine.seat()).toBe('s3');
    newcomer.engine.propose({ type: 'life', by: 's3', cid: 'eve-life', seat: 's3', delta: 3 });
    await expectConverged(sim.peers);
    expect(sim.peers[0]!.engine.state().seats.s3).toMatchObject({ name: 'Eve', peer: 'peer9', life: 23 });
    expect(sim.peers[0]!.engine.peers().find((p) => p.peerId === 'peer9')!.seat).toBe('s3');
  });

  it('players move chairs as M1-P5 stamps it (take the new chair as itself, then leave the old one), down and up', async () => {
    // DESIGN "Players, seats and formats" (chair selection); Sequencing 3 with a sender that briefly holds two chairs.
    const base = baseTable(4);
    const free = { seq: base.seq + 1, state: reduce(base.state, { type: 'seatLeave', by: 's1', cid: 'free', seat: 's1', seq: base.seq + 1 }) };
    const sim = makeSim({ engines: 0, seed: 22, start: free, ...DELAY });
    const [a, , d] = [sim.add(0, free), sim.add(2, free), sim.add(3, free)];
    await until(() => agreed(sim.peers), 20_000, 'connection');
    let n = 0;
    const move = (p: SimPeer, to: string): void => {
      const from = p.engine.seat()!;
      const group = `move-${++n}`;
      expect(p.engine.propose({ type: 'seatTake', by: to, cid: `${group}-take`, seat: to, name: `P${p.index}`, colour: p.index, peer: p.peerId, group })).toBe(true);
      expect(p.engine.propose({ type: 'seatLeave', by: from, cid: `${group}-leave`, seat: from, group })).toBe(true);
    };
    move(d, 's1'); // a follower, to a lower chair
    await expectConverged(sim.peers);
    expect(d.engine.seat()).toBe('s1');
    move(d, 's3'); // and back up
    await expectConverged(sim.peers);
    expect(d.engine.seat()).toBe('s3');
    move(d, 's1');
    await expectConverged(sim.peers);
    move(a, 's3'); // the sequencer itself, to a higher chair: peer3 (now s1) takes over
    await until(() => agreed(sim.peers) && d.engine.isSequencing(), 20_000, 'handover to the lowest chair');
    await expectConverged(sim.peers);
    expect(a.engine.seat()).toBe('s3');
    for (const p of sim.peers) expect(p.rolledBack, p.peerId).toEqual(new Map());
    const seats = d.engine.state().seats;
    expect([seats.s0!.peer, seats.s1!.peer, seats.s2!.peer, seats.s3!.peer]).toEqual([undefined, 'peer3', 'peer2', 'peer0']);
    a.engine.propose(life({ ...a, seat: 's3' }, 'a-plays'));
    d.engine.propose(life({ ...d, seat: 's1' }, 'd-plays'));
    await expectConverged(sim.peers);
    expect(d.engine.state().seats.s3!.life).toBe(19);
    expect(d.engine.state().seats.s1!.life).toBe(19);
  });

  it('a spectator never sequences and may only chat', async () => {
    const sim = makeSim({ engines: 0, seed: 11, ...DELAY });
    const spectator = sim.add(0, undefined, 'spectator'); // holds peer0, the lowest seat's id, but as a spectator
    const b = sim.add(1);
    await until(() => b.engine.isSequencing() && spectator.engine.status() === 'connected', 20_000, 'connection');
    expect(spectator.engine.sequencerId()).toBe('peer1');
    spectator.engine.propose({ type: 'chat', by: 'spectator-0', cid: 'hi', text: 'gl hf', channel: 'spectator' });
    spectator.engine.propose({ type: 'life', by: 's0', cid: 'meddle', seat: 's0', delta: -1 });
    await expectConverged([spectator, b]);
    expect([...b.log.values()].map((a) => a.cid)).toContain('hi');
    expect(spectator.rolledBack.has('meddle')).toBe(true);
  });
});

describe('pair channel and presence', () => {
  it('a pair-channel message reaches the addressed seat only', async () => {
    const sim = await connected({ engines: 3, seed: 12, ...DELAY });
    const [a, b, c] = sim.peers as [SimPeer, SimPeer, SimPeer];
    const got: { seat: string | null; peerId: string; t: string }[] = [];
    b.engine.onPrivate((msg, from) => got.push({ ...from, t: msg.t }));
    let cGot = 0;
    c.engine.onPrivate(() => cGot++);
    const card = libraryIds(0)[5]!;
    const secret = { instanceId: card, ref: { sid: 'secret-sid-123' }, salt: 'secret-salt-xyz' };
    expect(a.engine.sendPrivate('s1', { v: 1, t: 'reveal', ...secret, purpose: 'revealTo', about: 'cid-1' })).toBe(true);
    expect(a.engine.sendPrivate('s3', { v: 1, t: 'reveal', ...secret, purpose: 'revealTo', about: 'cid-2' })).toBe(false); // nobody holds s3
    await vi.advanceTimersByTimeAsync(500);
    expect(got).toEqual([{ seat: 's0', peerId: 'peer0', t: 'reveal' }]);
    expect(cGot).toBe(0);
    const toC = sim.net.delivered.filter((d) => d.to === tid(c));
    expect(scan([toC, c.engine.messages(), c.engine.state()], ['secret-sid-123', 'secret-salt-xyz'])).toEqual([]);
    expect(scan([sim.net.delivered.filter((d) => d.to === tid(b))], ['secret-sid-123']).length).toBeGreaterThan(0);
  });

  it('presence reaches every peer with the sender’s seat and never enters the log', async () => {
    const sim = await connected({ engines: 3, seed: 13, ...DELAY });
    const [a, b, c] = sim.peers as [SimPeer, SimPeer, SimPeer];
    const seq = a.engine.seq();
    const acts = sim.net.delivered.filter((d) => d.channel === 'act').length;
    a.engine.presence.cursor({ x: 10, y: 20 }, libraryIds(0)[0]!);
    a.engine.presence.drag([{ id: libraryIds(0)[0]!, pose: { x: 11, y: 22, rot: 0 } }]);
    a.engine.presence.typing('table');
    await vi.advanceTimersByTimeAsync(300);
    for (const p of [b, c]) {
      expect(p.engine.presence.peers()).toEqual([
        expect.objectContaining({ peerId: 'peer0', seat: 's0', cursor: { x: 10, y: 20 }, over: libraryIds(0)[0], typing: 'table', drag: [{ id: libraryIds(0)[0], pose: { x: 11, y: 22, rot: 0 } }] }),
      ]);
    }
    expect(sim.net.delivered.filter((d) => d.channel === 'act').length).toBe(acts);
    for (const p of sim.peers) expect(p.engine.seq()).toBe(seq);
    // A peer that goes away disappears from presence.
    sim.net.kill(tid(a));
    await vi.advanceTimersByTimeAsync(100);
    expect(b.engine.presence.peers()).toEqual([]);
  });
});

describe('liveness and the sequencer’s clock', () => {
  it('a peer that leaves with bye is dropped at once and the sequencer re-elected', async () => {
    const sim = await connected({ engines: 3, seed: 14, ...DELAY });
    const [a, b, c] = sim.peers as [SimPeer, SimPeer, SimPeer];
    const changes: [string, (string | null)[]][] = [];
    for (const p of [b, c]) {
      const seen: (string | null)[] = [];
      changes.push([p.peerId, seen]);
      p.engine.onSequencerChange((s) => seen.push(s));
    }
    const seqAtLeave = b.engine.seq();
    a.engine.leave();
    expect(a.engine.status()).toBe('closed');
    const took = await until(() => agreed([b, c]), AWAY_AFTER_MS, 'handover after bye', 20);
    expect(took).toBeLessThan(1500);
    expect(b.engine.isSequencing()).toBe(true);
    expect(b.engine.peers().map((p) => p.peerId)).toEqual(['peer2']);
    // Each survivor hears of the change once; the new sequencer announces itself once it has taken over.
    expect(changes).toEqual([
      ['peer1', ['peer1']],
      ['peer2', ['peer1']],
    ]);
    expect(b.engine.seq()).toBeGreaterThanOrEqual(seqAtLeave);
  });

  it('a joiner that meets a higher seat before the sequencer settles without logging a handover', async () => {
    const sim = await connected({ engines: 2, seed: 15, ...DELAY });
    const [a] = sim.peers as [SimPeer, SimPeer];
    a.engine.propose(life(a, 'early'));
    await expectConverged(sim.peers);
    // The joiner's transport id is t2-2 (sim.add); the sequencer's first hello to it is lost, so it verifies seat 1
    // first, elects it for a moment, then settles on seat 0.
    let lost = 0;
    a.transport.dropOut = (_ch, msg, to) => msg.t === 'hello' && to === 't2-2' && lost++ === 0;
    const elected: (string | null)[] = [];
    const c = sim.add(2);
    c.engine.onSequencerChange((s) => elected.push(s));
    await until(() => agreed(sim.peers), 20_000, 'joiner settles');
    await expectConverged(sim.peers);
    expect(lost).toBeGreaterThan(0);
    expect(elected).toContain('peer1'); // it did elect seat 1 on the way
    expect(elected.at(-1)).toBe('peer0');
    expect(c.engine.sequencerId()).toBe('peer0');
    expect(c.system.filter((t) => /now sequences/.test(t))).toEqual([]);
    expect(sim.peers.flatMap((p) => p.system).filter((t) => /now sequences/.test(t))).toEqual([]);
  });

  it('marks a silent peer away after 6 s, and connected again when it speaks', async () => {
    const sim = await connected({ engines: 3, seed: 15, ...DELAY });
    const [a, , c] = sim.peers as [SimPeer, SimPeer, SimPeer];
    c.transport.silent = true;
    await vi.advanceTimersByTimeAsync(AWAY_AFTER_MS - 1000);
    expect(a.engine.peers().find((p) => p.peerId === 'peer2')!.status).toBe('connected');
    await vi.advanceTimersByTimeAsync(1500);
    expect(a.engine.peers().find((p) => p.peerId === 'peer2')!.status).toBe('away');
    c.transport.silent = false;
    await until(() => a.engine.peers().find((p) => p.peerId === 'peer2')!.status === 'connected', HEARTBEAT_MS + 500, 'back');
  });

  it('goes idle → joining → alone → connected, and closed after leave', async () => {
    const sim = makeSim({ engines: 0, seed: 16, ...DELAY });
    const seen: string[] = [];
    const a = sim.add(0);
    a.engine.onStatus((s) => seen.push(s));
    await vi.advanceTimersByTimeAsync(10);
    expect(a.engine.status()).toBe('alone');
    sim.add(1);
    await until(() => agreed(sim.peers), 10_000, 'connection');
    a.engine.leave();
    expect(seen[0]).toBe('alone');
    expect(seen).toContain('connected');
    expect(seen[seen.length - 1]).toBe('closed');
  });

  it('alone, a browser sequences its own actions at once', async () => {
    const sim = makeSim({ engines: 1, seed: 17, ...DELAY });
    const a = sim.peers[0]!;
    await vi.advanceTimersByTimeAsync(10);
    const seq = a.engine.seq();
    expect(a.engine.propose(life(a, 'solo'))).toBe(true);
    expect(a.engine.seq()).toBe(seq + 1);
    expect(a.acked.has('solo')).toBe(true);
    expect(a.engine.pending()).toEqual([]);
  });

  it('the sequencer emits deadline actions once, and a new sequencer re-arms them after a handover', async () => {
    const deadlines = (s: TableState): Deadline[] => (s.turn.phase === 'combat' ? [{ key: `combat:${s.turn.number}`, fromSeq: s.seq, afterMs: 3000, emit: [{ type: 'phaseSet', phase: 'main2' }] }] : []);
    const sim = makeSim({ engines: 3, seed: 18, deadlines, ...DELAY });
    await until(() => agreed(sim.peers), 20_000, 'connection');
    const [a, b, c] = sim.peers as [SimPeer, SimPeer, SimPeer];
    b.engine.propose({ type: 'phaseSet', by: 's1', cid: 'fight', phase: 'combat' });
    await vi.advanceTimersByTimeAsync(2500);
    expect(a.engine.state().turn.phase).toBe('combat');
    await vi.advanceTimersByTimeAsync(1000);
    await expectConverged(sim.peers);
    const emitted = [...a.log.values()].filter((x) => x.type === 'phaseSet' && x.phase === 'main2');
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.by).toBe('s0');
    // Again, but the sequencer dies before its timer fires: the next one fires it from its own clock.
    c.engine.propose({ type: 'phaseSet', by: 's2', cid: 'fight2', phase: 'combat' });
    await vi.advanceTimersByTimeAsync(1000);
    sim.net.kill(tid(a));
    await vi.advanceTimersByTimeAsync(5000);
    await expectConverged([b, c]);
    const later = [...b.log.values()].filter((x) => x.type === 'phaseSet' && x.phase === 'main2');
    expect(later).toHaveLength(2);
    expect(later[1]!.by).toBe('s1');
    expect(b.engine.state().turn.phase).toBe('main2');
  });
});

describe('meeting after acting alone, and reloads', () => {
  it('browsers that sequenced alone before meeting converge, and neither loses its own actions', async () => {
    const sim = makeSim({ engines: 2, seed: 19, ...DELAY });
    const [a, b] = sim.peers as [SimPeer, SimPeer];
    // A partition: neither hears the other at first.
    a.transport.dropIn = () => true;
    b.transport.dropIn = () => true;
    await vi.advanceTimersByTimeAsync(50);
    for (let i = 0; i < 3; i++) if (a.engine.propose(life(a, `a-alone-${i}`))) a.proposed.push(`a-alone-${i}`);
    for (let i = 0; i < 5; i++) if (b.engine.propose(life(b, `b-alone-${i}`))) b.proposed.push(`b-alone-${i}`);
    expect(a.acked.size + b.acked.size).toBe(8); // each sequenced its own, alone
    a.transport.dropIn = null;
    b.transport.dropIn = null;
    await until(() => agreed(sim.peers), 20_000, 'meeting');
    await expectConverged(sim.peers);
    const log = [...a.log.values()].map((x) => x.cid);
    for (const cid of [...a.proposed, ...b.proposed]) expect(log, cid).toContain(cid);
    expect(a.engine.state().seats.s0!.life).toBe(17);
    expect(a.engine.state().seats.s1!.life).toBe(15);
    expect(a.engine.isSequencing()).toBe(true);
  });

  it.each([
    { a: 5, b: 20, what: 'the other side is longer' },
    { a: 6, b: 5, what: 'both sides reach the same seq' },
    { a: 20, b: 5, what: 'the sequencer’s side is longer' },
  ])('a split that heals ($what): every follower re-verifies its history, acked actions are re-proposed, never lost', async ({ a: nA, b: nB }) => {
    // The review round-3 probe, kept as a regression test: 4 engines, seed 5, delay 5–40 ms, no drops.
    // DESIGN "Multiplayer architecture", Shared state: every peer applies the sequencer's order; PLAN M1-P1: no
    // acknowledged action is lost. {peer0, peer1} and {peer2, peer3} split; each side sequences its own history
    // (side B under peer2, which logs its handover). After healing, peer0 re-claims; whichever history it continues,
    // every peer that holds the other one notices the fork and proposes its abandoned (acked) actions again — peer1
    // too, whose sequencer was peer0 all along — and no peer's confirmed state ever differs from the sequencer's from
    // the sequencer's first new seq on (the reviewer's condition, not only after a settle).
    const start = baseTable(4);
    const sim = await connected({ engines: 4, seed: 5, start, ...DELAY });
    const [a, b, c, d] = sim.peers as [SimPeer, SimPeer, SimPeer, SimPeer];
    const sideA = new Set([tid(a), tid(b)]);
    const split = { on: true };
    for (const p of sim.peers) {
      const mine = sideA.has(tid(p));
      p.transport.dropIn = (_ch, _msg, from) => split.on && sideA.has(from) !== mine;
    }
    await until(() => c.engine.isSequencing() && agreed([c, d]) && agreed([a, b]), 4 * AWAY_AFTER_MS, 'two sides');
    for (let i = 0; i < nA; i++) {
      b.engine.propose(life(b, `b-${i}`));
      await vi.advanceTimersByTimeAsync(60);
    }
    for (let i = 0; i < nB; i++) {
      d.engine.propose({ type: 'life', by: 's3', cid: `d-${i}`, seat: 's3', delta: -1 });
      await vi.advanceTimersByTimeAsync(60);
    }
    await until(() => b.acked.size === nA && d.acked.size === nB, 10_000, 'both sides sequenced');
    if (nA === nB + 1) expect(c.engine.seq()).toBe(a.engine.seq());
    else if (nA < nB) expect(c.engine.seq()).toBeGreaterThan(a.engine.seq());
    else expect(c.engine.seq()).toBeLessThan(a.engine.seq());
    const heads = Math.max(a.engine.seq(), c.engine.seq());
    split.on = false;
    await until(() => agreed(sim.peers) && a.engine.isSequencing(), 30_000, 'healed');
    await until(() => sim.peers.every((p) => p.engine.seq() > heads), 15_000, 'the sequencer’s first new seq everywhere');

    // The sequencer's first new seq is its handover record: it took over from the other side's history, or followed
    // peers that named another sequencer.
    const first = [...a.log.values()].filter((x) => x.seq > heads).sort((x, y) => x.seq - y.seq)[0]!;
    expect(first).toMatchObject({ type: 'sequencerClaim', peer: 'peer0' });
    const n = first.seq;
    const truth = historyWhenReached(a, n)!;
    const want = hashOf(replay(start, truth, n));
    for (const p of sim.peers) {
      // What this peer had applied when it first applied seq n is the sequencer's history, cid for cid.
      const h = historyWhenReached(p, n);
      expect(h, `${p.peerId} reached seq ${n}`).not.toBeNull();
      for (let q = start.seq + 1; q <= n; q++) expect(h!.get(q)?.cid, `${p.peerId} seq ${q} when it reached ${n}`).toBe(truth.get(q)?.cid);
      expect(hashOf(replay(start, h!, n)), `${p.peerId} confirmed hash at seq ${n}`).toBe(want);
    }
    await expectConverged(sim.peers, 15_000);
    for (const p of sim.peers) expect(p.system.filter((t) => /hash mismatch/.test(t)), p.peerId).toEqual([]);
    // Each acked cid ends up in the sequencer's history (none was refused, so none is rolled back).
    const log = new Set([...a.log.values()].filter((x) => x.seq <= a.engine.seq()).map((x) => x.cid));
    expect(b.rolledBack.size + d.rolledBack.size).toBe(0);
    for (const cid of [...b.acked, ...d.acked]) expect(log.has(cid), cid).toBe(true);
    for (const p of sim.peers) {
      expect(p.engine.confirmedState().seats.s1!.life, p.peerId).toBe(20 - nA);
      expect(p.engine.confirmedState().seats.s3!.life, p.peerId).toBe(20 - nB);
      expect(p.engine.confirmedState().seats.s0!.away, `${p.peerId}: nobody is away once healed`).toBeUndefined();
      expect(p.engine.confirmedState().seats.s2!.away, `${p.peerId}: nobody is away once healed`).toBeUndefined();
    }
  });

  it.each([
    { seed: 13, drop: 0.05 },
    { seed: 100, drop: 0 },
    { seed: 106, drop: 0 },
    { seed: 133, drop: 0.05 },
    { seed: 182, drop: 0 },
    { seed: 122, drop: 0.05 },
  ])('a split that heals while followers keep acting (seed $seed): no follower stacks the new history on its old one', async ({ seed, drop }) => {
    // Review M1-P1 retry round 1, finding 1: a stamp the sequencer made before its claim, delivered late, made a
    // follower re-read the overlap while the sequencer was still claiming; it took that answer (the history about to
    // be abandoned) as the verification and later stacked the adopted history on its forked copy, losing its acked
    // actions as a "reducer bug". A claimant now answers catch-up only once it has taken over, and only the overlap
    // read sent after the claim verifies it. Condition (the reviewer's): every follower's history when it first
    // reaches any seq above the pre-heal heads is the final history, no hash mismatch, every acked action is in the
    // log. Seqs a peer stamped while it was itself still sequencing are exempt: the losing side's sequencer may stamp
    // its own action right after the heal before it learns of the claimant (inherent to a split; the action is
    // re-proposed and sequenced again, review M1-P1 retry round 2).
    const start = baseTable(4);
    const sim = await connected({ engines: 4, seed, start, ...DELAY, drop });
    const [a, b, c, d] = sim.peers as [SimPeer, SimPeer, SimPeer, SimPeer];
    const stampedAlone = new Map<SimPeer, Set<number>>(sim.peers.map((p) => [p, new Set<number>()]));
    for (const p of sim.peers) {
      p.engine.onSequenced(() => {
        if (p.engine.isSequencing()) stampedAlone.get(p)!.add(p.trace.length - 1);
      });
    }
    const sideA = new Set([tid(a), tid(b)]);
    const split = { on: true };
    for (const p of sim.peers) {
      const mine = sideA.has(tid(p));
      p.transport.dropIn = (_ch, _msg, from) => split.on && sideA.has(from) !== mine;
    }
    await until(() => c.engine.isSequencing() && agreed([c, d]) && agreed([a, b]), 6 * AWAY_AFTER_MS, 'two sides');
    for (let i = 0; i < 5; i++) {
      b.engine.propose(life(b, `b-${i}`));
      await vi.advanceTimersByTimeAsync(60);
    }
    for (let i = 0; i < 20; i++) {
      d.engine.propose(life(d, `d-${i}`));
      await vi.advanceTimersByTimeAsync(60);
    }
    await until(() => b.acked.size === 5 && d.acked.size === 20, 20_000, 'both sides sequenced');
    const heads = Math.max(a.engine.seq(), c.engine.seq());
    split.on = false;
    for (let i = 0; i < 6; i++) {
      b.engine.propose(life(b, `bx-${i}`));
      c.engine.propose(life(c, `cx-${i}`));
      d.engine.propose(life(d, `dx-${i}`));
      await vi.advanceTimersByTimeAsync(150);
    }
    await until(() => agreed(sim.peers) && converged(sim.peers), 60_000, 'healed and converged');
    const seqr = sim.peers.find((p) => p.engine.isSequencing())!;
    const final = new Map([...seqr.log.values()].map((x) => [x.seq, x.cid]));
    for (const p of sim.peers) {
      const reached = new Set<number>();
      for (const [i, x] of p.trace.entries()) {
        if (x.seq <= heads || stampedAlone.get(p)!.has(i) || reached.has(x.seq)) continue;
        reached.add(x.seq);
        // This peer's history when it first applied seq x.seq from a sequencer other than itself.
        const h = new Map<number, string>();
        for (const y of p.trace.slice(0, i + 1)) if (y.seq <= x.seq) h.set(y.seq, y.cid);
        for (let q = start.seq + 1; q <= x.seq; q++) expect(h.get(q), `${p.peerId} at its first ${x.seq}, seq ${q}`).toBe(final.get(q));
      }
      expect(p.system.filter((t) => /mismatch/.test(t)), p.peerId).toEqual([]);
      expect(p.rolledBack.size, p.peerId).toBe(0);
    }
    const all = new Set(final.values());
    for (const p of sim.peers) for (const cid of p.acked) if (!/^peer\d/.test(cid)) expect(all.has(cid), `${p.peerId} acked ${cid}`).toBe(true);
    const st = seqr.engine.confirmedState();
    expect([st.seats.s0!.life, st.seats.s1!.life, st.seats.s2!.life, st.seats.s3!.life]).toEqual([20, 9, 14, -6]);
  });

  it.each([
    { seed: 1, drop: 0.05, groups: [0, 1, 2, 2], what: 'a claimant whose checked peer rewound below its claimAck asks again' },
    { seed: 16, drop: 0, groups: [0, 1, 1, 2], what: 'a follower drops a catch-up answer it no longer waits for' },
    { seed: 180, drop: 0.05, groups: [0, 1, 2, 2], what: 'a follower still verifying does not adopt from a single forked seq' },
    { seed: 425, drop: 0.05, groups: [0, 1, 2, 2], what: 'a verification snapshot is not swallowed by an older-epoch request' },
    { seed: 5, drop: 0.1, groups: [0, 1, 2, 2], what: 'a follower still verifying waits for the overlap read (drop 0.1)' },
  ])('a three-way split heals (seed $seed): $what', async ({ seed, drop, groups }) => {
    // Review M1-P1 retry round 1, findings 2 and 3: {peer0}, {peer1}, {peer2, peer3} (or {peer1, peer2}, {peer3})
    // each sequence alone, then heal. Seed 16 once applied a late answer from a former sequencer on top of a
    // replica rewound to adopt the new one's history (a mixed confirmed state, logged as a hash mismatch); seed 1 once
    // left peer0 claiming for ever on a claimAck its checked peer had since rewound below.
    const n = [10, 1, 6, 3];
    const sim = await connected({ engines: 4, seed, start: baseTable(4), ...DELAY, drop });
    const g = new Map(sim.peers.map((p, i) => [tid(p), groups[i]!]));
    const split = { on: true };
    for (const p of sim.peers) p.transport.dropIn = (_ch, _msg, from) => split.on && g.get(from) !== g.get(tid(p));
    await vi.advanceTimersByTimeAsync(4 * AWAY_AFTER_MS);
    for (let k = 0; k < 12; k++) {
      for (const [i, p] of sim.peers.entries()) {
        if (k >= n[i]!) continue;
        p.engine.propose(life(p, `x${i}-${k}`));
        await vi.advanceTimersByTimeAsync(30);
      }
    }
    await until(() => sim.peers.every((p, i) => [...p.acked].filter((cid) => cid.startsWith('x')).length === n[i]), 20_000, 'each side sequenced');
    split.on = false;
    await until(() => agreed(sim.peers) && converged(sim.peers), 60_000, 'convergence after the heal', 100);
    for (const p of sim.peers) expect(p.system.filter((t) => /mismatch/.test(t)), p.peerId).toEqual([]);
    for (const p of sim.peers) expect(p.engine.isSequencing() || p.engine.status() === 'connected', p.peerId).toBe(true);
    const st = sim.peers[0]!.engine.confirmedState();
    for (let i = 0; i < 4; i++) expect(st.seats[`s${i}`]!.life).toBe(20 - n[i]!);
  });

  it.each([
    { silent: true, what: 'cut off without a word' },
    { silent: false, what: 'killed and revived' },
  ])('a sequencer $what that went on alone returns: the room keeps its history, the returning page re-proposes its own', async ({ silent }) => {
    // DESIGN "Multiplayer architecture": the connected peer with the lowest seat takes over from the last sequence
    // number everyone acknowledges. The old sequencer sequenced alone meanwhile (its own actions, and `away` records
    // for the seats it lost); none of that may replace what the room acknowledged, not even for a moment: no
    // follower ever applies a seq it later has to rewind.
    const sim = await connected({ engines: 3, seed: 27, ...DELAY });
    const [a, b, c] = sim.peers as [SimPeer, SimPeer, SimPeer];
    for (let i = 0; i < 3; i++) b.engine.propose(life(b, `before-${i}`));
    await expectConverged(sim.peers);
    if (silent) a.transport.silent = true;
    else sim.net.kill(tid(a));
    await until(() => b.engine.isSequencing() && agreed([b, c]), 4 * AWAY_AFTER_MS, 'handover');
    for (let i = 0; i < 3; i++) if (a.engine.propose(life(a, `alone-${i}`))) a.proposed.push(`alone-${i}`);
    expect([...a.acked].filter((x) => x.startsWith('alone-')), 'the cut-off page sequenced its own actions alone').toHaveLength(3);
    await until(() => a.engine.state().seats.s1!.away === true, 2 * AWAY_AFTER_MS, 'the cut-off page marks the others away');
    for (let i = 0; i < 10; i++) {
      c.engine.propose(life(c, `room-${i}`));
      await vi.advanceTimersByTimeAsync(60);
    }
    await until(() => c.acked.size === 10, 10_000, 'the room sequenced');
    const roomHead = b.engine.seq();
    expect(roomHead).toBeGreaterThan(a.engine.seq());
    if (silent) a.transport.silent = false;
    else sim.net.revive(tid(a));
    await until(() => agreed(sim.peers) && a.engine.isSequencing(), 30_000, 'the old sequencer back');
    await expectConverged(sim.peers);
    const final = new Map([...a.log.values()].map((x) => [x.seq, x.cid]));
    for (const p of [b, c]) {
      for (const x of p.trace) expect(final.get(x.seq), `${p.peerId} applied ${x.cid} at seq ${x.seq} and kept it`).toBe(x.cid);
      expect(p.system.filter((t) => /diverged|mismatch/.test(t)), p.peerId).toEqual([]);
    }
    const log = new Set(final.values());
    for (const cid of c.acked) expect(log.has(cid), cid).toBe(true);
    for (const cid of a.proposed) expect(log.has(cid), `${cid} re-proposed and sequenced`).toBe(true);
    for (const p of sim.peers) {
      expect(p.engine.confirmedState().seats.s0!.life, p.peerId).toBe(17);
      expect(p.engine.confirmedState().seats.s2!.life, p.peerId).toBe(10);
      for (const seat of ['s0', 's1', 's2']) expect(p.engine.confirmedState().seats[seat]!.away, `${p.peerId} ${seat}`).toBeUndefined();
    }
  });

  it('a reloaded page with the same identity replaces its old connection and catches up', async () => {
    const sim = await connected({ engines: 3, seed: 20, ...DELAY });
    const [a, b] = sim.peers as [SimPeer, SimPeer];
    const save = { seq: b.engine.seq(), state: b.engine.confirmedState() };
    b.transport.silent = true; // the old page is gone without a word
    for (let i = 0; i < 4; i++) a.engine.propose(life(a, `meanwhile-${i}`));
    const reloaded = sim.add(1, save);
    await until(() => a.engine.peers().filter((p) => p.peerId === 'peer1' && p.status === 'connected').length === 1 && reloaded.engine.status() === 'connected', 20_000, 'reload');
    expect(a.engine.peers().filter((p) => p.peerId === 'peer1')).toHaveLength(1);
    expect(a.engine.peers().find((p) => p.peerId === 'peer1')!.transportId).toBe(tid(reloaded));
    reloaded.engine.propose(life(reloaded, 'after-reload'));
    const live = sim.peers.filter((p) => p !== b);
    await expectConverged(live);
    expect(reloaded.engine.state().seats.s0!.life).toBe(16);
    expect(reloaded.engine.state().seats.s1!.life).toBe(19);
  });
});
