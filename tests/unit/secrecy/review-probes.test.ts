/**
 * The round-3 review probes of M1-P2, kept as permanent regression tests (docs/gates/M1-parked-m1-p2.md, "Open review
 * findings"). Each runs the reviewer's scratch probe step by step and asserts the design's outcome:
 *
 * 1. An undo's restore patch cannot make a committed card's identity public unverified (DESIGN "Specification: network
 *    protocol and secrecy", Commitments: every revealed identity is checked against the commitment; DECISIONS [M0-P1]).
 * 2. A sequencer owner that has seen the peer's nonce proposal cannot pick the shuffle order, neither by committing a
 *    new round nor by changing the zone's id set before the nonce is sequenced (DESIGN "Secret shuffle" 3; "Multiplayer
 *    architecture", Hidden information 3: "The owner cannot choose the order").
 * 3. A look sequenced while the owner's private reorder (scry) is still pending is not answered from the order after
 *    the scry (DESIGN "Multiplayer architecture", Hidden information 4: the logged look is the look that happens).
 */
import { describe, expect, it } from 'vitest';
import type { Action, ActionDraft } from '../../../src/core/actions';
import { nonceHash } from '../../../src/core/commit';
import { explain, reduce } from '../../../src/core/reducer';
import { shuffleOutcome, shuffleSeed } from '../../../src/core/rng';
import { beginShuffle, finishShuffle, lookAnswer, privateReorder } from '../../../src/core/secrets';
import type { InstanceId, SeatId, TableState } from '../../../src/core/types';
import { inverse } from '../../../src/core/undo';
import type { PrivateMessage, SequencedAction } from '../../../src/net/messages';
import { privateChannelOver, type PrivateChannelHost } from '../../../src/net/private';
import type { PeerInfo } from '../../../src/net/types';
import { readySecretTable, seededEntropy, type SecretTable } from './helpers';

const LIB0 = 'library:s0';

describe('probe 1: a forged undo restore patch by s1 puts an identity on s0’s face-down card', () => {
  it('is refused, so the plain flip that follows shows nothing and no peer sees the forged identity', () => {
    const t = readySecretTable();
    const id = t.secrets.s0!.libraryOrder[0]!;
    // 1. s0 moves a library card to its battlefield: it lands face down without an identity.
    t.apply('s0', { type: 'move', card: id, to: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 } });
    expect(t.state.cards[id]).toMatchObject({ zone: 'battlefield:s0', face: 'down' });
    expect(t.state.cards[id]!.identity).toBeUndefined();
    // 2. s1 sends an undo of an action it never made, whose inverse carries a restore identity.
    const forged = { type: 'tap' as const, card: id, tapped: false, restore: { cards: { [id]: { identity: { expect: null, put: { sid: 'black-lotus' } } } } } };
    t.refuse('s1', { type: 'undo', of: 'zzz', inverse: { ...forged, by: 's1', cid: 'inv' } } as ActionDraft, /cannot reveal card/);
    // 3. s0 sends a plain flip up: there is no public identity to show.
    t.refuse('s0', { type: 'flip', card: id, face: 'up' }, /no public identity/);
    expect(t.state.cards[id]!.identity).toBeUndefined();
    expect(JSON.stringify(t.state)).not.toContain('black-lotus');
  });

  it('is refused on every inverse type and from every seat, also on an already public card', () => {
    const t = readySecretTable();
    const [down, up] = t.secrets.s0!.libraryOrder;
    t.apply('s0', { type: 'move', card: down!, to: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 } });
    const { card, salt } = t.secrets.s0!.identities[up!]!;
    t.apply('s0', { type: 'reveal', instanceId: up!, ref: card, salt });
    t.apply('s0', { type: 'move', card: up!, to: 'battlefield:s0', pose: { x: 60, y: -200, rot: 0 } });
    for (const by of ['s0', 's1'] as SeatId[]) {
      for (const [target, expect0] of [
        [down!, null],
        [up!, card],
      ] as const) {
        const restore = { cards: { [target]: { identity: { expect: expect0, put: { sid: 'black-lotus' } } } } };
        const inverses = [
          { type: 'tap', card: target, tapped: true, restore },
          { type: 'flip', card: target, face: 'up', restore },
          { type: 'move', card: target, to: 'battlefield:s0', pose: { x: 10, y: -210, rot: 0 }, restore },
          { type: 'counter', card: target, kind: '+1/+1', delta: 1, restore },
        ];
        for (const inv of inverses) {
          const before = t.state;
          const undo = { type: 'undo', by, cid: `u-${by}`, seq: before.seq + 1, of: 'zzz', inverse: { ...inv, by, cid: 'inv' } } as Action;
          expect(reduce(before, undo), `${inv.type} by ${by} on ${target}`).toBe(before);
          expect(explain(before, undo), `${inv.type} by ${by} on ${target}`).toMatch(inv.type === 'flip' && target === down ? /no public identity/ : /cannot reveal card/);
        }
      }
    }
    expect(t.state.cards[up!]!.identity).toEqual(card);
    expect(JSON.stringify(t.state)).not.toContain('black-lotus');
  });
});

describe('probe 2: the 1v1 sequencer owner holds the peer nonce proposal before it sequences it', () => {
  /** s0 holds three cards in hand and commits a shuffle of its library; s1's nonce `peerN` is not sequenced yet. */
  function committed(): { t: SecretTable; hand: InstanceId[]; ownerNonce: string; libAtCommit: InstanceId[]; undoLastDraw: ActionDraft } {
    const t = readySecretTable(['Anna', 'Ben'], 20);
    const hand = t.secrets.s0!.libraryOrder.slice(0, 3);
    let undoLastDraw: ActionDraft | null = null;
    for (const id of hand) {
      const before = t.state;
      t.apply('s0', { type: 'draw', instanceId: id });
      const draw = t.log.at(-1)!;
      undoLastDraw = { type: 'undo', of: draw.cid, inverse: inverse(before, draw)! } as ActionDraft;
    }
    t.secrets.s0 = { ...t.secrets.s0!, hand, libraryOrder: t.secrets.s0!.libraryOrder.slice(3) };
    const ownerNonce = 'owner-nonce-1';
    const b = beginShuffle(t.secrets.s0!, LIB0, 'sh1', ownerNonce);
    t.secrets.s0 = b.secrets;
    t.apply('s0', b.action);
    return { t, hand, ownerNonce, libAtCommit: [...t.state.zones[LIB0]!.ids], undoLastDraw: undoLastDraw! };
  }
  const peerNonce = 'peerN';

  it('(a) the owner cannot replace the round with a new commitment to retry for a better order', () => {
    const { t, ownerNonce, libAtCommit } = committed();
    // The owner could compute the top card for each candidate nonce; the probe retried until it liked one.
    const tops = new Set(['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].map((n) => shuffleOutcome(shuffleSeed(n, [peerNonce]), libAtCommit).before[0]));
    expect(tops.size).toBeGreaterThan(1);
    for (const [i, n] of ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'].entries()) {
      t.refuse('s0', { type: 'shuffleCommit', sid: `sh-retry-${i}`, zone: LIB0, h: nonceHash(n) }, /sh1 of library:s0 is not finished/);
      t.refuse('s0', { type: 'shuffleCommit', sid: 'sh1', zone: LIB0, h: nonceHash(n) }, /already exists/);
    }
    expect(Object.keys(t.state.shuffles)).toEqual(['sh1']);
    // The round that stands is the first commitment's: the top card follows from it and the peer nonce.
    t.apply('s1', { type: 'shuffleNonce', sid: 'sh1', nonce: peerNonce });
    const f = finishShuffle(t.secrets.s0!, t.state, 'sh1', t.entropy.s0!);
    t.apply('s0', f.action);
    expect(f.secrets.libraryOrder).toEqual(shuffleOutcome(shuffleSeed(ownerNonce, [peerNonce]), libAtCommit).before);
  });

  it('(b) the owner cannot change the shuffled id set (0 to 3 hand cards into the library, a draw, an undo) before the nonce', () => {
    const { t, hand, ownerNonce, libAtCommit, undoLastDraw } = committed();
    // The probe: each of these id sets gives a different top card once the peer nonce is known.
    const candidates = [0, 1, 2, 3].map((k) => [...libAtCommit, ...hand.slice(0, k)]);
    const tops = new Set(candidates.map((ids) => shuffleOutcome(shuffleSeed(ownerNonce, [peerNonce]), ids).before[0]));
    expect(tops.size).toBeGreaterThan(1);
    const frozen = /library:s0 is being shuffled \(sh1\)/;
    for (const id of hand) {
      t.refuse('s0', { type: 'toZone', card: id, to: LIB0, position: 'top' }, frozen);
      t.refuse('s0', { type: 'toZone', card: id, to: LIB0, position: 'bottom' }, frozen);
    }
    t.refuse('s0', { type: 'draw', instanceId: libAtCommit[0]! }, frozen);
    t.refuse('s0', { type: 'mulligan', count: 1 }, frozen);
    // Undoing the last draw (its inverse puts the card back on top of the library) is refused the same way.
    expect((undoLastDraw as { inverse: { type: string; to: string } }).inverse).toMatchObject({ type: 'toZone', to: LIB0 });
    t.refuse('s0', undoLastDraw, frozen);
    expect(t.state.zones[LIB0]!.ids).toEqual(libAtCommit);
    // Only the committed id set is shuffled: one top card, the one the seed gives for it.
    t.apply('s1', { type: 'shuffleNonce', sid: 'sh1', nonce: peerNonce });
    const f = finishShuffle(t.secrets.s0!, t.state, 'sh1', t.entropy.s0!);
    t.apply('s0', f.action);
    expect(f.secrets.libraryOrder[0]).toBe(shuffleOutcome(shuffleSeed(ownerNonce, [peerNonce]), libAtCommit).before[0]);
    // After shuffleDone the zone is free again.
    t.apply('s0', { type: 'toZone', card: hand[0]!, to: LIB0, position: 'top' });
  });

  it('a peer may not change the frozen zone either (e.g. mill it) before the nonce', () => {
    const { t, libAtCommit } = committed();
    t.refuse('s1', { type: 'move', card: libAtCommit[0]!, to: 'graveyard:s0', index: 0 }, /being shuffled/);
  });
});

/** A minimal two-seat host pair over one shared state, with the owner's pending queue settable (no network). */
function pair(t: SecretTable): {
  owner: ReturnType<typeof privateChannelOver>;
  asker: ReturnType<typeof privateChannelOver>;
  setPending: (a: Action[]) => void;
  lookAt: (zone: string, count: number) => void;
  received: PrivateMessage[];
} {
  let pending: Action[] = [];
  let seq = 0;
  const seqListeners: ((a: SequencedAction, own: boolean) => void)[] = [];
  const inbox: Record<SeatId, ((m: PrivateMessage, from: { seat: SeatId | null; peerId: string }) => void)[]> = { s0: [], s1: [] };
  const received: PrivateMessage[] = [];
  const host = (me: SeatId, other: SeatId): PrivateChannelHost => ({
    state: (): TableState => t.state,
    confirmedState: (): TableState => t.state,
    pending: () => (me === 's0' ? pending : []),
    onState: () => () => undefined,
    onSequenced: (l) => {
      seqListeners.push(l);
      return () => undefined;
    },
    seat: () => me,
    sendPrivate: (to, msg) => {
      const copy = JSON.parse(JSON.stringify(msg)) as PrivateMessage;
      if (to === 's1') received.push(copy);
      for (const l of inbox[to]!) l(copy, { seat: me, peerId: `p-${me}` });
      return true;
    },
    onPrivate: (l) => {
      inbox[me]!.push(l);
      return () => undefined;
    },
    peers: (): PeerInfo[] => [{ transportId: other, peerId: `p-${other}`, nickname: other, seat: other, role: 'player', status: 'connected', lastSeq: 0 }],
    onPeers: () => () => undefined,
  });
  const owner = privateChannelOver(host('s0', 's1'));
  const asker = privateChannelOver(host('s1', 's0'));
  return {
    owner,
    asker,
    setPending: (a) => (pending = a),
    lookAt: (zone, count) => {
      const a = { type: 'lookAt', by: 's1', zone, count, cid: `look-${++seq}`, seq } as unknown as SequencedAction;
      for (const l of seqListeners) l(a, false);
    },
    received,
  };
}

describe('probe 3: s0 scries x1 to the bottom (reorder pending), then s1’s lookAt library:s0 count 1 is sequenced', () => {
  it('s1 does not receive x2, the card that was second at the logged look; the look is refused', async () => {
    const t = readySecretTable(['Anna', 'Ben'], 8);
    const p = pair(t);
    p.owner.answerLooks((req) => lookAnswer(t.secrets.s0!, t.state, req, { allowZoneLook: true }));
    const [x1, x2] = t.secrets.s0!.libraryOrder;
    // 1. The scry: the store holds the new order at once, the public reorder is still pending.
    const r = privateReorder(t.secrets.s0!, t.state, LIB0, [...t.secrets.s0!.libraryOrder.slice(1), x1!], 1, seededEntropy(99));
    t.secrets.s0 = r.secrets;
    p.setPending([{ ...r.action, by: 's0', cid: 'scry' } as Action]);
    // 2. s1's look is sequenced before the reorder.
    p.lookAt(LIB0, 1);
    const got = await p.asker.requestLook('s0', LIB0, 1);
    // 3. Nothing from after the scry reaches s1.
    expect(got).toEqual([]);
    const ids = p.received.flatMap((m) => (m.t === 'look' ? m.cards.map((c) => c.instanceId) : []));
    expect(ids).not.toContain(x2);
    expect(JSON.stringify(p.received)).not.toContain(t.secrets.s0!.identities[x2!]!.salt);
    expect(p.received.at(-1)).toMatchObject({ t: 'look', cards: [], refused: true });
  });

  it('once the reorder is sequenced, a later look is answered from the new order (pending() comes from the host)', async () => {
    const t = readySecretTable(['Anna', 'Ben'], 8);
    const p = pair(t);
    p.owner.answerLooks((req) => lookAnswer(t.secrets.s0!, t.state, req, { allowZoneLook: true }));
    const [x1, x2] = t.secrets.s0!.libraryOrder;
    // Before the scry, with nothing pending, the look is answered: zone looks do not fail closed.
    p.lookAt(LIB0, 1);
    expect((await p.asker.requestLook('s0', LIB0, 1)).map((c) => c.instanceId)).toEqual([x1]);
    const r = privateReorder(t.secrets.s0!, t.state, LIB0, [...t.secrets.s0!.libraryOrder.slice(1), x1!], 1, seededEntropy(99));
    t.secrets.s0 = r.secrets;
    t.apply('s0', r.action);
    p.setPending([]);
    p.lookAt(LIB0, 1);
    expect((await p.asker.requestLook('s0', LIB0, 1)).map((c) => c.instanceId)).toEqual([x2]);
  });
});
