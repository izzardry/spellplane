/**
 * PLAN M1-P2 acceptance tests on a simulated network (LoopbackNetwork with delay, drop, reordering and peer loss):
 * a mismatched reveal is flagged on every peer; the shuffle order cannot be reproduced from public messages alone
 * and can be with the owner's nonce; the owner cannot change its nonce after the peers' nonces arrived. Also the
 * commit window under peer loss, dice by commit-and-reveal, targeted reveals and private looks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nonceHash, verifyNonce, type RevealedCard } from '../../../src/core/commit';
import { stateHash } from '../../../src/core/hash';
import { reduce } from '../../../src/core/reducer';
import { COMMIT_WINDOW_MS, orderHash, rngOutcome, rngSeed, shuffleOutcome, shufflePeerNonces, shuffleSeed } from '../../../src/core/rng';
import { auditSeat, beginShuffle, revealedCard, shuffleRecord } from '../../../src/core/secrets';
import type { TableState } from '../../../src/core/types';
import type { LoopbackOptions } from '../../../src/net/loopback';
import type { SequencedAction } from '../../../src/net/messages';
import { fixtureDeck, netTable, type NetTable } from '../../leak/fixtures';
import { until, type MiniPeer } from '../../leak/minitable';
import { scan } from '../../leak/scan';

const FAULTY: LoopbackOptions = { seed: 7, delay: { min: 0, max: 250 }, drop: 0.05, faultyChannels: ['act', 'ctl'] };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function table(names: string[], options: LoopbackOptions = FAULTY): Promise<NetTable> {
  const t = await netTable(names, options);
  await until(() => t.peers.every((p) => p.peers().length === names.length - 1), 5_000, 'peers to connect');
  const decks = [await fixtureDeck('gw-m19-60.txt'), await fixtureDeck('ur-m19-60.mtga.txt')];
  for (const [i, p] of t.players.entries()) await p.importDeck(decks[i % 2]!);
  await converged(t);
  return t;
}

/** Wait until every live peer applied the same last seq, then compare hashes. */
async function converged(t: NetTable, live: MiniPeer[] = t.peers): Promise<string> {
  const last = (): number => Math.max(...live.map((p) => p.state.seq));
  await until(() => live.every((p) => p.state.seq === last()), 30_000, 'peers to converge');
  const hashes = await Promise.all(live.map((p) => stateHash(p.state)));
  expect(new Set(hashes).size).toBe(1);
  return hashes[0]!;
}

/** Every string anywhere in `v` (values and keys). */
function strings(v: unknown, out = new Set<string>()): Set<string> {
  if (typeof v === 'string') out.add(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (typeof v === 'object' && v !== null)
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      strings(x, out);
    }
  return out;
}

/** What peer `seat`'s transport received, from the network's delivered log. */
function receivedBy(t: NetTable, peer: MiniPeer): unknown[] {
  return t.net.delivered.filter((d) => d.to === peer.peerId).map((d) => d.msg);
}

describe('a reveal that does not match its commitment', () => {
  it('is flagged on every peer, in shared state, and the table carries on', async () => {
    const t = await table(['Anna', 'Ben', 'Cleo']);
    const [a] = t.players;
    await a!.shuffle();
    const [x, y] = await a!.draw(2);
    // A genuine reveal and a forged one (claims another printing).
    await a!.play(x!, { x: 0, y: -200, rot: 0 });
    const real = revealedCard(a!.secrets, y!)!;
    await a!.peer.act({ type: 'reveal', instanceId: y!, ref: { sid: 'forged-printing' }, salt: real.salt });
    await a!.peer.act({ type: 'move', card: y!, to: 'battlefield:s0', pose: { x: 70, y: -200, rot: 0 } });
    await converged(t);
    for (const p of t.peers) {
      expect(p.state.cards[y!]).toMatchObject({ identity: { sid: 'forged-printing' }, suspect: true, zone: 'battlefield:s0' });
      expect(p.state.cards[x!]!.suspect).toBeUndefined();
    }
    // Play goes on: the next action applies everywhere.
    await t.players[1]!.draw(1);
    await converged(t);
  });
});

describe('the secret shuffle over the network', () => {
  it('cannot be reproduced from public messages alone, and can be with the owner nonce', async () => {
    const t = await table(['Anna', 'Ben', 'Cleo']);
    const [a, b] = t.players;
    const before = b!.state;
    const sid = await a!.shuffle();
    await converged(t);
    const log = b!.peer.log();
    const done = log.find((x): x is SequencedAction & { type: 'shuffleDone' } => x.type === 'shuffleDone' && x.sid === sid)!;
    const commit = log.find((x): x is SequencedAction & { type: 'shuffleCommit' } => x.type === 'shuffleCommit' && x.sid === sid)!;
    // Everything B knows publicly: its state before the shuffle (the sorted ids), the sequenced round and every message it received.
    const atDone: TableState = log.filter((x) => x.seq < done.seq && x.seq > before.seq).reduce<TableState>((s, x) => reduce(s, x), before);
    const oldIds = atDone.zones['library:s0']!.ids;
    const peers = shufflePeerNonces(atDone, sid);
    expect(peers).toHaveLength(2);
    const publicStrings = strings([receivedBy(t, b!.peer), b!.state, b!.secrets]);
    let tried = 0;
    for (const guess of publicStrings) {
      expect(verifyNonce(commit.h, guess)).toBe(false);
      const out = shuffleOutcome(shuffleSeed(guess, peers), oldIds, done.reissue?.ids);
      expect(orderHash(out.order, guess)).not.toBe(done.orderHash);
      tried++;
    }
    expect(tried).toBeGreaterThan(200);
    // With the owner's nonce (from its audit record) B reproduces the order, the hash and the identities' positions.
    const ownerNonce = shuffleRecord(a!.secrets, sid)!.ownerNonce;
    expect(publicStrings.has(ownerNonce)).toBe(false);
    expect(nonceHash(ownerNonce)).toBe(commit.h);
    const out = shuffleOutcome(shuffleSeed(ownerNonce, peers), oldIds, done.reissue?.ids);
    expect(orderHash(out.order, ownerNonce)).toBe(done.orderHash);
    expect(out.order).toEqual(a!.secrets.libraryOrder);
    // And A's next draws name exactly that order's top cards.
    await a!.draw(3);
    await converged(t);
    const draws = b!.peer.log().filter((x) => x.type === 'draw' && x.by === 's0').map((x) => (x.type === 'draw' ? x.instanceId : ''));
    expect(draws).toEqual(out.order.slice(0, 3));
  });

  it('rejects a changed owner nonce after the peers sent theirs, on every peer', async () => {
    const t = await table(['Anna', 'Ben']);
    const [a, b] = t.players;
    const lib = 'library:s0';
    const first = beginShuffle(a!.secrets, lib, 'sh-x', 'first-nonce');
    a!.secrets = first.secrets;
    await a!.peer.act(first.action);
    await until(() => Object.keys(a!.state.shuffles['sh-x']!.nonces).length === 1, 10_000, "B's nonce");
    const h0 = await converged(t);
    // The owner now prefers another nonce: re-commit the round, or start a new round on the same zone.
    await expect(a!.peer.act({ type: 'shuffleCommit', sid: 'sh-x', zone: lib, h: nonceHash('second-nonce') })).rejects.toThrow(/already exists/);
    await expect(a!.peer.act({ type: 'shuffleCommit', sid: 'sh-y', zone: lib, h: nonceHash('second-nonce') })).rejects.toThrow(/already has peer nonces/);
    // A non-sequencer owner is refused by the sequencer's nack the same way.
    const bLib = 'library:s1';
    await b!.peer.act({ type: 'shuffleCommit', sid: 'sh-b', zone: bLib, h: nonceHash('b-first') });
    await until(() => Object.keys(a!.state.shuffles['sh-b']?.nonces ?? {}).length === 1, 10_000, "A's nonce for B");
    await expect(b!.peer.act({ type: 'shuffleCommit', sid: 'sh-b', zone: bLib, h: nonceHash('b-second') })).rejects.toThrow(/already exists/);
    await expect(b!.peer.act({ type: 'shuffleCommit', sid: 'sh-b2', zone: bLib, h: nonceHash('b-second') })).rejects.toThrow(/already has peer nonces/);
    const h1 = await converged(t);
    expect(h1).not.toBe(h0);
    for (const p of t.peers) {
      expect(p.state.shuffles['sh-x']!.h).toBe(nonceHash('first-nonce'));
      expect(p.state.shuffles['sh-b']!.h).toBe(nonceHash('b-first'));
      expect(p.state.shuffles['sh-y']).toBeUndefined();
    }
  });

  it('a done with another nonce than the committed one is exposed by the audit', async () => {
    const t = await table(['Anna', 'Ben']);
    const [a, b] = t.players;
    const lib = 'library:s0';
    const start = b!.state;
    const first = beginShuffle(a!.secrets, lib, 'sh-z', 'committed-nonce');
    a!.secrets = first.secrets;
    await a!.peer.act(first.action);
    await until(() => Object.keys(a!.state.shuffles['sh-z']!.nonces).length === 1, 10_000, "B's nonce");
    // The owner computes the order with a nonce chosen after seeing B's; the reducer cannot tell, the audit can.
    const peers = shufflePeerNonces(a!.state, 'sh-z');
    const chosen = shuffleOutcome(shuffleSeed('chosen-later', peers), a!.state.zones[lib]!.ids);
    await a!.peer.act({ type: 'shuffleDone', sid: 'sh-z', orderHash: orderHash(chosen.order, 'chosen-later') });
    await converged(t);
    const published = a!.secrets.audit.map((r) => (r.kind === 'shuffle' && r.sid === 'sh-z' ? { ...r, ownerNonce: 'chosen-later', peerNonces: peers, order: chosen.order } : r));
    const after = b!.peer.log().filter((x) => x.seq > start.seq);
    const findings = auditSeat(start, after, 's0', published, a!.secrets.identities).map((f) => f.text);
    expect(findings).toEqual([expect.stringMatching(/sh-z does not open its commit/)]);
  });

  it('closes the nonce window after 3 s when a peer is lost, and finishes with the nonces that arrived', async () => {
    const t = await table(['Anna', 'Ben', 'Cleo']);
    const [a, b, c] = t.players;
    t.net.kill(c!.peer.peerId);
    const live = [a!.peer, b!.peer];
    const at = Date.now();
    // B shuffles; A (seat 0) is the sequencer and closes the window.
    const sid = await b!.shuffle();
    expect(Date.now() - at).toBeGreaterThanOrEqual(COMMIT_WINDOW_MS);
    await converged(t, live);
    for (const p of live) {
      const r = p.state.shuffles[sid]!;
      expect(r.closedSeq).toBeDefined();
      expect(Object.keys(r.nonces)).toEqual(['s0']);
      expect(r.orderHash).not.toBeNull();
    }
    expect(shuffleRecord(b!.secrets, sid)!.peerNonces).toEqual([b!.state.shuffles[sid]!.nonces.s0]);
  });

  it("the sequencer's clock never closes the sequencer's own shuffle: the owner cannot shut the peers out", async () => {
    const t = await table(['Anna', 'Ben']);
    const [a, b] = t.players;
    t.net.kill(b!.peer.peerId);
    const sid = 's0-own';
    const begun = beginShuffle(a!.secrets, 'library:s0', sid, 'owner-nonce');
    a!.secrets = begun.secrets;
    await a!.peer.act(begun.action);
    await vi.advanceTimersByTimeAsync(3 * COMMIT_WINDOW_MS);
    const r = a!.state.shuffles[sid]!;
    expect(r.closedSeq).toBeUndefined();
    expect(r.orderHash).toBeNull();
    expect(a!.peer.log().some((x) => x.type === 'commitClose')).toBe(false);
  });
});

describe('dice and coins by commit-and-reveal', () => {
  it('every seated peer contributes and all agree on the result', async () => {
    const t = await table(['Anna', 'Ben', 'Cleo']);
    const result = await t.players[1]!.roll(20);
    await converged(t);
    const rid = Object.keys(t.peers[0]!.state.rng)[0]!;
    for (const p of t.peers) {
      const r = p.state.rng[rid]!;
      expect(Object.keys(r.commits).sort()).toEqual(['s0', 's1', 's2']);
      expect(r.result).toBe(result);
      expect(r.result).toBe(rngOutcome(rngSeed(r.reveals, ['s0', 's1', 's2']), 20));
    }
  });

  it('a lost peer is excluded when the commit window closes', async () => {
    const t = await table(['Anna', 'Ben', 'Cleo']);
    t.net.kill(t.peers[2]!.peerId);
    // Ben rolls; Anna (seat 0) is the sequencer and closes the window.
    await t.players[1]!.roll(6);
    await converged(t, t.peers.slice(0, 2));
    const r = Object.values(t.peers[1]!.state.rng)[0]!;
    expect(Object.keys(r.reveals).sort()).toEqual(['s0', 's1']);
    expect(r.closedSeq).toBeDefined();
  });

  it("the sequencer's own roll is not closed by its own clock, so it never decides alone", async () => {
    const t = await table(['Anna', 'Ben']);
    t.net.kill(t.peers[1]!.peerId);
    const [a] = t.players;
    await a!.peer.act({ type: 'rngCommit', rid: 'mine', purpose: 'die', n: 20, h: nonceHash('a') });
    await vi.advanceTimersByTimeAsync(3 * COMMIT_WINDOW_MS);
    const r = a!.state.rng.mine!;
    expect(r.closedSeq).toBeUndefined();
    expect(r.result).toBeNull();
  });
});

describe('hidden information on the pair channel', () => {
  it('a targeted reveal reaches the named seat only; the public log records the fact', async () => {
    const t = await table(['Anna', 'Ben', 'Cleo']);
    const [a, b, c] = t.players;
    await a!.shuffle();
    const [x] = await a!.draw(1);
    await a!.revealTo(x!, ['s1']);
    await until(() => Object.hasOwn(b!.secrets.received, x!), 10_000, 'B to receive the identity');
    await converged(t);
    const id = a!.secrets.identities[x!]!;
    expect(b!.secrets.received[x!]).toEqual({ card: id.card, salt: id.salt, from: 's0' });
    expect(c!.secrets.received).toEqual({});
    expect(scan([receivedBy(t, c!.peer), c!.state, c!.secrets], [id.salt])).toEqual([]);
    for (const p of t.peers) expect(p.log().some((y) => y.type === 'revealTo' && y.instanceId === x && y.seats.join() === 's1')).toBe(true);
    for (const p of t.peers) expect(p.state.cards[x!]!.identity).toBeUndefined();
  });

  it('private looks are logged publicly with private content; a look at another seat goes through its owner', async () => {
    const t = await table(['Anna', 'Ben', 'Cleo']);
    const [a, b, c] = t.players;
    await a!.shuffle();
    const seen = await a!.scry(2);
    await converged(t);
    for (const p of t.peers) expect(p.log().some((y) => y.type === 'lookAt' && y.by === 's0' && y.count === 2)).toBe(true);
    const tokens = seen.flatMap((id) => [a!.secrets.identities[id]!.salt]);
    expect(scan([receivedBy(t, b!.peer), receivedBy(t, c!.peer), b!.state, c!.state], tokens)).toEqual([]);
    // B looks at the top card of A's library (an effect that allows it): A answers B only.
    await b!.peer.act({ type: 'lookAt', zone: 'library:s0', count: 1 });
    let got: RevealedCard[] | null = null;
    void b!.channel.requestLook('s0', 'library:s0', 1).then((r) => (got = r));
    await until(() => got !== null, 10_000, 'the look answer');
    expect(got!.map((g) => g.instanceId)).toEqual([a!.secrets.libraryOrder[0]]);
    const top = a!.secrets.identities[a!.secrets.libraryOrder[0]!]!;
    expect(scan([receivedBy(t, c!.peer), c!.state], [top.salt])).toEqual([]);
  });
});

