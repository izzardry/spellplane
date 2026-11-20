/**
 * Leak test of the public lobby (contracts.md Part A; matchmaking.md MM-15, 2.15). With a deck selected and a search
 * running through to a formed match, no lobby message contains a Scryfall id, a deck id, a deck name, a card name or a
 * salt; the only deck-derived fields are QueueDeckInfo's band and score. Shown to fail when a deck fact is injected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeckRecord, DeckSummary } from '../../../src/store/types';
import type { LobbyMessage } from '../../../src/net/lobby/messages';
import { browser, closeAll, fixtureDeck, nameOf, until, type Browser } from '../session/harness';
import { FAKE_TIMERS, lobbyNet } from './harness';
import { mmPage, type MmPage } from './mm-harness';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

let browsers: Browser[] = [];
let pages: MmPage[] = [];
beforeEach(() => vi.useFakeTimers(FAKE_TIMERS));
afterEach(() => {
  for (const p of pages) p.mm.dispose();
  pages = [];
  closeAll(browsers);
  browsers = [];
  vi.useRealTimers();
});

async function deckRecord(id: string, name: string, file: 'gw-m19-60.txt' | 'ur-m19-60.mtga.txt'): Promise<DeckRecord> {
  const d = await fixtureDeck(file);
  const summary = {
    v: 1,
    at: 1,
    cards: d.main.length,
    lands: 24,
    colours: ['G', 'W'],
    curve: [0, 4, 8, 8, 6, 4, 2, 0],
    avgMv: 2.9,
    unknown: 0,
    strength: { v: 1, score: 63, band: 'tuned', parts: { quality: 0.6, curve: 0.7, interaction: 0.3, consistency: 0.5, mana: 0.8 }, basis: 'rarity', complete: true },
    simple: false,
    maxCopies: 4,
    cover: d.main[0]!,
    fan: d.main.slice(0, 5),
  } as unknown as DeckSummary;
  return { id, name, main: d.main, side: d.side, source: 'pasted', createdAt: 1, updatedAt: 1, kind: 'custom', size: 60, summary, text: `4 ${nameOf(d.main[0]!.sid)}` };
}

/** Every string a deck could leak through. */
function secretsOf(deck: DeckRecord): string[] {
  const sids = [...deck.main, ...deck.side].map((c) => c.sid);
  const names = sids.map(nameOf).filter((n) => n !== '?' && n.length >= 4);
  return [deck.id, deck.name, ...new Set(sids), ...new Set(names)];
}

function leaks(messages: readonly LobbyMessage[], secrets: readonly string[]): string[] {
  const out: string[] = [];
  for (const m of messages) {
    const text = JSON.stringify(m);
    for (const s of secrets) if (text.includes(s)) out.push(`${m.t}: ${s}`);
    if (/salt/i.test(text)) out.push(`${m.t}: salt`);
  }
  return out;
}

describe('lobby leak (M8-P7)', () => {
  it('a search through to a formed match carries only QueueDeckInfo about a deck', async () => {
    const lobby = lobbyNet({ seed: 61 });
    const A = await browser('ann', 'peer-a', 'Ann', 0);
    const B = await browser('ben', 'peer-b', 'Ben', 1);
    browsers.push(A, B);
    const deckA = await deckRecord('deck-secret-ann', 'Ann Secret Selesnya', 'gw-m19-60.txt');
    const deckB = await deckRecord('deck-secret-ben', 'Ben Hidden Izzet', 'ur-m19-60.mtga.txt');
    await A.stores.decks.put(deckA);
    await B.stores.decks.put(deckB);
    const a = mmPage(lobby, 'Ann', A.peerId, A.stores);
    const b = mmPage(lobby, 'Ben', B.peerId, B.stores);
    pages.push(a, b);
    a.mm.seek({ queues: ['1v1.constructed.ranked'], deckId: deckA.id });
    b.mm.seek({ queues: ['1v1.constructed.ranked'], deckId: deckB.id });
    await until(() => a.mm.status().phase === 'check' && b.mm.status().phase === 'check', 5_000, 'check');
    a.mm.answer(true);
    b.mm.answer(true);
    await until(() => a.mm.status().phase === 'moving' && b.mm.status().phase === 'moving', 5_000, 'moving');

    const wire = lobby.delivered.map((d) => d.msg as unknown as LobbyMessage);
    const logged = [...a.mm.messages(), ...b.mm.messages()].map((r) => r.msg);
    expect(wire.length).toBeGreaterThan(5);
    const secrets = [...secretsOf(deckA), ...secretsOf(deckB)];
    expect(leaks([...wire, ...logged], secrets)).toEqual([]);

    // The deck-derived fields are exactly band and score (the tuned band 4, score 63).
    const seeks = wire.filter((m): m is Extract<LobbyMessage, { t: 'seek' }> => m.t === 'seek');
    expect(seeks.length).toBeGreaterThan(0);
    for (const s of seeks) {
      expect(Object.keys(s.ticket).sort()).toEqual(['band', 'name', 'nat', 'open', 'peerId', 'proto', 'pubKey', 'queues', 'ratings', 'rev', 'score', 'sig', 'tid', 'v']);
      expect(s.ticket.band).toBe(4);
      expect(s.ticket.score).toBe(63);
    }

    // The check finds a leak when one is injected.
    const injected = [...wire, { ...seeks[0]!, ticket: { ...seeks[0]!.ticket, name: deckA.name } }];
    expect(leaks(injected, secrets)).not.toEqual([]);
    expect(leaks([{ v: 1, t: 'pass', mid: 'x', reason: `stale ${deckA.main[0]!.sid}` } as unknown as LobbyMessage], secrets)).not.toEqual([]);
  });
});
