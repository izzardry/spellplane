/**
 * The `draftCards` pair message (net/draftcards.ts; DESIGN "Specification: network protocol and secrecy", prv: one
 * pair only; "Pre-game", Hidden information: Winston "pile contents visible to whoever looks"): identities go to the
 * one named seat, never to itself or as a broadcast, and malformed payloads are dropped whole.
 */
import { describe, expect, it } from 'vitest';
import type { PrivateMessage } from '../../../../src/net/messages';
import { asDraftCards, draftCardsOver, MAX_DRAFT_CARDS } from '../../../../src/net/draftcards';
import type { SeatId } from '../../../../src/core/types';
import { PROTOCOL_VERSION } from '../../../../src/net/messages';

function fakeEngine(seat: SeatId) {
  const sent: { to: SeatId; msg: PrivateMessage }[] = [];
  const listeners: ((msg: PrivateMessage, from: { seat: SeatId | null; peerId: string }) => void)[] = [];
  return {
    sent,
    deliver: (msg: unknown, from: SeatId | null) => {
      for (const l of listeners) l(msg as PrivateMessage, { seat: from, peerId: `peer-${from}` });
    },
    host: {
      seat: () => seat,
      sendPrivate: (to: SeatId, msg: PrivateMessage) => {
        sent.push({ to, msg });
        return true;
      },
      onPrivate: (l: (msg: PrivateMessage, from: { seat: SeatId | null; peerId: string }) => void) => {
        listeners.push(l);
        return () => listeners.splice(listeners.indexOf(l), 1);
      },
    },
  };
}

const card = { instanceId: 'c1', ref: { sid: 'sid-1' }, salt: 'salt-1' };

describe('draftCards channel', () => {
  it('sends plain copies to the named seat only', () => {
    const e = fakeEngine('s0');
    const ch = draftCardsOver(e.host);
    expect(ch.send('s1', 'cid-7', [{ ...card, extra: 'x' } as typeof card])).toBe(true);
    expect(e.sent).toEqual([{ to: 's1', msg: { v: PROTOCOL_VERSION, t: 'draftCards', about: 'cid-7', cards: [card] } }]);
    expect(ch.send('s0', 'cid-7', [card])).toBe(false);
    expect(e.sent).toHaveLength(1);
  });

  it('hands on well-formed messages from a seated peer with its seat, and drops the rest whole', () => {
    const e = fakeEngine('s1');
    const got: unknown[] = [];
    const off = draftCardsOver(e.host).on((about, cards, from) => got.push({ about, cards, from }));
    e.deliver({ v: PROTOCOL_VERSION, t: 'draftCards', about: 'a', cards: [card] }, 's0');
    e.deliver({ v: PROTOCOL_VERSION, t: 'draftCards', about: 'b', cards: [card, { instanceId: 'c2', ref: { sid: 7 }, salt: 's' }] }, 's0');
    e.deliver({ v: PROTOCOL_VERSION, t: 'draftCards', about: '', cards: [card] }, 's0');
    e.deliver({ v: PROTOCOL_VERSION, t: 'draftCards', about: 'c', cards: [card] }, null);
    e.deliver({ v: PROTOCOL_VERSION, t: 'pack', packId: 'p', cards: [card] }, 's0');
    expect(got).toEqual([{ about: 'a', cards: [card], from: 's0' }]);
    off();
    e.deliver({ v: PROTOCOL_VERSION, t: 'draftCards', about: 'a', cards: [card] }, 's0');
    expect(got).toHaveLength(1);
  });

  it('caps the number of cards', () => {
    const many = Array.from({ length: MAX_DRAFT_CARDS + 1 }, (_, i) => ({ ...card, instanceId: `c${i}` }));
    expect(asDraftCards({ t: 'draftCards', about: 'x', cards: many })).toBeNull();
    expect(asDraftCards({ t: 'draftCards', about: 'x', cards: many.slice(1) })?.cards).toHaveLength(MAX_DRAFT_CARDS);
    expect(asDraftCards({ t: 'draftCards', about: 'x', cards: [{ ...card, ref: { sid: 'a', foil: false } }] })).toBeNull();
  });
});
