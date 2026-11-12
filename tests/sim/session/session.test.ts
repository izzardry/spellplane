/**
 * The networked session's behaviour around the engine (PLAN M1-P8; DESIGN "Players, seats and formats", Seats;
 * "Multiplayer architecture", Resume; "Specification: network protocol and secrecy": Sequencing 3-4, Timers, Public
 * randomness, Secret shuffle). Real sessions on a LoopbackNetwork under fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../../../src/core/actions';
import type { Channel, Message, MessageHandler, PeerHandler, PeerId, Transport } from '../../../src/net/transport';
import { browser, closeAll, FAKE_TIMERS, fixtureDeck, hashOf, net, open, settle, until, waitConverged, type Browser, KEY, ROOM } from './harness';
import { isLand, playScript } from './script';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

let browsers: Browser[] = [];
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
});
afterEach(() => {
  closeAll(browsers);
  browsers = [];
  vi.useRealTimers();
});

async function two(seed = 1): Promise<{ network: ReturnType<typeof net>; A: Browser; B: Browser }> {
  const network = net({ seed });
  const A = await browser('anna', 'peer-a', 'Anna', 1);
  const B = await browser('ben', 'peer-b', 'Ben', 3);
  browsers.push(A, B);
  await open(network, A);
  await open(network, B);
  await waitConverged([A.session!, B.session!]);
  return { network, A, B };
}

const actions = (b: Browser): Action[] => b.session!.log().flatMap((e) => (e.kind === 'action' ? [e.action] : []));
const warnings = (b: Browser): string[] => b.session!.log().flatMap((e) => (e.kind === 'system' ? [e.text] : []));

describe('chairs', () => {
  it('two browsers that open the link at the same moment end up in different chairs and agree on one table', async () => {
    const network = net({ seed: 12, delay: { min: 5, max: 50 } });
    const A = await browser('anna', 'peer-a', 'Anna', 0);
    const B = await browser('ben', 'peer-b', 'Ben', 0);
    browsers.push(A, B);
    const [a, b] = await Promise.all([open(network, A), open(network, B)]);
    await waitConverged([a, b]);
    expect(new Set([a.seat, b.seat])).toEqual(new Set(['s0', 's1']));
    const seats = a.getState().seats;
    expect(seats[a.seat]).toMatchObject({ peer: 'peer-a', name: 'Anna' });
    expect(seats[b.seat]).toMatchObject({ peer: 'peer-b', name: 'Ben' });
    // Both preferred colour 0: the second chair takes another one.
    expect(seats.s0!.colour).not.toBe(seats.s1!.colour);
  });

  it('a browser that joins later waits for the table and takes the free chair, never the creator’s', async () => {
    const network = net({ seed: 13 });
    const A = await browser('anna', 'peer-z', 'Anna'); // a peer id that sorts after B's
    browsers.push(A);
    const a = await open(network, A);
    expect(a.seat).toBe('s0');
    const B = await browser('ben', 'peer-a', 'Ben');
    browsers.push(B);
    const b = await open(network, B);
    expect(b.seat).toBe('s1');
    await waitConverged([a, b]);
    expect(a.getState().seats.s0!.peer).toBe('peer-z');
    // B never proposed a chair someone held.
    expect(warnings(B).filter((w) => /seatTake/.test(w))).toEqual([]);
  });

  it('a third browser at a full 1v1 table is told so plainly', async () => {
    const { network } = await two(14);
    const C = await browser('cleo', 'peer-c', 'Cleo');
    browsers.push(C);
    await expect(open(network, C)).rejects.toThrow('This table is full.');
  });

  it('moving chairs: the new chair is taken before the old one is left, stamped as the lobby does, and nothing is refused', async () => {
    const network = net({ seed: 15 });
    const A = await browser('anna', 'peer-a', 'Anna', 1);
    const B = await browser('ben', 'peer-b', 'Ben', 3);
    const C = await browser('cleo', 'peer-c', 'Cleo', 5);
    browsers.push(A, B, C);
    const opts = { format: 'ffa4' as const };
    const a = await open(network, A, {}, opts);
    const b = await open(network, B, {}, opts);
    const c = await open(network, C, {}, opts);
    await waitConverged([a, b, c]);
    expect([a.seat, b.seat, c.seat]).toEqual(['s0', 's1', 's2']);
    // A follower moves up (s1 -> s3).
    const up = b.takeSeat('s3', 3);
    expect(up).toMatchObject({ type: 'seatTake', seat: 's3', by: 's3', peer: 'peer-b', name: 'Ben' });
    await waitConverged([a, b, c]);
    expect(b.seat).toBe('s3');
    const moves = actions(B).slice(-2);
    expect(moves.map((x) => [x.type, x.by])).toEqual([
      ['seatTake', 's3'],
      ['seatLeave', 's1'],
    ]);
    expect(moves[0]!.group).toBeDefined();
    expect(moves[1]!.group).toBe(moves[0]!.group);
    // The sequencer itself moves to the chair B left; s0 is free now, and A still holds the lowest taken chair.
    a.takeSeat('s1', 1);
    await waitConverged([a, b, c]);
    expect(a.seat).toBe('s1');
    expect(a.getState().seats.s0!.peer).toBeUndefined();
    // C moves into the lowest chair and so becomes the sequencer.
    c.takeSeat('s0', 5);
    await waitConverged([a, b, c]);
    await until(() => [a, b, c].every((s) => s.engine.sequencerId() === 'peer-c'), 20_000, 'C to sequence');
    for (const x of [A, B, C]) expect(warnings(x).filter((w) => /refused/.test(w)), x.name).toEqual([]);
    expect([a.seat, b.seat, c.seat]).toEqual(['s1', 's3', 's0']);
  });

  it('takeSeat uses the identity’s current nickname, and “Player” while it has none', async () => {
    const network = net({ seed: 16 });
    const A = await browser('anna', 'peer-a', '');
    browsers.push(A);
    const a = await open(network, A);
    expect(a.getState().seats.s0!.name).toBe('Player');
    // The lobby renames through the IdentityStore; main.ts's live identity follows it (session/live-identity.ts).
    (A.identity as { nickname: string }).nickname = 'Ann Lee';
    a.takeSeat('s0', 4);
    await until(() => a.engine.pending().length === 0);
    expect(a.getState().seats.s0).toMatchObject({ name: 'Ann Lee', colour: 4 });
  });
});

describe('sequencing', () => {
  it('a proposal the sequencer refuses is rolled back and logged with its reason', async () => {
    const { A, B } = await two(21);
    const a = A.session!;
    const b = B.session!;
    a.dispatch({ type: 'createToken', card: 'tok-1', zone: 'battlefield:s0', pose: { x: 0, y: -250, rot: 0 }, label: 'Soldier' });
    await waitConverged([a, b]);
    // A (the sequencer) removes the token while B's tap of it is on the way.
    a.dispatch({ type: 'remove', card: 'tok-1' });
    b.dispatch({ type: 'tap', card: 'tok-1', tapped: true });
    expect(b.getState().cards['tok-1']?.tapped).toBe(true);
    await waitConverged([a, b]);
    expect(b.getState().cards['tok-1']).toBeUndefined();
    expect(warnings(B).some((w) => /^tap refused: /.test(w))).toBe(true);
  });

  it('own chat lines come back sequenced with their cid in both logs', async () => {
    const { A, B } = await two(22);
    const line = A.session!.chat('good luck');
    expect(line.cid).toBeTruthy();
    await waitConverged([A.session!, B.session!]);
    for (const x of [A, B]) expect(actions(x).find((e) => e.type === 'chat')).toMatchObject({ cid: line.cid, text: 'good luck', by: 's0' });
  });

  it('a confirmation round times out on the sequencer’s clock for a seat that stays silent', async () => {
    const { A, B } = await two(23);
    const a = A.session!;
    a.dispatch({ type: 'ask', round: 'r-1', label: 'attacks?' });
    await waitConverged([a, B.session!]);
    expect(a.getState().confirm?.responses.s1).toBeUndefined();
    await until(() => a.engine.confirmedState().confirm?.responses.s1 === 'timeout', 15_000, 'the timeout');
    await waitConverged([a, B.session!]);
    const t = actions(B).find((x) => x.type === 'respond');
    expect(t).toMatchObject({ type: 'respond', seat: 's1', response: 'timeout', by: 's0' });
  });
});

describe('undo', () => {
  it('after a public card returns to the hand and the hand gets fresh ids, undo skips the steps naming the old ids', async () => {
    const network = net({ seed: 24 });
    const p = await playScript(network, browsers);
    const a = p.a;
    const sidOf = (id: string): string => a.secrets().identities[id]!.card.sid;
    for (let i = 0; i < 20 && !a.secrets().hand.some((id) => isLand(sidOf(id))); i++) await settle(a.draw(1));
    const land = a.secrets().hand.find((id) => isLand(sidOf(id)))!;
    a.dispatch({ type: 'move', card: land, to: 'battlefield:s0', pose: { x: 200, y: -200, rot: 0 } });
    a.dispatch({ type: 'createToken', card: 'tok-u', zone: 'battlefield:s0', pose: { x: 260, y: -200, rot: 0 }, label: 'Soldier' });
    a.dispatch({ type: 'tap', card: 'tok-u', tapped: true });
    a.dispatch({ type: 'toZone', card: land, to: 'hand:s0', position: 'any' });
    await until(() => a.engine.confirmedState().cards[land] === undefined && a.engine.pending().length === 0, 20_000, 'the re-issue');
    // The return and the play name the land's retired id: gone from the stack. The tap is undone next.
    expect(a.undo()).toBe(true);
    await waitConverged([a, p.b]);
    expect(p.b.getState().cards['tok-u']!.tapped).toBe(false);
    expect(warnings(p.A).filter((w) => /Cannot undo/.test(w))).toEqual([]);
  });
});

describe('joint randomness', () => {
  it('the HUD’s back-to-back rngCommit and rngReveal: the reveal waits until the other seat committed', async () => {
    const { A, B } = await two(31);
    const a = A.session!;
    const { nonceHash } = await import('../../../src/core/commit');
    const nonce = 'hud-nonce-0123456789';
    a.dispatch({ type: 'rngCommit', rid: 'rng-hud', purpose: 'die', n: 6, h: nonceHash(nonce) });
    a.dispatch({ type: 'rngReveal', rid: 'rng-hud', nonce });
    await until(() => a.engine.confirmedState().rng['rng-hud']?.result != null, 15_000, 'the result');
    await waitConverged([a, B.session!]);
    const r = B.session!.getState().rng['rng-hud']!;
    expect(Object.keys(r.commits).sort()).toEqual(['s0', 's1']);
    expect(r.reveals.s0).toBe(nonce);
    expect(warnings(A).filter((w) => /refused/.test(w))).toEqual([]);
  });

  it('a roll survives the roller’s reload: the committed nonce is revealed from local storage once the other seat commits', async () => {
    const { network, A, B } = await two(32);
    // B's connection drops: it is still waited for (an away seat counts, decision M1-P2).
    network.kill('peer-b');
    let rolled: number | null = null;
    void A.session!.roll('die', 20).then(
      (r) => (rolled = r),
      () => undefined,
    );
    await until(() => Object.keys(A.session!.engine.confirmedState().rng).length === 1, 10_000, 'the commit');
    const rid = Object.keys(A.session!.engine.confirmedState().rng)[0]!;
    expect(A.nonces.get('rng', rid)).not.toBeNull();
    await settle(A.session!.whenSaved());
    // A reloads while the round waits.
    A.session!.leave();
    expect(rolled).toBeNull();
    const a = await open(network, A, { settleMs: 200 });
    network.revive('peer-b');
    await until(() => a.engine.confirmedState().rng[rid]?.result != null, 30_000, 'the result after the reload');
    await waitConverged([a, B.session!]);
    expect(Object.keys(a.engine.confirmedState().rng[rid]!.reveals).sort()).toEqual(['s0', 's1']);
    // The nonce of a decided round is forgotten.
    await until(() => A.nonces.get('rng', rid) === null, 5_000, 'the nonce to be dropped');
  });

  it('an own nonce that comes back from the sequencer changed is logged as an integrity warning', async () => {
    const network = net({ seed: 33 });
    const A = await browser('anna', 'peer-a', 'Anna');
    const B = await browser('ben', 'peer-b', 'Ben');
    browsers.push(A, B);
    const a = await open(network, A);
    // B's shuffle nonces are rewritten on the way to the sequencer (a sequencer could do that: actions are unsigned).
    const b = await open(network, B, {}, { transport: () => new Tamper(network.create('peer-b')) });
    await settle(a.importDeck(await fixtureDeck('gw-m19-60.txt')));
    await settle(b.importDeck(await fixtureDeck('ur-m19-60.mtga.txt')));
    await settle(a.shuffle(), 30_000, 'A’s shuffle');
    await waitConverged([a, b]);
    expect(warnings(B).some((w) => /^Integrity warning: your shuffleNonce came back from the sequencer changed/.test(w))).toBe(true);
    expect(warnings(A).filter((w) => /Integrity/.test(w))).toEqual([]);
  });
});

describe('resume', () => {
  it('a reload rejoins the same chair with the same hand and library order, the log, and one state hash', async () => {
    const network = net({ seed: 41 });
    const p = await playScript(network, browsers);
    const before = { seat: p.a.seat, hand: [...p.a.secrets().hand], library: [...p.a.secrets().libraryOrder], log: p.a.log().filter((e) => e.kind === 'action').length };
    p.a.leave();
    const a = await open(network, p.A, { settleMs: 200 });
    await waitConverged([a, p.b]);
    expect(a.seat).toBe(before.seat);
    expect(a.secrets().hand).toEqual(before.hand);
    expect(a.secrets().libraryOrder).toEqual(before.library);
    expect(a.log().filter((e) => e.kind === 'action').length).toBeGreaterThanOrEqual(before.log);
    expect(hashOf(a.getState())).toBe(hashOf(p.b.getState()));
    // And A plays on from its restored secrets: a draw takes the top card it remembered.
    const top = before.library[0]!;
    await settle(a.draw(1));
    await waitConverged([a, p.b]);
    expect(a.secrets().hand).toContain(top);
  });

  it('the cards another seat saw are rebuilt from the log after a reload, so the next shuffle still re-issues their ids', async () => {
    const network = net({ seed: 42 });
    const p = await playScript(network, browsers);
    const sidOf = (id: string): string => p.a.secrets().identities[id]!.card.sid;
    for (let i = 0; i < 20 && !p.a.secrets().hand.some((id) => isLand(sidOf(id))); i++) await settle(p.a.draw(1));
    const land = p.a.secrets().hand.find((id) => isLand(sidOf(id)))!;
    // A plays a land and puts it back on top of its library: B saw it, and knows where it is.
    p.a.dispatch({ type: 'move', card: land, to: 'battlefield:s0', pose: { x: 200, y: -200, rot: 0 } });
    p.a.dispatch({ type: 'toZone', card: land, to: 'library:s0', position: 'top' });
    await waitConverged([p.a, p.b]);
    await settle(p.a.whenSaved());
    p.a.leave();
    const a = await open(network, p.A, { settleMs: 200 });
    await settle(a.shuffle(), 30_000, 'the shuffle after the reload');
    await waitConverged([a, p.b]);
    const done = actions(p.B).filter((x) => x.type === 'shuffleDone').at(-1)!;
    expect(done.type === 'shuffleDone' && done.reissue !== undefined).toBe(true);
    expect(a.getState().cards[land]).toBeUndefined();
  });

  it('every sequenced action is saved with the table record, and the save restores the same state hash', async () => {
    const network = net({ seed: 43 });
    const p = await playScript(network, browsers);
    const loaded = (await settle(p.A.stores.tables.loadTable(ROOM)))!;
    expect(loaded.table).toMatchObject({ roomId: ROOM, roomKey: KEY, seat: 's0', lastSeq: p.a.engine.seq(), stage: p.a.getState().stage });
    expect(loaded.secrets).toEqual(p.a.secrets());
    const log = await settle(p.A.stores.tables.loadLog(ROOM));
    expect(log.map((r) => r.seq)).toEqual(Array.from({ length: p.a.engine.seq() }, (_, i) => i + 1));
  });
});

/** A transport that rewrites this peer's `shuffleNonce` proposals in transit (as a dishonest sequencer could). */
class Tamper implements Transport {
  constructor(private readonly inner: Transport) {}
  get selfId(): PeerId {
    return this.inner.selfId;
  }
  join(roomId: string, roomKey: string): Promise<void> {
    return this.inner.join(roomId, roomKey);
  }
  leave(): void {
    this.inner.leave();
  }
  peers(): PeerId[] {
    return this.inner.peers();
  }
  send(channel: Channel, msg: Message, to?: PeerId): void {
    if (channel === 'act' && msg.t === 'propose') {
      const action = (msg as unknown as { action: Action }).action;
      if (action.type === 'shuffleNonce') {
        this.inner.send(channel, { ...msg, action: { ...action, nonce: 'chosen-by-the-sequencer' } } as Message, to);
        return;
      }
    }
    this.inner.send(channel, msg, to);
  }
  on(channel: Channel, handler: MessageHandler): void {
    this.inner.on(channel, handler);
  }
  onPeer(handler: PeerHandler): void {
    this.inner.onPeer(handler);
  }
}
