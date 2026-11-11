/**
 * The stand-in networked session the lobby is built against until M1-P8 (PLAN M1-P5: fake NetSession), over the
 * loopback transport: chairs are taken through shared state (DESIGN "Players, seats and formats", Seats; Identity: the
 * key pair identifies the seat), Ready publishes only the commitment (DESIGN "Multiplayer architecture", Hidden
 * information 1), and the two-seat layout shows the opponent's hand as card backs (PLAN M1-P5). Includes this package's
 * scenario of the shared leak test (CLAUDE.md).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardRef, Format } from '../../../src/core/types';
import { mtg } from '../../../src/games/index';
import { LoopbackNetwork } from '../../../src/net/loopback';
import { placeCards } from '../../../src/scene/layout';
import { FakeCardData } from '../../../src/ui/fakes';
import { createLocalSession, type LocalSession } from '../../../src/ui/lobby/local-session';
import { chairs, firstFreeChair } from '../../../src/ui/lobby/seats';
import { scan } from '../../leak/scan';

const ROOM = { roomId: 'amber-fox-river-42', roomKey: 'AAECAwQFBgcICQoLDA0ODw' };
const PEER = (c: string) => c.repeat(16);
const sessions: LocalSession[] = [];

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const s of sessions.splice(0)) s.leave();
  vi.useRealTimers();
});

async function join(net: LoopbackNetwork, tid: string, peerId: string, nickname: string, seatColour = 0, format: Format = '1v1'): Promise<LocalSession> {
  const p = createLocalSession({ game: mtg, cardData: new FakeCardData(), ...ROOM, transport: net.create(tid), identity: { peerId, nickname, seatColour }, settleMs: 300, format });
  await vi.advanceTimersByTimeAsync(400);
  const s = await p;
  sessions.push(s);
  return s;
}

const deck = (n: number, prefix: string): CardRef[] => Array.from({ length: n }, (_, i) => ({ sid: `${prefix}-sid-${i}` }));

describe('stand-in session: chairs', () => {
  it('the first browser sits in the lowest chair, the second in the next one; both see the same table', async () => {
    const net = new LoopbackNetwork({ delay: { min: 5, max: 20 }, ordered: true });
    const a = await join(net, 'ta', PEER('a'), 'Ann', 2);
    expect(a.seat).toBe('s0');
    const b = await join(net, 'tb', PEER('b'), 'Ben', 2);
    await vi.advanceTimersByTimeAsync(100);
    expect(b.seat).toBe('s1');
    expect(a.getState()).toEqual(b.getState());
    const list = chairs(b.getState(), PEER('b'));
    expect(list.map((c) => [c.seat, c.name, c.mine])).toEqual([
      ['s0', 'Ann', false],
      ['s1', 'Ben', true],
    ]);
    // Ann kept her preferred colour; Ben's preference was taken, so he got the lowest free one.
    expect(list.map((c) => c.colour)).toEqual([2, 0]);
    expect(firstFreeChair(a.getState())).toBeNull();
  });

  it('each side sees the other as a connected peer with its nickname and seat', async () => {
    const net = new LoopbackNetwork();
    const a = await join(net, 'ta', PEER('a'), 'Ann');
    const b = await join(net, 'tb', PEER('b'), 'Ben');
    await vi.advanceTimersByTimeAsync(50);
    expect(a.netStatus()).toMatchObject({ mode: 'net', connection: 'connected', peers: [{ peerId: PEER('b'), nickname: 'Ben', seat: 's1', status: 'connected' }] });
    expect(b.netStatus().peers).toMatchObject([{ peerId: PEER('a'), nickname: 'Ann', seat: 's0', status: 'connected' }]);
  });

  it('alone in the room the table runs on this browser alone', async () => {
    const a = await join(new LoopbackNetwork(), 'ta', PEER('a'), 'Ann');
    expect(a.netStatus().connection).toBe('alone');
    expect(a.seat).toBe('s0');
  });

  it('moving to a free chair frees the old one; a taken chair is refused by the reducer', async () => {
    const net = new LoopbackNetwork();
    const a = await join(net, 'ta', PEER('a'), 'Ann');
    const b = await join(net, 'tb', PEER('b'), 'Ben');
    await vi.advanceTimersByTimeAsync(50);
    b.takeSeat('s0', 3);
    await vi.advanceTimersByTimeAsync(50);
    expect(a.getState().seats.s0?.peer).toBe(PEER('a'));
    expect(b.seat).toBe('s1');
    expect(b.log().some((e) => e.kind === 'system' && /taken|refused/.test(e.text))).toBe(true);
  });

  it('a non-sequencing browser moves between chairs without ever holding two or none', async () => {
    const net = new LoopbackNetwork({ delay: { min: 2, max: 8 }, ordered: true });
    const a = await join(net, 'ta', PEER('a'), 'Ann', 0, 'ffa3');
    const b = await join(net, 'tb', PEER('b'), 'Ben', 1, 'ffa3');
    await vi.advanceTimersByTimeAsync(50);
    expect([a.seat, b.seat]).toEqual(['s0', 's1']);
    const held: string[][] = [];
    a.subscribe((st) => held.push(Object.values(st.seats).filter((x) => x.peer === PEER('b')).map((x) => x.id)));
    b.takeSeat('s2', 1);
    await vi.advanceTimersByTimeAsync(50);
    expect(b.seat).toBe('s2');
    b.takeSeat('s1', 1);
    await vi.advanceTimersByTimeAsync(50);
    expect(b.seat).toBe('s1');
    expect(a.getState().seats.s2?.peer).toBeUndefined();
    expect(held.every((h) => h.length >= 1)).toBe(true);
    expect(held.at(-1)).toEqual(['s1']);
    expect(a.getState()).toEqual(b.getState());
  });

  it('moving chairs while another browser sequences', async () => {
    const net = new LoopbackNetwork({ delay: { min: 2, max: 8 }, ordered: true });
    const a = await join(net, 'ta', PEER('a'), 'Ann');
    a.takeSeat('s1', 0);
    await vi.advanceTimersByTimeAsync(20);
    const b = await join(net, 'tb', PEER('b'), 'Ben');
    await vi.advanceTimersByTimeAsync(50);
    expect([a.seat, b.seat]).toEqual(['s1', 's0']);
    // A third chair does not exist in 1v1; Ben (the proposer, Ann sequences) moves nowhere but re-takes his own.
    b.takeSeat('s0', 6);
    await vi.advanceTimersByTimeAsync(50);
    expect(a.getState().seats.s0).toMatchObject({ peer: PEER('b'), colour: 6 });
    expect(a.getState()).toEqual(b.getState());
  });

  it('a nickname change reaches the other side when the chair is retaken', async () => {
    const net = new LoopbackNetwork();
    const a = await join(net, 'ta', PEER('a'), 'Ann');
    const b = await join(net, 'tb', PEER('b'), 'Ben');
    await vi.advanceTimersByTimeAsync(50);
    b.setNickname('Benedict');
    b.takeSeat('s1', 5);
    await vi.advanceTimersByTimeAsync(50);
    expect(a.getState().seats.s1).toMatchObject({ name: 'Benedict', colour: 5, peer: PEER('b') });
  });

  it('a third browser at a full 1v1 table is refused plainly', async () => {
    const net = new LoopbackNetwork();
    await join(net, 'ta', PEER('a'), 'Ann');
    await join(net, 'tb', PEER('b'), 'Ben');
    const p = createLocalSession({ game: mtg, cardData: new FakeCardData(), ...ROOM, transport: net.create('tc'), identity: { peerId: PEER('c'), nickname: 'Cat', seatColour: 0 }, settleMs: 300 });
    const result = p.then(
      () => 'joined',
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(400);
    expect(await result).toBe('This table is full.');
  });

  it('a browser that comes back with the same key pair finds its chair', async () => {
    const net = new LoopbackNetwork();
    const a = await join(net, 'ta', PEER('a'), 'Ann');
    const b = await join(net, 'tb', PEER('b'), 'Ben');
    await vi.advanceTimersByTimeAsync(50);
    b.leave();
    await vi.advanceTimersByTimeAsync(50);
    const again = await join(net, 'tb2', PEER('b'), 'Ben');
    expect(again.seat).toBe('s1');
    expect(a.getState().seats.s1?.peer).toBe(PEER('b'));
  });
});

describe('stand-in session: Ready, the two-seat layout and secrecy', () => {
  async function readyGame() {
    const net = new LoopbackNetwork({ delay: { min: 1, max: 10 }, ordered: true });
    const a = await join(net, 'ta', PEER('a'), 'Ann');
    const b = await join(net, 'tb', PEER('b'), 'Ben');
    await vi.advanceTimersByTimeAsync(50);
    const deckA = deck(60, 'ann');
    const ra = a.importDeck({ main: deckA, side: deck(2, 'annside') });
    const rb = b.importDeck({ main: deck(40, 'ben'), side: [] });
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([ra, rb]);
    return { net, a, b, deckA };
  }

  it('Ready publishes one commitment per card and opaque ids; the identities stay in the owner\'s secret store', async () => {
    const { a, b, deckA } = await readyGame();
    const st = b.getState();
    expect(st.seats.s0?.ready).toBe(true);
    expect(st.seats.s1?.ready).toBe(true);
    expect(st.commitments.s0?.commits).toHaveLength(60);
    expect(st.zones['library:s0']).toMatchObject({ count: 60 });
    expect(st.zones['library:s1']).toMatchObject({ count: 40 });
    expect(Object.keys(a.secrets().identities)).toHaveLength(60);
    expect(a.secrets().libraryOrder).toHaveLength(60);
    expect(Object.keys(b.secrets().identities)).toHaveLength(40);
    // Ids carry nothing about the card.
    for (const id of st.commitments.s0!.instanceIds) for (const ref of deckA) expect(id).not.toContain(ref.sid);
  });

  it('the opponent\'s hand is a row of card backs at their hand row; the own hand is not drawn on the table', async () => {
    const { a, b } = await readyGame();
    a.dispatch({ type: 'stageSet', stage: 'match' });
    await vi.advanceTimersByTimeAsync(20);
    const da = a.draw(7);
    const db = b.draw(7);
    await vi.advanceTimersByTimeAsync(200);
    await Promise.all([da, db]);
    const st = b.getState();
    expect(st.zones['hand:s0']).toMatchObject({ count: 7 });
    const layout = mtg.layout('1v1');
    const view = { selection: [], hovered: null, privateFaces: Object.fromEntries(b.secrets().hand.map((id) => [id, b.secrets().identities[id]!.card])), reducedMotion: true, pings: [], openPile: null };
    const placed = placeCards(st, view, { game: mtg, layout, viewerSeat: 's1' });
    const annHand = st.zones['hand:s0']!.ids;
    const row = layout.seats[0]!.zones.handRow;
    for (const id of annHand) {
      const p = placed.get(id)!;
      expect(p.kind).toBe('hand');
      expect(p.ref).toBeNull();
      expect(Math.abs(p.rest.x - row.x)).toBeLessThanOrEqual(row.w / 2);
      expect(p.rest.y).toBeCloseTo(row.y);
    }
    for (const id of b.secrets().hand) expect(placed.has(id)).toBe(false);
  });

  it('leak scan: nothing Ben\'s browser received or holds names a card that stayed in Ann\'s hand or library', async () => {
    const { net, a, b } = await readyGame();
    a.dispatch({ type: 'stageSet', stage: 'match' });
    await vi.advanceTimersByTimeAsync(20);
    const d = a.draw(7);
    await vi.advanceTimersByTimeAsync(200);
    await d;
    // Presence on top: Ann moves her pointer over the table.
    a.presence.cursor({ x: 10, y: -200 }, null);
    await vi.advanceTimersByTimeAsync(100);
    expect(b.presence.peers()[0]?.cursor).toEqual({ x: 10, y: -200 });
    const secrets = a.secrets();
    const forbidden = Object.values(secrets.identities).flatMap((i) => [i.card.sid, i.salt]);
    expect(forbidden.length).toBe(120);
    const received = net.delivered.filter((d) => d.to === 'tb').map((d) => d.msg);
    expect(received.length).toBeGreaterThan(0);
    expect(scan([...received, b.getState(), b.secrets(), b.log()], forbidden)).toEqual([]);
  });
});

describe('stand-in session: presence', () => {
  it('cursor and drag reach the other side in table millimetres, newest wins, drags end with an empty list', async () => {
    const net = new LoopbackNetwork();
    const a = await join(net, 'ta', PEER('a'), 'Ann');
    const b = await join(net, 'tb', PEER('b'), 'Ben');
    await vi.advanceTimersByTimeAsync(50);
    const seen: number[] = [];
    b.presence.subscribe((p) => seen.push(p.length));
    a.presence.cursor({ x: 1, y: 2 }, null);
    a.presence.cursor({ x: 3, y: 4 }, 'c1');
    a.presence.drag([{ id: 'c1', pose: { x: 3, y: 4, rot: 0 } }]);
    await vi.advanceTimersByTimeAsync(100);
    expect(b.presence.peers()).toMatchObject([{ peerId: PEER('a'), seat: 's0', cursor: { x: 3, y: 4 }, over: 'c1', drag: [{ id: 'c1', pose: { x: 3, y: 4, rot: 0 } }] }]);
    a.presence.drag([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(b.presence.peers()[0]?.drag).toEqual([]);
    expect(seen.length).toBeGreaterThan(0);
  });

  it('throttles to one burst per 50 ms and always sends the last value', async () => {
    const net = new LoopbackNetwork();
    const a = await join(net, 'ta', PEER('a'), 'Ann');
    await join(net, 'tb', PEER('b'), 'Ben');
    await vi.advanceTimersByTimeAsync(50);
    const before = net.delivered.filter((d) => d.channel === 'pres').length;
    for (let i = 0; i < 20; i++) a.presence.cursor({ x: i, y: 0 }, null);
    await vi.advanceTimersByTimeAsync(60);
    const pres = net.delivered.filter((d) => d.channel === 'pres').slice(before);
    expect(pres.length).toBeLessThanOrEqual(2);
    expect(pres.at(-1)?.msg).toMatchObject({ t: 'cursor', at: { x: 19, y: 0 } });
  });

  it('a peer who leaves disappears from presence', async () => {
    const net = new LoopbackNetwork();
    const a = await join(net, 'ta', PEER('a'), 'Ann');
    const b = await join(net, 'tb', PEER('b'), 'Ben');
    await vi.advanceTimersByTimeAsync(50);
    a.presence.cursor({ x: 1, y: 1 });
    await vi.advanceTimersByTimeAsync(100);
    expect(b.presence.peers()).toHaveLength(1);
    a.leave();
    await vi.advanceTimersByTimeAsync(50);
    expect(b.presence.peers()).toHaveLength(0);
  });
});
