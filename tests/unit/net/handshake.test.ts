/**
 * The hello handshake with real ECDSA keys (DESIGN "Specification: network protocol and secrecy", Handshake: each
 * side sends `hello {peerId, pubKey, ...}`; `sig` signs the other side's connection nonce; peers with a different
 * `v` are refused with a visible version-mismatch notice). Real timers: Web Crypto settles outside the fake clock.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createTable } from '../../../src/core/reducer';
import type { TableState } from '../../../src/core/types';
import { createNetEngine } from '../../../src/net/engine';
import { createNetIdentity } from '../../../src/net/identity';
import { LoopbackNetwork, type LoopbackTransport } from '../../../src/net/loopback';
import { handshakeText, type WireMessage } from '../../../src/net/messages';
import type { Message } from '../../../src/net/transport';
import type { NetEngine, NetIdentity } from '../../../src/net/types';
import { generateIdentity } from '../../../src/store/identity';
import { TEST_GAME } from '../core/helpers';

const ROOM = 'amber-fox-93';
const engines: NetEngine[] = [];

afterEach(() => {
  for (const e of engines.splice(0)) e.leave();
});

async function realIdentity(nickname: string): Promise<NetIdentity> {
  const rec = await generateIdentity();
  return createNetIdentity(rec.keyPair, rec.peerId, nickname);
}

function table(peers: string[]): { seq: number; state: TableState } {
  const state = createTable({ game: TEST_GAME, format: '1v1', seats: peers.map((peer, i) => ({ name: `P${i}`, colour: i, peer })) });
  return { seq: 0, state };
}

function engine(net: LoopbackNetwork, tid: string, identity: NetIdentity, start: { seq: number; state: TableState }): NetEngine {
  const e = createNetEngine({ transport: net.create(tid), roomId: ROOM, roomKey: 'k', identity, game: TEST_GAME, start: { snapshot: start, tail: [] } });
  engines.push(e);
  return e;
}

async function waitFor(cond: () => boolean, ms = 8000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A scripted peer on the network that speaks raw messages. */
function rawPeer(net: LoopbackNetwork, tid: string): { t: LoopbackTransport; got: WireMessage[] } {
  const t = net.create(tid);
  const got: WireMessage[] = [];
  t.on('ctl', (m) => got.push(m as unknown as WireMessage));
  t.on('act', (m) => got.push(m as unknown as WireMessage));
  void t.join(ROOM, 'k');
  return { t, got };
}

describe('hello handshake (real ECDSA P-256)', () => {
  it('two browsers verify each other and settle on the lowest seat as sequencer', async () => {
    const net = new LoopbackNetwork({ seed: 1 });
    const [ia, ib] = [await realIdentity('Anna'), await realIdentity('Ben')];
    const start = table([ia.peerId, ib.peerId]);
    const a = engine(net, 'ta', ia, start);
    const b = engine(net, 'tb', ib, start);
    const statuses: string[] = [];
    b.onStatus((s) => statuses.push(s));
    await Promise.all([a.join(), b.join()]);
    await waitFor(() => a.status() === 'connected' && b.status() === 'connected');
    expect(a.peers()).toEqual([expect.objectContaining({ transportId: 'tb', peerId: ib.peerId, nickname: 'Ben', status: 'connected', seat: 's1' })]);
    expect(b.peers()).toEqual([expect.objectContaining({ transportId: 'ta', peerId: ia.peerId, nickname: 'Anna', status: 'connected', seat: 's0' })]);
    expect(a.sequencerId()).toBe(ia.peerId);
    expect(b.sequencerId()).toBe(ia.peerId);
    expect(statuses[0]).toBe('joining');
    expect(statuses).toContain('alone');
    expect(statuses[statuses.length - 1]).toBe('connected');
    // The welcome each side sent carries a signature of the other side's hello nonce.
    const helloFromB = a.messages().find((r) => r.dir === 'in' && r.msg.t === 'hello')!.msg as Extract<WireMessage, { t: 'hello' }>;
    const welcomeToB = a.messages().find((r) => r.dir === 'out' && r.msg.t === 'welcome')!.msg as Extract<WireMessage, { t: 'welcome' }>;
    expect(welcomeToB.peerId).toBe(ia.peerId);
    const { verifySignature } = await import('../../../src/net/identity');
    expect(await verifySignature(ia.pubKey, handshakeText(ROOM, helloFromB.nonce, ia.peerId), welcomeToB.sig)).toBe(true);
    // An action now flows through the sequencer.
    expect(b.propose({ type: 'life', by: 's1', cid: 'b-1', seat: 's1', delta: -2 })).toBe(true);
    await waitFor(() => a.state().seats.s1!.life === 18 && b.confirmedState().seq === 1);
  });

  it('refuses a peer that claims an identity it cannot sign for', async () => {
    const net = new LoopbackNetwork({ seed: 2 });
    const [ia, victim, thief] = [await realIdentity('Anna'), await realIdentity('Ben'), await realIdentity('Mallory')];
    const a = engine(net, 'ta', ia, table([ia.peerId, victim.peerId]));
    const warnings: string[] = [];
    a.onSystem((_l, t) => warnings.push(t));
    await a.join();
    const raw = rawPeer(net, 'tm');
    await waitFor(() => raw.got.some((m) => m.t === 'hello'));
    const theirHello = raw.got.find((m) => m.t === 'hello') as Extract<WireMessage, { t: 'hello' }>;
    // Mallory replays the victim's public key and peer id, but signs with her own key.
    raw.t.send('ctl', { v: 1, t: 'hello', peerId: victim.peerId, pubKey: victim.pubKey, nickname: 'Ben', seat: 's1', role: 'player', lastSeq: 0, nonce: 'n-m' } as Message, 'ta');
    const sig = await thief.sign(handshakeText(ROOM, theirHello.nonce, victim.peerId));
    await sleep(50);
    raw.t.send('ctl', { v: 1, t: 'welcome', peerId: victim.peerId, sig, sequencer: null, seq: 0 } as Message, 'ta');
    await waitFor(() => raw.got.some((m) => m.t === 'bye'));
    expect(raw.got.find((m) => m.t === 'bye')).toMatchObject({ reason: 'badSignature' });
    expect(a.peers()).toEqual([expect.objectContaining({ status: 'handshake', peerId: '' })]);
    expect(a.status()).toBe('alone');
    expect(warnings.some((w) => /signature/.test(w))).toBe(true);
  });

  it('refuses a hello whose peer id is not the hash of its public key', async () => {
    const net = new LoopbackNetwork({ seed: 3 });
    const [ia, other] = [await realIdentity('Anna'), await realIdentity('Ben')];
    const a = engine(net, 'ta', ia, table([ia.peerId]));
    await a.join();
    const raw = rawPeer(net, 'tm');
    await waitFor(() => raw.got.some((m) => m.t === 'hello'));
    raw.t.send('ctl', { v: 1, t: 'hello', peerId: '0123456789abcdef', pubKey: other.pubKey, nickname: 'X', seat: null, role: 'player', lastSeq: 0, nonce: 'n' } as Message, 'ta');
    await waitFor(() => raw.got.some((m) => m.t === 'bye'));
    expect(raw.got.find((m) => m.t === 'bye')).toMatchObject({ reason: 'badSignature' });
    expect(raw.got.some((m) => m.t === 'welcome')).toBe(false);
  });

  it('ignores everything but the handshake from a peer that has not verified', async () => {
    const net = new LoopbackNetwork({ seed: 4 });
    const ia = await realIdentity('Anna');
    const a = engine(net, 'ta', ia, table([ia.peerId]));
    await a.join();
    const raw = rawPeer(net, 'tm');
    await waitFor(() => raw.got.some((m) => m.t === 'hello'));
    const action = { type: 'life', by: 's0', cid: 'x', seat: 's0', delta: -20, seq: 1 };
    raw.t.send('act', { v: 1, t: 'seq', seq: 1, cid: 'x', action } as unknown as Message, 'ta');
    raw.t.send('ctl', { v: 1, t: 'syncRes', snapshot: null, tail: [action] } as unknown as Message, 'ta');
    raw.t.send('act', { v: 1, t: 'propose', cid: 'y', action: { ...action, cid: 'y', seq: undefined } } as unknown as Message, 'ta');
    await sleep(100);
    expect(a.seq()).toBe(0);
    expect(a.state().seats.s0!.life).toBe(20);
  });

  it('answers a peer of another protocol version with a version notice and shows it', async () => {
    const net = new LoopbackNetwork({ seed: 5 });
    const ia = await realIdentity('Anna');
    const a = engine(net, 'ta', ia, table([ia.peerId]));
    const warnings: string[] = [];
    a.onSystem((_l, t) => warnings.push(t));
    await a.join();
    const raw = rawPeer(net, 'tv');
    await waitFor(() => raw.got.some((m) => m.t === 'hello'));
    raw.t.send('ctl', { v: 2, t: 'hello', peerId: 'abc', pubKey: 'k', nickname: 'Future', whatever: true } as unknown as Message, 'ta');
    await waitFor(() => raw.got.some((m) => m.t === 'bye'));
    expect(raw.got.find((m) => m.t === 'bye')).toEqual({ v: 1, t: 'bye', reason: 'version', version: 1 });
    expect(a.status()).toBe('versionMismatch');
    expect(warnings.some((w) => /version 2/.test(w) && /version 1/.test(w))).toBe(true);
  });

  it('shows the notice when a newer peer refuses this one', async () => {
    const net = new LoopbackNetwork({ seed: 6 });
    const ia = await realIdentity('Anna');
    const a = engine(net, 'ta', ia, table([ia.peerId]));
    await a.join();
    const raw = rawPeer(net, 'tv');
    await waitFor(() => raw.got.some((m) => m.t === 'hello'));
    raw.t.send('ctl', { v: 3, t: 'bye', reason: 'version', version: 3 } as unknown as Message, 'ta');
    await waitFor(() => a.status() === 'versionMismatch');
  });

  it('refuses a second page with the same identity', async () => {
    const net = new LoopbackNetwork({ seed: 7 });
    const ia = await realIdentity('Anna');
    const a = engine(net, 'ta', ia, table([ia.peerId]));
    const twin = engine(net, 'ta2', ia, table([ia.peerId]));
    const warnings: string[] = [];
    twin.onSystem((_l, t) => warnings.push(t));
    await Promise.all([a.join(), twin.join()]);
    await waitFor(() => warnings.length > 0);
    expect(warnings[0]).toMatch(/already at the table/);
    expect(twin.peers().every((p) => p.status === 'handshake')).toBe(true);
  });
});
