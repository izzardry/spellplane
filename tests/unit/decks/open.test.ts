/**
 * Booster decks without the page (decks.md D3, D11, D18; contracts.md Part G "Decks" item 1; PLAN M8-P3 sealed
 * acceptance at the model level): OPEN saves the sealed record with the whole pool before anything is shown, the
 * reveal ends on a pre-made 40-card deck, one undo empties it, SUGGEST A DECK gives the same 40 again, an outside card
 * answers notInPool, CONVERT makes a custom copy and leaves the original byte-equal, quickBoosterDeck makes FIRST BOOSTERS.
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../../src/core/hash';
import { add, setMain } from '../../../src/data/deck/edit';
import { convertToCustom } from '../../../src/data/deck/seal';
import { fixtureSetSource } from '../../../src/debug/fixture-sets';
import type { DeckRecord, DeckStore } from '../../../src/store/types';
import { summarise } from '../../../src/data/deck/summary';
import { DeckEditor } from '../../../src/ui/decks/state/editor';
import { boosterDeckName, finishOpening, markSuggest, openBoosterDeck, pinNextSeed, revealedWhileShowing, suggestFor, takeSuggest } from '../../../src/ui/decks/state/open';
import { QUICK_DECK_NAME, quickBoosterDeck } from '../../../src/ui/decks/state/quick';
import { lookup, named, setData, source } from './fixture-decks';

function memoryStore(): DeckStore & { writes: DeckRecord[]; map: Map<string, DeckRecord> } {
  const map = new Map<string, DeckRecord>();
  const writes: DeckRecord[] = [];
  return {
    map,
    writes,
    list: () => Promise.resolve([...map.values()]),
    get: (id) => Promise.resolve(map.get(id) ?? null),
    put: (d) => {
      const copy = JSON.parse(JSON.stringify(d)) as DeckRecord;
      writes.push(copy);
      map.set(d.id, copy);
      return Promise.resolve();
    },
    delete: (id) => (map.delete(id), Promise.resolve()),
  };
}

const SEED = '5eed'.repeat(16);

function deps(store = memoryStore()) {
  let n = 0;
  return { store, d: { decks: store, sets: fixtureSetSource([setData('M19')]), cardData: source, newId: () => `deck-${++n}`, now: () => Date.UTC(2026, 10, 20, 12), seed: () => SEED } };
}

describe('OPEN', () => {
  it('saves a sealed deck of 90 pool cards with nothing revealed before anything is shown', async () => {
    const { store, d } = deps();
    const deck = await openBoosterDeck(d, 6, ['M19']);
    expect(store.writes).toHaveLength(1);
    const saved = store.writes[0]!;
    expect(saved.kind).toBe('sealed');
    expect(saved.seal?.pool).toHaveLength(90);
    expect(saved.seal?.revealed).toBe(0);
    expect(saved.seal?.seed).toBe(SEED);
    expect(saved.seal?.sets).toEqual(['M19', 'M19', 'M19', 'M19', 'M19', 'M19']);
    expect(saved.main).toEqual([]);
    expect(saved.name).toBe('M19 boosters · 20 Nov');
    // Edits wait for the opening.
    expect(add(deck, saved.seal!.pool[0]!, 'main', 1, lookup(saved.seal!.pool[0]!))).toEqual({ ok: false, reason: 'opening' });
  });

  it('ends on a page with 40 cards in MAIN; one undo empties it; SUGGEST gives the same 40 again', async () => {
    const { store, d } = deps();
    const opened = await openBoosterDeck(d, 6, ['M19']);
    const { deck, suggestion } = await finishOpening(d, opened);
    expect(deck.main).toHaveLength(40);
    expect(deck.seal?.revealed).toBe(6);
    expect(deck.summary?.cards).toBe(40);
    expect(store.map.get(deck.id)?.main).toHaveLength(40);
    // The deck page: the suggestion is undone as one step, then suggested again.
    const editor = new DeckEditor({ ...deck, main: [] }, { store, lookup, now: () => 1 });
    editor.apply((x) => setMain(x, suggestion!.main, lookup));
    expect(editor.deck.main).toHaveLength(40);
    editor.undo();
    expect(editor.deck.main).toHaveLength(0);
    const again = await suggestFor(editor.deck, source);
    editor.apply((x) => setMain(x, again!.main, lookup));
    expect(editor.deck.main).toEqual(deck.main);
    await editor.dispose();
  });

  it("without the pool's card data no deck is suggested, and the deck page suggests once the data is there", async () => {
    const { d } = deps();
    const opened = await openBoosterDeck(d, 6, ['M19']);
    // The page's source with nothing loaded and the network gone: every lookup fails.
    const offline = { ...source, peek: () => null, getMany: () => Promise.reject(new Error('offline')), resolveDeck: () => Promise.reject(new Error('offline')) } as unknown as typeof source;
    expect(await suggestFor({ ...opened, seal: { ...opened.seal!, revealed: 6 } }, offline)).toBeNull();
    const { deck, suggestion } = await finishOpening({ ...d, cardData: offline }, opened);
    expect(suggestion).toBeNull();
    // No basics-only deck and no summary, so the automatic suggestion still runs on the deck page.
    expect(deck.main).toHaveLength(0);
    expect(deck.summary).toBeUndefined();
    expect(takeSuggest(deck.id, deck)).toBe(true);
  });

  it('a card from outside the pool answers notInPool; CONVERT makes a custom copy and the original is byte-equal', async () => {
    const { d } = deps();
    const { deck } = await finishOpening(d, await openBoosterDeck(d, 6, ['M19']));
    const outside = ['Cancel', 'Shock', 'Divination', 'Llanowar Elves', 'Colossal Dreadmaw', 'Pelakka Wurm'].map((n) => named(n)).find((c) => !deck.seal!.pool.some((r) => r.sid === c.id))!;
    expect(add(deck, { sid: outside.id }, 'main', 1, outside)).toEqual({ ok: false, reason: 'notInPool' });
    const before = canonicalJson(deck);
    const copy = convertToCustom(deck, 'copy-1', 5);
    expect(canonicalJson(deck)).toBe(before);
    expect(copy.kind).toBe('custom');
    expect(add(copy, { sid: outside.id }, 'main', 1, outside).ok).toBe(true);
  });

  it('a pinned seed opens the same pool twice; an unknown set saves nothing', async () => {
    const a = deps();
    pinNextSeed('ab'.repeat(32));
    const one = await openBoosterDeck(a.d, 6, ['M19']);
    pinNextSeed('ab'.repeat(32));
    const two = await openBoosterDeck(a.d, 6, ['M19']);
    expect(two.seal?.pool).toEqual(one.seal?.pool);
    const b = deps();
    await expect(openBoosterDeck(b.d, 6, ['XYZ'])).rejects.toThrow(/XYZ/);
    expect(b.store.writes).toHaveLength(0);
  });

  it('quickBoosterDeck returns a 40-card sealed deck named FIRST BOOSTERS from the latest core set', async () => {
    const { store, d } = deps();
    const id = await quickBoosterDeck(d);
    const deck = store.map.get(id)!;
    expect(deck.name).toBe(QUICK_DECK_NAME);
    expect(deck.kind).toBe('sealed');
    expect(deck.main).toHaveLength(40);
    expect(deck.seal?.sets[0]).toBe('M19');
    expect(deck.seal?.revealed).toBe(6);
  });

  it('names mixed boosters MIXED', () => {
    expect(boosterDeckName(['M19', 'M20'], Date.UTC(2026, 0, 2))).toBe('MIXED boosters · 2 Jan');
  });
});

describe('the end of the opening survives a reload (contracts.md Part G "Decks" item 1)', () => {
  it('the last pack counts as revealed only when the opening ends', () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => revealedWhileShowing(i, 6))).toEqual([1, 2, 3, 4, 5, 5]);
    expect(revealedWhileShowing(0, 1)).toBe(0);
  });

  it('the deck page suggests for a finished opening that was never saved, even without the in-page mark', async () => {
    const { d } = deps();
    const deck = await openBoosterDeck(d, 6, ['M19']);
    const opened: DeckRecord = { ...deck, seal: { ...deck.seal!, revealed: 6 } };
    expect(takeSuggest(opened.id, opened)).toBe(true);
    // Still opening, already built, or saved by an edit (a summary): no suggestion.
    expect(takeSuggest(deck.id, deck)).toBe(false);
    expect(takeSuggest(opened.id, { ...opened, main: [opened.side[0]!] })).toBe(false);
    expect(takeSuggest(opened.id, { ...opened, summary: summarise(opened, lookup) })).toBe(false);
    // The mark is taken once.
    markSuggest('x');
    expect(takeSuggest('x')).toBe(true);
    expect(takeSuggest('x')).toBe(false);
  });
});
