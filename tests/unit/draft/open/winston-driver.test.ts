/**
 * The Winston driver's private looks (draft/winston.ts; DESIGN "Pre-game", Hidden information: Winston "pile contents
 * visible to whoever looks"; PLAN M2-P3 "Winston … end states account for every card"). A fake host stands in for
 * the session: it feeds sequenced states and records `draftCards` sends, which report whether a connected peer took
 * them. A disclosure counts only once delivered; the other player asks again for what it lacks.
 */
import { describe, expect, it } from 'vitest';
import type { Action } from '../../../../src/core/actions';
import type { RevealedCard } from '../../../../src/core/commit';
import { emptySecretStore } from '../../../../src/core/secrets';
import type { SecretStore, SeatId, TableState } from '../../../../src/core/types';
import { WINSTON_SEEN } from '../../../../src/draft/open';
import type { DraftHost } from '../../../../src/draft/types';
import { createWinstonDriver, WINSTON_NEED } from '../../../../src/draft/winston';
import { act, draftOf, draftTable, ok, openWinston, packCards } from './helpers';

interface Sent {
  to: SeatId;
  about: string;
  ids: string[];
  delivered: boolean;
}

/** A fake host for `seat`: `online` decides whether sends are delivered. */
function fakeHost(seat: SeatId, start: TableState, secrets: SecretStore) {
  const h = {
    state: start,
    secrets,
    online: true,
    sent: [] as Sent[],
    seq: [] as ((a: Action, s: TableState) => void)[],
    cards: [] as ((about: string, cards: RevealedCard[], from: SeatId) => void)[],
  };
  const host: DraftHost = {
    seat,
    state: () => h.state,
    secrets: () => h.secrets,
    setSecrets: (next) => {
      h.secrets = next;
    },
    dispatch: (draft) => ({ ...draft, by: seat, cid: 'x' }) as Action,
    packSeed: () => Promise.reject(new Error('no pack seeds here')),
    sendPack: () => undefined,
    onPack: () => () => undefined,
    sendCards: (to, about, cards) => {
      h.sent.push({ to, about, ids: cards.map((c) => c.instanceId), delivered: h.online });
      return h.online;
    },
    onCards: (l) => {
      h.cards.push(l);
      return () => undefined;
    },
    onSequenced: (l) => {
      h.seq.push(l);
      return () => undefined;
    },
    sets: { listSets: () => Promise.resolve([]), get: () => Promise.resolve(null), peek: () => null },
    generatePack: () => {
      throw new Error('no packs here');
    },
    entropy: { id: () => 'cx', salt: () => 'salt' },
  };
  /** Apply `action` as sequenced and tell the driver. */
  const apply = (action: Action): void => {
    h.state = ok(h.state, action);
    const sequenced = { ...action, seq: h.state.seq } as Action;
    for (const l of h.seq) l(sequenced, h.state);
  };
  return { h, host, apply };
}

/** A dealt one-pack Winston draft and the dealer's cards. */
function dealt(): { s: TableState; cards: RevealedCard[] } {
  const cards = packCards(15);
  return { s: openWinston(draftTable(2, { format: 'winston', packs: 1 }), [cards]), cards };
}

function dealerSecrets(cards: readonly RevealedCard[]): SecretStore {
  return { ...emptySecretStore('s0'), draft: { held: { pack: cards.map((c) => ({ ...c })) }, generated: [], marked: [] } };
}

describe('Winston dealer', () => {
  it('a pile look that found no connected peer is sent again once the peer is back, and only once', () => {
    const { s, cards } = dealt();
    const { h, host, apply } = fakeHost('s0', s, dealerSecrets(cards));
    const driver = createWinstonDriver(host);
    // The dealer takes pile 1: s1 now looks at pile 1, but s1 is offline.
    h.online = false;
    apply(act('pileLook', { pile: 0, take: true }, 's0'));
    const w = draftOf(h.state).winston!;
    expect(w.active).toBe('s1');
    expect(h.sent).toEqual([{ to: 's1', about: expect.any(String) as string, ids: w.pileIds![0], delivered: false }]);
    // Back online: the next drive() delivers it, later ones send nothing more.
    h.online = true;
    driver.drive();
    driver.drive();
    expect(h.sent.filter((x) => x.delivered)).toEqual([{ to: 's1', about: expect.any(String) as string, ids: w.pileIds![0], delivered: true }]);
    // s1 takes the pile: nothing new to show (it already knows those cards), and the dealer's own look stays private.
    apply(act('pileLook', { pile: 0, take: true }, 's1'));
    driver.drive();
    expect(h.sent.filter((x) => x.delivered)).toHaveLength(1);
    driver.dispose();
  });

  it("answers the other player's request with everything it may see now, and nothing else", () => {
    const { s, cards } = dealt();
    const { h, host, apply } = fakeHost('s0', s, dealerSecrets(cards));
    const driver = createWinstonDriver(host);
    // The dealer declines all three piles and takes the top stack card; s1 then takes pile 1 and declines pile 1 later.
    apply(act('pileLook', { pile: 0, take: true }, 's0'));
    apply(act('pileLook', { pile: 0, take: true }, 's1'));
    apply(act('pileLook', { pile: 0, take: true }, 's0'));
    const d = draftOf(h.state);
    expect(d.winston!.active).toBe('s1');
    const before = h.sent.length;
    // A request from s1 (an empty draftCards): the current look and every card s1 took, again.
    for (const l of h.cards) l(WINSTON_NEED, [], 's1');
    const answer = h.sent.slice(before);
    expect(answer).toHaveLength(1);
    expect(new Set(answer[0]!.ids)).toEqual(new Set([...d.taken!.s1!, ...d.winston!.pileIds![0]!]));
    // Requests with cards, of another kind, or from the dealer itself are not answered.
    for (const l of h.cards) l(WINSTON_NEED, [cards[0]!], 's1');
    for (const l of h.cards) l('other', [], 's1');
    for (const l of h.cards) l(WINSTON_NEED, [], 's0');
    expect(h.sent.length).toBe(before + 1);
    // Never a card the dealer took or a pile s1 is not looking at.
    for (const x of h.sent) for (const id of x.ids) expect(d.taken!.s0!).not.toContain(id);
    driver.dispose();
  });
});

describe('Winston other player', () => {
  it('asks the dealer for a pile it looks at but cannot see, keeps only cards that open the commitments, then stops asking', () => {
    const { s, cards } = dealt();
    const { h, host, apply } = fakeHost('s1', s, emptySecretStore('s1'));
    const driver = createWinstonDriver(host);
    apply(act('pileLook', { pile: 0, take: true }, 's0'));
    const w = draftOf(h.state).winston!;
    expect(w.active).toBe('s1');
    // It asked at once (the sequenced action), and does not repeat at every drive().
    const asks = (): Sent[] => h.sent.filter((x) => x.about === WINSTON_NEED);
    expect(asks()).toEqual([{ to: 's0', about: WINSTON_NEED, ids: [], delivered: true }]);
    for (let i = 0; i < 5; i++) driver.drive();
    expect(asks()).toHaveLength(1);
    expect(driver.view().pile).toBeUndefined();
    // Unanswered for a while: it asks again.
    for (let i = 0; i < 30; i++) driver.drive();
    expect(asks().length).toBeGreaterThan(1);
    // A forged identity is dropped; the real one is kept and the pile shows.
    const pile = w.pileIds![0]!.map((id) => cards.find((c) => c.instanceId === id)!);
    for (const l of h.cards) l('a', pile.map((c) => ({ ...c, ref: { sid: 'forged' } })), 's0');
    expect(h.secrets.draft?.held[WINSTON_SEEN] ?? []).toEqual([]);
    for (const l of h.cards) l('a', pile, 's0');
    expect(h.secrets.draft!.held[WINSTON_SEEN]!.map((c) => c.instanceId)).toEqual(pile.map((c) => c.instanceId));
    expect(driver.view().pile!.map((c) => c.id)).toEqual(pile.map((c) => c.instanceId));
    const n = asks().length;
    for (let i = 0; i < 60; i++) driver.drive();
    expect(asks()).toHaveLength(n);
    driver.dispose();
  });

  it('a request that found no connected dealer is repeated at the next drive()', () => {
    const { s } = dealt();
    const { h, host, apply } = fakeHost('s1', s, emptySecretStore('s1'));
    const driver = createWinstonDriver(host);
    h.online = false;
    apply(act('pileLook', { pile: 0, take: true }, 's0'));
    expect(h.sent.filter((x) => x.about === WINSTON_NEED)).toHaveLength(1);
    h.online = true;
    driver.drive();
    expect(h.sent.filter((x) => x.about === WINSTON_NEED).map((x) => x.delivered)).toEqual([false, true]);
    driver.dispose();
  });
});

describe('Winston after a reload', () => {
  /** s0 takes pile 1, so s1 now looks at pile 1: the table both browsers reload into. */
  function s1Looking(): { s: TableState; cards: RevealedCard[] } {
    const { s, cards } = dealt();
    return { s: ok(s, act('pileLook', { pile: 0, take: true }, 's0')), cards };
  }

  it('the other player, reloaded without its pile, asks the dealer from drive() alone (no action follows)', () => {
    const { s } = s1Looking();
    expect(draftOf(s).winston!.active).toBe('s1');
    const { h, host } = fakeHost('s1', s, emptySecretStore('s1'));
    const driver = createWinstonDriver(host);
    for (let i = 0; i < 200; i++) driver.drive();
    expect(driver.view().pile).toBeUndefined();
    const asks = h.sent.filter((x) => x.about === WINSTON_NEED);
    expect(asks.length).toBeGreaterThan(0);
    expect(asks.every((x) => x.to === 's0' && x.ids.length === 0)).toBe(true);
    driver.dispose();
  });

  it('the dealer, reloaded, answers a request before any action is sequenced', () => {
    const { s, cards } = s1Looking();
    const { h, host } = fakeHost('s0', s, dealerSecrets(cards));
    const driver = createWinstonDriver(host);
    const d = draftOf(s);
    const before = h.sent.length;
    for (const l of h.cards) l(WINSTON_NEED, [], 's1');
    const answer = h.sent.slice(before);
    expect(answer).toHaveLength(1);
    expect(answer[0]!.to).toBe('s1');
    expect(new Set(answer[0]!.ids)).toEqual(new Set(d.winston!.pileIds![0]!));
    driver.dispose();
  });

  it('a late identity holds back later picks, so the pool stays in pick order', () => {
    // s1 takes pile 1 (cards it was shown), then declines every pile and takes the top stack card, whose identity it
    // is not shown before it takes it; then it takes a pile it is shown.
    const { s: start, cards } = dealt();
    const byId = new Map(cards.map((c) => [c.instanceId, c]));
    const { h, host, apply } = fakeHost('s1', start, emptySecretStore('s1'));
    const driver = createWinstonDriver(host);
    apply(act('pileLook', { pile: 0, take: true }, 's0'));
    const first = draftOf(h.state).winston!.pileIds![0]!;
    for (const l of h.cards) l('a', first.map((id) => byId.get(id)!), 's0');
    apply(act('pileLook', { pile: 0, take: true }, 's1'));
    expect(h.secrets.pool).toEqual(first.map((id) => byId.get(id)!.ref));
    // After the dealer's take, s1 declines all three piles: it takes the top stack card, unseen.
    apply(act('pileLook', { pile: 0, take: true }, 's0'));
    for (let pile = 0; pile < 3; pile++) apply(act('pileLook', { pile, take: false }, 's1'));
    const afterBlind = draftOf(h.state).taken!.s1!;
    const blind = afterBlind.at(-1)!;
    expect(first).not.toContain(blind);
    // The dealer takes a pile; s1 takes the pile it is shown now.
    apply(act('pileLook', { pile: 0, take: true }, 's0'));
    const w = draftOf(h.state).winston!;
    const next = w.pileIds![w.pile]!;
    for (const l of h.cards) l('b', next.map((id) => byId.get(id)!), 's0');
    apply(act('pileLook', { pile: w.pile, take: true }, 's1'));
    const taken = draftOf(h.state).taken!.s1!;
    // The unseen card is missing: nothing after it is in the pool yet.
    expect(h.secrets.pool).toEqual(first.map((id) => byId.get(id)!.ref));
    // It arrives: the pool is every taken card, in pick order.
    for (const l of h.cards) l('c', [byId.get(blind)!], 's0');
    expect(h.secrets.pool).toEqual(taken.map((id) => byId.get(id)!.ref));
    driver.dispose();
  });
});
