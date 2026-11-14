/**
 * The hello handshake with real ECDSA keys (DESIGN "Specification: network protocol and secrecy", Handshake: each
 * side sends `hello {peerId, pubKey, ...}`; `sig` signs the other side's connection nonce; peers with a different
 * `v` are refused with a visible version-mismatch notice). Real timers: Web Crypto settles outside the fake clock.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createTable } from '../../../src/core/reducer';
import type { TableState } from '../../../src/core/types';
import { createNetEngine } from '../../../src/net/engine';
import { boundNonce } from '../../../src/net/hello';
import { createNetIdentity } from '../../../src/net/identity';
import { LoopbackNetwork, type LoopbackTransport } from '../../../src/net/loopback';
import { scan } from '../../leak/scan';
import { handshakeText, type WireMessage } from '../../../src/net/messages';
import type { Message } from '../../../src/net/transport';
import type { NetEngine, NetIdentity } from '../../../src/net/types';
import { generateIdentity, toIdentityRecord } from '../../../src/store/identity';
import { TEST_GAME } from '../core/helpers';
import { PROTOCOL_VERSION } from '../../../src/net/messages';

const ROOM = 'amber-fox-93';
const engines: NetEngine[] = [];

afterEach(() => {
  for (const e of engines.splice(0)) e.leave();
});

async function realIdentity(nickname: string): Promise<NetIdentity> {
  const rec = await toIdentityRecord(await generateIdentity());
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
function rawPeer(net: LoopbackNetwork, tid: string): { t: LoopbackTransport; got: WireMessage[]; from: { m: WireMessage; from: string }[] } {
  const t = net.create(tid);
  const got: WireMessage[] = [];
  const from: { m: WireMessage; from: string }[] = [];
  for (const ch of ['ctl', 'act', 'prv'] as const) {
    t.on(ch, (m, f) => {
      got.push(m as unknown as WireMessage);
      from.push({ m: m as unknown as WireMessage, from: f });
    });
  }
  void t.join(ROOM, 'k');
  return { t, got, from };
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
    // The welcome each side sent carries a signature of the other side's hello nonce, bound to this connection
    // (signer's transport id, then the recipient's).
    const helloFromB = a.messages().find((r) => r.dir === 'in' && r.msg.t === 'hello')!.msg as Extract<WireMessage, { t: 'hello' }>;
    const welcomeToB = a.messages().find((r) => r.dir === 'out' && r.msg.t === 'welcome')!.msg as Extract<WireMessage, { t: 'welcome' }>;
    expect(welcomeToB.peerId).toBe(ia.peerId);
    const { verifySignature } = await import('../../../src/net/identity');
    expect(await verifySignature(ia.pubKey, handshakeText(ROOM, boundNonce(helloFromB.nonce, 'ta', 'tb'), ia.peerId), welcomeToB.sig)).toBe(true);
    expect(await verifySignature(ia.pubKey, handshakeText(ROOM, helloFromB.nonce, ia.peerId), welcomeToB.sig)).toBe(false);
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
    raw.t.send('ctl', { v: PROTOCOL_VERSION, t: 'hello', peerId: victim.peerId, pubKey: victim.pubKey, nickname: 'Ben', seat: 's1', role: 'player', lastSeq: 0, nonce: 'n-m' } as Message, 'ta');
    const sig = await thief.sign(handshakeText(ROOM, theirHello.nonce, victim.peerId));
    await sleep(50);
    raw.t.send('ctl', { v: PROTOCOL_VERSION, t: 'welcome', peerId: victim.peerId, sig, sequencer: null, seq: 0 } as Message, 'ta');
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
    raw.t.send('ctl', { v: PROTOCOL_VERSION, t: 'hello', peerId: '0123456789abcdef', pubKey: other.pubKey, nickname: 'X', seat: null, role: 'player', lastSeq: 0, nonce: 'n' } as Message, 'ta');
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
    raw.t.send('act', { v: PROTOCOL_VERSION, t: 'seq', seq: 1, cid: 'x', action } as unknown as Message, 'ta');
    raw.t.send('ctl', { v: PROTOCOL_VERSION, t: 'syncRes', snapshot: null, tail: [action] } as unknown as Message, 'ta');
    raw.t.send('act', { v: PROTOCOL_VERSION, t: 'propose', cid: 'y', action: { ...action, cid: 'y', seq: undefined } } as unknown as Message, 'ta');
    await sleep(100);
    expect(a.seq()).toBe(0);
    expect(a.state().seats.s0!.life).toBe(20);
  });

  it.each([
    { theirs: PROTOCOL_VERSION - 1, what: 'an older' },
    { theirs: PROTOCOL_VERSION + 1, what: 'a newer' },
  ])('answers $what peer (protocol $theirs) with a version notice and shows both versions', async ({ theirs }) => {
    const net = new LoopbackNetwork({ seed: 5 });
    const ia = await realIdentity('Anna');
    const a = engine(net, 'ta', ia, table([ia.peerId]));
    const warnings: string[] = [];
    a.onSystem((_l, t) => warnings.push(t));
    await a.join();
    const raw = rawPeer(net, 'tv');
    await waitFor(() => raw.got.some((m) => m.t === 'hello'));
    raw.t.send('ctl', { v: theirs, t: 'hello', peerId: 'abc', pubKey: 'k', nickname: 'Ben', whatever: true } as unknown as Message, 'ta');
    await waitFor(() => raw.got.some((m) => m.t === 'bye'));
    expect(raw.got.find((m) => m.t === 'bye')).toEqual({ v: PROTOCOL_VERSION, t: 'bye', reason: 'version', version: PROTOCOL_VERSION });
    expect(a.status()).toBe('versionMismatch');
    expect(a.versionMismatch?.()).toEqual({ mine: PROTOCOL_VERSION, theirs, peerId: 'abc', nickname: 'Ben' });
    expect(warnings.some((w) => w.includes(`version ${theirs}`) && w.includes(`version ${PROTOCOL_VERSION}`) && w.includes('Ben'))).toBe(true);
  });

  it('shows the notice when a newer peer refuses this one', async () => {
    const net = new LoopbackNetwork({ seed: 6 });
    const ia = await realIdentity('Anna');
    const a = engine(net, 'ta', ia, table([ia.peerId]));
    await a.join();
    const raw = rawPeer(net, 'tv');
    await waitFor(() => raw.got.some((m) => m.t === 'hello'));
    raw.t.send('ctl', { v: PROTOCOL_VERSION + 1, t: 'bye', reason: 'version', version: PROTOCOL_VERSION + 1 } as unknown as Message, 'ta');
    await waitFor(() => a.status() === 'versionMismatch');
    expect(a.versionMismatch?.()).toEqual({ mine: PROTOCOL_VERSION, theirs: PROTOCOL_VERSION + 1, peerId: '', nickname: '' });
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

  it('leak scenario: a relaying peer cannot take another player’s identity on its own connection (channel binding)', async () => {
    // DESIGN "Multiplayer architecture", Hidden information 5 (a targeted reveal travels on that pair's channel only);
    // "Specification: network protocol and secrecy", Handshake. Mallory has her own valid key and is in the room.
    const net = new LoopbackNetwork({ seed: 8 });
    const [ia, ib, im] = [await realIdentity('Anna'), await realIdentity('Ben'), await realIdentity('Mallory')];
    const start = table([ia.peerId, ib.peerId]);
    const a = engine(net, 'ta', ia, start);
    const b = engine(net, 'tb', ib, start);
    await Promise.all([a.join(), b.join()]);
    await waitFor(() => a.status() === 'connected' && b.status() === 'connected');
    const warnings: string[] = [];
    a.onSystem((_l, t) => warnings.push(t));
    const m = rawPeer(net, 'tm');
    await waitFor(() => m.from.some((g) => g.from === 'ta' && g.m.t === 'hello') && m.from.some((g) => g.from === 'tb' && g.m.t === 'hello'));
    const annaHello = m.from.find((g) => g.from === 'ta' && g.m.t === 'hello')!.m as Extract<WireMessage, { t: 'hello' }>;
    const benHello = m.from.find((g) => g.from === 'tb' && g.m.t === 'hello')!.m as Extract<WireMessage, { t: 'hello' }>;
    // Mallory says hello to Ben with her own key but the nonce Anna sent her, so Ben signs Anna's challenge ...
    m.t.send('ctl', { v: PROTOCOL_VERSION, t: 'hello', peerId: im.peerId, pubKey: im.pubKey, nickname: 'M', seat: null, role: 'player', lastSeq: 0, nonce: annaHello.nonce } as Message, 'tb');
    await waitFor(() => m.from.some((g) => g.from === 'tb' && g.m.t === 'welcome'));
    const benWelcome = m.from.find((g) => g.from === 'tb' && g.m.t === 'welcome')!.m;
    // ... and replays Ben's hello and that welcome to Anna.
    m.t.send('ctl', benHello as unknown as Message, 'ta');
    await sleep(50);
    m.t.send('ctl', benWelcome as unknown as Message, 'ta');
    await waitFor(() => m.got.some((x) => x.t === 'bye'));
    expect(m.got.find((x) => x.t === 'bye')).toMatchObject({ reason: 'badSignature' });
    expect(warnings.some((w) => /signature/.test(w))).toBe(true);
    // Anna still knows Ben on his own connection only; Mallory's connection never verified.
    expect(a.peers().filter((p) => p.peerId === ib.peerId)).toEqual([expect.objectContaining({ transportId: 'tb', status: 'connected' })]);
    expect(a.peers().find((p) => p.transportId === 'tm')).toMatchObject({ status: 'handshake', peerId: '' });
    // A targeted reveal to Ben's seat reaches Ben and nothing of it reaches Mallory.
    const got: string[] = [];
    b.onPrivate((msg) => got.push(msg.t));
    expect(a.sendPrivate('s1', { v: PROTOCOL_VERSION, t: 'reveal', instanceId: 'x1', ref: { sid: 'secret-sid-relay' }, salt: 'secret-salt-relay', purpose: 'revealTo', about: 'c1' })).toBe(true);
    await waitFor(() => got.length > 0);
    await sleep(50);
    expect(scan([m.got], ['secret-sid-relay', 'secret-salt-relay'])).toEqual([]);
    // Mallory's proposals are not sequenced as Ben's seat.
    m.t.send('act', { v: PROTOCOL_VERSION, t: 'propose', cid: 'm-1', action: { type: 'life', by: 's1', cid: 'm-1', seat: 's1', delta: -10 } } as unknown as Message, 'ta');
    await sleep(100);
    expect(a.state().seats.s1!.life).toBe(20);
  });

  it('a second live connection with the same identity does not replace the first', async () => {
    const net = new LoopbackNetwork({ seed: 9 });
    const [ia, ib] = [await realIdentity('Anna'), await realIdentity('Ben')];
    const start = table([ia.peerId, ib.peerId]);
    const a = engine(net, 'ta', ia, start);
    const b = engine(net, 'tb', ib, start);
    await Promise.all([a.join(), b.join()]);
    await waitFor(() => a.status() === 'connected' && b.status() === 'connected');
    // Ben's identity opens a second page while the first is still connected and heard.
    const twin = engine(net, 'tb2', ib, start);
    await twin.join();
    await sleep(1500);
    expect(a.peers().filter((p) => p.peerId === ib.peerId && p.status === 'connected').map((p) => p.transportId)).toEqual(['tb']);
    expect(a.peers().find((p) => p.transportId === 'tb2')).toMatchObject({ status: 'handshake' });
  });
});
