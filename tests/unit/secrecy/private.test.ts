/**
 * The pair channel (PLAN M1-P2; DESIGN "Multiplayer architecture", Hidden information 4-5: private looks and targeted
 * reveal; "Specification: network protocol and secrecy", prv): identities go to the named seats only, are verified
 * against the owner's commitment on arrival, and a look at another seat's hidden cards goes through its owner.
 */
import { describe, expect, it } from 'vitest';
import type { RevealedCard } from '../../../src/core/commit';
import { commitDeck, emptySecretStore, lookAnswer, revealedCard } from '../../../src/core/secrets';
import type { SeatId, TableState } from '../../../src/core/types';
import type { PrivateMessage, SequencedAction } from '../../../src/net/messages';
import { privateChannelOver, type PrivateChannelHost } from '../../../src/net/private';
import type { PeerInfo, PrivateChannel } from '../../../src/net/types';
import { deckRefs, readySecretTable, seededEntropy, type SecretTable } from './helpers';

type Listener = (msg: PrivateMessage, from: { seat: SeatId | null; peerId: string }) => void;

/** In-memory pair channels between seats: synchronous, addressed, with a per-seat inbox for assertions. */
class Bus {
  readonly inbox: Record<SeatId, { msg: PrivateMessage; from: SeatId | null }[]> = {};
  private readonly listeners: Record<SeatId, Listener[]> = {};
  private readonly peerListeners: Record<SeatId, ((peers: PeerInfo[]) => void)[]> = {};
  readonly connected = new Set<SeatId>();
  readonly stateListeners: ((s: TableState) => void)[] = [];
  readonly seqListeners: ((a: SequencedAction, own: boolean) => void)[] = [];

  constructor(private readonly table: SecretTable) {}

  host(seat: SeatId, asSeat: SeatId | null = seat): PrivateChannelHost {
    this.connected.add(seat);
    this.inbox[seat] = [];
    this.listeners[seat] = [];
    this.peerListeners[seat] = [];
    const host: PrivateChannelHost = {
      state: (): TableState => this.table.state,
      onState: (l: (s: TableState) => void) => {
        this.stateListeners.push(l);
        return () => undefined;
      },
      onSequenced: (l: (a: SequencedAction, own: boolean) => void) => {
        this.seqListeners.push(l);
        return () => undefined;
      },
      seat: () => asSeat,
      sendPrivate: (to: SeatId, msg: PrivateMessage) => {
        if (!this.connected.has(to) || !this.connected.has(seat)) return false;
        const copy = JSON.parse(JSON.stringify(msg)) as PrivateMessage;
        this.inbox[to]!.push({ msg: copy, from: asSeat });
        for (const l of this.listeners[to]!) l(copy, { seat: asSeat, peerId: `peer-${seat}` });
        return true;
      },
      onPrivate: (l: Listener) => {
        this.listeners[seat]!.push(l);
        return () => undefined;
      },
      peers: () => this.peers(seat),
      onPeers: (l: (peers: PeerInfo[]) => void) => {
        this.peerListeners[seat]!.push(l);
        return () => undefined;
      },
    };
    return host;
  }

  peers(self: SeatId): PeerInfo[] {
    return [...this.connected]
      .filter((s) => s !== self)
      .map((s) => ({ transportId: s, peerId: `peer-${s}`, nickname: s, seat: s, role: 'player' as const, status: 'connected' as const, lastSeq: 0 }));
  }

  /** Inject a raw message as if `from` had sent it to `to`. */
  inject(to: SeatId, from: SeatId | null, msg: unknown): void {
    for (const l of this.listeners[to]!) l(msg as PrivateMessage, { seat: from, peerId: `peer-${from}` });
  }

  /** Tell every channel that the action with `cid` was sequenced (a chat line unless `action` says otherwise). */
  sequenced(cid: string, action: Record<string, unknown> = { type: 'chat', text: '', channel: 'table', by: 's0' }): void {
    const a = { ...action, cid, seq: 1 } as unknown as SequencedAction;
    for (const l of this.seqListeners) l(a, false);
  }

  /** A sequenced `revealTo` of `card` by `by` naming `seats`. */
  revealTo(cid: string, by: SeatId, card: string, seats: SeatId[]): void {
    this.sequenced(cid, { type: 'revealTo', by, instanceId: card, seats });
  }

  /** A sequenced `lookAt` by `by`. */
  lookAt(by: SeatId, zone: string, count: number, card?: string): void {
    this.sequenced(`look-${++this.lookCid}`, { type: 'lookAt', by, zone, count, ...(card !== undefined ? { card } : {}) });
  }
  private lookCid = 0;

  /** Tell every channel the shared state changed. */
  notify(): void {
    for (const l of this.stateListeners) l(this.table.state);
  }

  disconnect(seat: SeatId): void {
    this.connected.delete(seat);
    for (const s of this.connected) for (const l of this.peerListeners[s]!) l(this.peers(s));
  }
}

function setup(): { t: SecretTable; bus: Bus; ch: Record<SeatId, PrivateChannel>; got: Record<SeatId, { card: RevealedCard; from: SeatId; verified: boolean }[]> } {
  const t = readySecretTable(['Anna', 'Ben', 'Cleo'], 8);
  // s0 holds three cards in hand.
  for (const id of t.secrets.s0!.libraryOrder.slice(0, 3)) t.apply('s0', { type: 'draw', instanceId: id });
  t.secrets.s0 = { ...t.secrets.s0!, hand: t.secrets.s0!.libraryOrder.slice(0, 3), libraryOrder: t.secrets.s0!.libraryOrder.slice(3) };
  const bus = new Bus(t);
  const ch: Record<SeatId, PrivateChannel> = {};
  const got: Record<SeatId, { card: RevealedCard; from: SeatId; verified: boolean }[]> = {};
  for (const s of ['s0', 's1', 's2']) {
    ch[s] = privateChannelOver(bus.host(s));
    got[s] = [];
    ch[s].onIdentity((card, from, verified) => got[s]!.push({ card, from, verified }));
  }
  return { t, bus, ch, got };
}

describe('targeted reveal', () => {
  it('reaches the named seats only, verified against the owner commitment', () => {
    const { t, bus, ch, got } = setup();
    const card = revealedCard(t.secrets.s0!, t.secrets.s0!.hand[0]!)!;
    ch.s0!.reveal(['s1', 's1', 's0'], [card], 'revealTo', 'cid-1');
    expect(bus.inbox.s1).toHaveLength(1);
    // Taken once the public revealTo is applied here (the pair channel can overtake the log).
    expect(got.s1).toEqual([]);
    bus.revealTo('cid-1', 's0', card.instanceId, ['s1']);
    expect(bus.inbox.s1![0]!.msg).toEqual({ v: 1, t: 'reveal', ...card, purpose: 'revealTo', about: 'cid-1' });
    expect(bus.inbox.s2).toEqual([]);
    expect(bus.inbox.s0).toEqual([]);
    expect(got.s1).toEqual([{ card, from: 's0', verified: true }]);
    expect(got.s2).toEqual([]);
  });

  it('flags an identity that does not open the sender commitment, or names a card the sender does not own', () => {
    const { t, bus, got } = setup();
    const card = revealedCard(t.secrets.s0!, t.secrets.s0!.hand[0]!)!;
    bus.inject('s1', 's0', { v: 1, t: 'reveal', ...card, ref: { sid: 'forged' }, purpose: 'revealTo', about: 'x' });
    bus.inject('s1', 's2', { v: 1, t: 'reveal', ...card, purpose: 'revealTo', about: 'y' });
    bus.revealTo('x', 's0', card.instanceId, ['s1']);
    // s2 publicly "reveals" s0's card to s1 (no rules enforcement), but cannot open s0's commitment.
    bus.revealTo('y', 's2', card.instanceId, ['s1']);
    expect(got.s1!.map((g) => g.verified)).toEqual([false, false]);
  });

  it('is taken only with the sender\u2019s public revealTo of that card naming this seat', () => {
    const { t, bus, got } = setup();
    const [h0, h1] = t.secrets.s0!.hand;
    const card = revealedCard(t.secrets.s0!, h0!)!;
    const send = (about: string): void => bus.inject('s1', 's0', { v: 1, t: 'reveal', ...card, purpose: 'revealTo', about });
    send('chat');
    bus.sequenced('chat');
    send('other-card');
    bus.revealTo('other-card', 's0', h1!, ['s1']);
    send('other-seat');
    bus.revealTo('other-seat', 's0', h0!, ['s2']);
    send('other-sender');
    bus.revealTo('other-sender', 's2', h0!, ['s1']);
    // A look answer for a look this browser never asked for.
    bus.inject('s1', 's0', { v: 1, t: 'reveal', ...card, purpose: 'look', about: 'look-s1-1' });
    expect(got.s1).toEqual([]);
    bus.revealTo('right', 's0', h0!, ['s2', 's1']);
    send('right');
    expect(got.s1).toEqual([{ card, from: 's0', verified: true }]);
  });

  it('holds an identity that arrives before the shared state knows its card, and verifies it once it does', () => {
    const t = readySecretTable(['Anna', 'Ben'], 0);
    const bus = new Bus(t);
    const ch = privateChannelOver(bus.host('s1'));
    bus.host('s0');
    const got: boolean[] = [];
    ch.onIdentity((_c, _f, ok) => got.push(ok));
    const deck = commitDeck(emptySecretStore('s0'), deckRefs('s0', 2), seededEntropy(5));
    const early = revealedCard(deck.secrets, deck.secrets.libraryOrder[0]!)!;
    bus.inject('s1', 's0', { v: 1, t: 'reveal', ...early, purpose: 'revealTo', about: 'x' });
    bus.revealTo('x', 's0', early.instanceId, ['s1']);
    expect(got).toEqual([]);
    t.apply('s0', { type: 'reorder', zone: 'library:s0', count: 0, orderHash: 'o' });
    bus.notify();
    expect(got).toEqual([]);
    t.apply('s0', deck.action);
    bus.notify();
    expect(got).toEqual([true]);
  });

  it('ignores malformed messages and messages from unseated peers', () => {
    const { t, bus, got } = setup();
    const card = revealedCard(t.secrets.s0!, t.secrets.s0!.hand[0]!)!;
    bus.inject('s1', null, { v: 1, t: 'reveal', ...card, purpose: 'revealTo', about: 'x' });
    bus.inject('s1', 's0', { v: 1, t: 'reveal', instanceId: card.instanceId, ref: 'bolt', salt: card.salt, purpose: 'revealTo', about: 'x' });
    bus.inject('s1', 's0', { v: 1, t: 'reveal', instanceId: card.instanceId, ref: { sid: 'x', foil: 'yes' }, salt: card.salt, purpose: 'revealTo', about: 'x' });
    bus.inject('s1', 's0', { v: 1, t: 'look', lookId: 'unknown', cards: [card] });
    bus.inject('s1', 's0', { v: 1, t: 'reveal', ...card, purpose: 'other', about: 'x' });
    bus.sequenced('x');
    expect(got.s1).toEqual([]);
  });

  it('never sends a card this seat does not own, so a received identity is not forwarded', () => {
    const { t, ch, bus } = setup();
    const card = revealedCard(t.secrets.s0!, t.secrets.s0!.hand[0]!)!;
    expect(() => ch.s1!.reveal(['s2'], [card], 'revealTo', 'x')).toThrow(/not s1's/);
    expect(bus.inbox.s2).toEqual([]);
    const unseated = privateChannelOver(bus.host('s9', null));
    expect(() => unseated.reveal(['s1'], [card], 'revealTo', 'x')).toThrow(/unseated/);
  });
});

describe('looks at another seat’s hidden cards', () => {
  it('go through the owner, who answers the asker only; the asker gets verified cards', async () => {
    const { t, bus, ch, got } = setup();
    ch.s0!.answerLooks((req) => lookAnswer(t.secrets.s0!, t.state, req));
    bus.lookAt('s1', 'library:s0', 2);
    const cards = await ch.s1!.requestLook('s0', 'library:s0', 2);
    expect(cards.map((c) => c.instanceId)).toEqual(t.secrets.s0!.libraryOrder.slice(0, 2));
    expect(got.s1!.every((g) => g.verified)).toBe(true);
    expect(bus.inbox.s2).toEqual([]);
    expect(bus.inbox.s1!.map((m) => m.msg.t)).toEqual(['look']);
  });

  it('resolve empty when the owner refuses, has no answerer, is asked about a zone it does not own, or is away', async () => {
    const { bus, ch } = setup();
    bus.lookAt('s1', 'library:s0', 1);
    expect(await ch.s1!.requestLook('s0', 'library:s0', 1)).toEqual([]);
    const off = ch.s0!.answerLooks(() => null);
    bus.lookAt('s1', 'library:s0', 1);
    expect(await ch.s1!.requestLook('s0', 'library:s0', 1)).toEqual([]);
    off();
    ch.s2!.answerLooks(() => []);
    bus.lookAt('s1', 'library:s0', 1);
    expect(await ch.s1!.requestLook('s2', 'library:s0', 1)).toEqual([]);
    expect(bus.inbox.s1!.at(-1)!.msg).toMatchObject({ t: 'look', refused: true });
    expect(await ch.s1!.requestLook('s1', 'library:s1', 1)).toEqual([]);
    bus.disconnect('s0');
    expect(await ch.s1!.requestLook('s0', 'library:s0', 1)).toEqual([]);
  });

  it('a pending look resolves empty when the owner leaves before answering', async () => {
    const { bus, ch } = setup();
    // s3's browser is connected but runs no pair channel, so it never answers.
    bus.host('s3');
    let settled = false;
    const pending = ch.s1!.requestLook('s3', 'library:s3', 1).then((cards) => {
      settled = true;
      return cards;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    bus.disconnect('s3');
    expect(await pending).toEqual([]);
  });

  it('strips cards that are not the answerer’s own from an answer', async () => {
    const { t, bus, ch } = setup();
    const foreign = { instanceId: t.state.zones['library:s1']!.ids[0]!, ref: { sid: 'x' }, salt: 'y' };
    const mine = revealedCard(t.secrets.s0!, t.secrets.s0!.libraryOrder[0]!)!;
    const second = revealedCard(t.secrets.s0!, t.secrets.s0!.libraryOrder[1]!)!;
    const hand = revealedCard(t.secrets.s0!, t.secrets.s0!.hand[0]!)!;
    ch.s0!.answerLooks(() => [foreign, hand, mine, mine, second]);
    bus.lookAt('s2', 'library:s0', 2);
    expect(await ch.s2!.requestLook('s0', 'library:s0', 2)).toEqual([mine, second]);
    // Never more than the count the public lookAt named.
    bus.lookAt('s2', 'library:s0', 1);
    expect(await ch.s2!.requestLook('s0', 'library:s0', 1)).toEqual([mine]);
  });

  it('are answered only for a sequenced lookAt of the asker, once each, and a request may arrive before it', async () => {
    const { t, bus, ch } = setup();
    const asked: string[] = [];
    ch.s0!.answerLooks((req, from) => {
      asked.push(`${from}:${req.zone}:${req.count}`);
      return lookAnswer(t.secrets.s0!, t.state, req);
    });
    const top = revealedCard(t.secrets.s0!, t.secrets.s0!.libraryOrder[0]!)!;
    // No lookAt at all: the answerer is never asked and nothing leaves s0.
    bus.inject('s0', 's1', { v: 1, t: 'lookReq', lookId: 'bogus', zone: 'library:s0', count: 1 });
    expect(asked).toEqual([]);
    expect(bus.inbox.s1).toEqual([]);
    // A lookAt by another seat, or with another count, does not open it either.
    bus.lookAt('s2', 'library:s0', 1);
    bus.lookAt('s1', 'library:s0', 2);
    expect(asked).toEqual([]);
    // The matching lookAt arrives after the request (the pair channel overtook the log): answered now.
    bus.lookAt('s1', 'library:s0', 1);
    expect(asked).toEqual(['s1:library:s0:1']);
    expect(bus.inbox.s1!.map((m) => m.msg)).toEqual([{ v: 1, t: 'look', lookId: 'bogus', cards: [top] }]);
    // The lookAt is used up: a second request waits again.
    bus.inject('s0', 's1', { v: 1, t: 'lookReq', lookId: 'again', zone: 'library:s0', count: 1 });
    expect(asked).toHaveLength(1);
  });

  it('a peek shows only an own face-down card in a public zone, never a hand or library card', async () => {
    const { t, bus, ch } = setup();
    const [h0, h1] = t.secrets.s0!.hand;
    t.apply('s0', { type: 'move', card: h1!, to: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 } });
    // A careless answerer that shows whatever is asked for.
    ch.s0!.answerLooks((req) => [revealedCard(t.secrets.s0!, req.card ?? h0!)!]);
    bus.lookAt('s1', 'library:s0', 1, h0);
    expect(await ch.s1!.requestLook('s0', 'library:s0', 1, h0)).toEqual([]);
    expect(bus.inbox.s1!.at(-1)!.msg).toMatchObject({ t: 'look', cards: [], refused: true });
    bus.lookAt('s1', 'hand:s0', 1, h0);
    expect(await ch.s1!.requestLook('s0', 'hand:s0', 1, h0)).toEqual([]);
    bus.lookAt('s1', 'battlefield:s0', 1, h1);
    expect((await ch.s1!.requestLook('s0', 'battlefield:s0', 1, h1)).map((c) => c.instanceId)).toEqual([h1]);
    const salts = bus.inbox.s1!.flatMap((m) => (m.msg.t === 'look' ? m.msg.cards.map((c) => c.salt) : []));
    expect(salts).toEqual([t.secrets.s0!.identities[h1!]!.salt]);
  });
});

describe('packs', () => {
  it('go to one seat only', () => {
    const { t, bus, ch } = setup();
    const received: string[] = [];
    ch.s1!.onPack((packId, cards, from) => received.push(`${packId}:${cards.length}:${from}`));
    ch.s0!.sendPack('s1', 'p1', [revealedCard(t.secrets.s0!, t.secrets.s0!.hand[0]!)!]);
    expect(received).toEqual(['p1:1:s0']);
    expect(bus.inbox.s2).toEqual([]);
  });
});
