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
import { agreed, baseTable, expectConverged, hashOf, libraryIds, makeSim, until, type Sim, type SimPeer } from './sim';

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

  it('a lost proposal is resent and sequenced; later ones that overtook it are sequenced or rolled back, never lost', async () => {
    // Outside the design's reliable channel (the simulated loss) the wire carries no per-proposer order, so a later
    // proposal can overtake a lost one (decision M1-P1; a `prev` field on `propose` would need a contract change).
    const sim = await connected({ engines: 2, seed: 3, ...DELAY });
    const b = sim.peers[1]!;
    let dropped = 0;
    b.transport.dropOut = (_ch, msg) => msg.t === 'propose' && (msg as unknown as { cid: string }).cid === 'make' && dropped++ === 0;
    b.engine.propose({ type: 'createToken', by: 's1', cid: 'make', card: 'tok-b', zone: 'battlefield:s1', pose: { x: 0, y: 0, rot: 0 }, ref: { sid: 'cat' } });
    b.engine.propose({ type: 'tap', by: 's1', cid: 'tap', card: 'tok-b', tapped: true });
    b.engine.propose({ type: 'counter', by: 's1', cid: 'count', card: 'tok-b', kind: '+1/+1', delta: 1 });
    await expectConverged(sim.peers);
    expect(dropped).toBe(2); // the first copy was lost, the resend went through
    const logged = new Set([...b.log.values()].map((x) => x.cid));
    expect(logged.has('make')).toBe(true);
    for (const cid of ['tap', 'count']) expect(logged.has(cid) !== b.rolledBack.has(cid), `${cid} sequenced xor rolled back`).toBe(true);
    expect(b.rolledBack.get('tap')).toMatch(/tok-b/);
    expect(sim.peers[0]!.engine.state().cards['tok-b']).toMatchObject({ tapped: false });
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
    expect(c.system.some((t) => /hash mismatch/.test(t))).toBe(true);
    // The reload replays the tail after the snapshot; actions already reported are not reported again.
    expect([...emitted].filter(([, n]) => n > 1)).toEqual([]);
    expect(c.engine.state().seats.s2!.life).toBe(sim.peers[0]!.engine.state().seats.s2!.life);
    const log = new Set([...sim.peers[0]!.log.values()].map((a) => a.cid));
    for (const cid of c.proposed) expect(log.has(cid) !== c.rolledBack.has(cid), cid).toBe(true);
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
    expect(a.engine.pendingActions()).toEqual([]);
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
