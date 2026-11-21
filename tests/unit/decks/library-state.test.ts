/** The library model (journey.md 4.2; decks.md D1; contracts.md Part E search lock; PLAN M8-P3 library acceptance at the model level). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { importLibrary } from '../../../src/store/decks';
import { DEFAULT_HOME_PREFS, type DeckRecord, type DeckStore, type Settings, type SettingsStore } from '../../../src/store/types';
import { DeckLibrary, SEARCH_LOCK_TEXT, UNDO_WINDOW_MS } from '../../../src/ui/decks/state/library';
import type { CardDataSource } from '../../../src/data/types';
import { source } from './fixture-decks';

/** The app's card source on a fresh page: nothing in memory until getMany loads it (which waits for `gate`). */
function coldSource(gate: Promise<unknown> = Promise.resolve()): CardDataSource & { asked: number } {
  const loaded = new Set<string>();
  const cold = {
    asked: 0,
    get: (sid: string) => source.get(sid),
    getMany: async (sids: string[]) => {
      cold.asked++;
      await gate;
      for (const s of sids) loaded.add(s);
      return source.getMany(sids);
    },
    peek: (sid: string) => (loaded.has(sid) ? source.peek(sid) : null),
    resolveDeck: (l: Parameters<CardDataSource['resolveDeck']>[0]) => source.resolveDeck(l),
    searchTokens: (q: string) => source.searchTokens(q),
    relatedTokens: (c: Parameters<CardDataSource['relatedTokens']>[0]) => source.relatedTokens(c),
  };
  return cold;
}

const FILE = readFileSync(join(fileURLToPath(new URL('../../fixtures/decks', import.meta.url)), 'library-v1.json'), 'utf8');

function stores(): { decks: DeckStore & { map: Map<string, DeckRecord> }; settings: SettingsStore & { home: Settings['home'] } } {
  const map = new Map<string, DeckRecord>(importLibrary(FILE).decks.map((d) => [d.id, d]));
  const decks = {
    map,
    list: () => Promise.resolve([...map.values()].sort((a, b) => b.updatedAt - a.updatedAt)),
    get: (id: string) => Promise.resolve(map.get(id) ?? null),
    put: (d: DeckRecord) => (map.set(d.id, d), Promise.resolve()),
    delete: (id: string) => (map.delete(id), Promise.resolve()),
  };
  const settings = {
    home: { ...DEFAULT_HOME_PREFS },
    get(name: keyof Settings) {
      return Promise.resolve(name === 'home' ? this.home : undefined) as never;
    },
    set(name: keyof Settings, v: unknown) {
      if (name === 'home') this.home = v as Settings['home'];
      return Promise.resolve();
    },
    all: () => Promise.reject(new Error('unused')),
  };
  return { decks, settings };
}

function library(searching = false) {
  const s = stores();
  let n = 0;
  const lib = new DeckLibrary({ decks: s.decks, settings: s.settings, cardData: source, newId: () => `n${++n}`, now: () => 5_000_000_000_000, searching: () => searching });
  return { lib, ...s };
}

describe('DeckLibrary', () => {
  it('a seeded profile shows one CUSTOM and one BOOSTER deck, filtered', async () => {
    const { lib } = library();
    await lib.load();
    expect(lib.visible.map((d) => d.kind).sort()).toEqual(['custom', 'sealed']);
    lib.setFilter('sealed');
    expect(lib.visible.map((d) => d.id)).toEqual(['drafted-ur']);
    lib.setFilter('custom');
    expect(lib.visible.map((d) => d.id)).toEqual(['pasted-gw']);
    // Summaries were filled from card data and saved.
    expect(lib.decks.every((d) => d.summary && d.summary.cards === d.main.length)).toBe(true);
  });

  it('a click selects the deck Home plays with; while a search runs it answers the lock line', async () => {
    const { lib, settings } = library();
    await lib.load();
    expect(await lib.select('pasted-gw')).toBe(true);
    expect(settings.home.deckId).toBe('pasted-gw');
    const locked = library(true);
    await locked.lib.load();
    expect(await locked.lib.select('drafted-ur')).toBe(SEARCH_LOCK_TEXT);
    expect(locked.settings.home.deckId).toBeNull();
  });

  it('delete then UNDO restores; delete and the clock run on removes the record', async () => {
    vi.useFakeTimers();
    try {
      const { lib, decks } = library();
      await lib.load();
      lib.remove('pasted-gw');
      expect(lib.visible.map((d) => d.id)).toEqual(['drafted-ur']);
      expect(decks.map.has('pasted-gw')).toBe(true);
      expect(lib.undoRemove('pasted-gw')).toBe(true);
      expect(lib.visible).toHaveLength(2);
      lib.remove('pasted-gw');
      await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
      expect(decks.map.has('pasted-gw')).toBe(false);
      expect(lib.undoRemove('pasted-gw')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('convert keeps the booster deck and adds a custom copy; duplicate and rename save', async () => {
    const { lib, decks } = library();
    await lib.load();
    const before = JSON.stringify(decks.map.get('drafted-ur'));
    const copy = await lib.convert('drafted-ur');
    expect(copy?.kind).toBe('custom');
    expect(copy?.name).toBe('Thursday Draft (custom)');
    expect(JSON.stringify(decks.map.get('drafted-ur'))).toBe(before);
    const dup = await lib.duplicate('pasted-gw');
    expect(decks.map.get(dup!.id)?.name).toBe('Green-White Pasted (copy)');
    // The copy carries its own summary at once (its tile and Home read it before the library loads again).
    expect(decks.map.get(dup!.id)?.summary?.cards).toBe(decks.map.get('pasted-gw')!.main.length);
    expect(lib.decks.find((d) => d.id === dup!.id)?.summary).toBeDefined();
    await lib.rename('pasted-gw', '  Selesnya  ');
    expect(decks.map.get('pasted-gw')?.name).toBe('Selesnya');
  });
});

describe('DeckLibrary with card data not yet in memory', () => {
  async function warmed() {
    const s = stores();
    // A first visit leaves current summaries on every record: the next library load asks for no card data.
    await new DeckLibrary({ decks: s.decks, settings: s.settings, cardData: source, newId: () => 'w', now: () => 1 }).load();
    return s;
  }

  it('duplicate and convert load the card data before they summarise the copy', async () => {
    const s = await warmed();
    const cold = coldSource();
    let n = 0;
    const lib = new DeckLibrary({ decks: s.decks, settings: s.settings, cardData: cold, newId: () => `n${++n}`, now: () => 5_000_000_000_000 });
    await lib.load();
    expect(cold.asked).toBe(0);
    const dup = (await lib.duplicate('pasted-gw'))!;
    const conv = (await lib.convert('drafted-ur'))!;
    for (const copy of [dup, conv]) {
      const saved = s.decks.map.get(copy.id)!;
      expect(saved.summary?.unknown).toBe(0);
      expect(saved.summary?.colours.length).toBeGreaterThan(0);
    }
  });

  it('a copy whose card data does not load is saved without a summary, so the next load computes one', async () => {
    const s = await warmed();
    const offline = { ...coldSource(), getMany: () => Promise.reject(new Error('offline')) } as unknown as CardDataSource;
    const lib = new DeckLibrary({ decks: s.decks, settings: s.settings, cardData: offline, newId: () => 'n1', now: () => 5_000_000_000_000 });
    await lib.load();
    const dup = (await lib.duplicate('pasted-gw'))!;
    expect(s.decks.map.get(dup.id)!.summary).toBeUndefined();
  });

  it('a summary refresh never overwrites a record saved while its card data loaded, nor writes after dispose', async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const s = stores();
    const lib = new DeckLibrary({ decks: s.decks, settings: s.settings, cardData: coldSource(gate), newId: () => 'n1', now: () => 1 });
    const loading = lib.load();
    await vi.waitFor(() => expect(lib.decks).toHaveLength(2));
    // The deck page autosaves an edit while the library still waits for card data.
    const edited: DeckRecord = { ...s.decks.map.get('pasted-gw')!, main: [], updatedAt: 9_000_000_000_000 };
    s.decks.map.set(edited.id, edited);
    open();
    await loading;
    expect(s.decks.map.get('pasted-gw')).toBe(edited);
    expect(s.decks.map.get('drafted-ur')!.summary).toBeDefined();

    let open2!: () => void;
    const gate2 = new Promise<void>((r) => (open2 = r));
    const t = stores();
    const before = JSON.stringify([...t.decks.map.values()]);
    const left = new DeckLibrary({ decks: t.decks, settings: t.settings, cardData: coldSource(gate2), newId: () => 'n1', now: () => 1 });
    const loading2 = left.load();
    await vi.waitFor(() => expect(left.decks).toHaveLength(2));
    await left.dispose();
    open2();
    await loading2;
    expect(JSON.stringify([...t.decks.map.values()])).toBe(before);
  });
});
