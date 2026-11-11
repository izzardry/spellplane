/**
 * M0-P7 acceptance (docs/PLAN.md): importing the fixture deck creates 60 hidden library cards whose identities exist
 * only in the secret store; shuffle permutes the private order; draw moves the top card to the hand; undo restores the
 * previous hash. (The reload test is in persistence.test.ts and tests/e2e/solo/.)
 *
 * DESIGN: "Table model" (hidden cards are opaque ids), "Specification: network protocol and secrecy" (commitments,
 * secret shuffle, draw names the top opaque id), "Turn flow and confirmation" (Undo).
 */
import { describe, expect, it } from 'vitest';
import { sha256 } from '../../../src/core/hash';
import { checkInvariants } from '../../../src/core/invariants';
import type { HiddenZone, ShuffleRecord } from '../../../src/core/types';
import { orderHash, shuffledOrder, shuffleSeed } from '../../../src/session/index';
import { deckA, hashNoSeq, json, session, withDeck } from './helpers';

const LIB = 'library:s0';
const HAND = 'hand:s0';

describe('deck import', () => {
  it('creates 60 hidden library cards whose identities exist only in the secret store', async () => {
    const s = await withDeck();
    const st = s.getState();
    const lib = st.zones[LIB] as HiddenZone;
    expect(lib.visibility).toBe('nobody');
    expect(lib.count).toBe(60);
    expect(lib.ids).toHaveLength(60);
    const own = Object.values(st.cards).filter((c) => c.owner === 's0');
    expect(own).toHaveLength(60);
    for (const c of own) {
      expect(c.zone).toBe(LIB);
      expect(c.identity).toBeUndefined();
      expect(c.face).toBe('down');
    }
    const sec = s.secrets();
    expect(Object.keys(sec.identities).sort()).toEqual([...lib.ids].sort());
    expect(new Set(sec.libraryOrder)).toEqual(new Set(lib.ids));
    expect(sec.hand).toEqual([]);

    // Scan the whole shared state for every Scryfall id and salt in the secret store: none may appear.
    const shared = json(st);
    for (const { card, salt } of Object.values(sec.identities)) {
      expect(shared).not.toContain(card.sid);
      expect(shared).not.toContain(salt);
    }
    // The shared log carries no identity either.
    const log = json(s.log());
    for (const { card } of Object.values(sec.identities)) expect(log).not.toContain(card.sid);
    expect(checkInvariants(st)).toEqual([]);
  });

  it('keeps the deck list order as the unshuffled library and the sideboard in the private pool', async () => {
    const deck = await deckA();
    const s = await session();
    await s.importDeck(deck);
    const sec = s.secrets();
    expect(sec.libraryOrder.map((id) => sec.identities[id]!.card)).toEqual(deck.main);
    expect(sec.pool).toEqual(deck.side);
    expect(deck.side.length).toBeGreaterThan(0);
  });

  it('publishes one commitment per card: base64url(SHA-256(instanceId|sid|f-or-n|salt)), salts of 16 random bytes', async () => {
    const s = await withDeck();
    const st = s.getState();
    const c = st.commitments.s0!;
    const sec = s.secrets();
    expect(c.instanceIds).toEqual([...c.instanceIds].sort());
    expect(c.commits).toHaveLength(60);
    const expected = await Promise.all(
      Object.entries(sec.identities).map(([id, { card, salt }]) => sha256(`${id}|${card.sid}|${card.foil ? 'f' : 'n'}|${salt}`)),
    );
    expect([...c.commits].sort()).toEqual(expected.sort());
    for (const { salt } of Object.values(sec.identities)) expect(salt).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(new Set(Object.values(sec.identities).map((i) => i.salt)).size).toBe(60);
    // Opaque ids say nothing about the card: no Scryfall id inside, and copies of one card get unrelated ids.
    for (const [id, { card }] of Object.entries(sec.identities)) expect(id).not.toContain(card.sid.slice(0, 8));
    expect(st.seats.s0!.ready).toBe(true);
  });

  it('commits foil cards with "f" and keeps the foil flag in the secret store', async () => {
    const deck = await deckA();
    const s = await session();
    await s.importDeck({ main: [{ ...deck.main[0]!, foil: true }, ...deck.main.slice(1)], side: [] });
    const sec = s.secrets();
    const [id, foil] = Object.entries(sec.identities).find(([, v]) => v.card.foil)!;
    expect(foil.card).toEqual({ sid: deck.main[0]!.sid, foil: true });
    expect(s.getState().commitments.s0!.commits).toContain(await sha256(`${id}|${foil.card.sid}|f|${foil.salt}`));
  });

  it('refuses a second import and an empty deck without changing the table', async () => {
    const s = await withDeck();
    const before = json(s.getState());
    await expect(s.importDeck(await deckA())).rejects.toThrow();
    expect(json(s.getState())).toBe(before);
    const empty = await session();
    await expect(empty.importDeck({ main: [], side: [] })).rejects.toThrow();
    expect(Object.keys(empty.getState().cards)).toHaveLength(0);
  });

  it('sets up the 1v1 table: seat 0 is the player, seat 1 is empty, the stage is match', async () => {
    const s = await session();
    const st = s.getState();
    expect(s.seat).toBe('s0');
    expect(st.format).toBe('1v1');
    expect(Object.keys(st.seats).sort()).toEqual(['s0', 's1']);
    expect(st.seats.s1!.name).toBe('');
    expect(st.stage).toBe('match');
  });
});

describe('secret shuffle', () => {
  it('permutes the private order, keeps the public state apart from seq, and records the audit entry', async () => {
    const s = await withDeck();
    const before = s.getState();
    const orderBefore = [...s.secrets().libraryOrder];
    await s.shuffle();
    const after = s.getState();
    const order = s.secrets().libraryOrder;
    expect([...order].sort()).toEqual([...orderBefore].sort());
    expect(order).not.toEqual(orderBefore);
    // Shared state is unchanged apart from seq: hidden zones keep their sorted ids, so no order leaks.
    expect(await hashNoSeq(after)).toBe(await hashNoSeq(before));
    expect(after.seq).toBe(before.seq + 1);

    const audit = s.secrets().audit.filter((r): r is ShuffleRecord => r.kind === 'shuffle');
    expect(audit).toHaveLength(1);
    const rec = audit[0]!;
    expect(rec.zone).toBe(LIB);
    expect(rec.peerNonces).toEqual([]);
    expect(rec.order).toEqual(order);
    // The audit replays: sorted ids, Fisher–Yates driven by SHA-256(seed + counter), seed = SHA-256(ownerNonce).
    expect(shuffledOrder([...order].sort(), shuffleSeed(rec.ownerNonce, []))).toEqual(order);
    // The public trace commits to the order: orderHash = SHA-256(order joined by ',' + '|' + ownerNonce).
    const last = s.log().at(-1)!;
    expect(last.kind).toBe('action');
    if (last.kind === 'action') {
      expect(last.action).toMatchObject({ type: 'reorder', zone: LIB, count: 60, by: 's0' });
      expect(last.action.type === 'reorder' && last.action.orderHash).toBe(await sha256(`${order.join(',')}|${rec.ownerNonce}`));
      expect(orderHash(order, rec.ownerNonce)).toBe(await sha256(`${order.join(',')}|${rec.ownerNonce}`));
      // The nonce stays private.
      expect(json(s.log())).not.toContain(rec.ownerNonce);
      expect(json(after)).not.toContain(rec.ownerNonce);
    }
  });

  it('uses a fresh owner nonce each time, so two shuffles of the same library give different orders', async () => {
    const s = await withDeck();
    await s.shuffle();
    const first = [...s.secrets().libraryOrder];
    await s.shuffle();
    const recs = s.secrets().audit.filter((r): r is ShuffleRecord => r.kind === 'shuffle');
    expect(recs).toHaveLength(2);
    expect(recs[0]!.ownerNonce).not.toBe(recs[1]!.ownerNonce);
    expect(s.secrets().libraryOrder).not.toEqual(first);
  });

  it('cannot be undone, and undo does not reach past it', async () => {
    const s = await withDeck();
    await s.draw();
    expect(s.canUndo()).toBe(true);
    await s.shuffle();
    expect(s.canUndo()).toBe(false);
    expect(s.undo()).toBe(false);
    expect(s.secrets().hand).toHaveLength(1);
  });

  it("refuses to shuffle a zone that is not one of the player's hidden zones", async () => {
    const s = await withDeck();
    await expect(s.shuffle('battlefield:s0')).rejects.toThrow();
    await expect(s.shuffle('library:s1')).rejects.toThrow();
  });
});

describe('draw', () => {
  it('moves the top card of the private order to the hand as an opaque id; only the owner knows the identity', async () => {
    const s = await withDeck();
    await s.shuffle();
    const top = s.secrets().libraryOrder[0]!;
    const ref = s.secrets().identities[top]!.card;
    await s.draw();
    const st = s.getState();
    expect(st.cards[top]!.zone).toBe(HAND);
    expect(st.cards[top]!.identity).toBeUndefined();
    expect((st.zones[HAND] as HiddenZone).count).toBe(1);
    expect((st.zones[LIB] as HiddenZone).count).toBe(59);
    expect(s.secrets().hand).toEqual([top]);
    expect(s.secrets().libraryOrder).not.toContain(top);
    expect(s.secrets().identities[top]!.card).toEqual(ref);
    const last = s.log().at(-1)!;
    expect(last.kind === 'action' && last.action).toMatchObject({ type: 'draw', instanceId: top, by: 's0' });
    expect(json(st)).not.toContain(ref.sid);
  });

  it('draws n cards from the top in order, and stops at an empty library', async () => {
    const s = await withDeck();
    const order = [...s.secrets().libraryOrder];
    await s.draw(7);
    expect(s.secrets().hand).toEqual(order.slice(0, 7));
    expect(s.secrets().libraryOrder).toEqual(order.slice(7));
    await s.draw(100);
    expect(s.secrets().hand).toHaveLength(60);
    expect((s.getState().zones[LIB] as HiddenZone).count).toBe(0);
    const seq = s.getState().seq;
    await s.draw();
    expect(s.getState().seq).toBe(seq);
    expect(s.log().at(-1)).toMatchObject({ kind: 'system', level: 'warn' });
  });

  it('refuses a dispatched draw that does not name the top card', async () => {
    const s = await withDeck();
    const second = s.secrets().libraryOrder[1]!;
    const before = json(s.getState());
    s.dispatch({ type: 'draw', instanceId: second });
    expect(json(s.getState())).toBe(before);
    expect(s.secrets().hand).toEqual([]);
  });
});

describe('undo', () => {
  it('restores the previous hash after a draw and puts the card back on top of the library, logged', async () => {
    const s = await withDeck();
    await s.shuffle();
    const order = [...s.secrets().libraryOrder];
    const h0 = await hashNoSeq(s.getState());
    await s.draw();
    expect(await hashNoSeq(s.getState())).not.toBe(h0);
    expect(s.undo()).toBe(true);
    expect(await hashNoSeq(s.getState())).toBe(h0);
    expect(s.secrets().libraryOrder).toEqual(order);
    expect(s.secrets().hand).toEqual([]);
    const last = s.log().at(-1)!;
    expect(last.kind === 'action' && last.action).toMatchObject({
      type: 'undo',
      inverse: { type: 'toZone', card: order[0], to: LIB, position: 'top' },
    });
    expect(s.canUndo()).toBe(false);
    expect(s.undo()).toBe(false);
  });

  it('undoes a multi-card draw as one step, restoring the exact order', async () => {
    const s = await withDeck();
    const order = [...s.secrets().libraryOrder];
    const h0 = await hashNoSeq(s.getState());
    await s.draw(3);
    expect(s.undo()).toBe(true);
    expect(await hashNoSeq(s.getState())).toBe(h0);
    expect(s.secrets().libraryOrder).toEqual(order);
  });

  it('undoes public actions one at a time, newest first', async () => {
    const s = await withDeck();
    await s.draw(2);
    const [a, b] = s.secrets().hand;
    s.dispatch({ type: 'move', card: a!, to: 'battlefield:s0', pose: { x: 0, y: 100, rot: 0 } });
    const h1 = await hashNoSeq(s.getState());
    s.dispatch({ type: 'tap', card: a!, tapped: true });
    const h2 = await hashNoSeq(s.getState());
    s.dispatch({ type: 'life', seat: 's0', delta: -3 });
    expect(s.undo()).toBe(true);
    expect(await hashNoSeq(s.getState())).toBe(h2);
    expect(s.undo()).toBe(true);
    expect(await hashNoSeq(s.getState())).toBe(h1);
    expect(s.getState().cards[a!]!.tapped).toBe(false);
    void b;
  });

  it('undoing a play from the hand returns the card to the hand, drops its identity and keeps the hand order', async () => {
    const s = await withDeck();
    await s.draw(3);
    const hand = [...s.secrets().hand];
    const h0 = await hashNoSeq(s.getState());
    s.dispatch({ type: 'move', card: hand[1]!, to: 'battlefield:s0', pose: { x: 10, y: 80, rot: 0 } });
    expect(s.getState().cards[hand[1]!]!.identity).toBeDefined();
    expect(s.undo()).toBe(true);
    expect(s.getState().cards[hand[1]!]!.zone).toBe(HAND);
    expect(s.getState().cards[hand[1]!]!.identity).toBeUndefined();
    expect(await hashNoSeq(s.getState())).toBe(h0);
    expect(s.secrets().hand).toEqual(hand);
  });
});
